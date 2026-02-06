import { Logger } from './logger';

export async function resolveTabId(
  payloadTabId?: number,
  senderTabId?: number,
): Promise<number | undefined> {
  const tabId = payloadTabId || senderTabId;
  if (tabId) return tabId;

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return activeTab?.id;
  } catch (error) {
    Logger.error('[TabHelpers] Failed to get active tab', { error });
    return undefined;
  }
}
