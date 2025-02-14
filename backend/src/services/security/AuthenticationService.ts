import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { v4 as uuidv4 } from 'uuid'
import { DatabaseService } from '../database/DatabaseService'
import { CacheService } from '../cache/CacheService'
import { MetricsService } from '../monitoring/MetricsService'
import { AuthenticationError, AuthorizationError } from '../../utils/errors'
import { logger, logError } from '../../utils/logger'
import config from '../../config/config'

interface TokenPayload {
  userId: string
  sessionId: string
  role: string
  iat?: number
  exp?: number
}

interface AuthenticationResult {
  token: string
  refreshToken: string
  expiresIn: number
}

export class AuthenticationService {
  private static instance: AuthenticationService
  private db: DatabaseService
  private cache: CacheService
  private metrics: MetricsService

  private readonly SALT_ROUNDS = 12
  private readonly TOKEN_VERSION = 'v1'
  private readonly MAX_SESSIONS_PER_USER = 5
  private readonly REFRESH_TOKEN_LENGTH = 40
  private readonly MAX_FAILED_ATTEMPTS = 5
  private readonly LOCKOUT_DURATION = 15 * 60 * 1000 // 15 minutes
  private readonly SESSION_CLEANUP_INTERVAL = 3600000 // 1 hour

  private constructor() {
    this.db = DatabaseService.getInstance()
    this.cache = CacheService.getInstance()
    this.metrics = MetricsService.getInstance()
    this.startSessionCleanup()
  }

  public static getInstance(): AuthenticationService {
    if (!AuthenticationService.instance) {
      AuthenticationService.instance = new AuthenticationService()
    }
    return AuthenticationService.instance
  }

  public async authenticate(
    username: string,
    password: string,
    ipAddress: string
  ): Promise<AuthenticationResult> {
    const startTime = performance.now()

    try {
      // Check for account lockout
      await this.checkAccountLockout(username, ipAddress)

      // Get user from database
      const user = await this.getUserByUsername(username)
      if (!user) {
        await this.handleFailedLogin(username, ipAddress)
        throw new AuthenticationError('Invalid credentials')
      }

      // Verify password
      const isValid = await bcrypt.compare(password, user.password_hash)
      if (!isValid) {
        await this.handleFailedLogin(username, ipAddress)
        throw new AuthenticationError('Invalid credentials')
      }

      // Clear failed attempts on successful login
      await this.clearFailedAttempts(username, ipAddress)

      // Generate tokens
      const sessionId = uuidv4()
      const token = await this.generateToken(user.id, sessionId, user.role)
      const refreshToken = await this.generateRefreshToken(user.id, sessionId)

      // Store session
      await this.storeSession(user.id, sessionId, ipAddress)

      // Record metrics
      this.recordMetrics('success', startTime)

      return {
        token,
        refreshToken,
        expiresIn: config.security.jwtExpiresIn
      }

    } catch (error) {
      this.recordMetrics('error', startTime)
      throw error
    }
  }

  public async validateToken(token: string): Promise<TokenPayload> {
    try {
      // Verify token
      const decoded = jwt.verify(token, config.security.jwtSecret) as TokenPayload

      // Check if session is valid
      const isValidSession = await this.validateSession(decoded.userId, decoded.sessionId)
      if (!isValidSession) {
        throw new AuthorizationError('Invalid session')
      }

      return decoded

    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AuthenticationError('Token expired')
      }
      throw new AuthenticationError('Invalid token')
    }
  }

  public async refreshToken(
    refreshToken: string,
    ipAddress: string
  ): Promise<AuthenticationResult> {
    try {
      // Get refresh token data
      const tokenData = await this.getRefreshTokenData(refreshToken)
      if (!tokenData) {
        throw new AuthenticationError('Invalid refresh token')
      }

      // Validate session
      const isValidSession = await this.validateSession(
        tokenData.userId,
        tokenData.sessionId
      )
      if (!isValidSession) {
        throw new AuthenticationError('Invalid session')
      }

      // Get user data
      const user = await this.getUserById(tokenData.userId)
      if (!user) {
        throw new AuthenticationError('User not found')
      }

      // Generate new tokens
      const newToken = await this.generateToken(
        user.id,
        tokenData.sessionId,
        user.role
      )
      const newRefreshToken = await this.generateRefreshToken(
        user.id,
        tokenData.sessionId
      )

      // Update session
      await this.updateSession(
        user.id,
        tokenData.sessionId,
        ipAddress
      )

      return {
        token: newToken,
        refreshToken: newRefreshToken,
        expiresIn: config.security.jwtExpiresIn
      }

    } catch (error) {
      throw new AuthenticationError('Token refresh failed')
    }
  }

  public async logout(userId: string, sessionId: string): Promise<void> {
    try {
      await this.invalidateSession(userId, sessionId)
    } catch (error) {
      logError('Logout failed', error as Error)
    }
  }

  public async logoutAll(userId: string): Promise<void> {
    try {
      await this.invalidateAllSessions(userId)
    } catch (error) {
      logError('Logout all failed', error as Error)
    }
  }

  private async generateToken(
    userId: string,
    sessionId: string,
    role: string
  ): Promise<string> {
    const payload: TokenPayload = {
      userId,
      sessionId,
      role
    }

    return jwt.sign(payload, config.security.jwtSecret, {
      expiresIn: config.security.jwtExpiresIn,
      algorithm: 'HS256',
      issuer: 'solsynthai',
      audience: 'api'
    })
  }

  private async generateRefreshToken(
    userId: string,
    sessionId: string
  ): Promise<string> {
    const token = require('crypto')
      .randomBytes(this.REFRESH_TOKEN_LENGTH)
      .toString('hex')

    await this.storeRefreshToken(token, userId, sessionId)
    return token
  }

  private async storeRefreshToken(
    token: string,
    userId: string,
    sessionId: string
  ): Promise<void> {
    await this.cache.set(
      `refresh_token:${token}`,
      { userId, sessionId },
      30 * 24 * 60 * 60 // 30 days
    )
  }

  private async getRefreshTokenData(
    token: string
  ): Promise<{ userId: string; sessionId: string } | null> {
    return this.cache.get(`refresh_token:${token}`)
  }

  private async storeSession(
    userId: string,
    sessionId: string,
    ipAddress: string
  ): Promise<void> {
    const session = {
      id: sessionId,
      userId,
      ipAddress,
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString()
    }

    await this.db.query(
      'INSERT INTO sessions (id, user_id, ip_address, created_at, last_accessed_at) VALUES ($1, $2, $3, $4, $5)',
      [session.id, session.userId, session.ipAddress, session.createdAt, session.lastAccessedAt]
    )

    await this.cache.set(
      `session:${userId}:${sessionId}`,
      session,
      24 * 60 * 60 // 24 hours
    )
  }

  private async validateSession(
    userId: string,
    sessionId: string
  ): Promise<boolean> {
    const session = await this.cache.get(`session:${userId}:${sessionId}`)
    return !!session
  }

  private async updateSession(
    userId: string,
    sessionId: string,
    ipAddress: string
  ): Promise<void> {
    const now = new Date().toISOString()

    await this.db.query(
      'UPDATE sessions SET last_accessed_at = $1, ip_address = $2 WHERE id = $3 AND user_id = $4',
      [now, ipAddress, sessionId, userId]
    )

    const session = await this.cache.get(`session:${userId}:${sessionId}`)
    if (session) {
      session.lastAccessedAt = now
      session.ipAddress = ipAddress
      await this.cache.set(
        `session:${userId}:${sessionId}`,
        session,
        24 * 60 * 60
      )
    }
  }

  private async invalidateSession(
    userId: string,
    sessionId: string
  ): Promise<void> {
    await this.db.query(
      'DELETE FROM sessions WHERE id = $1 AND user_id = $2',
      [sessionId, userId]
    )
    await this.cache.delete(`session:${userId}:${sessionId}`)
  }

  private async invalidateAllSessions(userId: string): Promise<void> {
    await this.db.query(
      'DELETE FROM sessions WHERE user_id = $1',
      [userId]
    )

    const sessions = await this.db.query(
      'SELECT id FROM sessions WHERE user_id = $1',
      [userId]
    )

    for (const session of sessions.rows) {
      await this.cache.delete(`session:${userId}:${session.id}`)
    }
  }

  private async checkAccountLockout(
    username: string,
    ipAddress: string
  ): Promise<void> {
    const key = `login_attempts:${username}:${ipAddress}`
    const attempts = await this.cache.get<number>(key) || 0

    if (attempts >= this.MAX_FAILED_ATTEMPTS) {
      throw new AuthenticationError('Account locked. Try again later.')
    }
  }

  private async handleFailedLogin(
    username: string,
    ipAddress: string
  ): Promise<void> {
    const key = `login_attempts:${username}:${ipAddress}`
    const attempts = (await this.cache.get<number>(key) || 0) + 1

    await this.cache.set(
      key,
      attempts,
      this.LOCKOUT_DURATION / 1000
    )

    this.metrics.increment('auth_failures_total', {
      username,
      ip: ipAddress
    })
  }

  private async clearFailedAttempts(
    username: string,
    ipAddress: string
  ): Promise<void> {
    const key = `login_attempts:${username}:${ipAddress}`
    await this.cache.delete(key)
  }

  private async getUserByUsername(username: string): Promise<any> {
    const result = await this.db.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    )
    return result.rows[0]
  }

  private async getUserById(userId: string): Promise<any> {
    const result = await this.db.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    )
    return result.rows[0]
  }

  private startSessionCleanup(): void {
    setInterval(async () => {
      try {
        await this.db.query(`
          DELETE FROM sessions 
          WHERE last_accessed_at < NOW() - INTERVAL '24 hours'
        `)
      } catch (error) {
        logError('Session cleanup failed', error as Error)
      }
    }, this.SESSION_CLEANUP_INTERVAL)
  }

  private recordMetrics(
    status: 'success' | 'error',
    startTime: number
  ): void {
    const duration = performance.now() - startTime
    this.metrics.gauge('auth_operation_duration', duration)
    this.metrics.increment(`auth_${status}_total`)
  }
}

export default AuthenticationService
