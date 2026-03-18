import { PATHS } from '@/config/constants';

export const NavigationService = {
  openHistoryPage(historyId?: string, tab: 'comments' | 'analysis' = 'comments'): void {
    let url = PATHS.HISTORY_PAGE;
    if (historyId) {
      url += `?id=${historyId}&tab=${tab}`;
    }
    chrome.tabs.create({ url: chrome.runtime.getURL(url) });
    window.close();
  },

  openOptionsPage(): void {
    chrome.tabs.create({ url: chrome.runtime.getURL(PATHS.OPTIONS_PAGE) });
    window.close();
  },

  openLogsPage(): void {
    chrome.tabs.create({ url: chrome.runtime.getURL(PATHS.LOGS_PAGE) });
    window.close();
  },
};
