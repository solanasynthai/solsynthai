import { toast } from "sonner";
import { z } from "zod";
import { metrics } from "@/lib/metrics";
import { retry, sleep, withLoading } from "@/lib/utils";
import { APIError } from "@/lib/errors";

export const ContractType = {
  TOKEN: 'token',
  NFT: 'nft',
  MARKETPLACE: 'marketplace',
  STAKING: 'staking',
  CUSTOM: 'custom'
} as const;

export type ContractType = typeof ContractType[keyof typeof ContractType];

export const OptimizationLevel = {
  SPEED: 'speed',
  SIZE: 'size',
  BALANCED: 'balanced'
} as const;

export type OptimizationLevel = typeof OptimizationLevel[keyof typeof OptimizationLevel];

const GenerationRequestSchema = z.object({
  prompt: z.string().min(10).max(2000),
  projectName: z.string().min(3).max(50),
  contractType: z.enum([
    ContractType.TOKEN,
    ContractType.NFT,
    ContractType.MARKETPLACE,
    ContractType.STAKING,
    ContractType.CUSTOM
  ]),
  options: z.object({
    includeTests: z.boolean(),
    optimization: z.enum([
      OptimizationLevel.SPEED,
      OptimizationLevel.SIZE,
      OptimizationLevel.BALANCED
    ]),
    solanaVersion: z.string(),
    features: z.array(z.string()).optional(),
    security: z.object({
      auditLevel: z.enum(['basic', 'standard', 'comprehensive']),
      includeAuditReport: z.boolean()
    }).optional()
  })
});

export type GenerationRequest = z.infer<typeof GenerationRequestSchema>;

export interface GenerationResponse {
  contractId: string;
  sourceCode: string;
  testCode?: string;
  documentation?: string;
  auditReport?: string;
  metrics: {
    tokenCount: number;
    generationTime: number;
    codeSize: number;
  };
}

export class GenerationService {
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor() {
    this.apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1';
    this.apiKey = process.env.NEXT_PUBLIC_API_KEY || '';
  }

  async generateContract(request: GenerationRequest): Promise<GenerationResponse> {
    const startTime = performance.now();

    try {
      GenerationRequestSchema.parse(request);

      return await withLoading(
        async () => {
          const response = await retry(
            () => this.makeGenerationRequest(request),
            3
          );

          metrics.timing(
            'contract_generation.duration',
            performance.now() - startTime,
            { contractType: request.contractType }
          );

          return response;
        },
        'Generating smart contract...',
        'Contract generated successfully!'
      );
    } catch (error) {
      metrics.increment('contract_generation.error', {
        contractType: request.contractType,
        error: error instanceof Error ? error.name : 'unknown'
      });
      throw this.handleError(error);
    }
  }

  private async makeGenerationRequest(request: GenerationRequest): Promise<GenerationResponse> {
    const response = await fetch(`${this.apiUrl}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new APIError(error.code, error.message);
    }

    return response.json();
  }

  async analyzeContract(code: string): Promise<any> {
    try {
      const response = await fetch(`${this.apiUrl}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({ code })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return response.json();
    } catch (error) {
      metrics.increment('contract_analysis.error');
      toast.error('Failed to analyze contract');
      throw error;
    }
  }

  private handleError(error: unknown): Error {
    if (error instanceof z.ZodError) {
      return new APIError(
        'VALIDATION_ERROR',
        'Invalid generation request: ' + error.errors[0].message
      );
    }

    if (error instanceof APIError) {
      return error;
    }

    return new APIError(
      'GENERATION_ERROR',
      'Failed to generate contract'
    );
  }
}

export const generationService = new GenerationService();
