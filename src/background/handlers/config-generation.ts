import { Message, Task, CrawlingConfig } from '@/types';
import { HandlerContext } from './types';
import { Logger } from '@/utils/logger';
import { ExtensionError, ErrorCode } from '@/utils/errors';
import { MESSAGES, TEXT, TIMEOUT } from '@/config/constants';
import { getDomain } from '@/utils/url';
import { ensureContentScriptInjected } from '../ContentScriptInjector';
import { resolveTabId } from '@/utils/chrome-message';
import { cleanAndParseJsonObject } from '@/utils/json-parser';
import {
  isExpectedAsyncAckError,
  resolveRunningCompletionTask,
  waitForTaskCompletion,
} from './utils/task-completion';

interface StartConfigGenerationResponse {
  taskId: string;
}

interface ConfigCompletionResponse {
  success: boolean;
}

export async function handleStartConfigGeneration(
  message: Extract<Message, { type: 'START_CONFIG_GENERATION' }>,
  context: HandlerContext,
): Promise<StartConfigGenerationResponse> {
  const { url, tabId: payloadTabId } = message.payload || {};

  if (!url) {
    throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'URL is required');
  }

  const domain = getDomain(url) || TEXT.UNKNOWN;

  const tabId = await resolveTabId(payloadTabId, context.sender?.tab?.id);
  if (!tabId) {
    throw new ExtensionError(ErrorCode.EXTRACTION_FAILED, 'No tab ID available');
  }

  Logger.info('[ConfigGenerationHandler] Starting config generation', { domain });

  const taskId = context.taskManager.createTask('config', url, domain, 0, tabId);

  context.taskManager.setExecutor(taskId, async (task: Task, signal: AbortSignal) => {
    if (!task.tabId) {
      throw new ExtensionError(ErrorCode.EXTRACTION_FAILED, 'No tab ID available');
    }

    await ensureContentScriptInjected(task.tabId);

    try {
      await chrome.tabs.sendMessage(task.tabId, {
        type: MESSAGES.START_CONFIG_GENERATION,
        payload: { taskId: task.id },
      });
    } catch (error) {
      if (!isExpectedAsyncAckError(error)) {
        throw error;
      }
      Logger.debug('[ConfigGenerationHandler] Message ack timeout ignored, waiting for completion');
    }

    return waitForTaskCompletion({
      taskId,
      signal,
      context,
      tabId: task.tabId!,
      timeoutMs: TIMEOUT.CONFIG_TASK_COMPLETION_MS,
      timeoutMessage: TEXT.CONFIG_TASK_TIMEOUT,
      tabClosedMessage: TEXT.TASK_SOURCE_TAB_CLOSED,
      cancelWarnLabel: '[ConfigGenerationHandler] Failed to send config cancel to content script',
      timeoutWarnLabel:
        '[ConfigGenerationHandler] Failed to send config timeout cancel to content script',
    });
  });

  return { taskId };
}

export async function handleConfigGenerationCompleted(
  message: Extract<Message, { type: 'CONFIG_GENERATION_COMPLETED' }>,
  context: HandlerContext,
): Promise<ConfigCompletionResponse> {
  const payload = message.payload;
  if (!payload?.taskId) {
    Logger.warn('[ConfigGenerationHandler] Invalid config completion payload', { payload });
    return { success: false };
  }
  const { taskId, success, error } = payload;
  const task = resolveRunningCompletionTask(taskId, context, 'config');

  if (!task) {
    return { success: false };
  }

  if (success) {
    context.taskManager.completeTask(taskId, { tokensUsed: 0, commentsCount: 0 });
  } else {
    context.taskManager.failTask(taskId, error || 'Config generation failed');
  }

  return { success: true };
}

export async function handleGenerateCrawlingConfig(
  message: Extract<Message, { type: 'GENERATE_CRAWLING_CONFIG' }>,
  context: HandlerContext,
): Promise<{ config: CrawlingConfig | null; error?: string }> {
  const { prompt } = message.payload || {};

  if (!prompt) {
    throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'Prompt is required');
  }

  try {
    const settings = await context.settingsStore.getSettings();

    const response = await context.aiService.callAI({
      prompt,
      systemPrompt:
        'You are a config generator. Return ONLY valid JSON matching the CrawlingConfig interface. No markdown.',
      config: settings.aiModel,
      timeout: settings.aiTimeout,
    });

    const config = cleanAndParseJsonObject<CrawlingConfig>(response.content);
    return { config };
  } catch (error) {
    Logger.error('[ConfigGenerationHandler] Config generation failed', { error });
    return {
      config: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
