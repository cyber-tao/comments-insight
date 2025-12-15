import { INJECTION, MESSAGES } from '@/config/constants';

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
  const file = manifest.content_scripts?.[0]?.js?.[0];

  if (!file) {
    throw new Error('Content script entry not found in manifest');
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: [file],
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
