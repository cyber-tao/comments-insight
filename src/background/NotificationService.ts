import { ICONS, PATHS, LIMITS, NOTIFICATION_KEYS } from '@/config/constants';
import { Logger } from '@/utils/logger';
import { generateUniqueId } from '@/utils/id-generator';
import i18n from '@/utils/i18n';

export interface NotificationTarget {
  historyId?: string;
  historyTab?: 'comments' | 'analysis' | 'dynamic';
  configDomain?: string;
}

export class NotificationService {
  async showTaskCompleted(
    taskType: 'extract' | 'analyze' | 'config',
    title: string,
    commentsCount?: number,
    target?: NotificationTarget,
  ): Promise<void> {
    try {
      const targetPath = this.buildTargetPath(taskType, target);
      const notificationId = `${generateUniqueId('task_completed')}::${targetPath}`;
      const options = {
        type: 'basic' as const,
        iconUrl: chrome.runtime.getURL(ICONS.ICON_48),
        title: i18n.t('common.appName'),
        message: this.getCompletionMessage(taskType, title, commentsCount),
        buttons: [
          { title: i18n.t('notification.viewResults', { defaultValue: 'View Results' }) },
          { title: i18n.t('notification.dismiss', { defaultValue: 'Dismiss' }) },
        ],
        requireInteraction: false,
      };

      await chrome.notifications.create(notificationId, options);
    } catch (error) {
      Logger.error('[NotificationService] Failed to show notification', { error });
    }
  }

  async showTaskFailed(taskType: 'extract' | 'analyze' | 'config', error: string): Promise<void> {
    try {
      const notificationId = generateUniqueId('task_failed');
      const options = {
        type: 'basic' as const,
        iconUrl: chrome.runtime.getURL(ICONS.ICON_48),
        title: i18n.t('common.appName'),
        message: this.getFailureMessage(taskType, error),
        requireInteraction: false,
      };

      await chrome.notifications.create(notificationId, options);
    } catch (error) {
      Logger.error('[NotificationService] Failed to show error notification', { error });
    }
  }

  private buildTargetPath(
    taskType: 'extract' | 'analyze' | 'config',
    target?: NotificationTarget,
  ): string {
    if (taskType === 'config') {
      const params = new URLSearchParams({ tab: 'crawling' });
      const domain = target?.configDomain?.trim();
      if (domain) {
        params.set('domain', domain);
      }
      return `${PATHS.OPTIONS_PAGE}?${params.toString()}`;
    }

    const params = new URLSearchParams();
    const historyId = target?.historyId?.trim();
    if (historyId) {
      params.set('id', historyId);
    }
    if (target?.historyTab) {
      params.set('tab', target.historyTab);
    } else if (historyId) {
      params.set('tab', taskType === 'extract' ? 'comments' : 'analysis');
    }
    const query = params.toString();
    return query ? `${PATHS.HISTORY_PAGE}?${query}` : PATHS.HISTORY_PAGE;
  }

  private resolveTargetPath(notificationId: string): string {
    const separatorIndex = notificationId.indexOf('::');
    if (separatorIndex === -1) {
      return PATHS.HISTORY_PAGE;
    }
    const targetPath = notificationId.slice(separatorIndex + 2);
    if (targetPath.startsWith(PATHS.HISTORY_PAGE) || targetPath.startsWith(PATHS.OPTIONS_PAGE)) {
      return targetPath;
    }
    return PATHS.HISTORY_PAGE;
  }

  private async openTaskCompletedTarget(notificationId: string): Promise<void> {
    try {
      await chrome.tabs.create({
        url: chrome.runtime.getURL(this.resolveTargetPath(notificationId)),
      });
    } catch (error) {
      Logger.warn('[NotificationService] Failed to open notification target', {
        notificationId,
        error,
      });
    }
  }

  private async clearNotification(notificationId: string): Promise<void> {
    try {
      await chrome.notifications.clear(notificationId);
    } catch (error) {
      Logger.debug('[NotificationService] Failed to clear notification', {
        notificationId,
        error,
      });
    }
  }

  setupNotificationHandlers(): void {
    chrome.notifications.onClicked.addListener((notificationId) => {
      if (notificationId.startsWith('task_completed_')) {
        void this.openTaskCompletedTarget(notificationId);
      }
      void this.clearNotification(notificationId);
    });

    chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
      if (buttonIndex === 0 && notificationId.startsWith('task_completed_')) {
        void this.openTaskCompletedTarget(notificationId);
      }
      void this.clearNotification(notificationId);
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
