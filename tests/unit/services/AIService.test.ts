import { AIGenerationService } from '../../../backend/src/services/ai/AIGenerationService'
import { ContractAnalyzer } from '../../../backend/src/services/analysis/ContractAnalyzer'
import { SecurityPatternGenerator } from '../../../backend/src/services/generation/rust/security/SecurityPatternGenerator'
import { TemplateEngine } from '../../../backend/src/services/generation/template/TemplateEngine'
import { CacheService } from '../../../backend/src/services/cache/CacheService'
import { MetricsService } from '../../../backend/src/services/monitoring/MetricsService'
import { GenerationOptions } from '../../../backend/src/types'

// Mock dependencies
jest.mock('../../../backend/src/services/cache/CacheService')
jest.mock('../../../backend/src/services/monitoring/MetricsService')
jest.mock('../../../backend/src/services/generation/template/TemplateEngine')
jest.mock('../../../backend/src/services/generation/rust/security/SecurityPatternGenerator')

describe('AIGenerationService', () => {
  let aiService: AIGenerationService
  let analyzer: ContractAnalyzer
  let templateEngine: jest.Mocked<TemplateEngine>
  let securityGenerator: jest.Mocked<SecurityPatternGenerator>
  let cache: jest.Mocked<CacheService>
  let metrics: jest.Mocked<MetricsService>

  const mockOptions: GenerationOptions = {
    security: 'high',
    optimization: 'medium',
    testing: true,
    autoFormat: true,
    liveAnalysis: true
  }

  const mockPrompt = 'Create a Solana token contract with mint and transfer functionality'

  const mockTemplateCode = `
use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    pubkey::Pubkey,
    program_error::ProgramError,
};

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> Result<(), ProgramError> {
    Ok(())
}`

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks()

    // Setup mock implementations
    templateEngine = new TemplateEngine() as jest.Mocked<TemplateEngine>
    securityGenerator = new SecurityPatternGenerator() as jest.Mocked<SecurityPatternGenerator>
    cache = CacheService.getInstance() as jest.Mocked<CacheService>
    metrics = MetricsService.getInstance() as jest.Mocked<MetricsService>
    analyzer = ContractAnalyzer.getInstance()

    // Initialize service
    aiService = AIGenerationService.getInstance()
  })

  describe('generateContract', () => {
    it('should generate a contract successfully', async () => {
      const mockGeneratedCode = mockTemplateCode
      const mockSecurityEnhancements = '// Security enhancements\n' + mockTemplateCode

      templateEngine.generateFromPrompt.mockResolvedValueOnce(mockGeneratedCode)
      securityGenerator.enhance.mockResolvedValueOnce(mockSecurityEnhancements)

      const result = await aiService.generateContract(mockPrompt, mockOptions)

      expect(result).toBeDefined()
      expect(result.code).toBe(mockSecurityEnhancements)
      expect(templateEngine.generateFromPrompt).toHaveBeenCalledWith(
        mockPrompt,
        expect.any(Object)
      )
      expect(securityGenerator.enhance).toHaveBeenCalledWith(
        mockGeneratedCode,
        mockOptions.security
      )
      expect(metrics.increment).toHaveBeenCalledWith('contracts_generated_total')
    })

    it('should handle generation errors gracefully', async () => {
      const error = new Error('Generation failed')
      templateEngine.generateFromPrompt.mockRejectedValueOnce(error)

      await expect(
        aiService.generateContract(mockPrompt, mockOptions)
      ).rejects.toThrow('Generation failed')

      expect(metrics.increment).toHaveBeenCalledWith('generation_errors_total')
    })

    it('should cache generated contracts', async () => {
      const mockGeneratedCode = mockTemplateCode
      templateEngine.generateFromPrompt.mockResolvedValueOnce(mockGeneratedCode)
      securityGenerator.enhance.mockResolvedValueOnce(mockGeneratedCode)

      // First generation
      await aiService.generateContract(mockPrompt, mockOptions)

      // Second generation with same prompt
      await aiService.generateContract(mockPrompt, mockOptions)

      expect(templateEngine.generateFromPrompt).toHaveBeenCalledTimes(1)
      expect(cache.get).toHaveBeenCalled()
      expect(cache.set).toHaveBeenCalled()
    })

    it('should handle different security levels', async () => {
      const testCases = ['high', 'medium', 'low']

      for (const security of testCases) {
        const options = { ...mockOptions, security }
        await aiService.generateContract(mockPrompt, options)

        expect(securityGenerator.enhance).toHaveBeenCalledWith(
          expect.any(String),
          security
        )
      }
    })
  })

  describe('analyzeContract', () => {
    const mockCode = mockTemplateCode

    it('should analyze contract successfully', async () => {
      const mockAnalysis = {
        securityScore: 90,
        optimizationScore: 85,
        vulnerabilities: [],
        suggestions: []
      }

      jest.spyOn(analyzer, 'analyzeContract').mockResolvedValueOnce(mockAnalysis)

      const result = await aiService.analyzeContract(mockCode)

      expect(result).toEqual(mockAnalysis)
      expect(analyzer.analyzeContract).toHaveBeenCalledWith(mockCode)
      expect(metrics.gauge).toHaveBeenCalledWith(
        'contract_security_score',
        mockAnalysis.securityScore
      )
    })

    it('should handle analysis errors', async () => {
      const error = new Error('Analysis failed')
      jest.spyOn(analyzer, 'analyzeContract').mockRejectedValueOnce(error)

      await expect(
        aiService.analyzeContract(mockCode)
      ).rejects.toThrow('Analysis failed')

      expect(metrics.increment).toHaveBeenCalledWith('analysis_errors_total')
    })
  })

  describe('optimizeContract', () => {
    const mockCode = mockTemplateCode

    it('should optimize contract successfully', async () => {
      const mockOptimizedCode = 'optimized ' + mockCode
      jest.spyOn(aiService, 'optimizeContract').mockResolvedValueOnce({
        code: mockOptimizedCode,
        improvements: ['Reduced instruction count']
      })

      const result = await aiService.optimizeContract(mockCode, 'high')

      expect(result.code).toBe(mockOptimizedCode)
      expect(result.improvements).toHaveLength(1)
      expect(metrics.increment).toHaveBeenCalledWith('contracts_optimized_total')
    })

    it('should handle optimization errors', async () => {
      const error = new Error('Optimization failed')
      jest.spyOn(aiService, 'optimizeContract').mockRejectedValueOnce(error)

      await expect(
        aiService.optimizeContract(mockCode, 'high')
      ).rejects.toThrow('Optimization failed')

      expect(metrics.increment).toHaveBeenCalledWith('optimization_errors_total')
    })
  })

  describe('generateTests', () => {
    const mockCode = mockTemplateCode

    it('should generate tests successfully', async () => {
      const mockTests = `
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_initialization() {
        // Test implementation
    }
}`

      jest.spyOn(aiService, 'generateTests').mockResolvedValueOnce({
        code: mockTests,
        coverage: 85
      })

      const result = await aiService.generateTests(mockCode)

      expect(result.code).toBe(mockTests)
      expect(result.coverage).toBe(85)
      expect(metrics.gauge).toHaveBeenCalledWith('test_coverage', 85)
    })

    it('should handle test generation errors', async () => {
      const error = new Error('Test generation failed')
      jest.spyOn(aiService, 'generateTests').mockRejectedValueOnce(error)

      await expect(
        aiService.generateTests(mockCode)
      ).rejects.toThrow('Test generation failed')

      expect(metrics.increment).toHaveBeenCalledWith('test_generation_errors_total')
    })
  })

  describe('Performance', () => {
    it('should generate contracts within time limit', async () => {
      const startTime = Date.now()
      
      await aiService.generateContract(mockPrompt, mockOptions)
      
      const duration = Date.now() - startTime
      expect(duration).toBeLessThan(5000) // 5 seconds max
    })

    it('should handle concurrent generations', async () => {
      const promises = Array(5).fill(null).map(() =>
        aiService.generateContract(mockPrompt, mockOptions)
      )

      const results = await Promise.all(promises)
      expect(results).toHaveLength(5)
      results.forEach(result => {
        expect(result).toBeDefined()
        expect(result.code).toBeDefined()
      })
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid prompts', async () => {
      await expect(
        aiService.generateContract('', mockOptions)
      ).rejects.toThrow('Invalid prompt')
    })

    it('should handle invalid options', async () => {
      await expect(
        aiService.generateContract(mockPrompt, { 
          ...mockOptions, 
          security: 'invalid' as any 
        })
      ).rejects.toThrow('Invalid security level')
    })

    it('should handle service unavailability', async () => {
      templateEngine.generateFromPrompt.mockRejectedValueOnce(
        new Error('Service unavailable')
      )

      await expect(
        aiService.generateContract(mockPrompt, mockOptions)
      ).rejects.toThrow('Service unavailable')
    })
  })
})
