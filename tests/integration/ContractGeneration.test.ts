import request from 'supertest'
import { app } from '../../backend/src/app'
import { AIGenerationService } from '../../backend/src/services/ai/AIGenerationService'
import { ContractAnalyzer } from '../../backend/src/services/analysis/ContractAnalyzer'
import { AuthenticationService } from '../../backend/src/services/security/AuthenticationService'
import { DatabaseService } from '../../backend/src/services/database/DatabaseService'
import { CacheService } from '../../backend/src/services/cache/CacheService'
import { WebSocketService } from '../../backend/src/services/websocket/WebSocketService'
import { createServer } from 'http'
import WebSocket from 'ws'
import { GenerationOptions } from '../../backend/src/types'

describe('Contract Generation Integration Tests', () => {
  let server: any
  let authToken: string
  let wsClient: WebSocket
  let testContractId: string

  const testUser = {
    username: 'testuser',
    password: 'TestPassword123!'
  }

  const mockContract = {
    name: 'Test Token Contract',
    description: 'A test token contract for Solana',
    prompt: 'Create a basic SPL token contract with mint and transfer functionality'
  }

  const mockOptions: GenerationOptions = {
    security: 'high',
    optimization: 'medium',
    testing: true,
    autoFormat: true,
    liveAnalysis: true
  }

  beforeAll(async () => {
    // Initialize services
    await DatabaseService.getInstance().connect()
    await CacheService.getInstance().connect()
    
    // Create test user and get auth token
    const auth = AuthenticationService.getInstance()
    const result = await auth.authenticate(
      testUser.username,
      testUser.password,
      '127.0.0.1'
    )
    authToken = result.token

    // Setup WebSocket server
    server = createServer(app)
    const wss = WebSocketService.getInstance(server)
    server.listen(0) // Random port for testing

    // Setup WebSocket client
    const port = (server.address() as any).port
    wsClient = new WebSocket(`ws://localhost:${port}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    })

    await new Promise(resolve => wsClient.on('open', resolve))
  })

  afterAll(async () => {
    await DatabaseService.getInstance().disconnect()
    await CacheService.getInstance().disconnect()
    wsClient.close()
    server.close()
  })

  beforeEach(() => {
    jest.setTimeout(30000) // 30 seconds timeout for generation tests
  })

  describe('Contract Generation Flow', () => {
    it('should generate a new contract successfully', async () => {
      const response = await request(app)
        .post('/api/contracts/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ...mockContract,
          options: mockOptions
        })

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('id')
      expect(response.body).toHaveProperty('code')
      expect(response.body.code).toContain('use solana_program')
      testContractId = response.body.id
    })

    it('should receive generation progress via WebSocket', (done) => {
      const progressUpdates: number[] = []

      wsClient.on('message', (data) => {
        const message = JSON.parse(data.toString())
        if (message.type === 'generation_progress') {
          progressUpdates.push(message.payload.progress)
          if (message.payload.progress === 100) {
            expect(progressUpdates).toEqual(
              expect.arrayContaining([25, 50, 75, 100])
            )
            done()
          }
        }
      })

      wsClient.send(JSON.stringify({
        type: 'subscribe',
        channel: `contract_generation_${testContractId}`
      }))
    })

    it('should analyze the generated contract', async () => {
      const response = await request(app)
        .get(`/api/contracts/${testContractId}/analysis`)
        .set('Authorization', `Bearer ${authToken}`)

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('securityScore')
      expect(response.body).toHaveProperty('optimizationScore')
      expect(response.body).toHaveProperty('testCoverage')
      expect(response.body.securityScore).toBeGreaterThanOrEqual(80)
    })

    it('should compile the generated contract', async () => {
      const response = await request(app)
        .post(`/api/contracts/${testContractId}/compile`)
        .set('Authorization', `Bearer ${authToken}`)

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('success', true)
      expect(response.body).toHaveProperty('programId')
      expect(response.body).toHaveProperty('programSize')
    })

    it('should save contract modifications', async () => {
      const updates = {
        code: `// Updated contract code
use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    pubkey::Pubkey,
    msg,
    program_error::ProgramError,
};

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> Result<(), ProgramError> {
    msg!("Updated contract");
    Ok(())
}`
      }

      const response = await request(app)
        .put(`/api/contracts/${testContractId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updates)

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('code', updates.code)
      expect(response.body).toHaveProperty('updated')
    })

    it('should validate contract syntax', async () => {
      const response = await request(app)
        .post(`/api/contracts/${testContractId}/validate`)
        .set('Authorization', `Bearer ${authToken}`)

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('valid', true)
      expect(response.body).toHaveProperty('errors', [])
    })

    it('should handle concurrent generations properly', async () => {
      const promises = Array(3).fill(null).map(() =>
        request(app)
          .post('/api/contracts/generate')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            ...mockContract,
            options: mockOptions
          })
      )

      const responses = await Promise.all(promises)
      responses.forEach(response => {
        expect(response.status).toBe(200)
        expect(response.body).toHaveProperty('id')
        expect(response.body).toHaveProperty('code')
      })
    })

    it('should handle rate limiting properly', async () => {
      const promises = Array(11).fill(null).map(() =>
        request(app)
          .post('/api/contracts/generate')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            ...mockContract,
            options: mockOptions
          })
      )

      const responses = await Promise.all(promises)
      const rateLimited = responses.some(r => r.status === 429)
      expect(rateLimited).toBe(true)
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid contract syntax', async () => {
      const response = await request(app)
        .post('/api/contracts/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ...mockContract,
          prompt: 'Invalid Rust syntax: fn main() {'
        })

      expect(response.status).toBe(400)
      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toContain('syntax error')
    })

    it('should handle service unavailability gracefully', async () => {
      // Simulate AI service downtime
      jest.spyOn(AIGenerationService.prototype, 'generateContract')
        .mockRejectedValueOnce(new Error('Service unavailable'))

      const response = await request(app)
        .post('/api/contracts/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ...mockContract,
          options: mockOptions
        })

      expect(response.status).toBe(503)
      expect(response.body).toHaveProperty('error')
      expect(response.body.error).toContain('service unavailable')
    })

    it('should handle invalid authentication', async () => {
      const response = await request(app)
        .post('/api/contracts/generate')
        .set('Authorization', 'Bearer invalid_token')
        .send({
          ...mockContract,
          options: mockOptions
        })

      expect(response.status).toBe(401)
    })
  })

  describe('Performance', () => {
    it('should generate contracts within acceptable time', async () => {
      const startTime = Date.now()
      
      const response = await request(app)
        .post('/api/contracts/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ...mockContract,
          options: mockOptions
        })

      const duration = Date.now() - startTime
      expect(response.status).toBe(200)
      expect(duration).toBeLessThan(10000) // 10 seconds max
    })

    it('should handle large contracts efficiently', async () => {
      const largePrompt = 'Create a complex DEX contract with ' +
        'multiple pool types, oracle integration, and governance features'

      const response = await request(app)
        .post('/api/contracts/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ...mockContract,
          prompt: largePrompt,
          options: mockOptions
        })

      expect(response.status).toBe(200)
      expect(response.body.code.length).toBeGreaterThan(1000)
    })
  })
})
