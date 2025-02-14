import { AccountValidator } from '../../../../services/security/validators/AccountValidator';
import { PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
import { ConnectionPool } from '../../../../utils/ConnectionPool';
import { metrics } from '../../../../utils/metrics';

describe('AccountValidator', () => {
  let validator: AccountValidator;
  let connection;

  beforeEach(async () => {
    validator = new AccountValidator();
    connection = await ConnectionPool.getInstance().acquire({
      commitment: 'confirmed',
      timeout: 30000,
      maxRetries: 3,
      endpoints: [process.env.SOLANA_RPC_PRIMARY!]
    });
  });

  afterEach(async () => {
    await ConnectionPool.getInstance().release(connection);
  });

  describe('Address Validation', () => {
    it('should validate correct Solana addresses', async () => {
      const keypair = Keypair.generate();
      const result = await validator.validateAddress(keypair.publicKey.toString());
      
      expect(result.success).toBe(true);
      expect(result.data).toBe(true);
    });

    it('should reject invalid addresses', async () => {
      const result = await validator.validateAddress('invalid-address');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Account Validation', () => {
    it('should validate system program account', async () => {
      const accountData = {
        address: SystemProgram.programId.toString(),
        type: 'program',
        permissions: ['execute'],
        metadata: {
          name: 'System Program',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      };

      const result = await validator.validateAccount(accountData);
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.riskScore).toBeDefined();
    });

    it('should reject accounts with invalid permissions', async () => {
      const accountData = {
        address: Keypair.generate().publicKey.toString(),
        type: 'program',
        permissions: ['read'], // Missing required 'execute' permission
        metadata: {
          name: 'Test Program',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      };

      const result = await validator.validateAccount(accountData);
      
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('must have execute permission');
    });
  });

  describe('Transaction Validation', () => {
    it('should validate simple transfer transaction', async () => {
      const sender = Keypair.generate();
      const recipient = Keypair.generate();
      
      const transactionData = {
        instructions: [{
          programId: SystemProgram.programId.toString(),
          keys: [
            {
              pubkey: sender.publicKey.toString(),
              isSigner: true,
              isWritable: true
            },
            {
              pubkey: recipient.publicKey.toString(),
              isSigner: false,
              isWritable: true
            }
          ],
          data: Buffer.from([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]).toString('base64')
        }],
        recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
        feePayer: sender.publicKey.toString(),
        version: 'legacy'
      };

      const result = await validator.validateTransaction(transactionData);
      
      expect(result.success).toBe(true);
      expect(result.data).toBe(true);
    });

    it('should reject transactions exceeding size limit', async () => {
      const sender = Keypair.generate();
      const data = Buffer.alloc(1500); // Exceeds size limit
      
      const transactionData = {
        instructions: [{
          programId: SystemProgram.programId.toString(),
          keys: [{ pubkey: sender.publicKey.toString(), isSigner: true, isWritable: true }],
          data: data.toString('base64')
        }],
        recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
        feePayer: sender.publicKey.toString(),
        version: 'legacy'
      };

      const result = await validator.validateTransaction(transactionData);
      
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('exceeds size limit');
    });
  });

  describe('Performance Metrics', () => {
    it('should track validation metrics', async () => {
      const metricsSpy = jest.spyOn(metrics, 'increment');
      const keypair = Keypair.generate();
      
      await validator.validateAddress(keypair.publicKey.toString());
      
      expect(metricsSpy).toHaveBeenCalledWith(
        'address_validation.attempt',
        expect.any(Object)
      );
    });
  });
});
