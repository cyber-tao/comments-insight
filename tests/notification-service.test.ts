import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService } from '../src/background/NotificationService';
import { LANGUAGES } from '../src/config/constants/ui';
import i18n, { changeLanguage } from '../src/utils/i18n';

const mockNotificationCreate = vi.fn().mockResolvedValue(undefined);
const mockNotificationClear = vi.fn().mockResolvedValue(undefined);
const mockOnClicked = { addListener: vi.fn() };
const mockOnButtonClicked = { addListener: vi.fn() };
const mockTabsCreate = vi.fn().mockResolvedValue({});
const mockRuntimeGetURL = vi.fn((path: string) => `chrome-extension://id/${path}`);

vi.stubGlobal('chrome', {
  notifications: {
    create: mockNotificationCreate,
    clear: mockNotificationClear,
    onClicked: mockOnClicked,
    onButtonClicked: mockOnButtonClicked,
  },
  tabs: {
    create: mockTabsCreate,
  },
  runtime: {
    getURL: mockRuntimeGetURL,
  },
});

vi.mock('../src/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('NotificationService', () => {
  let notificationService: NotificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    notificationService = new NotificationService();
  });

  describe('showTaskCompleted', () => {
    it.each(LANGUAGES.SUPPORTED.map(({ code }) => code))(
      'renders an extraction notification in %s',
      async (locale) => {
        const previousLanguage = i18n.language;
        await changeLanguage(locale);
        try {
          const title = 'Synthetic discussion';
          const catalog = i18n.getResourceBundle(locale, 'translation');
          const comments = catalog.notification.commentsCount.replace('{{count}}', '3');
          const expected = catalog.notification.extractionCompleted
            .replace('{{title}}', title)
            .replace('{{comments}}', comments);

          await notificationService.showTaskCompleted('extract', title, 3);

          expect(mockNotificationCreate).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
              title: catalog.common.appName,
              message: expected,
              buttons: [
                { title: catalog.notification.viewResults },
                { title: catalog.notification.dismiss },
              ],
            }),
          );
        } finally {
          await changeLanguage(previousLanguage);
        }
      },
    );

    it('should create notification for extraction completion', async () => {
      await notificationService.showTaskCompleted('extract', 'Test Post', 10);

      expect(mockNotificationCreate).toHaveBeenCalledWith(
        expect.stringContaining('task_completed_'),
        expect.objectContaining({
          type: 'basic',
          title: expect.any(String),
          requireInteraction: true,
        }),
      );
    });

    it('should create notification for analysis completion', async () => {
      await notificationService.showTaskCompleted('analyze', 'Test Post', 5);

      expect(mockNotificationCreate).toHaveBeenCalledWith(
        expect.stringContaining('task_completed_'),
        expect.objectContaining({
          type: 'basic',
          requireInteraction: true,
        }),
      );
    });

    it('should create notification for config generation completion', async () => {
      await notificationService.showTaskCompleted('config', 'Test Post');

      expect(mockNotificationCreate).toHaveBeenCalledWith(
        expect.stringContaining('task_completed_'),
        expect.objectContaining({
          message: expect.any(String),
          requireInteraction: true,
        }),
      );
    });

    it('should truncate long titles', async () => {
      const longTitle = 'A'.repeat(100);
      await notificationService.showTaskCompleted('extract', longTitle);

      expect(mockNotificationCreate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          message: expect.stringContaining('...'),
        }),
      );
    });

    it('should auto-clear notification after timeout', async () => {
      await notificationService.showTaskCompleted('extract', 'Test', 5);

      vi.advanceTimersByTime(10000);

      expect(mockNotificationClear).toHaveBeenCalled();
    });
  });

  describe('showTaskFailed', () => {
    it('should create error notification for extraction failure', async () => {
      await notificationService.showTaskFailed('extract', 'Network error');

      expect(mockNotificationCreate).toHaveBeenCalledWith(
        expect.stringContaining('task_failed_'),
        expect.objectContaining({
          requireInteraction: false,
        }),
      );
    });

    it('should create error notification for analysis failure', async () => {
      await notificationService.showTaskFailed('analyze', 'API error');

      expect(mockNotificationCreate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          requireInteraction: false,
        }),
      );
    });

    it('should create error notification for config generation failure', async () => {
      await notificationService.showTaskFailed('config', 'Invalid selectors');

      expect(mockNotificationCreate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          message: expect.any(String),
          requireInteraction: false,
        }),
      );
    });
  });

  describe('setupNotificationHandlers', () => {
    it('should register click handlers', () => {
      notificationService.setupNotificationHandlers();

      expect(mockOnClicked.addListener).toHaveBeenCalledWith(expect.any(Function));
      expect(mockOnButtonClicked.addListener).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should open history page on notification click', () => {
      notificationService.setupNotificationHandlers();

      const clickHandler = mockOnClicked.addListener.mock.calls[0][0];
      clickHandler('task_completed_123');

      expect(mockTabsCreate).toHaveBeenCalledWith({
        url: expect.stringContaining('history'),
      });
      expect(mockNotificationClear).toHaveBeenCalledWith('task_completed_123');
    });

    it('should open history page on View Results button click', () => {
      notificationService.setupNotificationHandlers();

      const buttonHandler = mockOnButtonClicked.addListener.mock.calls[0][0];
      buttonHandler('task_completed_123', 0);

      expect(mockTabsCreate).toHaveBeenCalled();
      expect(mockNotificationClear).toHaveBeenCalledWith('task_completed_123');
    });

    it('should only clear notification on Dismiss button click', () => {
      notificationService.setupNotificationHandlers();

      const buttonHandler = mockOnButtonClicked.addListener.mock.calls[0][0];
      buttonHandler('task_completed_123', 1);

      expect(mockTabsCreate).not.toHaveBeenCalled();
      expect(mockNotificationClear).toHaveBeenCalledWith('task_completed_123');
    });
  });
});
