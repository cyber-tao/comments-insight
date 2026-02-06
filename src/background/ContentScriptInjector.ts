import { INJECTION, MESSAGES, SCRIPTS, TEXT } from '@/config/constants';
import { ExtensionError, ErrorCode } from '@/utils/errors';
import { Logger } from '@/utils/logger';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ping(tabId: number): Promise<void> {
  await chrome.tabs.sendMessage(tabId, { type: MESSAGES.PING });
}

function isNonRetryableInjectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('cannot access') ||
    msg.includes('no tab with id') ||
    msg.includes('missing host permission') ||
    msg.includes('the extensions gallery cannot be scripted')
  );
}

export async function ensureContentScriptInjected(tabId: number): Promise<void> {
  try {
    await ping(tabId);
    return;
  } catch {
    // Not injected yet
  }

  const manifest = chrome.runtime.getManifest();
  const files = manifest.content_scripts?.flatMap((entry) => entry.js || [])?.filter(Boolean) || [];

  const contentScript =
    files.find((filePath) => filePath === SCRIPTS.CONTENT_MAIN) ||
    files.find((f) => f.includes('content')) ||
    files[0];

  if (!contentScript) {
    throw new ExtensionError(
      ErrorCode.EXTRACTION_FAILED,
      'Content script entry not found in manifest',
    );
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [contentScript],
    });
  } catch (error) {
    if (isNonRetryableInjectionError(error)) {
      throw new ExtensionError(ErrorCode.EXTRACTION_FAILED, TEXT.CONTENT_SCRIPT_INJECT_FAILED, {
        tabId,
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
    Logger.warn('[ContentScriptInjector] Script injection failed, will retry ping', { error });
  }

  for (let i = 0; i < INJECTION.PING_RETRY_ATTEMPTS; i++) {
    try {
      await ping(tabId);
      return;
    } catch {
      await sleep(INJECTION.PING_RETRY_DELAY_MS);
    }
  }

  throw new ExtensionError(ErrorCode.EXTRACTION_FAILED, TEXT.CONTENT_SCRIPT_INJECT_FAILED);
}
