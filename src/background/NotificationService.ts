import { ICONS, PATHS, LIMITS, TIMING, NOTIFICATION_KEYS } from '@/config/constants';
import { Logger } from '@/utils/logger';
import { generateUniqueId } from '@/utils/id-generator';
import i18n from '@/utils/i18n';

export class NotificationService {
  async showTaskCompleted(
    taskType: 'extract' | 'analyze' | 'config',
    title: string,
    commentsCount?: number,
  ): Promise<void> {
    try {
      const notificationId = generateUniqueId('task_completed');
      const options = {
        type: 'basic' as const,
        iconUrl: ICONS.ICON_48,
        title: i18n.t('common.appName'),
        message: this.getCompletionMessage(taskType, title, commentsCount),
        buttons: [
          { title: i18n.t('notification.viewResults', { defaultValue: 'View Results' }) },
          { title: i18n.t('notification.dismiss', { defaultValue: 'Dismiss' }) },
        ],
        requireInteraction: true,
      };

      await chrome.notifications.create(notificationId, options);

      setTimeout(() => {
        chrome.notifications.clear(notificationId).catch((e) => {
          Logger.debug('[NotificationService] clear failed', { error: e });
        });
      }, TIMING.NOTIFICATION_AUTOCLEAR_MS);
    } catch (error) {
      Logger.error('[NotificationService] Failed to show notification', { error });
    }
  }

  async showTaskFailed(taskType: 'extract' | 'analyze' | 'config', error: string): Promise<void> {
    try {
      const notificationId = generateUniqueId('task_failed');
      const options = {
        type: 'basic' as const,
        iconUrl: ICONS.ICON_48,
        title: i18n.t('common.appName'),
        message: this.getFailureMessage(taskType, error),
        requireInteraction: false,
      };

      await chrome.notifications.create(notificationId, options);
    } catch (error) {
      Logger.error('[NotificationService] Failed to show error notification', { error });
    }
  }

  setupNotificationHandlers(): void {
    chrome.notifications.onClicked.addListener((notificationId) => {
      if (notificationId.startsWith('task_completed_')) {
        chrome.tabs.create({
          url: chrome.runtime.getURL(PATHS.HISTORY_PAGE),
        });
      }
      chrome.notifications.clear(notificationId);
    });

    chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
      if (buttonIndex === 0) {
        chrome.tabs.create({
          url: chrome.runtime.getURL(PATHS.HISTORY_PAGE),
        });
      }
      chrome.notifications.clear(notificationId);
    });
  }

  private getCompletionMessage(
    taskType: 'extract' | 'analyze' | 'config',
    title: string,
    commentsCount?: number,
  ): string {
    const truncatedTitle =
      title.length > LIMITS.NOTIFICATION_TITLE_MAX_LENGTH
        ? title.substring(0, LIMITS.NOTIFICATION_TITLE_MAX_LENGTH) + '...'
        : title;

    const commentsSuffix = commentsCount
      ? taskType === 'analyze'
        ? i18n.t(NOTIFICATION_KEYS.COMMENTS_ANALYZED, { count: commentsCount })
        : i18n.t(NOTIFICATION_KEYS.COMMENTS_COUNT, { count: commentsCount })
      : '';

    if (taskType === 'extract') {
      return i18n.t(NOTIFICATION_KEYS.EXTRACTION_COMPLETED, {
        title: truncatedTitle,
        comments: commentsSuffix,
      });
    }
    if (taskType === 'analyze') {
      return i18n.t(NOTIFICATION_KEYS.ANALYSIS_COMPLETED, {
        title: truncatedTitle,
        comments: commentsSuffix,
      });
    }
    return i18n.t(NOTIFICATION_KEYS.CONFIG_GENERATION_COMPLETED, { title: truncatedTitle });
  }

  private getFailureMessage(taskType: 'extract' | 'analyze' | 'config', error: string): string {
    if (taskType === 'extract') {
      return i18n.t(NOTIFICATION_KEYS.EXTRACTION_FAILED, { error });
    }
    if (taskType === 'analyze') {
      return i18n.t(NOTIFICATION_KEYS.ANALYSIS_FAILED, { error });
    }
    return i18n.t(NOTIFICATION_KEYS.CONFIG_GENERATION_FAILED, { error });
  }
}
