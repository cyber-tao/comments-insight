/**
 * NotificationService handles browser notifications
 */
import { ICONS, PATHS, TEXT } from '@/config/constants';

export class NotificationService {
  /**
   * Show task completion notification
   * @param taskType - Type of completed task
   * @param title - Post title
   * @param commentsCount - Number of comments processed
   */
  static async showTaskCompleted(
    taskType: 'extract' | 'analyze',
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
      }, TEXT.NOTIFICATION_AUTOCLEAR_MS);
    } catch (error) {
      console.error('[NotificationService] Failed to show notification:', error);
    }
  }

  /**
   * Show task failed notification
   * @param taskType - Type of failed task
   * @param error - Error message
   */
  static async showTaskFailed(taskType: 'extract' | 'analyze', error: string): Promise<void> {
    try {
      const notificationId = `task_failed_${Date.now()}`;
      const options = {
        type: 'basic' as const,
        iconUrl: ICONS.ICON_48,
        title: TEXT.TASK_FAILED_TITLE,
        message: `${taskType === 'extract' ? 'Extraction' : 'Analysis'} failed: ${error}`,
        requireInteraction: false,
      };

      await chrome.notifications.create(notificationId, options);
    } catch (error) {
      console.error('[NotificationService] Failed to show error notification:', error);
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
    taskType: 'extract' | 'analyze',
    title: string,
    commentsCount?: number,
  ): string {
    const truncatedTitle = title.length > 50 ? title.substring(0, 50) + '...' : title;

    if (taskType === 'extract') {
      return `Extraction completed for "${truncatedTitle}"${commentsCount ? ` (${commentsCount} comments)` : ''}`;
    } else {
      return `Analysis completed for "${truncatedTitle}"${commentsCount ? ` (${commentsCount} comments analyzed)` : ''}`;
    }
  }
}
