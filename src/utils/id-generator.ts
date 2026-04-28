import { LIMITS } from '@/config/constants';

export function generateUniqueId(prefix: string): string {
  const random = Math.random()
    .toString(36)
    .slice(LIMITS.RANDOM_ID_START_INDEX, LIMITS.RANDOM_ID_START_INDEX + LIMITS.ID_RANDOM_LENGTH);
  return `${prefix}_${Date.now()}_${random}`;
}
