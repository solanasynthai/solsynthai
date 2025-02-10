export const SOLANA_NETWORKS = {
  MAINNET: 'mainnet-beta',
  TESTNET: 'testnet',
  DEVNET: 'devnet'
} as const;

export const CONTRACT_TYPES = {
  TOKEN: 'token',
  NFT: 'nft',
  DEFI: 'defi'
} as const;

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  COMPILATION_ERROR: 'COMPILATION_ERROR',
  DEPLOYMENT_ERROR: 'DEPLOYMENT_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED'
} as const;

export const DEFAULT_COMPILATION_OPTIONS = {
  optimizer: {
    enabled: true,
    runs: 200
  },
  outputSelection: {
    '*': {
      '*': ['metadata', 'evm.bytecode', 'evm.deployedBytecode']
    }
  }
};

export const MAX_CODE_SIZE = 1024 * 1024; // 1MB
export const MAX_PROMPT_LENGTH = 2000;
export const DEFAULT_GAS_LIMIT = 10000000;
