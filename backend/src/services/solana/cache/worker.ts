import { parentPort } from 'worker_threads';
import { Buffer } from 'buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { deflate, inflate } from 'zlib';
import { promisify } from 'util';

const deflateAsync = promisify(deflate);
const inflateAsync = promisify(inflate);

interface WorkerMessage {
    type: 'compress' | 'decompress' | 'encrypt' | 'decrypt';
    data: Buffer;
    key?: Buffer;
    id: number;
}

class CacheWorker {
    private algorithm = 'aes-256-gcm';
    private compressionLevel = 9; // Maximum compression
    private authTagLength = 16;
    private ivLength = 12;
    private saltLength = 16;
    private keyIterations = 100000;
    private keyLength = 32;

    constructor() {
        if (!parentPort) {
            throw new Error('Worker must be run as a worker thread');
        }

        parentPort.on('message', async (message: WorkerMessage) => {
            try {
                const result = await this.handleMessage(message);
                parentPort?.postMessage({
                    id: message.id,
                    success: true,
                    data: result
                });
            } catch (error) {
                parentPort?.postMessage({
                    id: message.id,
                    success: false,
                    error: error.message
                });
            }
        });
    }

    private async handleMessage(message: WorkerMessage): Promise<Buffer> {
        switch (message.type) {
            case 'compress':
                return this.compress(message.data);
            case 'decompress':
                return this.decompress(message.data);
            case 'encrypt':
                if (!message.key) throw new Error('Encryption key required');
                return this.encrypt(message.data, message.key);
            case 'decrypt':
                if (!message.key) throw new Error('Decryption key required');
                return this.decrypt(message.data, message.key);
            default:
                throw new Error(`Unknown message type: ${message.type}`);
        }
    }

    private async compress(data: Buffer): Promise<Buffer> {
        try {
            const compressed = await deflateAsync(data, {
                level: this.compressionLevel
            });

            // Add compression header for verification
            const header = Buffer.alloc(8);
            header.writeUInt32LE(data.length, 0); // Original size
            header.writeUInt32LE(compressed.length, 4); // Compressed size

            return Buffer.concat([header, compressed]);
        } catch (error) {
            throw new Error(`Compression failed: ${error.message}`);
        }
    }

    private async decompress(data: Buffer): Promise<Buffer> {
        try {
            // Read and verify compression header
            if (data.length < 8) {
                throw new Error('Invalid compressed data: missing header');
            }

            const originalSize = data.readUInt32LE(0);
            const compressedSize = data.readUInt32LE(4);

            if (data.length !== compressedSize + 8) {
                throw new Error('Invalid compressed data: size mismatch');
            }

            const compressed = data.slice(8);
            const decompressed = await inflateAsync(compressed);

            if (decompressed.length !== originalSize) {
                throw new Error('Decompression failed: size verification failed');
            }

            return decompressed;
        } catch (error) {
            throw new Error(`Decompression failed: ${error.message}`);
        }
    }

    private async encrypt(data: Buffer, key: Buffer): Promise<Buffer> {
        try {
            // Generate initialization vector and salt
            const iv = randomBytes(this.ivLength);
            const salt = randomBytes(this.saltLength);

            // Create cipher
            const cipher = createCipheriv(this.algorithm, key, iv, {
                authTagLength: this.authTagLength
            });

            // Encrypt data
            const encrypted = Buffer.concat([
                cipher.update(data),
                cipher.final()
            ]);

            // Get authentication tag
            const authTag = cipher.getAuthTag();

            // Combine all components into final buffer
            return Buffer.concat([
                salt,           // 16 bytes
                iv,            // 12 bytes
                authTag,       // 16 bytes
                encrypted      // Rest of the data
            ]);
        } catch (error) {
            throw new Error(`Encryption failed: ${error.message}`);
        }
    }

    private async decrypt(data: Buffer, key: Buffer): Promise<Buffer> {
        try {
            // Extract components from encrypted data
            const minLength = this.saltLength + this.ivLength + this.authTagLength;
            if (data.length < minLength) {
                throw new Error('Invalid encrypted data: too short');
            }

            let offset = 0;
            const salt = data.slice(offset, offset += this.saltLength);
            const iv = data.slice(offset, offset += this.ivLength);
            const authTag = data.slice(offset, offset += this.authTagLength);
            const encrypted = data.slice(offset);

            // Create decipher
            const decipher = createDecipheriv(this.algorithm, key, iv, {
                authTagLength: this.authTagLength
            });

            // Set authentication tag
            decipher.setAuthTag(authTag);

            // Decrypt data
            return Buffer.concat([
                decipher.update(encrypted),
                decipher.final()
            ]);
        } catch (error) {
            throw new Error(`Decryption failed: ${error.message}`);
        }
    }

    private async validateData(data: Buffer): Promise<void> {
        if (!Buffer.isBuffer(data)) {
            throw new Error('Invalid data: must be a Buffer');
        }

        if (data.length === 0) {
            throw new Error('Invalid data: empty buffer');
        }

        if (data.length > 100 * 1024 * 1024) { // 100MB limit
            throw new Error('Invalid data: exceeds size limit');
        }
    }

    private async validateKey(key: Buffer): Promise<void> {
        if (!Buffer.isBuffer(key)) {
            throw new Error('Invalid key: must be a Buffer');
        }

        if (key.length !== this.keyLength) {
            throw new Error(`Invalid key: must be ${this.keyLength} bytes`);
        }
    }
}

// Initialize worker
new CacheWorker();

// Handle worker errors
process.on('uncaughtException', (error: Error) => {
    console.error('Worker uncaught exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
    console.error('Worker unhandled rejection:', reason);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Worker received SIGTERM signal');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Worker received SIGINT signal');
    process.exit(0);
});
