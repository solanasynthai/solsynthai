import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
} from '@solana/web3.js';
import { AnchorProvider, Program, web3 } from '@project-serum/anchor';
import { SyntheticAsset } from '../../types/synthetic.types';
import { redisConfig } from '../../config/redis.config';
import { Logger } from '../../utils/logger';
import { PriceFeedService } from '../price/PriceFeedService';
import { CONFIG } from '../../config';

export class SyntheticAssetService {
  private connection: Connection;
  private program: Program;
  private priceFeedService: PriceFeedService;
  private logger: Logger;

  constructor(
    connection: Connection,
    program: Program,
    priceFeedService: PriceFeedService
  ) {
    this.connection = connection;
    this.program = program;
    this.priceFeedService = priceFeedService;
    this.logger = new Logger('SyntheticAssetService');
  }

  async createSyntheticAsset(
    assetName: string,
    symbol: string,
    collateralAmount: number,
    owner: PublicKey
  ): Promise<SyntheticAsset> {
    try {
      const assetAccount = Keypair.generate();
      const price = await this.priceFeedService.getPrice(symbol);
      
      const createInstruction = await this.program.methods
        .createSyntheticAsset(
          assetName,
          symbol,
          collateralAmount,
          price
        )
        .accounts({
          assetAccount: assetAccount.publicKey,
          owner,
          systemProgram: web3.SystemProgram.programId,
        })
        .instruction();

      const transaction = new Transaction().add(createInstruction);
      
      const signature = await this.connection.sendTransaction(
        transaction,
        [assetAccount]
      );

      await this.connection.confirmTransaction(signature);

      const asset: SyntheticAsset = {
        address: assetAccount.publicKey.toString(),
        name: assetName,
        symbol,
        collateralAmount,
        owner: owner.toString(),
        price: price.toString(),
        createdAt: new Date(),
      };

      await this.cacheAssetData(asset);

      this.logger.info('Created synthetic asset', {
        asset,
        signature,
      });

      return asset;
    } catch (error) {
      this.logger.error('Failed to create synthetic asset', {
        error: error instanceof Error ? error.message : 'Unknown error',
        assetName,
        symbol,
      });
      throw error;
    }
  }

  async mintSyntheticAsset(
    assetAddress: string,
    amount: number,
    owner: PublicKey
  ): Promise<string> {
    try {
      const assetPublicKey = new PublicKey(assetAddress);
      const asset = await this.program.account.syntheticAsset.fetch(assetPublicKey);

      if (!asset) {
        throw new Error('Synthetic asset not found');
      }

      const mintInstruction = await this.program.methods
        .mintSyntheticAsset(amount)
        .accounts({
          assetAccount: assetPublicKey,
          owner,
          systemProgram: web3.SystemProgram.programId,
        })
        .instruction();

      const transaction = new Transaction().add(mintInstruction);
      
      const signature = await this.connection.sendTransaction(
        transaction,
        [owner]
      );

      await this.connection.confirmTransaction(signature);

      await this.updateAssetCache(assetAddress);

      this.logger.info('Minted synthetic asset', {
        assetAddress,
        amount,
        signature,
      });

      return signature;
    } catch (error) {
      this.logger.error('Failed to mint synthetic asset', {
        error: error instanceof Error ? error.message : 'Unknown error',
        assetAddress,
        amount,
      });
      throw error;
    }
  }

  private async cacheAssetData(asset: SyntheticAsset): Promise<void> {
    const cacheKey = `synthetic:asset:${asset.address}`;
    await redisConfig.setex(
      cacheKey,
      CONFIG.CACHE.SYNTHETIC_ASSET_TTL,
      JSON.stringify(asset)
    );
  }

  private async updateAssetCache(assetAddress: string): Promise<void> {
    const assetPublicKey = new PublicKey(assetAddress);
    const asset = await this.program.account.syntheticAsset.fetch(assetPublicKey);
    
    if (asset) {
      await this.cacheAssetData({
        address: assetAddress,
        name: asset.name,
        symbol: asset.symbol,
        collateralAmount: asset.collateralAmount.toNumber(),
        owner: asset.owner.toString(),
        price: asset.price.toString(),
        createdAt: new Date(asset.createdAt * 1000),
      });
    }
  }

  async getAssetPrice(assetAddress: string): Promise<number> {
    try {
      const assetPublicKey = new PublicKey(assetAddress);
      const asset = await this.program.account.syntheticAsset.fetch(assetPublicKey);
      
      if (!asset) {
        throw new Error('Synthetic asset not found');
      }

      const price = await this.priceFeedService.getPrice(asset.symbol);
      return price;
    } catch (error) {
      this.logger.error('Failed to get asset price', {
        error: error instanceof Error ? error.message : 'Unknown error',
        assetAddress,
      });
      throw error;
    }
  }
}
