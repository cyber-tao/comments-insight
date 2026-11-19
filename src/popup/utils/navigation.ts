import { PATHS } from '@/config/constants';
import { Logger } from '@/utils/logger';

async function openExtensionPage(path: string): Promise<void> {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL(path) });
    window.close();
  } catch (error) {
    Logger.error('[NavigationService] Failed to open extension page', { path, error });
  }
}

export const NavigationService = {
  openHistoryPage(historyId?: string, tab: 'comments' | 'analysis' = 'comments'): Promise<void> {
    let url = PATHS.HISTORY_PAGE;
    if (historyId) {
      url += `?id=${historyId}&tab=${tab}`;
    }
    return openExtensionPage(url);
  },

  openOptionsPage(): Promise<void> {
    return openExtensionPage(PATHS.OPTIONS_PAGE);
  },

  openLogsPage(): Promise<void> {
    return openExtensionPage(PATHS.LOGS_PAGE);
  },
};
