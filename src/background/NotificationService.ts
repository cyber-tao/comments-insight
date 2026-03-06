/**
 * NotificationService handles browser notifications
 */
import { ICONS, PATHS, TEXT, LIMITS, TIMING } from '@/config/constants';
import { Logger } from '@/utils/logger';

export class NotificationService {
  /**
   * Show task completion notification
   * @param taskType - Type of completed task
   * @param title - Post title
   * @param commentsCount - Number of comments processed
   */
  static async showTaskCompleted(
    taskType: 'extract' | 'analyze' | 'config',
    title: string,
    commentsCount?: number,
  ): Promise<void> {
    try {
      const notificationId = `task_completed_${Date.now()}`;
      const options = {
        type: 'basic' as const,
        iconUrl: ICONS.ICON_48,
        title: TEXT.APP_NAME,
        message: this.getCompletionMessage(taskType, title, commentsCount),
        buttons: [{ title: TEXT.VIEW_RESULTS }, { title: TEXT.DISMISS }],
        requireInteraction: true,
      };

      await chrome.notifications.create(notificationId, options);

      // Auto-clear after 10 seconds if not interacted with
      setTimeout(() => {
        chrome.notifications.clear(notificationId);
      }, TIMING.NOTIFICATION_AUTOCLEAR_MS);
    } catch (error) {
      Logger.error('[NotificationService] Failed to show notification', { error });
    }
  }

  /**
   * Show task failed notification
   * @param taskType - Type of failed task
   * @param error - Error message
   */
  static async showTaskFailed(
    taskType: 'extract' | 'analyze' | 'config',
    error: string,
  ): Promise<void> {
    try {
      const notificationId = `task_failed_${Date.now()}`;
      const options = {
        type: 'basic' as const,
        iconUrl: ICONS.ICON_48,
        title: TEXT.TASK_FAILED_TITLE,
        message: this.getFailureMessage(taskType, error),
        requireInteraction: false,
      };

      await chrome.notifications.create(notificationId, options);
    } catch (error) {
      Logger.error('[NotificationService] Failed to show error notification', { error });
    }
  }

  /**
   * Handle notification clicks
   */
  static setupNotificationHandlers(): void {
    chrome.notifications.onClicked.addListener((notificationId) => {
      if (notificationId.startsWith('task_completed_')) {
        // Open history page
        chrome.tabs.create({
          url: chrome.runtime.getURL(PATHS.HISTORY_PAGE),
        });
      }
      chrome.notifications.clear(notificationId);
    });

    chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
      if (buttonIndex === 0) {
        // View Results
        chrome.tabs.create({
          url: chrome.runtime.getURL(PATHS.HISTORY_PAGE),
        });
      }
      chrome.notifications.clear(notificationId);
    });
  }

  /**
   * Get completion message based on task type
   */
  private static getCompletionMessage(
    taskType: 'extract' | 'analyze' | 'config',
    title: string,
    commentsCount?: number,
  ): string {
    const truncatedTitle =
      title.length > LIMITS.NOTIFICATION_TITLE_MAX_LENGTH
        ? title.substring(0, LIMITS.NOTIFICATION_TITLE_MAX_LENGTH) + '...'
        : title;

    if (taskType === 'extract') {
      return commentsCount
        ? `Extraction completed for "${truncatedTitle}" (${commentsCount} comments)`
        : `Extraction completed for "${truncatedTitle}"`;
    }
    if (taskType === 'analyze') {
      return commentsCount
        ? `Analysis completed for "${truncatedTitle}" (${commentsCount} comments analyzed)`
        : `Analysis completed for "${truncatedTitle}"`;
    }
    return `Config generation completed for "${truncatedTitle}"`;
  }

  /**
   * Get failure message based on task type
   */
  private static getFailureMessage(
    taskType: 'extract' | 'analyze' | 'config',
    error: string,
  ): string {
    if (taskType === 'extract') {
      return `Extraction failed: ${error}`;
    }
    if (taskType === 'analyze') {
      return `Analysis failed: ${error}`;
    }
    return `Config generation failed: ${error}`;
  }
}
