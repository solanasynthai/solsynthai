export const generatePrompt = (
  requirements: string,
  template: string,
  additionalContext: Record<string, any> = {}
): string => {
  const basePrompt = `Create a Solana smart contract with the following requirements:\n${requirements}\n\n`;
  
  const templatePrompts: Record<string, string> = {
    token: 'Include standard SPL token functionality with mint and burn capabilities.',
    nft: 'Include metadata handling and minting limit controls for NFT collection.',
    defi: 'Include staking mechanics and reward distribution functionality.',
  };

  const contextPrompt = Object.entries(additionalContext)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

  return `${basePrompt}${templatePrompts[template] || ''}\n${contextPrompt}`;
};
