import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';

export interface EncryptedSettings {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function systemSettingsMasterKey(): Buffer {
  const value = process.env.APP_CONFIG_MASTER_KEY?.trim() ?? '';
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new ServiceUnavailableException({
      errorCode: 'SYSTEM_SETTINGS_UNAVAILABLE',
      message: 'System secret storage has not been configured',
    });
  }
  return Buffer.from(value, 'hex');
}

export function encryptSystemSettings(value: unknown, key = systemSettingsMasterKey()): EncryptedSettings {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
  };
}

export function decryptSystemSettings<T>(encrypted: EncryptedSettings, key = systemSettingsMasterKey()): T {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plaintext) as T;
  } catch {
    throw new ServiceUnavailableException({
      errorCode: 'SYSTEM_SETTINGS_UNAVAILABLE',
      message: 'System secret storage could not be opened',
    });
  }
}
