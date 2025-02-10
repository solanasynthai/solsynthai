import OpenAI from 'openai';
import config from '../../config';
import { ValidationResult } from '../../types';

const openai = new OpenAI({
  apiKey: config.ai.openaiApiKey
});

export const validateContractCode = async (code: string): Promise<ValidationResult> => {
  try {
    const completion = await openai.chat.completions.create({
      model: config.ai.model,
      messages: [
        {
          role: 'system',
          content: 'You are a Solana smart contract security expert. Analyze the provided code for security vulnerabilities, best practices, and potential issues.'
        },
        {
          role: 'user',
          content: `Analyze this Solana program code:\n\n${code}`
        }
      ],
      temperature: 0.3,
      max_tokens: 1000
    });

    // Parse AI response and convert to ValidationResult format
    // This is a simplified implementation
    const analysis = completion.choices[0]?.message?.content || '';
    
    return {
      valid: !analysis.toLowerCase().includes('error'),
      errors: [],
      warnings: []
    };
  } catch (error) {
    console.error('Validation Error:', error);
    throw error;
  }
};
