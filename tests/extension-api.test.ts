import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtensionAPI } from '../src/utils/extension-api';
import { MESSAGES, TEXT } from '../src/config/constants';

const sendMessageMock = vi.hoisted(() => vi.fn());

vi.mock('../src/utils/chrome-message', () => ({
  sendMessage: sendMessageMock,
}));

describe('ExtensionAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps getters to message payloads and normalizes empty responses', async () => {
    sendMessageMock
      .mockResolvedValueOnce({ settings: { theme: 'dark' } })
      .mockResolvedValueOnce({ item: { id: 'history-1' } })
      .mockResolvedValueOnce({ item: null })
      .mockResolvedValueOnce({
        entries: [{ id: 'entry-1' }],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      })
      .mockResolvedValueOnce({ tasks: [{ id: 'task-1' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ config: { domain: 'example.com' } })
      .mockResolvedValueOnce({ data: '{"ok":true}' })
      .mockResolvedValueOnce({ models: ['gpt-4o-mini'] })
      .mockResolvedValueOnce({ success: true, response: 'pong' });

    expect(await ExtensionAPI.getSettings()).toEqual({ theme: 'dark' });
    expect(await ExtensionAPI.getHistoryItem('history-1')).toEqual({ id: 'history-1' });
    expect(await ExtensionAPI.getHistoryByUrl('https://example.com')).toBeNull();
    expect(await ExtensionAPI.getHistoryMetadataPage(1, 20, 'query')).toEqual({
      entries: [{ id: 'entry-1' }],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    expect(await ExtensionAPI.getTasks()).toEqual([{ id: 'task-1' }]);
    expect(await ExtensionAPI.getTaskStatus('task-1')).toBeNull();
    expect(await ExtensionAPI.getCrawlingConfig('example.com')).toEqual({ domain: 'example.com' });
    expect(await ExtensionAPI.exportSettings()).toBe('{"ok":true}');
    expect(await ExtensionAPI.getAvailableModels('https://api.example.com', 'secret')).toEqual([
      'gpt-4o-mini',
    ]);
    expect(
      await ExtensionAPI.testModel({
        apiUrl: 'https://api.example.com',
        apiKey: 'secret',
        model: 'gpt-4o-mini',
        contextWindowSize: 200000,
        maxOutputTokens: 4096,
        temperature: 1,
        topP: 0.95,
      }),
    ).toEqual({ success: true, response: 'pong' });

    expect(sendMessageMock.mock.calls).toEqual([
      [{ type: MESSAGES.GET_SETTINGS }],
      [{ type: MESSAGES.GET_HISTORY, payload: { id: 'history-1' } }],
      [{ type: MESSAGES.GET_HISTORY_BY_URL, payload: { url: 'https://example.com' } }],
      [
        {
          type: MESSAGES.GET_HISTORY,
          payload: { page: 1, pageSize: 20, query: 'query', metadataOnly: true },
        },
      ],
      [{ type: MESSAGES.GET_TASK_STATUS }],
      [{ type: MESSAGES.GET_TASK_STATUS, payload: { taskId: 'task-1' } }],
      [{ type: MESSAGES.GET_CRAWLING_CONFIG, payload: { domain: 'example.com' } }],
      [{ type: MESSAGES.EXPORT_DATA, payload: { type: 'settings' } }],
      [
        {
          type: MESSAGES.GET_AVAILABLE_MODELS,
          payload: { apiUrl: 'https://api.example.com', apiKey: 'secret' },
        },
      ],
      [
        {
          type: MESSAGES.TEST_MODEL,
          payload: {
            config: {
              apiUrl: 'https://api.example.com',
              apiKey: 'secret',
              model: 'gpt-4o-mini',
              contextWindowSize: 200000,
              maxOutputTokens: 4096,
              temperature: 1,
              topP: 0.95,
            },
          },
        },
      ],
    ]);
  });

  it('maps mutating operations to the expected messages', async () => {
    sendMessageMock
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ taskId: 'extract-1' })
      .mockResolvedValueOnce({ taskId: 'config-1' })
      .mockResolvedValueOnce({ taskId: 'analysis-1' })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true });

    expect(await ExtensionAPI.saveSettings({ theme: 'dark' })).toEqual({ success: true });
    expect(await ExtensionAPI.importSettings('{"maxComments":200}')).toEqual({ success: true });
    expect(await ExtensionAPI.startExtraction('https://example.com/post')).toEqual({
      taskId: 'extract-1',
    });
    expect(await ExtensionAPI.startConfigGeneration('https://example.com/post')).toEqual({
      taskId: 'config-1',
    });
    expect(
      await ExtensionAPI.startAnalysis({
        comments: [],
        historyId: 'history-1',
        metadata: { url: 'https://example.com/post' },
      }),
    ).toEqual({ taskId: 'analysis-1' });
    expect(await ExtensionAPI.cancelTask('task-1')).toEqual({ success: true });
    expect(await ExtensionAPI.deleteHistory('history-1')).toEqual({ success: true });
    expect(await ExtensionAPI.clearAllHistory()).toEqual({ success: true });

    expect(sendMessageMock.mock.calls).toEqual([
      [{ type: MESSAGES.SAVE_SETTINGS, payload: { settings: { theme: 'dark' } } }],
      [{ type: MESSAGES.IMPORT_SETTINGS, payload: { data: '{"maxComments":200}' } }],
      [{ type: MESSAGES.START_EXTRACTION, payload: { url: 'https://example.com/post' } }],
      [{ type: MESSAGES.START_CONFIG_GENERATION, payload: { url: 'https://example.com/post' } }],
      [
        {
          type: MESSAGES.START_ANALYSIS,
          payload: {
            comments: [],
            historyId: 'history-1',
            metadata: { url: 'https://example.com/post' },
          },
        },
      ],
      [{ type: MESSAGES.CANCEL_TASK, payload: { taskId: 'task-1' } }],
      [{ type: MESSAGES.DELETE_HISTORY, payload: { id: 'history-1' } }],
      [{ type: MESSAGES.CLEAR_ALL_HISTORY }],
    ]);
  });

  it('validates ensureContentScript success and failure responses', async () => {
    sendMessageMock.mockResolvedValueOnce({ success: true });
    await expect(ExtensionAPI.ensureContentScript(12)).resolves.toBeUndefined();
    expect(sendMessageMock).toHaveBeenCalledWith({
      type: MESSAGES.ENSURE_CONTENT_SCRIPT,
      payload: { tabId: 12 },
    });

    sendMessageMock.mockResolvedValueOnce({ success: false, injected: false });
    await expect(ExtensionAPI.ensureContentScript(13)).rejects.toThrow(
      TEXT.CONTENT_SCRIPT_INJECT_FAILED,
    );
  });

  it('rejects background error envelopes for public APIs', async () => {
    const config = {
      apiUrl: 'https://api.example.com',
      apiKey: 'secret',
      model: 'gpt-4o-mini',
      contextWindowSize: 200000,
      maxOutputTokens: 4096,
      temperature: 1,
      topP: 0.95,
    };
    const calls: Array<() => Promise<unknown>> = [
      () => ExtensionAPI.getSettings(),
      () => ExtensionAPI.saveSettings({ theme: 'dark' }),
      () => ExtensionAPI.importSettings('{"theme":"dark"}'),
      () => ExtensionAPI.getHistoryItem('history-1'),
      () => ExtensionAPI.getHistoryByUrl('https://example.com'),
      () => ExtensionAPI.getHistoryMetadataPage(1, 20, 'query'),
      () => ExtensionAPI.getTasks(),
      () => ExtensionAPI.getTaskStatus('task-1'),
      () => ExtensionAPI.ensureContentScript(12),
      () => ExtensionAPI.startExtraction('https://example.com/post'),
      () => ExtensionAPI.startConfigGeneration('https://example.com/post'),
      () => ExtensionAPI.startAnalysis({ comments: [], historyId: 'history-1' }),
      () => ExtensionAPI.cancelTask('task-1'),
      () => ExtensionAPI.getCrawlingConfig('example.com'),
      () => ExtensionAPI.deleteHistory('history-1'),
      () => ExtensionAPI.clearAllHistory(),
      () => ExtensionAPI.exportSettings(),
      () => ExtensionAPI.getAvailableModels('https://api.example.com', 'secret'),
      () => ExtensionAPI.testModel(config),
    ];

    for (const call of calls) {
      sendMessageMock.mockResolvedValueOnce({ error: 'background failed' });
      await expect(call()).rejects.toThrow('background failed');
    }
  });
});
