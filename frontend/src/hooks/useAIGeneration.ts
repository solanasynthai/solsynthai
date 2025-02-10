import { useState } from 'react';
import { generateContractCode } from '../services/ai/generation';

interface UseAIGenerationResult {
  generating: boolean;
  error: string | null;
  generateCode: (prompt: string, template: string) => Promise<string>;
}

export const useAIGeneration = (): UseAIGenerationResult => {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateCode = async (prompt: string, template: string): Promise<string> => {
    setGenerating(true);
    setError(null);
    try {
      const code = await generateContractCode(prompt, template);
      return code;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate code');
      throw err;
    } finally {
      setGenerating(false);
    }
  };

  return { generating, error, generateCode };
};

# File: /frontend/src/hooks/useCompilation.ts

import { useState } from 'react';
import { compileContract } from '../services/compiler';

interface UseCompilationResult {
  compiling: boolean;
  error: string | null;
  compile: (code: string) => Promise<string>;
}

export const useCompilation = (): UseCompilationResult => {
  const [compiling, setCompiling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compile = async (code: string): Promise<string> => {
    setCompiling(true);
    setError(null);
    try {
      const compiledCode = await compileContract(code);
      return compiledCode;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compile code');
      throw err;
    } finally {
      setCompiling(false);
    }
  };

  return { compiling, error, compile };
};

# File: /frontend/src/hooks/useDeployment.ts

import { useState } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { deployContract } from '../services/solana/deployment';

interface UseDeploymentResult {
  deploying: boolean;
  error: string | null;
  deploy: (compiledCode: string) => Promise<string>;
}

export const useDeployment = (): UseDeploymentResult => {
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { signTransaction } = useWallet();

  const deploy = async (compiledCode: string): Promise<string> => {
    setDeploying(true);
    setError(null);
    try {
      const programId = await deployContract(compiledCode, signTransaction);
      return programId;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deploy contract');
      throw err;
    } finally {
      setDeploying(false);
    }
  };

  return { deploying, error, deploy };
};
