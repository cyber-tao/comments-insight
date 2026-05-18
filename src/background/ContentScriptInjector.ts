import { INJECTION, MESSAGES, SCRIPTS, TEXT } from '@/config/constants';
import { ExtensionError, ErrorCode } from '@/utils/errors';
import { Logger } from '@/utils/logger';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ping(tabId: number): Promise<void> {
  await chrome.tabs.sendMessage(tabId, { type: MESSAGES.PING });
}

/**
 * Returns true when the URL belongs to a scheme/host where Chrome forbids
 * content-script injection (privileged pages, the Web Store, etc.). Detection
 * is purely structural so it works regardless of the browser UI language.
 */
function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  const lower = url.toLowerCase();
  if (INJECTION.RESTRICTED_URL_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return true;
  }
  try {
    const parsed = new URL(url);
    return INJECTION.RESTRICTED_HOSTS.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function isTabRestricted(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return isRestrictedUrl(tab.url) || isRestrictedUrl(tab.pendingUrl);
  } catch (error) {
    // Tab no longer exists / permission missing → treat as restricted to avoid
    // burning the retry budget; the caller surfaces the underlying error.
    Logger.warn('[ContentScriptInjector] Failed to inspect tab', {
      tabId,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

export async function ensureContentScriptInjected(tabId: number): Promise<void> {
  try {
    await ping(tabId);
    return;
  } catch {
    // Not injected yet
  }

  if (await isTabRestricted(tabId)) {
    throw new ExtensionError(ErrorCode.EXTRACTION_FAILED, TEXT.CONTENT_SCRIPT_INJECT_FAILED, {
      tabId,
      reason: 'restricted-url',
    });
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
