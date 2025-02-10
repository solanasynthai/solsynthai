import React, { useState } from 'react';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { useWallet } from '../../contexts/WalletContext';
import { useDeployment } from '../../hooks/useDeployment';
import { NetworkSelector } from './NetworkSelector';

interface DeploymentFormProps {
  contractId: string;
  compiledCode: string;
  onSuccess: (programId: string) => void;
  onError: (error: string) => void;
}

export const DeploymentForm: React.FC<DeploymentFormProps> = ({
  contractId,
  compiledCode,
  onSuccess,
  onError
}) => {
  const [network, setNetwork] = useState('devnet');
  const { connected } = useWallet();
  const { deploy, deploying } = useDeployment();

  const handleDeploy = async () => {
    if (!connected) {
      onError('Please connect your wallet first');
      return;
    }

    try {
      const programId = await deploy(compiledCode);
      onSuccess(programId);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Deployment failed');
    }
  };

  return (
    <div className="space-y-6">
      <NetworkSelector
        value={network}
        onChange={setNetwork}
      />
      
      <div className="space-y-4">
        <Input
          label="Contract Name"
          placeholder="Enter contract name"
          required
        />
        
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">
            Estimated deployment cost: 0.1 SOL
          </span>
        </div>
      </div>

      <Button
        variant="primary"
        onClick={handleDeploy}
        loading={deploying}
        disabled={!connected}
        className="w-full"
      >
        {connected ? 'Deploy Contract' : 'Connect Wallet to Deploy'}
      </Button>
    </div>
  );
};
