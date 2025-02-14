import { Buffer } from 'buffer'
import { PublicKey } from '@solana/web3.js'
import { BN } from 'bn.js'
import { SchemaField, AccountState, AccountMetadata } from '../../../types'
import { ValidationError } from '../../../utils/errors'
import { logger, logError } from '../../../utils/logger'
import { MetricsService } from '../../monitoring/MetricsService'

export class AccountDataSerializer {
  private static instance: AccountDataSerializer
  private metrics: MetricsService
  private schemaCache: Map<string, SchemaField[]>

  private readonly ACCOUNT_DISCRIMINATOR_SIZE = 8
  private readonly MAX_STRING_LENGTH = 1024
  private readonly MAX_BYTES_LENGTH = 1024 * 10 // 10KB

  private constructor() {
    this.metrics = MetricsService.getInstance()
    this.schemaCache = new Map()
  }

  public static getInstance(): AccountDataSerializer {
    if (!AccountDataSerializer.instance) {
      AccountDataSerializer.instance = new AccountDataSerializer()
    }
    return AccountDataSerializer.instance
  }

  public async serialize(
    data: AccountState,
    schemaName: string
  ): Promise<Buffer> {
    const startTime = performance.now()

    try {
      const schema = this.getSchema(schemaName)
      if (!schema) {
        throw new ValidationError(`Schema not found: ${schemaName}`)
      }

      const bufferSize = this.calculateBufferSize(schema, data)
      const buffer = Buffer.alloc(bufferSize)
      let offset = 0

      // Write account discriminator
      this.writeDiscriminator(buffer, schemaName)
      offset += this.ACCOUNT_DISCRIMINATOR_SIZE

      // Write fields according to schema
      for (const field of schema) {
        offset = this.writeField(buffer, offset, field, data[field.name])
      }

      this.recordMetrics('serialize', startTime, buffer.length)
      return buffer

    } catch (error) {
      logError('Account serialization failed', error as Error)
      throw error
    }
  }

  public async deserialize(
    buffer: Buffer,
    schemaName: string
  ): Promise<AccountState> {
    const startTime = performance.now()

    try {
      const schema = this.getSchema(schemaName)
      if (!schema) {
        throw new ValidationError(`Schema not found: ${schemaName}`)
      }

      // Verify buffer size
      if (buffer.length < this.ACCOUNT_DISCRIMINATOR_SIZE) {
        throw new ValidationError('Buffer too small for discriminator')
      }

      // Verify discriminator
      this.verifyDiscriminator(buffer, schemaName)
      let offset = this.ACCOUNT_DISCRIMINATOR_SIZE

      const data: AccountState = {
        pubkey: new PublicKey(buffer.slice(0, 32)),
        data: buffer,
        owner: new PublicKey(buffer.slice(32, 64)),
        executable: false,
        lamports: 0,
        rentEpoch: 0,
        metadata: this.deserializeMetadata(buffer)
      }

      // Read fields according to schema
      for (const field of schema) {
        const { value, newOffset } = this.readField(buffer, offset, field)
        data[field.name] = value
        offset = newOffset
      }

      this.recordMetrics('deserialize', startTime, buffer.length)
      return data

    } catch (error) {
      logError('Account deserialization failed', error as Error)
      throw error
    }
  }

  private getSchema(schemaName: string): SchemaField[] | undefined {
    return this.schemaCache.get(schemaName)
  }

  public setSchema(schemaName: string, schema: SchemaField[]): void {
    this.schemaCache.set(schemaName, schema)
  }

  private calculateBufferSize(schema: SchemaField[], data: any): number {
    let size = this.ACCOUNT_DISCRIMINATOR_SIZE

    for (const field of schema) {
      size += this.getFieldSize(field, data[field.name])
    }

    return size
  }

  private getFieldSize(field: SchemaField, value: any): number {
    switch (field.type) {
      case 'u8':
      case 'i8':
        return 1
      case 'u16':
      case 'i16':
        return 2
      case 'u32':
      case 'i32':
      case 'f32':
        return 4
      case 'u64':
      case 'i64':
      case 'f64':
        return 8
      case 'bool':
        return 1
      case 'pubkey':
        return 32
      case 'string':
        return 4 + (value?.length || 0) // Length prefix + string data
      case 'bytes':
        return 4 + (value?.length || 0) // Length prefix + bytes data
      default:
        throw new ValidationError(`Unsupported field type: ${field.type}`)
    }
  }

  private writeDiscriminator(buffer: Buffer, schemaName: string): void {
    const discriminator = Buffer.from(
      require('crypto')
        .createHash('sha256')
        .update(`account:${schemaName}`)
        .digest()
    ).slice(0, this.ACCOUNT_DISCRIMINATOR_SIZE)

    discriminator.copy(buffer)
  }

  private verifyDiscriminator(buffer: Buffer, schemaName: string): void {
    const expected = Buffer.from(
      require('crypto')
        .createHash('sha256')
        .update(`account:${schemaName}`)
        .digest()
    ).slice(0, this.ACCOUNT_DISCRIMINATOR_SIZE)

    const actual = buffer.slice(0, this.ACCOUNT_DISCRIMINATOR_SIZE)

    if (!actual.equals(expected)) {
      throw new ValidationError('Invalid account discriminator')
    }
  }

  private writeField(
    buffer: Buffer,
    offset: number,
    field: SchemaField,
    value: any
  ): number {
    if (value === undefined || value === null) {
      throw new ValidationError(`Missing required field: ${field.name}`)
    }

    switch (field.type) {
      case 'u8':
        buffer.writeUInt8(value, offset)
        return offset + 1
      case 'u16':
        buffer.writeUInt16LE(value, offset)
        return offset + 2
      case 'u32':
        buffer.writeUInt32LE(value, offset)
        return offset + 4
      case 'u64':
        if (BN.isBN(value)) {
          value.toArray('le', 8).copy(buffer, offset)
        } else {
          new BN(value).toArray('le', 8).copy(buffer, offset)
        }
        return offset + 8
      case 'i8':
        buffer.writeInt8(value, offset)
        return offset + 1
      case 'i16':
        buffer.writeInt16LE(value, offset)
        return offset + 2
      case 'i32':
        buffer.writeInt32LE(value, offset)
        return offset + 4
      case 'i64':
        if (BN.isBN(value)) {
          value.toArray('le', 8).copy(buffer, offset)
        } else {
          new BN(value).toArray('le', 8).copy(buffer, offset)
        }
        return offset + 8
      case 'bool':
        buffer.writeUInt8(value ? 1 : 0, offset)
        return offset + 1
      case 'pubkey':
        if (!(value instanceof PublicKey)) {
          throw new ValidationError(`Invalid PublicKey for field: ${field.name}`)
        }
        value.toBuffer().copy(buffer, offset)
        return offset + 32
      case 'string':
        return this.writeString(buffer, offset, value, field.name)
      case 'bytes':
        return this.writeBytes(buffer, offset, value, field.name)
      default:
        throw new ValidationError(`Unsupported field type: ${field.type}`)
    }
  }

  private readField(
    buffer: Buffer,
    offset: number,
    field: SchemaField
  ): { value: any; newOffset: number } {
    switch (field.type) {
      case 'u8':
        return {
          value: buffer.readUInt8(offset),
          newOffset: offset + 1
        }
      case 'u16':
        return {
          value: buffer.readUInt16LE(offset),
          newOffset: offset + 2
        }
      case 'u32':
        return {
          value: buffer.readUInt32LE(offset),
          newOffset: offset + 4
        }
      case 'u64':
        return {
          value: new BN(buffer.slice(offset, offset + 8), 'le'),
          newOffset: offset + 8
        }
      case 'i8':
        return {
          value: buffer.readInt8(offset),
          newOffset: offset + 1
        }
      case 'i16':
        return {
          value: buffer.readInt16LE(offset),
          newOffset: offset + 2
        }
      case 'i32':
        return {
          value: buffer.readInt32LE(offset),
          newOffset: offset + 4
        }
      case 'i64':
        return {
          value: new BN(buffer.slice(offset, offset + 8), 'le'),
          newOffset: offset + 8
        }
      case 'bool':
        return {
          value: buffer.readUInt8(offset) === 1,
          newOffset: offset + 1
        }
      case 'pubkey':
        return {
          value: new PublicKey(buffer.slice(offset, offset + 32)),
          newOffset: offset + 32
        }
      case 'string':
        return this.readString(buffer, offset)
      case 'bytes':
        return this.readBytes(buffer, offset)
      default:
        throw new ValidationError(`Unsupported field type: ${field.type}`)
    }
  }

  private writeString(
    buffer: Buffer,
    offset: number,
    value: string,
    fieldName: string
  ): number {
    if (value.length > this.MAX_STRING_LENGTH) {
      throw new ValidationError(
        `String too long for field ${fieldName}: ${value.length} > ${this.MAX_STRING_LENGTH}`
      )
    }

    const strBuffer = Buffer.from(value, 'utf8')
    buffer.writeUInt32LE(strBuffer.length, offset)
    strBuffer.copy(buffer, offset + 4)
    return offset + 4 + strBuffer.length
  }

  private readString(
    buffer: Buffer,
    offset: number
  ): { value: string; newOffset: number } {
    const length = buffer.readUInt32LE(offset)
    if (length > this.MAX_STRING_LENGTH) {
      throw new ValidationError(`String length exceeds maximum: ${length}`)
    }

    const value = buffer
      .slice(offset + 4, offset + 4 + length)
      .toString('utf8')
    return { value, newOffset: offset + 4 + length }
  }

  private writeBytes(
    buffer: Buffer,
    offset: number,
    value: Buffer,
    fieldName: string
  ): number {
    if (value.length > this.MAX_BYTES_LENGTH) {
      throw new ValidationError(
        `Bytes too long for field ${fieldName}: ${value.length} > ${this.MAX_BYTES_LENGTH}`
      )
    }

    buffer.writeUInt32LE(value.length, offset)
    value.copy(buffer, offset + 4)
    return offset + 4 + value.length
  }

  private readBytes(
    buffer: Buffer,
    offset: number
  ): { value: Buffer; newOffset: number } {
    const length = buffer.readUInt32LE(offset)
    if (length > this.MAX_BYTES_LENGTH) {
      throw new ValidationError(`Bytes length exceeds maximum: ${length}`)
    }

    const value = buffer.slice(offset + 4, offset + 4 + length)
    return { value, newOffset: offset + 4 + length }
  }

  private deserializeMetadata(buffer: Buffer): AccountMetadata {
    const metadataOffset = buffer.length - 48 // Last 48 bytes reserved for metadata
    return {
      schemaName: buffer.slice(metadataOffset, metadataOffset + 32).toString('utf8').replace(/\0+$/, ''),
      schemaVersion: buffer.readUInt32LE(metadataOffset + 32),
      lastUpdate: buffer.readBigUInt64LE(metadataOffset + 36),
      authority: new PublicKey(buffer.slice(metadataOffset + 44))
    }
  }

  private recordMetrics(
    operation: 'serialize' | 'deserialize',
    startTime: number,
    dataSize: number
  ): void {
    const duration = performance.now() - startTime
    this.metrics.gauge(`account_${operation}_duration`, duration)
    this.metrics.gauge(`account_${operation}_size`, dataSize)
    this.metrics.increment(`account_${operation}_total`)
  }
}
