import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useContract } from '../../contexts/ContractContext';
import { useWallet } from '../../contexts/WalletContext';
import { useDeployment } from '../../hooks/useDeployment';
import { DeploymentForm } from '../deployment/DeploymentForm';
import { NetworkSelector } from '../deployment/NetworkSelector';
import { Button } from '../common/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/components/ui/use-toast';
import { getProgramInfo } from '../../services/solana/program';
import { formatAddress } from '../../utils/format';
import { Activity, Check, AlertTriangle, Clock } from 'lucide-react';

interface DeploymentStatus {
  status: 'pending' | 'success' | 'error';
  timestamp: number;
  signature?: string;
  error?: string;
  programId?: string;
}

interface DeploymentHistory {
  network: string;
  deployments: DeploymentStatus[];
}

const DeploymentManager: React.FC = () => {
  const { contractId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { contracts } = useContract();
  const { connected, publicKey } = useWallet();
  const { deploy, deploying } = useDeployment();

  const [selectedNetwork, setSelectedNetwork] = useState('devnet');
  const [deploymentHistory, setDeploymentHistory] = useState<DeploymentHistory[]>([]);
  const [currentDeployment, setCurrentDeployment] = useState<DeploymentStatus | null>(null);
  const [programInfo, setProgramInfo] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const contract = contracts.find(c => c.id === contractId);

  useEffect(() => {
    // Load deployment history from local storage
    const loadHistory = () => {
      if (!contractId) return;
      const savedHistory = localStorage.getItem(`deployment_history_${contractId}`);
      if (savedHistory) {
        setDeploymentHistory(JSON.parse(savedHistory));
      }
    };

    loadHistory();
  }, [contractId]);

  useEffect(() => {
    // Load program info if contract is deployed
    const loadProgramInfo = async () => {
      if (!currentDeployment?.programId) return;
      try {
        const info = await getProgramInfo(currentDeployment.programId, selectedNetwork);
        setProgramInfo(info);
      } catch (err) {
        console.error('Failed to load program info:', err);
      }
    };

    loadProgramInfo();
  }, [currentDeployment, selectedNetwork]);

  const saveDeploymentHistory = (history: DeploymentHistory[]) => {
    if (!contractId) return;
    localStorage.setItem(`deployment_history_${contractId}`, JSON.stringify(history));
    setDeploymentHistory(history);
  };

  const handleDeploy = async () => {
    if (!contract || !contract.compiledCode) {
      setError('Contract must be compiled before deployment');
      return;
    }

    if (!connected) {
      setError('Please connect your wallet to deploy');
      return;
    }

    setError(null);
    setCurrentDeployment({
      status: 'pending',
      timestamp: Date.now()
    });

    try {
      const programId = await deploy(contract.compiledCode, {
        network: selectedNetwork
      });

      const newDeployment: DeploymentStatus = {
        status: 'success',
        timestamp: Date.now(),
        programId
      };

      setCurrentDeployment(newDeployment);

      // Update deployment history
      const networkHistory = deploymentHistory.find(h => h.network === selectedNetwork);
      if (networkHistory) {
        networkHistory.deployments.push(newDeployment);
        saveDeploymentHistory([...deploymentHistory]);
      } else {
        saveDeploymentHistory([
          ...deploymentHistory,
          {
            network: selectedNetwork,
            deployments: [newDeployment]
          }
        ]);
      }

      toast({
        title: 'Deployment Successful',
        description: `Contract deployed to ${selectedNetwork} at ${formatAddress(programId)}`,
      });

    } catch (err) {
      const failedDeployment: DeploymentStatus = {
        status: 'error',
        timestamp: Date.now(),
        error: err instanceof Error ? err.message : 'Deployment failed'
      };

      setCurrentDeployment(failedDeployment);
      setError(failedDeployment.error);

      toast({
        variant: 'destructive',
        title: 'Deployment Failed',
        description: failedDeployment.error
      });
    }
  };

  if (!contract) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>Contract not found</AlertDescription>
        </Alert>
        <Button
          variant="secondary"
          onClick={() => navigate('/generate')}
          className="mt-4"
        >
          Create New Contract
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Deploy Contract</h1>
        <p className="text-gray-600">{contract.name}</p>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Deployment Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <NetworkSelector
                value={selectedNetwork}
                onChange={setSelectedNetwork}
                disabled={deploying}
              />
              <DeploymentForm
                contractId={contract.id}
                compiledCode={contract.compiledCode}
                onSuccess={(programId) => {
                  setCurrentDeployment({
                    status: 'success',
                    timestamp: Date.now(),
                    programId
                  });
                }}
                onError={setError}
              />
            </CardContent>
          </Card>

          {currentDeployment && (
            <Card>
              <CardHeader>
                <CardTitle>Current Deployment</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    {currentDeployment.status === 'pending' && (
                      <Clock className="w-6 h-6 text-yellow-500 animate-spin" />
                    )}
                    {currentDeployment.status === 'success' && (
                      <Check className="w-6 h-6 text-green-500" />
                    )}
                    {currentDeployment.status === 'error' && (
                      <AlertTriangle className="w-6 h-6 text-red-500" />
                    )}
                    <div>
                      <p className="font-medium">
                        Status: {currentDeployment.status.charAt(0).toUpperCase() + currentDeployment.status.slice(1)}
                      </p>
                      <p className="text-sm text-gray-500">
                        {new Date(currentDeployment.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {currentDeployment.programId && (
                    <div>
                      <p className="text-sm font-medium text-gray-700">Program ID</p>
                      <p className="font-mono text-sm">{currentDeployment.programId}</p>
                    </div>
                  )}
                  {currentDeployment.error && (
                    <div>
                      <p className="text-sm font-medium text-red-700">Error Details</p>
                      <p className="text-sm text-red-600">{currentDeployment.error}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Deployment History</CardTitle>
            </CardHeader>
            <CardContent>
              {deploymentHistory.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No previous deployments</p>
              ) : (
                deploymentHistory.map((history) => (
                  <div key={history.network} className="mb-6 last:mb-0">
                    <h4 className="font-medium mb-2">{history.network}</h4>
                    <div className="space-y-3">
                      {history.deployments.map((deployment, index) => (
                        <div
                          key={index}
                          className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
                        >
                          {deployment.status === 'success' ? (
                            <Check className="w-5 h-5 text-green-500" />
                          ) : (
                            <AlertTriangle className="w-5 h-5 text-red-500" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {deployment.programId ? formatAddress(deployment.programId) : 'Failed Deployment'}
                            </p>
                            <p className="text-xs text-gray-500">
                              {new Date(deployment.timestamp).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {programInfo && (
            <Card>
              <CardHeader>
                <CardTitle>Program Info</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium text-gray-700">Owner</p>
                    <p className="text-sm font-mono">{formatAddress(programInfo.owner)}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">Data Size</p>
                    <p className="text-sm">{programInfo.dataSize.toLocaleString()} bytes</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">Balance</p>
                    <p className="text-sm">{(programInfo.lamports / 1e9).toFixed(9)} SOL</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-700">Executable</p>
                    {programInfo.executable ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-yellow-500" />
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default DeploymentManager;
