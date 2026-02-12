import { TIMEOUT } from '@/config/constants';

let active = false;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;

const SAFETY_TIMEOUT_MS = TIMEOUT.MAX_AI_SECONDS * TIMEOUT.MS_PER_SEC;

export function setExtractionActive(next: boolean) {
  active = next;

  if (safetyTimer) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }

  if (next) {
    safetyTimer = setTimeout(() => {
      active = false;
      safetyTimer = null;
    }, SAFETY_TIMEOUT_MS);
  }
}

export function isExtractionActive(): boolean {
  return active;
}
