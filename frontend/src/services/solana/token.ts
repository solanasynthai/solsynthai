/**
 * File: token.ts
 * Location: /frontend/src/services/solana/token.ts
 * Created: 2025-02-14 17:08:02 UTC
 * Author: solanasynthai
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  Token,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getMint,
  getAccount,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  transfer,
  burn,
  freeze,
  thaw,
  closeAccount,
} from '@solana/spl-token';
import { BN } from 'bn.js';
import { 
  MetadataProgram, 
  CreateMetadataV2, 
  DataV2 
} from '@metaplex-foundation/mpl-token-metadata';
import { Metaplex } from '@metaplex-foundation/js';
import { metrics } from '@/lib/metrics';
import { retry, withLoading } from '@/lib/utils';
import { ConnectionService } from './connection';
import { WalletService } from './wallet';
import { APIError } from '@/lib/errors';

export interface TokenMetadata {
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  externalUrl?: string;
  attributes?: Array<{
    trait_type: string;
    value: string;
  }>;
}

export interface TokenConfig {
  decimals: number;
  freezeAuthority?: PublicKey;
  mintAuthority?: PublicKey;
  initialSupply?: number | BN;
  metadata?: TokenMetadata;
}

export class TokenService {
  private connection: Connection;
  private wallet: WalletService;
  private metaplex: Metaplex;

  constructor() {
    this.connection = ConnectionService.getInstance().getConnection();
    this.wallet = WalletService.getInstance();
    this.metaplex = new Metaplex(this.connection);
  }

  async createToken(config: TokenConfig): Promise<PublicKey> {
    const startTime = performance.now();

    try {
      return await withLoading(async () => {
        const mintAuthority = config.mintAuthority || this.wallet.publicKey;
        const freezeAuthority = config.freezeAuthority || this.wallet.publicKey;

        if (!mintAuthority || !freezeAuthority) {
          throw new APIError('WALLET_NOT_CONNECTED', 'Wallet not connected');
        }

        // Create mint account
        const mintKeypair = Keypair.generate();
        const mint = await retry(async () => {
          const token = await createMint(
            this.connection,
            await this.wallet.signTransaction(new Transaction()),
            mintAuthority,
            freezeAuthority,
            config.decimals,
            mintKeypair,
            { commitment: 'confirmed' }
          );

          return token;
        });

        // Create metadata if provided
        if (config.metadata) {
          await this.createTokenMetadata(mint, config.metadata);
        }

        // Mint initial supply if specified
        if (config.initialSupply) {
          const amount = config.initialSupply instanceof BN 
            ? config.initialSupply 
            : new BN(config.initialSupply);

          const associatedToken = await this.getOrCreateAssociatedTokenAccount(
            mint,
            this.wallet.publicKey
          );

          await mintTo(
            this.connection,
            await this.wallet.signTransaction(new Transaction()),
            mint,
            associatedToken,
            mintAuthority,
            amount,
            [],
            { commitment: 'confirmed' }
          );
        }

        metrics.timing(
          'token.create.duration',
          performance.now() - startTime,
          { decimals: config.decimals.toString() }
        );

        return mint;
      }, 'Creating token...', 'Token created successfully!');
    } catch (error) {
      metrics.increment('token.create.error', {
        error: error instanceof Error ? error.name : 'unknown'
      });
      throw error;
    }
  }

  async getOrCreateAssociatedTokenAccount(
    mint: PublicKey,
    owner: PublicKey
  ): Promise<PublicKey> {
    try {
      return await retry(async () => {
        const associatedToken = await Token.getAssociatedTokenAddress(
          ASSOCIATED_TOKEN_PROGRAM_ID,
          TOKEN_PROGRAM_ID,
          mint,
          owner
        );

        try {
          await getAccount(this.connection, associatedToken);
          return associatedToken;
        } catch (error) {
          // Account doesn't exist, create it
          await createAssociatedTokenAccount(
            this.connection,
            await this.wallet.signTransaction(new Transaction()),
            mint,
            owner,
            this.wallet.publicKey
          );

          return associatedToken;
        }
      });
    } catch (error) {
      metrics.increment('token.account.error', {
        error: error instanceof Error ? error.name : 'unknown'
      });
      throw error;
    }
  }

  async transferTokens(
    mint: PublicKey,
    recipient: PublicKey,
    amount: number | BN
  ): Promise<string> {
    try {
      return await withLoading(async () => {
        const amountBN = amount instanceof BN ? amount : new BN(amount);
        
        const [sourceAccount, destinationAccount] = await Promise.all([
          this.getOrCreateAssociatedTokenAccount(mint, this.wallet.publicKey),
          this.getOrCreateAssociatedTokenAccount(mint, recipient)
        ]);

        const signature = await transfer(
          this.connection,
          await this.wallet.signTransaction(new Transaction()),
          sourceAccount,
          destinationAccount,
          this.wallet.publicKey,
          amountBN,
          [],
          { commitment: 'confirmed' }
        );

        metrics.increment('token.transfer.success', {
          amount: amountBN.toString()
        });
        
        return signature;
      }, 'Transferring tokens...', 'Tokens transferred successfully!');
    } catch (error) {
      metrics.increment('token.transfer.error', {
        error: error instanceof Error ? error.name : 'unknown'
      });
      throw error;
    }
  }

  async burnTokens(
    mint: PublicKey,
    amount: number | BN
  ): Promise<string> {
    try {
      return await withLoading(async () => {
        const amountBN = amount instanceof BN ? amount : new BN(amount);
        
        const account = await this.getOrCreateAssociatedTokenAccount(
          mint,
          this.wallet.publicKey
        );

        const signature = await burn(
          this.connection,
          await this.wallet.signTransaction(new Transaction()),
          account,
          mint,
          this.wallet.publicKey,
          amountBN,
          [],
          { commitment: 'confirmed' }
        );

        metrics.increment('token.burn.success', {
          amount: amountBN.toString()
        });
        
        return signature;
      }, 'Burning tokens...', 'Tokens burned successfully!');
    } catch (error) {
      metrics.increment('token.burn.error', {
        error: error instanceof Error ? error.name : 'unknown'
      });
      throw error;
    }
  }

  async freezeAccount(
    mint: PublicKey,
    account: PublicKey
  ): Promise<string> {
    try {
      return await withLoading(async () => {
        const signature = await freeze(
          this.connection,
          await this.wallet.signTransaction(new Transaction()),
          account,
          mint,
          this.wallet.publicKey,
          [],
          { commitment: 'confirmed' }
        );

        metrics.increment('token.freeze.success', {
          account: account.toString()
        });
        
        return signature;
      }, 'Freezing account...', 'Account frozen successfully!');
    } catch (error) {
      metrics.increment('token.freeze.error', {
        error: error instanceof Error ? error.name : 'unknown'
      });
      throw error;
    }
  }

  async thawAccount(
    mint: PublicKey,
    account: PublicKey
  ): Promise<string> {
    try {
      return await withLoading(async () => {
        const signature = await thaw(
          this.connection,
          await this.wallet.signTransaction(new Transaction()),
          account,
          mint,
          this.wallet.publicKey,
          [],
          { commitment: 'confirmed' }
        );

        metrics.increment('token.thaw.success', {
          account: account.toString()
        });
        
        return signature;
      }, 'Thawing account...', 'Account thawed successfully!');
    } catch (error) {
      metrics.increment('token.thaw.error', {
        error: error instanceof Error ? error.name : 'unknown'
      });
      throw error;
    }
  }

  async closeTokenAccount(account: PublicKey): Promise<string> {
    try {
      return await withLoading(async () => {
        const signature = await closeAccount(
          this.connection,
          await this.wallet.signTransaction(new Transaction()),
          account,
          this.wallet.publicKey,
          this.wallet.publicKey,
          [],
          { commitment: 'confirmed' }
        );

        metrics.increment('token.close.success', {
          account: account.toString()
        });
        
        return signature;
      }, 'Closing account...', 'Account closed successfully!');
    } catch (error) {
      metrics.increment('token.close.error', {
        error: error instanceof Error ? error.name : 'unknown'
      });
      throw error;
    }
  }

  private async createTokenMetadata(
    mint: PublicKey,
    metadata: TokenMetadata
  ): Promise<void> {
    try {
      const metadataPDA = await MetadataProgram.findMetadataAccount(mint);

      const tokenMetadata = {
        name: metadata.name,
        symbol: metadata.symbol,
        uri: '', // Will be updated after uploading metadata
        sellerFeeBasisPoints: 0,
        creators: null,
        collection: null,
        uses: null
      };

      // Upload metadata to Arweave
      const { uri } = await this.metaplex
        .nfts()
        .uploadMetadata({
          name: metadata.name,
          symbol: metadata.symbol,
          description: metadata.description,
          image: metadata.image,
          external_url: metadata.externalUrl,
          attributes: metadata.attributes,
          properties: {
            files: metadata.image ? [
              {
                uri: metadata.image,
                type: 'image/png'
              }
            ] : [],
          }
        })
        .run();

      tokenMetadata.uri = uri;

      const createMetadataTx = new CreateMetadataV2(
        { feePayer: this.wallet.publicKey },
        {
          metadata: metadataPDA,
          metadataData: new DataV2(tokenMetadata),
          updateAuthority: this.wallet.publicKey,
          mint: mint,
          mintAuthority: this.wallet.publicKey,
        }
      );

      const transaction = new Transaction().add(createMetadataTx);
      const signedTx = await this.wallet.signTransaction(transaction);

      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [signedTx],
        {
          commitment: 'confirmed',
          maxRetries: 3
        }
      );

      await this.connection.confirmTransaction(signature, 'confirmed');

      // Verify metadata creation
      const metadataAccount = await MetadataProgram.getAccount(
        this.connection,
        metadataPDA
      );

      if (!metadataAccount) {
        throw new APIError(
          'METADATA_VERIFICATION_FAILED',
          'Failed to verify metadata account creation'
        );
      }

      metrics.increment('token.metadata.create.success', {
        mint: mint.toString()
      });

    } catch (error) {
      metrics.increment('token.metadata.create.error', {
        error: error instanceof Error ? error.name : 'unknown'
      });
      throw new APIError(
        'METADATA_CREATION_FAILED',
        `Failed to create token metadata: ${error.message}`
      );
    }
  }
}

export const tokenService = new TokenService();
