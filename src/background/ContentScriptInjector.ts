import { INJECTION, MESSAGES, SCRIPTS } from '@/config/constants';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ping(tabId: number): Promise<void> {
  await chrome.tabs.sendMessage(tabId, { type: MESSAGES.PING });
}

export async function ensureContentScriptInjected(tabId: number): Promise<void> {
  // Fast path: already injected
  try {
    await ping(tabId);
    return;
  } catch {
    // ignore
  }

  const manifest = chrome.runtime.getManifest();
  const files = manifest.content_scripts?.flatMap((entry) => entry.js || [])?.filter(Boolean) || [];

  // Try to find exact match, otherwise use the first available script (common in Vite builds)
  const contentScript =
    files.find((filePath) => filePath === SCRIPTS.CONTENT_MAIN) ||
    files.find((f) => f.includes('content')) ||
    files[0];

  if (!contentScript) {
    throw new Error('Content script entry not found in manifest');
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: [contentScript],
  });

  // Wait until the listener is ready
  for (let i = 0; i < INJECTION.PING_RETRY_ATTEMPTS; i++) {
    try {
      await ping(tabId);
      return;
    } catch {
      await sleep(INJECTION.PING_RETRY_DELAY_MS);
    }
  }

  throw new Error('Failed to inject content script');
}
