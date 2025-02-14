import { Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import { SyntheticAssetService } from '../services/synthetic/SyntheticAssetService';
import { validateSyntheticAssetCreation } from '../utils/validation';
import { Logger } from '../utils/logger';

export class SyntheticController {
  private syntheticService: SyntheticAssetService;
  private logger: Logger;

  constructor(syntheticService: SyntheticAssetService) {
    this.syntheticService = syntheticService;
    this.logger = new Logger('SyntheticController');
  }

  async createAsset(req: Request, res: Response): Promise<void> {
    try {
      const { assetName, symbol, collateralAmount, ownerPublicKey } = req.body;

      const validationError = validateSyntheticAssetCreation({
        assetName,
        symbol,
        collateralAmount,
        ownerPublicKey
      });

      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }

      const owner = new PublicKey(ownerPublicKey);
      const asset = await this.syntheticService.createSyntheticAsset(
        assetName,
        symbol,
        collateralAmount,
        owner
      );

      res.status(201).json({
        success: true,
        data: asset
      });
    } catch (error) {
      this.logger.error('Error creating synthetic asset', {
        error: error instanceof Error ? error.message : 'Unknown error',
        body: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to create synthetic asset'
      });
    }
  }

  async mintAsset(req: Request, res: Response): Promise<void> {
    try {
      const { assetAddress, amount, ownerPublicKey } = req.body;

      if (!assetAddress || !amount || !ownerPublicKey) {
        res.status(400).json({
          success: false,
          error: 'Missing required parameters'
        });
        return;
      }

      const owner = new PublicKey(ownerPublicKey);
      const signature = await this.syntheticService.mintSyntheticAsset(
        assetAddress,
        amount,
        owner
      );

      res.status(200).json({
        success: true,
        data: { signature }
      });
    } catch (error) {
      this.logger.error('Error minting synthetic asset', {
        error: error instanceof Error ? error.message : 'Unknown error',
        body: req.body
      });
      res.status(500).json({
        success: false,
        error: 'Failed to mint synthetic asset'
      });
    }
  }

  async getAssetPrice(req: Request, res: Response): Promise<void> {
    try {
      const { assetAddress } = req.params;

      if (!assetAddress) {
        res.status(400).json({
          success: false,
          error: 'Asset address is required'
        });
        return;
      }

      const price = await this.syntheticService.getAssetPrice(assetAddress);

      res.status(200).json({
        success: true,
        data: { price }
      });
    } catch (error) {
      this.logger.error('Error getting asset price', {
        error: error instanceof Error ? error.message : 'Unknown error',
        assetAddress: req.params.assetAddress
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get asset price'
      });
    }
  }
}
