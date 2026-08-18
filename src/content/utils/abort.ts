import { TEXT } from '@/config/constants';
import { ErrorCode, ExtensionError } from '@/utils/error-types';
import { isExtractionActive } from '../extractionState';

/**
 * Check if extraction should be aborted
 * @param signal AbortSignal to check
 * @param enforceExtractionActive Whether to check global extraction active state
 * @throws ExtensionError if extraction is cancelled
 */
export function checkAborted(signal?: AbortSignal, enforceExtractionActive: boolean = true): void {
  if (signal?.aborted || (enforceExtractionActive && !isExtractionActive())) {
    throw new ExtensionError(
      ErrorCode.TASK_CANCELLED,
      TEXT.EXTRACTION_CANCELLED_BY_USER,
      {},
      false,
    );
  }
}

/**
 * Wait for specified milliseconds, abortable via signal
 * @param ms Milliseconds to wait
 * @param signal AbortSignal to listen to
 * @param enforceExtractionActive Whether to check global extraction active state immediately
 */
export function abortableDelay(
  ms: number,
  signal?: AbortSignal,
  enforceExtractionActive: boolean = true,
): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return new Promise((resolve, reject) => {
    try {
      checkAborted(signal, enforceExtractionActive);
    } catch (e) {
      reject(e);
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(
        new ExtensionError(ErrorCode.TASK_CANCELLED, TEXT.EXTRACTION_CANCELLED_BY_USER, {}, false),
      );
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
}
