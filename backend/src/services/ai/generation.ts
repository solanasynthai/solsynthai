import OpenAI from 'openai';
import config from '../../config';
import { ContractTemplate } from '../../types';

const openai = new OpenAI({
  apiKey: config.ai.openaiApiKey
});

interface GenerationOptions {
  temperature?: number;
  maxTokens?: number;
  template?: string;
}

const DEFAULT_OPTIONS: GenerationOptions = {
  temperature: 0.7,
  maxTokens: 2000,
  template: 'basic'
};

export const generateContractCode = async (
  prompt: string,
  options: GenerationOptions = {}
): Promise<string> => {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

  try {
    const completion = await openai.chat.completions.create({
      model: config.ai.model,
      messages: [
        {
          role: 'system',
          content: 'You are an expert Solana smart contract developer. Generate secure, optimized, and well-documented Rust code for Solana programs.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: mergedOptions.temperature,
      max_tokens: mergedOptions.maxTokens
    });

    return completion.choices[0]?.message?.content || '';
  } catch (error) {
    console.error('AI Generation Error:', error);
    throw error;
  }
};
