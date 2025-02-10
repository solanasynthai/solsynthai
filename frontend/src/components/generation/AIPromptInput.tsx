import React, { useState } from 'react';
import { Button } from '../common/Button';
import { useAIGeneration } from '../../hooks/useAIGeneration';

interface AIPromptInputProps {
  onGenerate: (code: string) => void;
  onError: (error: string) => void;
}

export const AIPromptInput: React.FC<AIPromptInputProps> = ({
  onGenerate,
  onError
}) => {
  const [prompt, setPrompt] = useState('');
  const { generateCode, generating } = useAIGeneration();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    try {
      const generatedCode = await generateCode(prompt, 'basic');
      onGenerate(generatedCode);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Generation failed');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="prompt"
          className="block text-sm font-medium text-gray-700"
        >
          Describe Your Smart Contract
        </label>
        <div className="mt-1">
          <textarea
            id="prompt"
            rows={4}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
            placeholder="Example: Create a token contract with mint and burn functions..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={generating || !prompt.trim()}
          loading={generating}
        >
          Generate Contract
        </Button>
      </div>
    </form>
  );
};
