import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES, STORAGE } from '../src/config/constants';
import type { LogEntry } from '../src/utils/logger';

const backgroundMocks = vi.hoisted(() => {
  const services = { source: 'service-container' };
  const taskManager = { initialize: vi.fn() };
  const settingsStore = { getSettings: vi.fn() };
  const notificationService = { setupNotificationHandlers: vi.fn() };
  const logStore = { saveSystemLog: vi.fn() };

  return {
    services,
    taskManager,
    settingsStore,
    notificationService,
    logStore,
    getLogStore: vi.fn(),
    setStorageWriter: vi.fn(),
    containerGetAll: vi.fn(),
    containerResetAll: vi.fn(),
    getTaskManager: vi.fn(),
    getSettingsStore: vi.fn(),
    getNotificationService: vi.fn(),
    migrate: vi.fn(),
    messageRouterConstructor: vi.fn(),
    handlePortMessage: vi.fn(),
    handleMessage: vi.fn(),
    loggerInfo: vi.fn(),
    loggerDebug: vi.fn(),
    loggerWarn: vi.fn(),
    loggerError: vi.fn(),
    i18n: { language: 'en-US' },
    changeLanguage: vi.fn(),
  };
});

vi.mock('../src/background/ServiceContainer', () => ({
  container: {
    getAll: backgroundMocks.containerGetAll,
    resetAll: backgroundMocks.containerResetAll,
  },
  getTaskManager: backgroundMocks.getTaskManager,
  getSettingsStore: backgroundMocks.getSettingsStore,
  getNotificationService: backgroundMocks.getNotificationService,
  getLogStore: backgroundMocks.getLogStore,
}));

vi.mock('../src/background/MessageRouter', async (importOriginal) => ({
  isLogMessageType: (await importOriginal<typeof import('../src/background/MessageRouter')>())
    .isLogMessageType,
  MessageRouter: class {
    constructor(services: unknown, options: unknown) {
      backgroundMocks.messageRouterConstructor(services, options);
    }

    handlePortMessage(port: unknown, message: unknown) {
      return backgroundMocks.handlePortMessage(port, message);
    }

    handleMessage(message: unknown, sender: unknown) {
      return backgroundMocks.handleMessage(message, sender);
    }
  },
}));

vi.mock('../src/background/storage/DataMigrator', () => ({
  DataMigrator: class {
    migrate() {
      return backgroundMocks.migrate();
    }
  },
}));

vi.mock('../src/utils/logger', () => ({
  Logger: {
    info: backgroundMocks.loggerInfo,
    debug: backgroundMocks.loggerDebug,
    warn: backgroundMocks.loggerWarn,
    error: backgroundMocks.loggerError,
    setStorageWriter: backgroundMocks.setStorageWriter,
  },
}));

vi.mock('../src/utils/i18n', () => ({
  default: backgroundMocks.i18n,
  changeLanguage: backgroundMocks.changeLanguage,
}));

type StorageChangeListener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  areaName: string,
) => void;
type InstalledListener = () => void;
type ConnectListener = (port: chrome.runtime.Port) => void;
type RuntimeMessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;
type PortMessageListener = (message: unknown) => void;

const chromeMocks = {
  remove: vi.fn<(key: string) => Promise<void>>(),
  storageAddListener: vi.fn<(listener: StorageChangeListener) => void>(),
  installedAddListener: vi.fn<(listener: InstalledListener) => void>(),
  connectAddListener: vi.fn<(listener: ConnectListener) => void>(),
  messageAddListener: vi.fn<(listener: RuntimeMessageListener) => void>(),
};

let storageChangeListener: StorageChangeListener | undefined;
let installedListener: InstalledListener | undefined;
let connectListener: ConnectListener | undefined;
let runtimeMessageListener: RuntimeMessageListener | undefined;

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function getListener<T>(listener: T | undefined): T {
  expect(listener).toBeDefined();
  return listener as T;
}

async function importBackground(): Promise<void> {
  await import('../src/background/index');
}

async function importInitializedBackground(): Promise<void> {
  await importBackground();
  await vi.waitFor(() => {
    expect(backgroundMocks.loggerInfo).toHaveBeenCalledWith(
      '[Background] Migration and TaskManager initialized',
    );
  });
}

describe('background entry wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();

    backgroundMocks.containerGetAll.mockReturnValue(backgroundMocks.services);
    backgroundMocks.getTaskManager.mockReturnValue(backgroundMocks.taskManager);
    backgroundMocks.getSettingsStore.mockReturnValue(backgroundMocks.settingsStore);
    backgroundMocks.getNotificationService.mockReturnValue(backgroundMocks.notificationService);
    backgroundMocks.getLogStore.mockReturnValue(backgroundMocks.logStore);
    backgroundMocks.logStore.saveSystemLog.mockResolvedValue(undefined);
    backgroundMocks.migrate.mockResolvedValue(undefined);
    backgroundMocks.taskManager.initialize.mockResolvedValue(undefined);
    backgroundMocks.settingsStore.getSettings.mockResolvedValue({ language: 'en-US' });
    backgroundMocks.changeLanguage.mockResolvedValue(undefined);
    backgroundMocks.handlePortMessage.mockResolvedValue(undefined);
    backgroundMocks.handleMessage.mockResolvedValue(undefined);
    backgroundMocks.i18n.language = 'en-US';

    storageChangeListener = undefined;
    installedListener = undefined;
    connectListener = undefined;
    runtimeMessageListener = undefined;

    chromeMocks.remove.mockResolvedValue(undefined);
    chromeMocks.storageAddListener.mockImplementation((listener) => {
      storageChangeListener = listener;
    });
    chromeMocks.installedAddListener.mockImplementation((listener) => {
      installedListener = listener;
    });
    chromeMocks.connectAddListener.mockImplementation((listener) => {
      connectListener = listener;
    });
    chromeMocks.messageAddListener.mockImplementation((listener) => {
      runtimeMessageListener = listener;
    });

    vi.stubGlobal('chrome', {
      storage: {
        local: { remove: chromeMocks.remove },
        onChanged: { addListener: chromeMocks.storageAddListener },
      },
      runtime: {
        onInstalled: { addListener: chromeMocks.installedAddListener },
        onConnect: { addListener: chromeMocks.connectAddListener },
        onMessage: { addListener: chromeMocks.messageAddListener },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers the background log writer before the first startup log', async () => {
    await importInitializedBackground();

    expect(backgroundMocks.setStorageWriter).toHaveBeenCalledOnce();
    expect(backgroundMocks.setStorageWriter).toHaveBeenCalledWith(expect.any(Function));
    expect(backgroundMocks.setStorageWriter.mock.invocationCallOrder[0]).toBeLessThan(
      backgroundMocks.loggerInfo.mock.invocationCallOrder[0],
    );
    expect(backgroundMocks.loggerInfo).toHaveBeenNthCalledWith(
      1,
      'Comments Insight Service Worker loaded',
    );
  });

  it('lazily resolves LogStore and delegates each background writer call to saveSystemLog', async () => {
    await importInitializedBackground();
    const writer = backgroundMocks.setStorageWriter.mock.calls[0]?.[0] as (
      entry: LogEntry,
    ) => Promise<void>;
    const entry = {
      level: 'INFO',
      timestamp: 1234,
      message: 'Persisted by the service worker',
    } as LogEntry;
    const persistence = createDeferred<void>();
    backgroundMocks.logStore.saveSystemLog.mockReturnValueOnce(persistence.promise);

    expect(backgroundMocks.getLogStore).not.toHaveBeenCalled();
    const result = writer(entry);

    expect(backgroundMocks.getLogStore).toHaveBeenCalledOnce();
    expect(backgroundMocks.logStore.saveSystemLog).toHaveBeenCalledExactlyOnceWith(entry);
    expect(backgroundMocks.logStore.saveSystemLog.mock.calls[0]?.[0]).toBe(entry);
    expect(result).toBe(persistence.promise);
    persistence.resolve(undefined);
    await expect(result).resolves.toBeUndefined();

    const replacementStore = { saveSystemLog: vi.fn().mockResolvedValue(undefined) };
    backgroundMocks.getLogStore.mockReturnValueOnce(replacementStore);
    await writer(entry);
    expect(replacementStore.saveSystemLog).toHaveBeenCalledExactlyOnceWith(entry);
  });

  it('does not emit receipt logs for log transport messages but still routes and responds', async () => {
    await importInitializedBackground();
    backgroundMocks.loggerDebug.mockClear();
    backgroundMocks.handleMessage.mockResolvedValue({ success: true });
    const onMessage = getListener(runtimeMessageListener);
    const sender = { id: 'logs-page' } as chrome.runtime.MessageSender;
    const sendResponse = vi.fn();
    const messages = [
      {
        type: MESSAGES.APPEND_SYSTEM_LOG,
        payload: { entry: { level: 'INFO', timestamp: 1234, message: 'Transport log' } },
      },
      { type: MESSAGES.DELETE_LOG, payload: { kind: 'system', key: 'log_info_1' } },
      { type: MESSAGES.CLEAR_LOGS, payload: { kind: 'all' } },
    ];

    for (const message of messages) {
      expect(onMessage(message, sender, sendResponse)).toBe(true);
      expect(backgroundMocks.handleMessage).toHaveBeenCalledWith(message, sender);
    }
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(messages.length));
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
    expect(backgroundMocks.loggerDebug).not.toHaveBeenCalled();

    onMessage({ type: MESSAGES.PING }, sender, sendResponse);
    expect(backgroundMocks.loggerDebug).toHaveBeenCalledExactlyOnceWith('Message received', {
      message: { type: MESSAGES.PING },
    });
  });

  it('applies the saved language after migration and before task restoration', async () => {
    const migration = createDeferred<void>();
    const taskInitialization = createDeferred<void>();
    const settingsLoad = createDeferred<{ language: string }>();
    backgroundMocks.migrate.mockReturnValueOnce(migration.promise);
    backgroundMocks.taskManager.initialize.mockReturnValueOnce(taskInitialization.promise);
    backgroundMocks.settingsStore.getSettings.mockReturnValueOnce(settingsLoad.promise);

    await importBackground();

    expect(backgroundMocks.migrate).toHaveBeenCalledOnce();
    expect(backgroundMocks.taskManager.initialize).not.toHaveBeenCalled();
    expect(backgroundMocks.settingsStore.getSettings).not.toHaveBeenCalled();
    expect(backgroundMocks.changeLanguage).not.toHaveBeenCalled();
    expect(backgroundMocks.notificationService.setupNotificationHandlers).toHaveBeenCalledOnce();
    expect(backgroundMocks.messageRouterConstructor).toHaveBeenCalledWith(
      backgroundMocks.services,
      {
        readyPromise: expect.any(Promise),
      },
    );
    expect(chromeMocks.remove).toHaveBeenCalledWith(STORAGE.LAST_VERIFIED_AI_MODEL_KEY);

    migration.resolve(undefined);
    await vi.waitFor(() => {
      expect(backgroundMocks.settingsStore.getSettings).toHaveBeenCalledOnce();
    });
    expect(backgroundMocks.taskManager.initialize).not.toHaveBeenCalled();
    expect(backgroundMocks.changeLanguage).not.toHaveBeenCalled();

    settingsLoad.resolve({ language: 'ja-JP' });
    await vi.waitFor(() => {
      expect(backgroundMocks.changeLanguage).toHaveBeenCalledWith('ja-JP');
      expect(backgroundMocks.taskManager.initialize).toHaveBeenCalledOnce();
    });
    expect(backgroundMocks.changeLanguage.mock.invocationCallOrder[0]).toBeLessThan(
      backgroundMocks.taskManager.initialize.mock.invocationCallOrder[0],
    );

    taskInitialization.resolve(undefined);
    await vi.waitFor(() => {
      expect(backgroundMocks.loggerInfo).toHaveBeenCalledWith(
        '[Background] Migration and TaskManager initialized',
      );
    });
  });

  it('initializes settings when the extension is installed', async () => {
    await importInitializedBackground();
    backgroundMocks.settingsStore.getSettings.mockClear();
    backgroundMocks.loggerDebug.mockClear();
    const settings = { language: 'de' };
    backgroundMocks.settingsStore.getSettings.mockResolvedValueOnce(settings);

    getListener(installedListener)();

    expect(backgroundMocks.settingsStore.getSettings).toHaveBeenCalledOnce();
    expect(backgroundMocks.loggerInfo).toHaveBeenCalledWith('Comments Insight Extension installed');
    await vi.waitFor(() => {
      expect(backgroundMocks.loggerDebug).toHaveBeenCalledWith('Settings initialized', {
        settings,
      });
    });
  });

  it('registers port messages only for ai-bridge connections and forwards them to the router', async () => {
    await importInitializedBackground();
    const onConnect = getListener(connectListener);
    const ignoredAddListener = vi.fn();
    const ignoredPort = {
      name: 'popup',
      onMessage: { addListener: ignoredAddListener },
    } as unknown as chrome.runtime.Port;

    onConnect(ignoredPort);

    expect(ignoredAddListener).not.toHaveBeenCalled();
    expect(backgroundMocks.handlePortMessage).not.toHaveBeenCalled();

    let portMessageListener: PortMessageListener | undefined;
    const bridgeAddListener = vi.fn((listener: PortMessageListener) => {
      portMessageListener = listener;
    });
    const bridgePort = {
      name: 'ai-bridge',
      onMessage: { addListener: bridgeAddListener },
    } as unknown as chrome.runtime.Port;
    const message = { id: 'request-1', type: 'AI_EXTRACT_CONTENT' };

    onConnect(bridgePort);

    expect(bridgeAddListener).toHaveBeenCalledOnce();
    getListener(portMessageListener)(message);
    expect(backgroundMocks.handlePortMessage).toHaveBeenCalledOnce();
    expect(backgroundMocks.handlePortMessage).toHaveBeenCalledWith(bridgePort, message);
  });

  it('keeps the message channel open and sends successful router results', async () => {
    await importInitializedBackground();
    const onMessage = getListener(runtimeMessageListener);
    const message = { type: 'PING' };
    const sender = { id: 'sender-id' } as chrome.runtime.MessageSender;
    const response = { pong: true };
    const sendResponse = vi.fn<(response: unknown) => void>();
    backgroundMocks.handleMessage.mockResolvedValueOnce(response);

    const keepChannelOpen = onMessage(message, sender, sendResponse);

    expect(keepChannelOpen).toBe(true);
    expect(backgroundMocks.handleMessage).toHaveBeenCalledWith(message, sender);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(response);
    });
  });

  it('keeps the message channel open and sends structured router failures', async () => {
    await importInitializedBackground();
    const { ErrorCode, ExtensionError } = await import('../src/utils/error-types');
    const onMessage = getListener(runtimeMessageListener);
    const message = { type: 'PING' };
    const sender = { id: 'sender-id' } as chrome.runtime.MessageSender;
    const sendResponse = vi.fn<(response: unknown) => void>();
    backgroundMocks.handleMessage.mockRejectedValueOnce(
      new ExtensionError(ErrorCode.API_ERROR, 'Router failed', undefined, true),
    );

    const keepChannelOpen = onMessage(message, sender, sendResponse);

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.API_ERROR,
          message: 'Router failed',
          retryable: true,
        },
      });
    });
  });

  it('changes language only for a new non-empty local settings language', async () => {
    await importInitializedBackground();
    const onStorageChanged = getListener(storageChangeListener);
    const settingsChange = (newValue: unknown) => ({
      [STORAGE.SETTINGS_KEY]: { newValue },
    });
    backgroundMocks.changeLanguage.mockClear();
    backgroundMocks.i18n.language = 'en-US';

    onStorageChanged(settingsChange({ language: 'fr' }), 'sync');
    onStorageChanged({ unrelated: { newValue: { language: 'fr' } } }, 'local');
    onStorageChanged(settingsChange(undefined), 'local');
    onStorageChanged(settingsChange({}), 'local');
    onStorageChanged(settingsChange({ language: 123 }), 'local');
    onStorageChanged(settingsChange({ language: '' }), 'local');
    onStorageChanged(settingsChange({ language: 'en-US' }), 'local');

    expect(backgroundMocks.changeLanguage).not.toHaveBeenCalled();

    onStorageChanged(settingsChange({ language: 'fr' }), 'local');

    expect(backgroundMocks.changeLanguage).toHaveBeenCalledOnce();
    expect(backgroundMocks.changeLanguage).toHaveBeenCalledWith('fr');
  });
});
