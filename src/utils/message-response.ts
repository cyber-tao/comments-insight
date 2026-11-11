import { ExtensionError, fromExtensionErrorPayload, isExtensionErrorPayload } from './error-types';

export function requireMessageSuccess(response: unknown, fallback: ExtensionError): void {
  if (response && typeof response === 'object') {
    if ('error' in response && isExtensionErrorPayload(response.error)) {
      throw fromExtensionErrorPayload(response.error);
    }
    if ('success' in response && response.success === true) return;
  }
  throw fallback;
}
