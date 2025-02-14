import WebSocket from 'ws'
import { Server } from 'http'
import { AuthenticationService } from '../security/AuthenticationService'
import { MetricsService } from '../monitoring/MetricsService'
import { CacheService } from '../cache/CacheService'
import { logger, logError } from '../../utils/logger'
import config from '../../config/config'

interface WebSocketClient extends WebSocket {
  id: string
  userId: string
  isAlive: boolean
  subscriptions: Set<string>
}

interface Message {
  type: string
  payload: any
  channel?: string
}

export class WebSocketService {
  private static instance: WebSocketService
  private wss: WebSocket.Server
  private clients: Map<string, WebSocketClient>
  private channels: Map<string, Set<string>>
  private auth: AuthenticationService
  private metrics: MetricsService
  private cache: CacheService

  private readonly PING_INTERVAL = config.websocket.pingInterval
  private readonly CLIENT_TIMEOUT = config.websocket.timeout
  private readonly MAX_CONNECTIONS = config.websocket.maxConnections
  private readonly MESSAGE_SIZE_LIMIT = 1024 * 1024 // 1MB
  private readonly RATE_LIMIT_WINDOW = 1000 // 1 second
  private readonly MAX_MESSAGES_PER_WINDOW = 50

  private constructor(server: Server) {
    this.wss = new WebSocket.Server({
      server,
      maxPayload: this.MESSAGE_SIZE_LIMIT,
      clientTracking: true,
      perMessageDeflate: {
        zlibDeflateOptions: {
          level: 6 // Balance between compression and CPU usage
        }
      }
    })

    this.clients = new Map()
    this.channels = new Map()
    this.auth = AuthenticationService.getInstance()
    this.metrics = MetricsService.getInstance()
    this.cache = CacheService.getInstance()

    this.initializeWebSocket()
    this.startHeartbeat()
  }

  public static getInstance(server: Server): WebSocketService {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService(server)
    }
    return WebSocketService.instance
  }

  private initializeWebSocket(): void {
    this.wss.on('connection', async (ws: WebSocket, req) => {
      try {
        if (this.clients.size >= this.MAX_CONNECTIONS) {
          ws.close(1013, 'Maximum connections reached')
          return
        }

        const token = this.extractToken(req)
        if (!token) {
          ws.close(1008, 'Authentication required')
          return
        }

        const payload = await this.auth.validateToken(token)
        const client = this.setupClient(ws as WebSocketClient, payload.userId)

        this.setupMessageHandling(client)
        this.metrics.increment('ws_connections_total')
        this.metrics.gauge('ws_active_connections', this.clients.size)

      } catch (error) {
        logError('WebSocket connection failed', error as Error)
        ws.close(1011, 'Internal server error')
      }
    })
  }

  private setupClient(ws: WebSocketClient, userId: string): WebSocketClient {
    const clientId = require('crypto').randomBytes(16).toString('hex')
    
    ws.id = clientId
    ws.userId = userId
    ws.isAlive = true
    ws.subscriptions = new Set()

    this.clients.set(clientId, ws)
    
    return ws
  }

  private setupMessageHandling(client: WebSocketClient): void {
    client.on('message', async (data: WebSocket.Data) => {
      try {
        const message = this.parseMessage(data)
        if (!message) return

        // Rate limiting check
        if (!this.checkRateLimit(client)) {
          client.close(1008, 'Rate limit exceeded')
          return
        }

        await this.handleMessage(client, message)

      } catch (error) {
        logError('WebSocket message handling failed', error as Error)
        this.sendError(client, 'Message processing failed')
      }
    })

    client.on('pong', () => {
      client.isAlive = true
    })

    client.on('close', () => {
      this.handleDisconnect(client)
    })

    client.on('error', (error) => {
      logError(`WebSocket client error: ${client.id}`, error)
      this.handleDisconnect(client)
    })
  }

  private async handleMessage(
    client: WebSocketClient,
    message: Message
  ): Promise<void> {
    switch (message.type) {
      case 'subscribe':
        await this.handleSubscribe(client, message.channel!)
        break

      case 'unsubscribe':
        await this.handleUnsubscribe(client, message.channel!)
        break

      case 'broadcast':
        await this.handleBroadcast(client, message)
        break

      default:
        this.sendError(client, 'Unknown message type')
    }
  }

  private async handleSubscribe(
    client: WebSocketClient,
    channel: string
  ): Promise<void> {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set())
    }

    this.channels.get(channel)!.add(client.id)
    client.subscriptions.add(channel)

    this.sendToClient(client, {
      type: 'subscribed',
      channel,
      payload: { status: 'success' }
    })
  }

  private async handleUnsubscribe(
    client: WebSocketClient,
    channel: string
  ): Promise<void> {
    if (this.channels.has(channel)) {
      this.channels.get(channel)!.delete(client.id)
      client.subscriptions.delete(channel)
    }

    this.sendToClient(client, {
      type: 'unsubscribed',
      channel,
      payload: { status: 'success' }
    })
  }

  private async handleBroadcast(
    client: WebSocketClient,
    message: Message
  ): Promise<void> {
    if (!message.channel) {
      this.sendError(client, 'Channel is required for broadcast')
      return
    }

    this.broadcast(message.channel, message.payload, [client.id])
  }

  public async broadcast(
    channel: string,
    data: any,
    excludeIds: string[] = []
  ): Promise<void> {
    const subscribers = this.channels.get(channel)
    if (!subscribers) return

    const message = JSON.stringify({
      type: 'message',
      channel,
      payload: data,
      timestamp: Date.now()
    })

    for (const clientId of subscribers) {
      if (excludeIds.includes(clientId)) continue
      
      const client = this.clients.get(clientId)
      if (client && client.readyState === WebSocket.OPEN) {
        client.send(message)
      }
    }
  }

  private handleDisconnect(client: WebSocketClient): void {
    // Clean up subscriptions
    for (const channel of client.subscriptions) {
      if (this.channels.has(channel)) {
        this.channels.get(channel)!.delete(client.id)
      }
    }

    this.clients.delete(client.id)
    this.metrics.gauge('ws_active_connections', this.clients.size)
  }

  private startHeartbeat(): void {
    setInterval(() => {
      this.wss.clients.forEach((ws: WebSocket) => {
        const client = ws as WebSocketClient
        
        if (!client.isAlive) {
          client.terminate()
          return
        }

        client.isAlive = false
        client.ping()
      })
    }, this.PING_INTERVAL)
  }

  private async checkRateLimit(client: WebSocketClient): Promise<boolean> {
    const key = `ws_rate_limit:${client.id}`
    const count = await this.cache.get<number>(key) || 0

    if (count >= this.MAX_MESSAGES_PER_WINDOW) {
      return false
    }

    await this.cache.set(
      key,
      count + 1,
      this.RATE_LIMIT_WINDOW / 1000
    )

    return true
  }

  private extractToken(req: any): string | null {
    const auth = req.headers['authorization']
    if (!auth) return null

    const parts = auth.split(' ')
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return null
    }

    return parts[1]
  }

  private parseMessage(data: WebSocket.Data): Message | null {
    try {
      return JSON.parse(data.toString())
    } catch {
      return null
    }
  }

  private sendToClient(client: WebSocketClient, message: any): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message))
    }
  }

  private sendError(client: WebSocketClient, message: string): void {
    this.sendToClient(client, {
      type: 'error',
      payload: { message }
    })
  }

  public getActiveConnections(): number {
    return this.clients.size
  }

  public getChannelSubscribers(channel: string): number {
    return this.channels.get(channel)?.size || 0
  }
}

export default WebSocketService
