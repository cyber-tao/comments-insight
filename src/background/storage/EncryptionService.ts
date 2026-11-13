import { SECURITY, STORAGE } from '@/config/constants';
import { Logger } from '../../utils/logger';
import { ExtensionError, ErrorCode } from '../../utils/errors';
import { Mutex } from '@/utils/promise';

export class EncryptionService {
  private encryptionKey?: CryptoKey;
  private encryptionEnabled = false;
  private encryptionInitPromise?: Promise<void>;
  // Single mutex for both secret and salt so they are created in one atomic
  // storage write; two independent locks could persist one half and lose the
  // other if the service worker is evicted in between.
  private keyMaterialMutex = new Mutex();

  async ensureEncryptionReady(): Promise<void> {
    if (this.encryptionEnabled && this.encryptionKey) return;
    if (!this.encryptionInitPromise) {
      this.encryptionInitPromise = this.initializeEncryption();
    }
    await this.encryptionInitPromise;
    if (!this.encryptionEnabled || !this.encryptionKey) {
      // Allow subsequent calls to retry initialization if previous attempt failed.
      this.encryptionInitPromise = undefined;
    }
  }

  private async initializeEncryption(): Promise<void> {
    try {
      const { secret, salt } = await this.getOrCreateKeyMaterial();
      const keyMaterial = await this.importKeyMaterial(secret);
      this.encryptionKey = await this.deriveKey(keyMaterial, salt);
      this.encryptionEnabled = true;
    } catch (error) {
      Logger.warn('[EncryptionService] Failed to initialize encryption', { error });
      this.disableEncryption();
    }
  }

  private async getOrCreateKeyMaterial(): Promise<{ secret: string; salt: ArrayBuffer }> {
    return this.keyMaterialMutex.withLock(async () => {
      const result = await chrome.storage.local.get([
        STORAGE.ENCRYPTION_SECRET_KEY,
        STORAGE.ENCRYPTION_SALT_KEY,
      ]);
      let secretBase64 = result[STORAGE.ENCRYPTION_SECRET_KEY] as string | undefined;
      let saltBase64 = result[STORAGE.ENCRYPTION_SALT_KEY] as string | undefined;

      const updates: Record<string, string> = {};
      if (!secretBase64) {
        const secret = crypto.getRandomValues(new Uint8Array(SECURITY.SECRET_LENGTH));
        secretBase64 = btoa(String.fromCharCode(...secret));
        updates[STORAGE.ENCRYPTION_SECRET_KEY] = secretBase64;
      }
      if (!saltBase64) {
        const salt = crypto.getRandomValues(new Uint8Array(SECURITY.SALT_LENGTH));
        saltBase64 = btoa(String.fromCharCode(...salt));
        updates[STORAGE.ENCRYPTION_SALT_KEY] = saltBase64;
      }
      if (Object.keys(updates).length > 0) {
        await chrome.storage.local.set(updates);
      }

      const saltBytes = Uint8Array.from(atob(saltBase64!), (c) => c.charCodeAt(0));
      return { secret: secretBase64!, salt: saltBytes.buffer };
    });
  }

  disableEncryption(): void {
    this.encryptionKey = undefined;
    this.encryptionEnabled = false;
  }

  private async importKeyMaterial(passphrase: string): Promise<CryptoKey> {
    const enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(passphrase), { name: 'PBKDF2' }, false, [
      'deriveBits',
      'deriveKey',
    ]);
  }

  private async deriveKey(keyMaterial: CryptoKey, salt: ArrayBuffer): Promise<CryptoKey> {
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        hash: SECURITY.PBKDF2_HASH,
        salt,
        iterations: SECURITY.PBKDF2_ITERATIONS,
      },
      keyMaterial,
      { name: 'AES-GCM', length: SECURITY.AES_KEY_LENGTH },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  async encrypt(text: string): Promise<string> {
    if (!text) {
      return text;
    }
    if (!this.encryptionEnabled || !this.encryptionKey) {
      await this.ensureEncryptionReady();
    }
    if (!this.encryptionEnabled || !this.encryptionKey) {
      throw new ExtensionError(
        ErrorCode.STORAGE_WRITE_ERROR,
        'Encryption key unavailable while saving protected value',
      );
    }
    const iv = crypto.getRandomValues(new Uint8Array(SECURITY.IV_LENGTH));
    const enc = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.encryptionKey,
      enc.encode(text),
    );
    const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.byteLength);
    const base64 = btoa(String.fromCharCode(...combined));
    return `${SECURITY.ENCRYPTION_PREFIX}${base64}`;
  }

  async decrypt(text: string): Promise<string> {
    if (!text || !text.startsWith(SECURITY.ENCRYPTION_PREFIX)) return text;
    if (!this.encryptionKey) {
      await this.ensureEncryptionReady();
    }
    if (!this.encryptionKey) {
      throw new ExtensionError(
        ErrorCode.STORAGE_READ_ERROR,
        'Encryption key unavailable while reading protected value',
      );
    }
    try {
      const base64 = text.slice(SECURITY.ENCRYPTION_PREFIX.length);
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const iv = bytes.slice(0, SECURITY.IV_LENGTH);
      const data = bytes.slice(SECURITY.IV_LENGTH);
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        this.encryptionKey,
        data,
      );
      const dec = new TextDecoder();
      return dec.decode(plaintext);
    } catch (error) {
      Logger.warn('[EncryptionService] Failed to decrypt value', { error });
      throw new ExtensionError(ErrorCode.STORAGE_READ_ERROR, 'Failed to decrypt protected value', {
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
