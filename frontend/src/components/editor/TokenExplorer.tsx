import React, { useState, useEffect } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useConnection } from '@solana/wallet-adapter-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '../common/Input';
import { Button } from '../common/Button';
import { Loader2, Search, RefreshCw } from 'lucide-react';
import { getTokenAccountInfo } from '../../services/solana/token';
import { formatBalance, formatAddress } from '../../utils/format';
import { useToast } from '@/components/ui/use-toast';

interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  supply: number;
  holders: number;
  price?: number;
}

interface TokenExplorerProps {
  onSelectToken?: (tokenAddress: string) => void;
  showMyTokens?: boolean;
}

const TokenExplorer: React.FC<TokenExplorerProps> = ({
  onSelectToken,
  showMyTokens = false,
}) => {
  const { connection } = useConnection();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [filteredTokens, setFilteredTokens] = useState<TokenInfo[]>([]);

  useEffect(() => {
    loadTokens();
  }, [showMyTokens]);

  useEffect(() => {
    filterTokens();
  }, [searchQuery, tokens]);

  const loadTokens = async () => {
    setLoading(true);
    try {
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
      );

      const tokenInfoPromises = tokenAccounts.value.map(async (account) => {
        const info = await getTokenAccountInfo(account.account.data.parsed.info.mint);
        return {
          address: account.account.data.parsed.info.mint,
          symbol: info.symbol || 'Unknown',
          name: info.name || 'Unknown Token',
          decimals: info.decimals || 0,
          supply: info.supply || 0,
          holders: info.holders || 0,
          price: info.price
        };
      });

      const tokenInfos = await Promise.all(tokenInfoPromises);
      setTokens(tokenInfos);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error Loading Tokens',
        description: 'Failed to load token information. Please try again.',
      });
      console.error('Error loading tokens:', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshTokens = async () => {
    setRefreshing(true);
    await loadTokens();
    setRefreshing(false);
  };

  const filterTokens = () => {
    const query = searchQuery.toLowerCase();
    const filtered = tokens.filter(token =>
      token.address.toLowerCase().includes(query) ||
      token.symbol.toLowerCase().includes(query) ||
      token.name.toLowerCase().includes(query)
    );
    setFilteredTokens(filtered);
  };

  const handleTokenSelect = (address: string) => {
    if (onSelectToken) {
      onSelectToken(address);
    }
  };

  const renderTokenTable = () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Symbol</TableHead>
          <TableHead>Supply</TableHead>
          <TableHead>Holders</TableHead>
          <TableHead>Price</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filteredTokens.map((token) => (
          <TableRow key={token.address}>
            <TableCell>
              <div>
                <p className="font-medium">{token.name}</p>
                <p className="text-sm text-gray-500">{formatAddress(token.address)}</p>
              </div>
            </TableCell>
            <TableCell>{token.symbol}</TableCell>
            <TableCell>{formatBalance(token.supply, token.decimals)}</TableCell>
            <TableCell>{token.holders.toLocaleString()}</TableCell>
            <TableCell>
              {token.price ? `$${token.price.toFixed(2)}` : 'N/A'}
            </TableCell>
            <TableCell className="text-right">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleTokenSelect(token.address)}
              >
                Select
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Token Explorer</CardTitle>
        <CardDescription>
          {showMyTokens ? 'View and manage your tokens' : 'Explore Solana tokens'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-6 flex gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, symbol, or address..."
                className="pl-10"
              />
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={refreshTokens}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filteredTokens.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {searchQuery ? 'No tokens found matching your search' : 'No tokens available'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            {renderTokenTable()}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default TokenExplorer;
