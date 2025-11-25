import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService } from '../src/background/NotificationService';

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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  describe('showTaskCompleted', () => {
    it('should create notification for extraction completion', async () => {
      await NotificationService.showTaskCompleted('extract', 'Test Post', 10);

      expect(mockNotificationCreate).toHaveBeenCalledWith(
        expect.stringMatching(/^task_completed_\d+$/),
        expect.objectContaining({
          type: 'basic',
          title: 'Comments Insight',
          message: expect.stringContaining('Extraction completed'),
          requireInteraction: true,
        }),
      );
    });

    it('should create notification for analysis completion', async () => {
      await NotificationService.showTaskCompleted('analyze', 'Test Post', 5);

      expect(mockNotificationCreate).toHaveBeenCalledWith(
        expect.stringMatching(/^task_completed_\d+$/),
        expect.objectContaining({
          message: expect.stringContaining('Analysis completed'),
        }),
      );
    });

    it('should truncate long titles', async () => {
      const longTitle = 'A'.repeat(100);
      await NotificationService.showTaskCompleted('extract', longTitle);

      expect(mockNotificationCreate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          message: expect.stringContaining('...'),
        }),
      );
    });

    it('should auto-clear notification after timeout', async () => {
      await NotificationService.showTaskCompleted('extract', 'Test', 5);

      vi.advanceTimersByTime(10000);

      expect(mockNotificationClear).toHaveBeenCalled();
    });
  });

  describe('showTaskFailed', () => {
    it('should create error notification for extraction failure', async () => {
      await NotificationService.showTaskFailed('extract', 'Network error');

      expect(mockNotificationCreate).toHaveBeenCalledWith(
        expect.stringMatching(/^task_failed_\d+$/),
        expect.objectContaining({
          title: expect.stringContaining('Task Failed'),
          message: expect.stringContaining('Extraction failed: Network error'),
          requireInteraction: false,
        }),
      );
    });

    it('should create error notification for analysis failure', async () => {
      await NotificationService.showTaskFailed('analyze', 'API error');

      expect(mockNotificationCreate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          message: expect.stringContaining('Analysis failed: API error'),
        }),
      );
    });
  });

  describe('setupNotificationHandlers', () => {
    it('should register click handlers', () => {
      NotificationService.setupNotificationHandlers();

      expect(mockOnClicked.addListener).toHaveBeenCalledWith(expect.any(Function));
      expect(mockOnButtonClicked.addListener).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should open history page on notification click', () => {
      NotificationService.setupNotificationHandlers();

      const clickHandler = mockOnClicked.addListener.mock.calls[0][0];
      clickHandler('task_completed_123');

      expect(mockTabsCreate).toHaveBeenCalledWith({
        url: expect.stringContaining('history'),
      });
      expect(mockNotificationClear).toHaveBeenCalledWith('task_completed_123');
    });

    it('should open history page on View Results button click', () => {
      NotificationService.setupNotificationHandlers();

      const buttonHandler = mockOnButtonClicked.addListener.mock.calls[0][0];
      buttonHandler('task_completed_123', 0);

      expect(mockTabsCreate).toHaveBeenCalled();
      expect(mockNotificationClear).toHaveBeenCalledWith('task_completed_123');
    });

    it('should only clear notification on Dismiss button click', () => {
      NotificationService.setupNotificationHandlers();

      const buttonHandler = mockOnButtonClicked.addListener.mock.calls[0][0];
      buttonHandler('task_completed_123', 1);

      expect(mockTabsCreate).not.toHaveBeenCalled();
      expect(mockNotificationClear).toHaveBeenCalledWith('task_completed_123');
    });
  });
});
