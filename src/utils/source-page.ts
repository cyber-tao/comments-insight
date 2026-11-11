import { ErrorCode, ExtensionError } from './error-types';

export function sourcePageChangedError(): ExtensionError {
  return new ExtensionError(
    ErrorCode.EXTRACTION_FAILED,
    'The source page changed. Run the task again on the intended page.',
    { messageKey: 'errors.sourcePageChanged' },
    false,
  );
}

export function isSameSourcePage(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  try {
    return new URL(actual).href === new URL(expected).href;
  } catch {
    return false;
  }
}

export function checkSourcePage(expectedUrl: string | undefined): void {
  if (expectedUrl && !isSameSourcePage(window.location.href, expectedUrl)) {
    throw sourcePageChangedError();
  }
}
