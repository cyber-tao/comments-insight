import { LIMITS } from '@/config/constants';

export function generateUniqueId(prefix: string): string {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  const bytes = crypto.getRandomValues(new Uint8Array(LIMITS.ID_RANDOM_BYTE_LENGTH));
  const suffix = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(LIMITS.HEX_BYTE_PAD_LENGTH, '0'),
  ).join('');
  return `${prefix}_${Date.now()}_${suffix}`;
}
