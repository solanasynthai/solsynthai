import React, { useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useConnection } from '@solana/wallet-adapter-react';
import { Loader2, CheckCircle2, XCircle, ExternalLink, RefreshCw } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Button } from '../common/Button';
import { Progress } from '@/components/ui/progress';
import { getProgramInfo } from '../../services/solana/program';
import { formatAddress } from '../../utils/format';
import { useToast } from '@/components/ui/use-toast';

interface DeploymentStep {
  name: string;
  status: 'pending' | 'processing' | 'complete' | 'error';
  description: string;
  error?: string;
}

interface DeploymentStatusProps {
  deploymentId: string;
  programId?: string;
  signature?: string;
  network: string;
  status: 'preparing' | 'deploying' | 'success' | 'error';
  error?: string;
  onRetry?: () => void;
}

const DeploymentStatus: React.FC<DeploymentStatusProps> = ({
  deploymentId,
  programId,
  signature,
  network,
  status,
  error,
  onRetry
}) => {
  const { connection } = useConnection();
  const { toast } = useToast();
  const [programInfo, setProgramInfo] = useState<any>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [progress, setProgress] = useState(0);

  const deploymentSteps: DeploymentStep[] = [
    {
      name: 'Preparation',
      status: status === 'preparing' ? 'processing' : 
             status === 'error' && !programId ? 'error' : 'complete',
      description: 'Preparing contract for deployment',
      error: status === 'error' && !programId ? error : undefined
    },
    {
      name: 'Deployment',
      status: status === 'preparing' ? 'pending' :
             status === 'deploying' ? 'processing' :
             status === 'error' && programId ? 'error' : 
             status === 'success' ? 'complete' : 'pending',
      description: 'Deploying contract to network',
      error: status === 'error' && programId ? error : undefined
    },
    {
      name: 'Verification',
      status: status === 'success' ? 'complete' : 
             status === 'error' && programId ? 'error' : 'pending',
      description: 'Verifying deployed program',
      error: status === 'error' && programId ? error : undefined
    }
  ];

  useEffect(() => {
    if (status === 'preparing') setProgress(25);
    if (status === 'deploying') setProgress(65);
    if (status === 'success') setProgress(100);
    if (status === 'error') setProgress(0);
  }, [status]);

  useEffect(() => {
    if (programId && (status === 'success' || status === 'error')) {
      loadProgramInfo();
    }
  }, [programId, status]);

  const loadProgramInfo = async () => {
    if (!programId) return;
    
    setLoadingInfo(true);
    try {
      const info = await getProgramInfo(programId, network);
      setProgramInfo(info);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error Loading Program Info',
        description: 'Failed to load program information',
      });
      console.error('Error loading program info:', error);
    } finally {
      setLoadingInfo(false);
    }
  };

  const getExplorerUrl = (type: 'transaction' | 'address', value: string) => {
    const baseUrl = network === 'mainnet-beta' 
      ? 'https://explorer.solana.com' 
      : `https://explorer.solana.com/${network}`;
    return `${baseUrl}/${type === 'transaction' ? 'tx' : 'address'}/${value}`;
  };

  const renderStepIcon = (step: DeploymentStep) => {
    switch (step.status) {
      case 'processing':
        return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
      case 'complete':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <div className="h-5 w-5 rounded-full border-2 border-gray-300" />;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Deployment Status
          {(status === 'success' || status === 'error') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => loadProgramInfo()}
              disabled={loadingInfo}
            >
              <RefreshCw className={`h-4 w-4 ${loadingInfo ? 'animate-spin' : ''}`} />
            </Button>
          )}
        </CardTitle>
        <CardDescription>
          Deployment ID: {formatAddress(deploymentId, 8)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-6">
          <Progress value={progress} className="h-2" />
        </div>

        <div className="space-y-6">
          {deploymentSteps.map((step, index) => (
            <div key={step.name} className="flex items-start gap-4">
              {renderStepIcon(step)}
              <div className="flex-1 space-y-1">
                <p className="font-medium">{step.name}</p>
                <p className="text-sm text-gray-500">{step.description}</p>
                {step.error && (
                  <Alert variant="destructive" className="mt-2">
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{step.error}</AlertDescription>
                  </Alert>
                )}
              </div>
            </div>
          ))}
        </div>

        {status === 'error' && onRetry && (
          <div className="mt-6">
            <Button onClick={onRetry} className="w-full">
              Retry Deployment
            </Button>
          </div>
        )}

        {(status === 'success' || programId) && (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border p-4">
              <h3 className="font-medium mb-2">Deployment Details</h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Program ID</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono">{formatAddress(programId!)}</span>
                    <a 
                      href={getExplorerUrl('address', programId!)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-4 w-4 text-gray-500 hover:text-gray-700" />
                    </a>
                  </div>
                </div>
                {signature && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Transaction</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono">{formatAddress(signature)}</span>
                      <a 
                        href={getExplorerUrl('transaction', signature)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4 text-gray-500 hover:text-gray-700" />
                      </a>
                    </div>
                  </div>
                )}
                {programInfo && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Program Size</span>
                      <span>{programInfo.dataSize.toLocaleString()} bytes</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Balance</span>
                      <span>{(programInfo.lamports / 1e9).toFixed(9)} SOL</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default DeploymentStatus;
