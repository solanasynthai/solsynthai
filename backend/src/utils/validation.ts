import Joi from 'joi';
import { PublicKey } from '@solana/web3.js';

export const createAssetSchema = Joi.object({
  assetName: Joi.string()
    .required()
    .min(3)
    .max(32)
    .pattern(/^[a-zA-Z0-9\s-]+$/),
  symbol: Joi.string()
    .required()
    .min(2)
    .max(10)
    .pattern(/^[A-Z]+$/),
  collateralAmount: Joi.number()
    .required()
    .positive(),
  ownerPublicKey: Joi.string()
    .required()
    .custom((value, helpers) => {
      try {
        new PublicKey(value);
        return value;
      } catch {
        return helpers.error('Invalid public key');
      }
    })
});

export const mintAssetSchema = Joi.object({
  assetAddress: Joi.string()
    .required()
    .custom((value, helpers) => {
      try {
        new PublicKey(value);
        return value;
      } catch {
        return helpers.error('Invalid asset address');
      }
    }),
  amount: Joi.number()
    .required()
    .positive(),
  ownerPublicKey: Joi.string()
    .required()
    .custom((value, helpers) => {
      try {
        new PublicKey(value);
        return value;
      } catch {
        return helpers.error('Invalid public key');
      }
    })
});

export function validateSyntheticAssetCreation(data: any): string | null {
  const { error } = createAssetSchema.validate(data);
  return error ? error.details[0].message : null;
}
