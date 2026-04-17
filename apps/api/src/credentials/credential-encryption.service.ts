// Key rotation procedure:
// 1. Set CREDENTIAL_ENCRYPTION_KEY_NEW in env
// 2. Run: tsx apps/api/scripts/rotate-credential-key.ts
//    (Stub — decrypts with old key, re-encrypts with new)
// 3. Swap: CREDENTIAL_ENCRYPTION_KEY = CREDENTIAL_ENCRYPTION_KEY_NEW
// 4. Remove CREDENTIAL_ENCRYPTION_KEY_NEW

import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

@Injectable()
export class CredentialEncryptionService {
  private readonly key: Buffer;
  private readonly logger = new Logger(CredentialEncryptionService.name);

  constructor() {
    const keyBase64 = process.env.CREDENTIAL_ENCRYPTION_KEY;
    if (!keyBase64) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('CREDENTIAL_ENCRYPTION_KEY is required in production');
      }
      this.logger.error('CREDENTIAL_ENCRYPTION_KEY not set — using insecure dev key. DO NOT use in production.');
      this.key = Buffer.alloc(32, 'dev-credential-key-not-for-prod!');
    } else {
      this.key = Buffer.from(keyBase64, 'base64');
      if (this.key.length !== 32) {
        throw new Error('CREDENTIAL_ENCRYPTION_KEY must be 32 bytes when base64-decoded');
      }
    }
  }

  encrypt(plaintext: string): { ciphertext: Buffer; iv: Buffer; tag: Buffer } {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { ciphertext: encrypted, iv, tag };
  }

  decrypt(ciphertext: Buffer, iv: Buffer, tag: Buffer): string {
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
