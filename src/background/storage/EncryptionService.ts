import { SECURITY, STORAGE } from '@/config/constants';
import { Logger } from '../../utils/logger';

export class EncryptionService {
  private encryptionKey?: CryptoKey;
  private encryptionEnabled = false;
  private encryptionInitPromise?: Promise<void>;

  async ensureEncryptionReady(): Promise<void> {
    if (this.encryptionEnabled) return;
    if (!this.encryptionInitPromise) {
      this.encryptionInitPromise = (async () => {
        try {
          const secret = await this.getOrCreateSecret();
          await this.enableEncryption(secret);
        } catch (error) {
          Logger.warn('[EncryptionService] Failed to initialize encryption', { error });
          this.disableEncryption();
        }
      })();
    }
    await this.encryptionInitPromise;
  }

  private async getOrCreateSecret(): Promise<string> {
    const result = await chrome.storage.local.get(STORAGE.ENCRYPTION_SECRET_KEY);
    let secretBase64 = result[STORAGE.ENCRYPTION_SECRET_KEY] as string | undefined;
    if (!secretBase64) {
      const secret = crypto.getRandomValues(new Uint8Array(SECURITY.SECRET_LENGTH));
      secretBase64 = btoa(String.fromCharCode(...secret));
      await chrome.storage.local.set({ [STORAGE.ENCRYPTION_SECRET_KEY]: secretBase64 });
    }
    return secretBase64;
  }

  async enableEncryption(passphrase: string): Promise<void> {
    const salt = await this.getOrCreateSalt();
    const keyMaterial = await this.importKeyMaterial(passphrase);
    this.encryptionKey = await this.deriveKey(keyMaterial, salt);
    this.encryptionEnabled = true;
  }

  disableEncryption(): void {
    this.encryptionKey = undefined;
    this.encryptionEnabled = false;
  }

  private async getOrCreateSalt(): Promise<ArrayBuffer> {
    const result = await chrome.storage.local.get(STORAGE.ENCRYPTION_SALT_KEY);
    let saltBase64 = result[STORAGE.ENCRYPTION_SALT_KEY] as string | undefined;
    if (!saltBase64) {
      const salt = crypto.getRandomValues(new Uint8Array(SECURITY.SALT_LENGTH));
      saltBase64 = btoa(String.fromCharCode(...salt));
      await chrome.storage.local.set({ [STORAGE.ENCRYPTION_SALT_KEY]: saltBase64 });
    }
    const bytes = Uint8Array.from(atob(saltBase64), (c) => c.charCodeAt(0));
    return bytes.buffer;
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
    if (!this.encryptionEnabled || !this.encryptionKey) return text;
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
    if (!text.startsWith(SECURITY.ENCRYPTION_PREFIX)) return text;
    if (!this.encryptionKey) return '';
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
      return '';
    }
  }
}
