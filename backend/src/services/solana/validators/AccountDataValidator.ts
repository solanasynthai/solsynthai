import {
  PublicKey,
  AccountInfo,
  Connection,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY
} from '@solana/web3.js'
import { BN } from 'bn.js'
import { Buffer } from 'buffer'
import { ValidationError, BlockchainError } from '../../../utils/errors'
import { logger, logError } from '../../../utils/logger'
import { SchemaField, AccountState, ValidationResult } from '../../../types'
import { AccountDataSerializer } from '../serializer/AccountDataSerializer'

export class AccountDataValidator {
  private static instance: AccountDataValidator
  private connection: Connection
  private serializer: AccountDataSerializer

  private readonly MINIMUM_BALANCE_FOR_RENT_EXEMPTION: number = 890880
  private readonly MAX_ACCOUNT_SIZE: number = 10 * 1024 * 1024 // 10MB
  private readonly MAX_RETRIES: number = 3
  private readonly RETRY_DELAY: number = 1000 // 1 second

  private constructor(connection: Connection) {
    this.connection = connection
    this.serializer = AccountDataSerializer.getInstance()
  }

  public static getInstance(connection: Connection): AccountDataValidator {
    if (!AccountDataValidator.instance) {
      AccountDataValidator.instance = new AccountDataValidator(connection)
    }
    return AccountDataValidator.instance
  }

  public async validateAccount(
    accountInfo: AccountInfo<Buffer>,
    expectedOwner: PublicKey,
    schema: SchemaField[]
  ): Promise<ValidationResult<AccountState>> {
    try {
      const startTime = performance.now()
      const errors: string[] = []

      // Validate account ownership
      if (!accountInfo.owner.equals(expectedOwner)) {
        throw new ValidationError('Invalid account owner', {
          expected: expectedOwner.toBase58(),
          actual: accountInfo.owner.toBase58()
        })
      }

      // Validate account data size
      const expectedSize = this.calculateExpectedSize(schema)
      if (accountInfo.data.length !== expectedSize) {
        throw new ValidationError('Invalid account data size', {
          expected: expectedSize,
          actual: accountInfo.data.length
        })
      }

      // Validate rent exemption
      await this.validateRentExemption(accountInfo)

      // Deserialize and validate account data
      const accountData = await this.deserializeAndValidate(
        accountInfo.data,
        schema
      )

      const duration = performance.now() - startTime
      logger.info('Account validation completed', {
        duration,
        accountSize: accountInfo.data.length,
        errors: errors.length
      })

      return {
        isValid: errors.length === 0,
        errors,
        value: accountData
      }

    } catch (error) {
      logError('Account validation failed', error as Error)
      throw error
    }
  }

  public async validateMultipleAccounts(
    accounts: { pubkey: PublicKey; accountInfo: AccountInfo<Buffer> }[],
    expectedOwner: PublicKey,
    schema: SchemaField[]
  ): Promise<Map<string, ValidationResult<AccountState>>> {
    const results = new Map<string, ValidationResult<AccountState>>()

    await Promise.all(
      accounts.map(async ({ pubkey, accountInfo }) => {
        try {
          const result = await this.validateAccount(
            accountInfo,
            expectedOwner,
            schema
          )
          results.set(pubkey.toBase58(), result)
        } catch (error) {
          results.set(pubkey.toBase58(), {
            isValid: false,
            errors: [(error as Error).message],
            value: null
          })
        }
      })
    )

    return results
  }

  public async validateAccountState(
    pubkey: PublicKey,
    expectedState: Partial<AccountState>
  ): Promise<boolean> {
    try {
      const accountInfo = await this.getAccountInfo(pubkey)
      if (!accountInfo) {
        throw new ValidationError('Account not found', {
          pubkey: pubkey.toBase58()
        })
      }

      const currentState = await this.serializer.deserialize(
        accountInfo.data,
        expectedState.metadata?.schemaName || ''
      )

      return this.compareStates(currentState, expectedState)

    } catch (error) {
      logError('Account state validation failed', error as Error)
      throw error
    }
  }

  private calculateExpectedSize(schema: SchemaField[]): number {
    return schema.reduce((size, field) => {
      const fieldSize = this.getFieldSize(field)
      if (fieldSize + size > this.MAX_ACCOUNT_SIZE) {
        throw new ValidationError('Account size exceeds maximum allowed', {
          maxSize: this.MAX_ACCOUNT_SIZE,
          attemptedSize: fieldSize + size
        })
      }
      return size + fieldSize
    }, 0)
  }

  private getFieldSize(field: SchemaField): number {
    const sizeLookup: Record<string, number> = {
      'u8': 1,
      'u16': 2,
      'u32': 4,
      'u64': 8,
      'i8': 1,
      'i16': 2,
      'i32': 4,
      'i64': 8,
      'bool': 1,
      'pubkey': 32,
    }

    if (field.type === 'string' || field.type === 'bytes') {
      return field.size + 4 // Include length prefix
    }

    return sizeLookup[field.type] || field.size
  }

  private async validateRentExemption(
    accountInfo: AccountInfo<Buffer>
  ): Promise<void> {
    const rentExemptMinimum = await this.connection.getMinimumBalanceForRentExemption(
      accountInfo.data.length
    )

    if (accountInfo.lamports < rentExemptMinimum) {
      throw new ValidationError('Account is not rent exempt', {
        required: rentExemptMinimum,
        actual: accountInfo.lamports
      })
    }
  }

  private async deserializeAndValidate(
    data: Buffer,
    schema: SchemaField[]
  ): Promise<AccountState> {
    const accountState = await this.serializer.deserialize(
      data,
      schema[0]?.name || ''
    )

    for (const field of schema) {
      if (field.validator) {
        const value = (accountState as any)[field.name]
        const isValid = await this.validateField(value, field)
        
        if (!isValid) {
          throw new ValidationError(`Field validation failed: ${field.name}`, {
            field: field.name,
            value,
            validator: field.validator
          })
        }
      }
    }

    return accountState
  }

  private async validateField(
    value: any,
    field: SchemaField
  ): Promise<boolean> {
    if (!field.validator) return true

    switch (field.validator.type) {
      case 'range':
        return this.validateRange(value, field.validator.params)
      case 'regex':
        return this.validateRegex(value, field.validator.params)
      case 'enum':
        return this.validateEnum(value, field.validator.params)
      case 'custom':
        return this.validateCustom(value, field.validator.params)
      default:
        return true
    }
  }

  private validateRange(
    value: number | BN,
    params: { min?: number | string; max?: number | string }
  ): boolean {
    const val = BN.isBN(value) ? value : new BN(value)
    const min = params.min ? new BN(params.min) : null
    const max = params.max ? new BN(params.max) : null

    if (min && val.lt(min)) return false
    if (max && val.gt(max)) return false
    return true
  }

  private validateRegex(value: string, params: { pattern: string }): boolean {
    const regex = new RegExp(params.pattern)
    return regex.test(value)
  }

  private validateEnum(value: any, params: { values: any[] }): boolean {
    return params.values.includes(value)
  }

  private validateCustom(
    value: any,
    params: { validator: (value: any) => boolean }
  ): boolean {
    return params.validator(value)
  }

  private compareStates(
    current: AccountState,
    expected: Partial<AccountState>
  ): boolean {
    for (const [key, value] of Object.entries(expected)) {
      if (value !== undefined && value !== null) {
        const currentValue = (current as any)[key]
        
        if (currentValue === undefined || !this.deepEqual(currentValue, value)) {
          return false
        }
      }
    }
    return true
  }

  private deepEqual(a: any, b: any): boolean {
    if (a === b) return true
    if (typeof a !== typeof b) return false
    if (typeof a !== 'object') return false
    if (a === null || b === null) return false

    const keysA = Object.keys(a)
    const keysB = Object.keys(b)

    if (keysA.length !== keysB.length) return false

    return keysA.every(key => this.deepEqual(a[key], b[key]))
  }

  private async getAccountInfo(
    pubkey: PublicKey,
    retry: number = 0
  ): Promise<AccountInfo<Buffer> | null> {
    try {
      const accountInfo = await this.connection.getAccountInfo(pubkey)
      return accountInfo
    } catch (error) {
      if (retry < this.MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY))
        return this.getAccountInfo(pubkey, retry + 1)
      }
      throw new BlockchainError('Failed to fetch account info', {
        pubkey: pubkey.toBase58(),
        error: (error as Error).message
      })
    }
  }
}
