import { ContractTemplate } from '../../types';

interface PromptContext {
  template?: ContractTemplate;
  features?: string[];
  securityLevel?: 'basic' | 'standard' | 'high';
}

export const generatePrompt = (
  userRequirements: string,
  context: PromptContext = {}
): string => {
  const basePrompt = `Create a secure Solana program with the following requirements:\n${userRequirements}\n\n`;
  
  const templateInstructions = context.template
    ? `Use this template as a base:\n${context.template.code}\n\n`
    : '';
  
  const featureInstructions = context.features?.length
    ? `Include the following features:\n${context.features.join('\n')}\n\n`
    : '';
  
  const securityInstructions = {
    basic: 'Include basic security checks.',
    standard: 'Implement standard security measures and input validation.',
    high: 'Implement comprehensive security measures, including reentrancy guards, access controls, and extensive input validation.'
  }[context.securityLevel || 'standard'];

  const commonInstructions = `
    - Use Rust best practices
    - Include comprehensive error handling
    - Add detailed comments and documentation
    - Follow Solana program development guidelines
    - Implement proper account validation
  `;

  return `${basePrompt}${templateInstructions}${featureInstructions}${securityInstructions}\n${commonInstructions}`;
};
