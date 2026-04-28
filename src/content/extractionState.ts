import { TIMEOUT } from '@/config/constants';

let active = false;
let activeTaskId: string | null = null;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;

const SAFETY_TIMEOUT_MS = TIMEOUT.MAX_AI_SECONDS * TIMEOUT.MS_PER_SEC;

export function setExtractionActive(next: boolean, taskId?: string) {
  if (next) {
    if (!active) {
      // 仅在首次激活时设置安全超时
      if (safetyTimer) {
        clearTimeout(safetyTimer);
      }
      safetyTimer = setTimeout(() => {
        active = false;
        safetyTimer = null;
      }, SAFETY_TIMEOUT_MS);
    }
    // 如果已经 active，不重置 timer
    activeTaskId = taskId ?? activeTaskId;
  } else {
    if (taskId && activeTaskId && activeTaskId !== taskId) {
      return;
    }
    if (safetyTimer) {
      clearTimeout(safetyTimer);
      safetyTimer = null;
    }
    activeTaskId = null;
  }
  active = next;
}

export function isExtractionActive(taskId?: string): boolean {
  return active && (!taskId || activeTaskId === taskId);
}
