// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '@/config/constants';

const contentMocks = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  handleStartExtraction: vi.fn(),
  handleCancelExtraction: vi.fn(),
  handleStartConfigGeneration: vi.fn(),
  handleGetDOMStructure: vi.fn(),
  handleTestSelector: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  Logger: contentMocks.logger,
}));

vi.mock('@/content/handlers/extraction', () => ({
  handleStartExtraction: contentMocks.handleStartExtraction,
  handleCancelExtraction: contentMocks.handleCancelExtraction,
}));

vi.mock('@/content/handlers/config-generation', () => ({
  handleStartConfigGeneration: contentMocks.handleStartConfigGeneration,
}));

vi.mock('@/content/handlers/dom', () => ({
  handleGetDOMStructure: contentMocks.handleGetDOMStructure,
  handleTestSelector: contentMocks.handleTestSelector,
}));

type RuntimeMessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | void;

const contentGlobal = globalThis as typeof globalThis & {
  __COMMENTS_INSIGHT_CONTENT_SCRIPT_LOADED?: boolean;
};
const sender = {} as chrome.runtime.MessageSender;
const invalidMessageResponse = { success: false, error: 'Invalid content message' };

let registeredListener: RuntimeMessageListener | undefined;

const addListenerMock = vi.fn((listener: RuntimeMessageListener) => {
  registeredListener = listener;
});

async function loadContentEntry(): Promise<RuntimeMessageListener> {
  await import('@/content/index');
  expect(registeredListener).toBeTypeOf('function');
  return registeredListener as RuntimeMessageListener;
}

function dispatchMessage(listener: RuntimeMessageListener, message: unknown) {
  const sendResponse = vi.fn();
  const result = listener(message, sender, sendResponse);
  return { result, sendResponse };
}

function expectInvalidMessage(listener: RuntimeMessageListener, message: unknown): void {
  const { result, sendResponse } = dispatchMessage(listener, message);
  expect(result).toBe(false);
  expect(sendResponse).toHaveBeenCalledOnce();
  expect(sendResponse).toHaveBeenCalledWith(invalidMessageResponse);
}

function expectNoHandlerCalls(): void {
  expect(contentMocks.handleStartExtraction).not.toHaveBeenCalled();
  expect(contentMocks.handleCancelExtraction).not.toHaveBeenCalled();
  expect(contentMocks.handleStartConfigGeneration).not.toHaveBeenCalled();
  expect(contentMocks.handleGetDOMStructure).not.toHaveBeenCalled();
  expect(contentMocks.handleTestSelector).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  registeredListener = undefined;
  delete contentGlobal.__COMMENTS_INSIGHT_CONTENT_SCRIPT_LOADED;
  document.title = 'Content Entry Test';
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: { addListener: addListenerMock },
    },
  });
});

afterEach(() => {
  delete contentGlobal.__COMMENTS_INSIGHT_CONTENT_SCRIPT_LOADED;
  document.title = '';
  vi.unstubAllGlobals();
});

describe('content entry', () => {
  it('prevents duplicate listener registration when the module is evaluated again', async () => {
    const firstListener = await loadContentEntry();

    expect(addListenerMock).toHaveBeenCalledOnce();
    expect(contentMocks.logger.debug).toHaveBeenNthCalledWith(
      1,
      'Comments Insight Content Script loaded',
    );
    expect(contentMocks.logger.debug).toHaveBeenNthCalledWith(2, '[Content] Page loaded', {
      href: window.location.href,
    });
    expect(contentGlobal.__COMMENTS_INSIGHT_CONTENT_SCRIPT_LOADED).toBe(true);

    vi.resetModules();
    await import('@/content/index');

    expect(addListenerMock).toHaveBeenCalledOnce();
    expect(contentMocks.logger.debug).toHaveBeenCalledTimes(2);
    expect(registeredListener).toBe(firstListener);
  });

  it.each([
    ['null', null],
    ['a primitive', 'PING'],
    ['an array', []],
    ['a missing type', {}],
    ['a non-string type', { type: 1 }],
    ['an unknown type', { type: 'UNKNOWN_MESSAGE' }],
    ['a PING payload', { type: MESSAGES.PING, payload: null }],
    ['a GET_PLATFORM_INFO payload', { type: MESSAGES.GET_PLATFORM_INFO, payload: {} }],
    ['a GET_DOM_STRUCTURE payload', { type: MESSAGES.GET_DOM_STRUCTURE, payload: {} }],
  ] as Array<[string, unknown]>)(
    'rejects %s without routing to a handler',
    async (_description, message) => {
      const listener = await loadContentEntry();

      expectInvalidMessage(listener, message);
      expectNoHandlerCalls();
    },
  );

  it('responds to PING', async () => {
    const listener = await loadContentEntry();

    const { result, sendResponse } = dispatchMessage(listener, { type: MESSAGES.PING });

    expect(result).toBe(true);
    expect(sendResponse).toHaveBeenCalledOnce();
    expect(sendResponse).toHaveBeenCalledWith({ status: 'ok' });
    expectNoHandlerCalls();
  });

  it('returns the jsdom page information for GET_PLATFORM_INFO', async () => {
    const listener = await loadContentEntry();

    const { result, sendResponse } = dispatchMessage(listener, {
      type: MESSAGES.GET_PLATFORM_INFO,
    });

    expect(result).toBe(true);
    expect(sendResponse).toHaveBeenCalledOnce();
    expect(sendResponse).toHaveBeenCalledWith({
      url: window.location.href,
      title: 'Content Entry Test',
    });
    expectNoHandlerCalls();
  });

  it('routes a valid RUN_EXTRACTION message', async () => {
    const listener = await loadContentEntry();
    const payload = { taskId: 'extract-task', maxComments: 25 };

    const { result, sendResponse } = dispatchMessage(listener, {
      type: MESSAGES.RUN_EXTRACTION,
      payload,
    });

    expect(result).toBe(true);
    expect(contentMocks.handleStartExtraction).toHaveBeenCalledOnce();
    expect(contentMocks.handleStartExtraction).toHaveBeenCalledWith(payload, sendResponse);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('rejects invalid RUN_EXTRACTION task IDs and maxComments values', async () => {
    const listener = await loadContentEntry();
    const invalidPayloads = [
      { taskId: '', maxComments: 25 },
      { taskId: 42, maxComments: 25 },
      { taskId: 'extract-task', maxComments: 0 },
      { taskId: 'extract-task', maxComments: -1 },
      { taskId: 'extract-task', maxComments: 1.5 },
      { taskId: 'extract-task', maxComments: '25' },
      { taskId: 'extract-task', maxComments: Number.NaN },
      { taskId: 'extract-task', maxComments: Number.POSITIVE_INFINITY },
    ];

    for (const payload of invalidPayloads) {
      expectInvalidMessage(listener, { type: MESSAGES.RUN_EXTRACTION, payload });
    }
    expectNoHandlerCalls();
  });

  it('routes a valid RUN_CONFIG_GENERATION message', async () => {
    const listener = await loadContentEntry();
    const payload = { taskId: 'config-task' };

    const { result, sendResponse } = dispatchMessage(listener, {
      type: MESSAGES.RUN_CONFIG_GENERATION,
      payload,
    });

    expect(result).toBe(true);
    expect(contentMocks.handleStartConfigGeneration).toHaveBeenCalledOnce();
    expect(contentMocks.handleStartConfigGeneration).toHaveBeenCalledWith(payload, sendResponse);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('rejects invalid RUN_CONFIG_GENERATION task IDs without calling the handler', async () => {
    const listener = await loadContentEntry();

    expectInvalidMessage(listener, {
      type: MESSAGES.RUN_CONFIG_GENERATION,
      payload: { taskId: '' },
    });
    expectInvalidMessage(listener, {
      type: MESSAGES.RUN_CONFIG_GENERATION,
      payload: { taskId: 42 },
    });

    expect(contentMocks.handleStartConfigGeneration).not.toHaveBeenCalled();
  });

  it('routes CANCEL_EXTRACTION and acknowledges it', async () => {
    const listener = await loadContentEntry();

    const { result, sendResponse } = dispatchMessage(listener, {
      type: MESSAGES.CANCEL_EXTRACTION,
      payload: { taskId: 'cancel-task' },
    });

    expect(result).toBe(true);
    expect(contentMocks.handleCancelExtraction).toHaveBeenCalledOnce();
    expect(contentMocks.handleCancelExtraction).toHaveBeenCalledWith('cancel-task');
    expect(sendResponse).toHaveBeenCalledOnce();
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('rejects invalid CANCEL_EXTRACTION task IDs without calling the handler', async () => {
    const listener = await loadContentEntry();

    expectInvalidMessage(listener, {
      type: MESSAGES.CANCEL_EXTRACTION,
      payload: { taskId: '' },
    });
    expectInvalidMessage(listener, {
      type: MESSAGES.CANCEL_EXTRACTION,
      payload: { taskId: null },
    });

    expect(contentMocks.handleCancelExtraction).not.toHaveBeenCalled();
  });

  it('routes GET_DOM_STRUCTURE', async () => {
    const listener = await loadContentEntry();

    const { result, sendResponse } = dispatchMessage(listener, {
      type: MESSAGES.GET_DOM_STRUCTURE,
    });

    expect(result).toBe(true);
    expect(contentMocks.handleGetDOMStructure).toHaveBeenCalledOnce();
    expect(contentMocks.handleGetDOMStructure).toHaveBeenCalledWith(sendResponse);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it.each(['css', 'xpath'] as const)(
    'routes a valid %s TEST_SELECTOR message',
    async (selectorType) => {
      const listener = await loadContentEntry();
      const payload = {
        selector: selectorType === 'css' ? '.comment' : '//article',
        selectorType,
      };

      const { result, sendResponse } = dispatchMessage(listener, {
        type: MESSAGES.TEST_SELECTOR,
        payload,
      });

      expect(result).toBe(true);
      expect(contentMocks.handleTestSelector).toHaveBeenCalledOnce();
      expect(contentMocks.handleTestSelector).toHaveBeenCalledWith(payload, sendResponse);
      expect(sendResponse).not.toHaveBeenCalled();
    },
  );

  it('rejects invalid TEST_SELECTOR payloads without calling the handler', async () => {
    const listener = await loadContentEntry();
    const invalidPayloads = [
      { selector: '', selectorType: 'css' },
      { selector: 42, selectorType: 'css' },
      { selector: '.comment', selectorType: 'text' },
      { selector: '.comment' },
    ];

    for (const payload of invalidPayloads) {
      expectInvalidMessage(listener, { type: MESSAGES.TEST_SELECTOR, payload });
    }

    expect(contentMocks.handleTestSelector).not.toHaveBeenCalled();
  });
});
