import { body, param, query } from 'express-validator';
import { SOLANA_NETWORKS, CONTRACT_TYPES } from '../constants';

export const contractValidation = {
  create: [
    body('name')
      .isString()
      .trim()
      .isLength({ min: 3, max: 50 })
      .matches(/^[a-zA-Z][a-zA-Z0-9_]*$/)
      .withMessage('Contract name must start with a letter and contain only letters, numbers, and underscores'),
    body('description')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 500 }),
    body('template')
      .isIn(Object.values(CONTRACT_TYPES))
      .withMessage('Invalid contract template'),
    body('schema')
      .isObject()
      .notEmpty()
      .withMessage('Schema is required'),
  ],
  
  update: [
    param('pubkey')
      .isString()
      .matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
      .withMessage('Invalid Solana public key format'),
    body('updates')
      .isObject()
      .notEmpty()
      .withMessage('Updates object is required'),
  ],
  
  validate: [
    param('pubkey')
      .isString()
      .matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
      .withMessage('Invalid Solana public key format'),
    body('data')
      .isObject()
      .notEmpty()
      .withMessage('Data object is required'),
  ],
};

export const deploymentValidation = {
  deploy: [
    body('contractId')
      .isString()
      .notEmpty()
      .withMessage('Contract ID is required'),
    body('network')
      .isIn(Object.values(SOLANA_NETWORKS))
      .withMessage('Invalid network'),
    body('options')
      .optional()
      .isObject(),
  ],
  
  status: [
    param('deploymentId')
      .isString()
      .notEmpty()
      .withMessage('Deployment ID is required'),
  ],
  
  simulate: [
    body('contractId')
      .isString()
      .notEmpty()
      .withMessage('Contract ID is required'),
    body('network')
      .isIn(Object.values(SOLANA_NETWORKS))
      .withMessage('Invalid network'),
    body('options')
      .optional()
      .isObject(),
  ],
};

export const analyticsValidation = {
  metrics: [
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('Invalid start date format'),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('Invalid end date format'),
  ],
  
  contractPerformance: [
    param('pubkey')
      .isString()
      .matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
      .withMessage('Invalid Solana public key format'),
    query('period')
      .optional()
      .isIn(['day', 'week', 'month'])
      .withMessage('Invalid period'),
  ],
  
  usageStats: [
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('Invalid start date format'),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('Invalid end date format'),
    query('groupBy')
      .optional()
      .isIn(['hour', 'day', 'week', 'month'])
      .withMessage('Invalid groupBy parameter'),
  ],
};

export const securityValidation = {
  validateCode: [
    body('contractId')
      .isString()
      .notEmpty()
      .withMessage('Contract ID is required'),
    body('code')
      .isString()
      .notEmpty()
      .withMessage('Code is required'),
  ],
  
  validateSchema: [
    body('schema')
      .isObject()
      .notEmpty()
      .withMessage('Schema is required'),
  ],
};

export const aiValidation = {
  generate: [
    body('prompt')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Prompt is required')
      .isLength({ max: 2000 })
      .withMessage('Prompt too long (max 2000 characters)'),
    body('template')
      .optional()
      .isString()
      .isIn(Object.values(CONTRACT_TYPES))
      .withMessage('Invalid template type'),
    body('options')
      .optional()
      .isObject(),
  ],
};

export const networkValidation = {
  validateEndpoint: [
    body('endpoint')
      .isURL()
      .withMessage('Invalid RPC endpoint URL'),
    body('network')
      .isIn(Object.values(SOLANA_NETWORKS))
      .withMessage('Invalid network'),
  ],
};

export const accountValidation = {
  validatePublicKey: [
    param('pubkey')
      .isString()
      .matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
      .withMessage('Invalid Solana public key format'),
  ],
  
  validateOwner: [
    body('owner')
      .isString()
      .matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
      .withMessage('Invalid owner public key format'),
  ],
};
