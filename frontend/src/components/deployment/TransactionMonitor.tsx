import React, { useEffect, useState, useCallback } from 'react';
import { Connection, TransactionResponse, TransactionConfirmationStatus } from '@solana/web3.js';
import { useConnection } from '@solana/wallet-adapter-react';
import { Loader2, CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '../common/Button';
import { Badge } from '@/components/ui/badge';
import { formatAddress } from '../../utils/format';
import { useToast } from '@/components/ui/use-toast';

interface TransactionMonitorProps {
  signature: string;
  network: string;
  onConfirm?: () => void;
  onError?: (error: string) => void;
}

interface TransactionDetails {
  status: TransactionConfirmationStatus;
  timestamp: number;
  slot: number;
  fee: number;
  logs: string[];
  error?: string;
}

const TransactionMonitor: React.FC<TransactionMonitorProps> = ({
  signature,
  network,
  onConfirm,
  onError
}) => {
  const { connection } = useConnection();
  const { toast } = useToast();
  const [details, setDetails] = useState<TransactionDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLogs, setShowLogs] = useState(false);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      setPollingInterval(null);
    }
  }, [pollingInterval]);

  const fetchTransactionDetails = useCallback(async () => {
    try {
      const response = await connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0
      });

      if (!response) {
        setLoading(true);
        return;
      }

      const details: TransactionDetails = {
        status: response.meta?.err ? 'failed' : 'confirmed',
        timestamp: response.blockTime ? response.blockTime * 1000 : Date.now(),
        slot: response.slot,
        fee: response.meta?.fee || 0,
        logs: response.meta?.logMessages || []
      };

      if (response.meta?.err) {
        details.error = response.meta.err.toString();
        stopPolling();
        onError?.(details.error);
      } else if (details.status === 'confirmed') {
        stopPolling();
        onConfirm?.();
      }

      setDetails(details);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching transaction:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to fetch transaction details',
      });
    }
  }, [connection, signature, stopPolling, onConfirm, onError]);

  useEffect(() => {
    fetchTransactionDetails();
    const interval = setInterval(fetchTransactionDetails, 2000);
    setPollingInterval(interval);

    return () => {
      clearInterval(interval);
    };
  }, [fetchTransactionDetails]);

  const getStatusIcon = () => {
    if (loading) return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
    if (!details) return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
    if (details.error) return <XCircle className="h-5 w-5 text-red-500" />;
    return <CheckCircle2 className="h-5 w-5 text-green-500" />;
  };

  const getStatusText = () => {
    if (loading) return 'Processing';
    if (!details) return 'Pending';
    if (details.error) return 'Failed';
    return 'Confirmed';
  };

  const getStatusColor = () => {
    if (loading) return 'text-blue-500';
    if (!details) return 'text-yellow-500';
    if (details.error) return 'text-red-500';
    return 'text-green-500';
  };

  const getExplorerUrl = (signature: string) => {
    const baseUrl = network === 'mainnet-beta' 
      ? 'https://explorer.solana.com' 
      : `https://explorer.solana.com/${network}`;
    return `${baseUrl}/tx/${signature}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <span className={getStatusColor()}>{getStatusText()}</span>
          </div>
          <a
            href={getExplorerUrl(signature)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-500 hover:text-gray-700"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </CardTitle>
        <CardDescription>
          Transaction: {formatAddress(signature, 8)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {details?.error ? (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>Transaction Failed</AlertTitle>
            <AlertDescription>{details.error}</AlertDescription>
          </Alert>
        ) : null}

        {details && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">Slot</p>
                <p className="font-medium">{details.slot.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Fee</p>
                <p className="font-medium">{(details.fee / 1e9).toFixed(6)} SOL</p>
              </div>
              <div className="col-span-2">
                <p className="text-sm text-gray-500">Time</p>
                <p className="font-medium">
                  {new Date(details.timestamp).toLocaleString()}
                </p>
              </div>
            </div>

            {details.logs.length > 0 && (
              <Collapsible open={showLogs} onOpenChange={setShowLogs}>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" className="w-full">
                    <span className="flex items-center gap-2">
                      {showLogs ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      Program Logs
                      <Badge variant="secondary">{details.logs.length}</Badge>
                    </span>
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ScrollArea className="h-[200px] mt-2">
                    <div className="space-y-1 font-mono text-sm">
                      {details.logs.map((log, index) => (
                        <div
                          key={index}
                          className="py-1 px-2 hover:bg-gray-100 rounded"
                        >
                          {log}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}

        {loading && !details && (
          <div className="text-center py-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
            <p className="text-gray-600">Fetching transaction details...</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default TransactionMonitor;
