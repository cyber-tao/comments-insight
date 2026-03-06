import { Message, Comment, Task, TaskResolver, CrawlingConfig } from '../../types';
import { HandlerContext } from './types';
import { Logger } from '../../utils/logger';
import { ExtensionError, ErrorCode } from '../../utils/errors';
import {
  CHROME_MESSAGE_ERRORS,
  MESSAGES,
  DEFAULTS,
  EXTRACTION_PROGRESS,
  DATE_TIME,
  ANALYSIS_FORMAT,
  STORAGE,
  TIMEOUT,
  TEXT,
} from '@/config/constants';
import { getDomain } from '../../utils/url';
import { Tokenizer } from '../../utils/tokenizer';
import { ensureContentScriptInjected } from '../ContentScriptInjector';
import { resolveTabId } from '../../utils/tab-helpers';
import { cleanAndParseJsonObject, cleanAndParseJsonArray } from '../../utils/json-parser';

interface ScraperAnalysisResult {
  selectors: Record<string, string>;
  structure: {
    hasReplies: boolean;
    repliesNested: boolean;
    needsExpand: boolean;
  };
  confidence: number;
}

interface HistoryItemWithVideoTime {
  platform?: string;
  url?: string;
  title?: string;
  videoTime?: string;
  postContent?: string;
}

interface StoredVerifiedAIModel {
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  contextWindowSize?: number;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  verifiedAt?: number;
}

interface StartExtractionResponse {
  taskId: string;
}

interface StartConfigGenerationResponse {
  taskId: string;
}

interface AIAnalyzeStructureResponse {
  selectors?: Record<string, string>;
  structure?: {
    hasReplies: boolean;
    repliesNested: boolean;
    needsExpand: boolean;
  };
  confidence?: number;
  data?: ScraperAnalysisResult;
  error?: string;
}

interface ProgressResponse {
  success: boolean;
}

interface StartAnalysisResponse {
  taskId: string;
}

interface ExtractionCompletionResponse {
  success: boolean;
}

interface PendingTaskEntry extends TaskResolver {
  timeoutId: ReturnType<typeof setTimeout>;
  cleanup: () => void;
}

type PendingTaskMap = Map<string, PendingTaskEntry>;

interface WaitForPendingTaskOptions {
  map: PendingTaskMap;
  taskId: string;
  signal: AbortSignal;
  tabId: number;
  timeoutMs: number;
  timeoutMessage: string;
  tabClosedMessage: string;
  cancelWarnLabel: string;
  timeoutWarnLabel: string;
}

type PendingTaskResult = { tokensUsed: number; commentsCount: number; title?: string };

export function chunkDomText(
  structure: string,
  maxTokens: number,
  overheadText?: string,
): string[] {
  if (overheadText && overheadText.length > 0) {
    return Tokenizer.chunkTextWithOverhead(structure, maxTokens, overheadText);
  }
  return Tokenizer.chunkText(structure, maxTokens);
}

// Map to hold pending task resolvers
const pendingExtractionTasks: PendingTaskMap = new Map();
const pendingConfigTasks: PendingTaskMap = new Map();

function takePendingTask(map: PendingTaskMap, taskId: string): PendingTaskEntry | undefined {
  const pending = map.get(taskId);
  if (!pending) {
    return undefined;
  }
  map.delete(taskId);
  clearTimeout(pending.timeoutId);
  pending.cleanup();
  return pending;
}

function notifyCancelExtraction(tabId: number, taskId: string, contextLabel: string): void {
  chrome.tabs
    .sendMessage(tabId, {
      type: MESSAGES.CANCEL_EXTRACTION,
      payload: { taskId },
    })
    .catch((err) => {
      Logger.warn(contextLabel, { err });
    });
}

function isExpectedAsyncAckError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes(CHROME_MESSAGE_ERRORS.TIMEOUT) ||
    message.includes(CHROME_MESSAGE_ERRORS.PORT_CLOSED)
  );
}

function waitForPendingTaskCompletion({
  map,
  taskId,
  signal,
  tabId,
  timeoutMs,
  timeoutMessage,
  tabClosedMessage,
  cancelWarnLabel,
  timeoutWarnLabel,
}: WaitForPendingTaskOptions): Promise<PendingTaskResult> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      const pending = takePendingTask(map, taskId);
      if (!pending) {
        return;
      }

      notifyCancelExtraction(tabId, taskId, cancelWarnLabel);
      pending.reject(new ExtensionError(ErrorCode.TASK_CANCELLED, 'Task cancelled by user'));
    };

    const onTabRemoved = (removedTabId: number): void => {
      if (removedTabId !== tabId) {
        return;
      }

      const pending = takePendingTask(map, taskId);
      if (!pending) {
        return;
      }

      pending.reject(
        new ExtensionError(
          ErrorCode.EXTRACTION_FAILED,
          tabClosedMessage,
          { taskId, tabId },
          false,
        ),
      );
    };

    const timeoutId = setTimeout(() => {
      const pending = takePendingTask(map, taskId);
      if (!pending) {
        return;
      }

      notifyCancelExtraction(tabId, taskId, timeoutWarnLabel);
      pending.reject(new ExtensionError(ErrorCode.TIMEOUT_ERROR, timeoutMessage));
    }, timeoutMs);

    map.set(taskId, {
      resolve,
      reject,
      timeoutId,
      cleanup: () => {
        signal.removeEventListener('abort', onAbort);
        chrome.tabs.onRemoved?.removeListener(onTabRemoved);
      },
    });

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener('abort', onAbort);
    chrome.tabs.onRemoved?.addListener(onTabRemoved);
  });
}

export async function handleStartExtraction(
  message: Extract<Message, { type: 'START_EXTRACTION' }>,
  context: HandlerContext,
): Promise<StartExtractionResponse> {
  const { url, maxComments, tabId: payloadTabId } = message.payload || {};

  if (!url) {
    throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'URL is required');
  }

  const domain = getDomain(url) || 'unknown';

  // Get maxComments from settings if not provided
  let finalMaxComments = maxComments;
  if (!finalMaxComments) {
    const settings = await context.storageManager.getSettings();
    finalMaxComments = settings.maxComments || DEFAULTS.MAX_COMMENTS;
  }

  const tabId = await resolveTabId(payloadTabId, context.sender?.tab?.id);
  if (!tabId) {
    throw new ExtensionError(ErrorCode.EXTRACTION_FAILED, 'No tab ID available');
  }

  Logger.info('[ExtractionHandler] Starting extraction with maxComments', {
    maxComments: finalMaxComments,
  });

  const taskId = context.taskManager.createTask('extract', url, domain, finalMaxComments, tabId);

  context.taskManager.setExecutor(taskId, async (task: Task, signal: AbortSignal) => {
    if (!task.tabId) {
      throw new ExtensionError(ErrorCode.EXTRACTION_FAILED, 'No tab ID available');
    }

    await ensureContentScriptInjected(task.tabId);

    // Send start message to content script (fire and forget pattern from executor perspective)
    // The content script will reply immediately to acknowledge receipt,
    // and then send EXTRACTION_COMPLETED later.
    try {
      await chrome.tabs.sendMessage(task.tabId, {
        type: MESSAGES.START_EXTRACTION,
        payload: { taskId: task.id, maxComments: finalMaxComments },
      });
    } catch (error) {
      if (!isExpectedAsyncAckError(error)) {
        throw error;
      }
      Logger.debug('[ExtractionHandler] Message ack timeout ignored, waiting for completion');
    }
    // Hang here until we receive the completion message
    return waitForPendingTaskCompletion({
      map: pendingExtractionTasks,
      taskId,
      signal,
      tabId: task.tabId!,
      timeoutMs: TIMEOUT.EXTRACTION_TASK_COMPLETION_MS,
      timeoutMessage: TEXT.EXTRACTION_TASK_TIMEOUT,
      tabClosedMessage: TEXT.TASK_SOURCE_TAB_CLOSED,
      cancelWarnLabel: '[ExtractionHandler] Failed to send cancel to content script',
      timeoutWarnLabel: '[ExtractionHandler] Failed to send timeout cancel to content script',
    });
  });

  return { taskId };
}

export async function handleExtractionCompleted(
  message: Extract<Message, { type: 'EXTRACTION_COMPLETED' }>,
  context: HandlerContext,
): Promise<ExtractionCompletionResponse> {
  const payload = message.payload;
  if (!payload?.taskId) {
    Logger.warn('[ExtractionHandler] Invalid extraction completion payload', {
      payload,
    });
    return { success: false };
  }
  const { taskId, success, comments, postInfo, error } = payload;
  const pending = takePendingTask(pendingExtractionTasks, taskId);

  if (!pending) {
    Logger.warn('[ExtractionHandler] Received completion for unknown or finished task', { taskId });
    return { success: false };
  }

  if (success) {
    if (comments && comments.length > 0) {
      const task = context.taskManager.getTask(taskId);
      if (task) {
        let normalizedComments = comments;
        let normalizedPostTime = postInfo?.videoTime;
        try {
          const settings = await context.storageManager.getSettings();
          if (settings.normalizeTimestamps) {
            const totalCount = comments.length + (postInfo?.videoTime ? 1 : 0);
            context.taskManager.updateTaskProgress(
              taskId,
              EXTRACTION_PROGRESS.NORMALIZING,
              `normalizing:0:${totalCount}`,
            );
            const pad = (value: number) => value.toString().padStart(DATE_TIME.PAD_LENGTH, '0');
            const now = new Date();
            const referenceTime = `${now.getFullYear()}${DATE_TIME.DISPLAY_DATE_SEPARATOR}${pad(
              now.getMonth() + DATE_TIME.MONTH_OFFSET,
            )}${DATE_TIME.DISPLAY_DATE_SEPARATOR}${pad(now.getDate())}T${pad(
              now.getHours(),
            )}${DATE_TIME.DISPLAY_TIME_SEPARATOR}${pad(now.getMinutes())}`;
            normalizedComments = await context.aiService.normalizeCommentTimestamps(
              comments,
              settings.aiModel,
              referenceTime,
              settings.aiTimeout,
            );
            normalizedPostTime = await context.aiService.normalizeSingleTimestamp(
              postInfo?.videoTime,
              settings.aiModel,
              referenceTime,
              settings.aiTimeout,
            );
            context.taskManager.updateTaskProgress(
              taskId,
              EXTRACTION_PROGRESS.NORMALIZING,
              `normalizing:${totalCount}:${totalCount}`,
            );
          }
        } catch (error) {
          Logger.warn('[ExtractionHandler] Timestamp normalization failed', { error });
        }

        const historyItem = {
          id: `history_${Date.now()}`,
          url: postInfo?.url || task.url,
          title: postInfo?.title || 'Untitled',
          platform: task.platform || 'unknown',
          videoTime: normalizedPostTime,
          postContent: postInfo?.postContent,
          extractedAt: Date.now(),
          commentsCount: normalizedComments.length,
          comments: normalizedComments,
        };
        try {
          await context.storageManager.saveHistory(historyItem);
        } catch (saveError) {
          Logger.error('[ExtractionHandler] Failed to save extraction history', { saveError });
        }
      }
    }

    pending.resolve({
      tokensUsed: 0,
      commentsCount: comments?.length || 0,
      title: postInfo?.title || postInfo?.url,
    });
  } else {
    pending.reject(new ExtensionError(ErrorCode.EXTRACTION_FAILED, error || 'Extraction failed'));
  }

  return { success: true };
}

export async function handleStartConfigGeneration(
  message: Extract<Message, { type: 'START_CONFIG_GENERATION' }>,
  context: HandlerContext,
): Promise<StartConfigGenerationResponse> {
  const { url, tabId: payloadTabId } = message.payload || {};

  if (!url) {
    throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'URL is required');
  }

  const domain = getDomain(url) || 'unknown';

  const tabId = await resolveTabId(payloadTabId, context.sender?.tab?.id);
  if (!tabId) {
    throw new ExtensionError(ErrorCode.EXTRACTION_FAILED, 'No tab ID available');
  }

  Logger.info('[ExtractionHandler] Starting config generation', { domain });

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
      Logger.debug('[ExtractionHandler] Message ack timeout ignored, waiting for completion');
    }

    return waitForPendingTaskCompletion({
      map: pendingConfigTasks,
      taskId,
      signal,
      tabId: task.tabId!,
      timeoutMs: TIMEOUT.CONFIG_TASK_COMPLETION_MS,
      timeoutMessage: TEXT.CONFIG_TASK_TIMEOUT,
      tabClosedMessage: TEXT.TASK_SOURCE_TAB_CLOSED,
      cancelWarnLabel: '[ExtractionHandler] Failed to send config cancel to content script',
      timeoutWarnLabel:
        '[ExtractionHandler] Failed to send config timeout cancel to content script',
    });
  });

  return { taskId };
}

export async function handleConfigGenerationCompleted(
  message: Extract<Message, { type: 'CONFIG_GENERATION_COMPLETED' }>,
  _context: HandlerContext,
): Promise<ExtractionCompletionResponse> {
  const payload = message.payload;
  if (!payload?.taskId) {
    Logger.warn('[ExtractionHandler] Invalid config completion payload', { payload });
    return { success: false };
  }
  const { taskId, success, error } = payload;
  const pending = takePendingTask(pendingConfigTasks, taskId);

  if (!pending) {
    Logger.warn('[ExtractionHandler] Received config completion for unknown task', { taskId });
    return { success: false };
  }

  if (success) {
    pending.resolve({ tokensUsed: 0, commentsCount: 0 });
  } else {
    pending.reject(
      new ExtensionError(ErrorCode.EXTRACTION_FAILED, error || 'Config generation failed'),
    );
  }

  return { success: true };
}

export async function handleAIAnalyzeStructure(
  message: Extract<Message, { type: 'AI_ANALYZE_STRUCTURE' }>,
  context: HandlerContext,
): Promise<AIAnalyzeStructureResponse> {
  const { prompt } = message.payload || {};

  if (!prompt) {
    throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'Prompt is required');
  }

  try {
    const settings = await context.storageManager.getSettings();
    // The caller (AIStrategy) manages chunking and token limits.
    // We directly call AI service here.

    const response = await context.aiService.callAI({
      prompt,
      systemPrompt:
        'You MUST respond with ONLY valid JSON, no markdown, no explanations, no code blocks. Start with { and end with }.',
      config: settings.aiModel,
      timeout: settings.aiTimeout,
    });

    const aggregated: ScraperAnalysisResult = {
      selectors: {},
      structure: { hasReplies: false, repliesNested: true, needsExpand: false },
      confidence: 0,
    };

    try {
      const data = cleanAndParseJsonObject<ScraperAnalysisResult>(response.content);
      if (data.selectors && typeof data.selectors === 'object') {
        aggregated.selectors = { ...aggregated.selectors, ...data.selectors };
      }
      if (data.structure) aggregated.structure = data.structure;
      if (typeof data.confidence === 'number')
        aggregated.confidence = Math.max(aggregated.confidence, data.confidence);
    } catch (e) {
      Logger.warn('[ExtractionHandler] Failed to parse AI structure response', {
        error: e,
      });
    }

    return { data: aggregated };
  } catch (error) {
    Logger.error('[ExtractionHandler] AI structure analysis failed', { error });
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
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
    const settings = await context.storageManager.getSettings();

    // Call AI to generate config JSON
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
    Logger.error('[ExtractionHandler] Config generation failed', { error });
    return {
      config: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleExtractionProgress(
  message: Extract<Message, { type: 'EXTRACTION_PROGRESS' }>,
  context: HandlerContext,
): Promise<ProgressResponse> {
  const { taskId, progress, message: progressMessage } = message.payload || {};

  if (taskId) {
    context.taskManager.updateTaskProgress(taskId, progress, progressMessage || '');
  }

  return { success: true };
}

export async function handleStartAnalysis(
  message: Extract<Message, { type: 'START_ANALYSIS' }>,

  context: HandlerContext,
): Promise<StartAnalysisResponse> {
  const { comments, metadata, historyId } = message.payload || {};

  if (!comments || !Array.isArray(comments)) {
    throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'Comments array is required');
  }

  const finalUrl = metadata?.url;
  const domain = finalUrl ? getDomain(finalUrl) || 'unknown' : 'unknown';

  const taskId = context.taskManager.createTask('analyze', finalUrl || 'unknown', domain);

  context.taskManager.setExecutor(taskId, async (task: Task, signal: AbortSignal) => {
    const settings = await context.storageManager.getSettings();
    let analysisModel = settings.aiModel;
    const hasPrimaryApiKey =
      typeof analysisModel?.apiKey === 'string' && analysisModel.apiKey.trim().length > 0;

    if (!hasPrimaryApiKey) {
      try {
        const raw = await chrome.storage.local.get(STORAGE.LAST_VERIFIED_AI_MODEL_KEY);
        const fallback = raw[STORAGE.LAST_VERIFIED_AI_MODEL_KEY] as
          | StoredVerifiedAIModel
          | undefined;
        const fallbackKey =
          typeof fallback?.apiKey === 'string' && fallback.apiKey.trim().length > 0
            ? fallback.apiKey
            : '';

        if (fallbackKey) {
          const sameApiUrl =
            typeof fallback?.apiUrl === 'string' &&
            fallback.apiUrl.trim().length > 0 &&
            fallback.apiUrl.trim() === (analysisModel.apiUrl || '').trim();

          if (sameApiUrl || !analysisModel.apiUrl) {
            analysisModel = {
              ...analysisModel,
              apiUrl: analysisModel.apiUrl || fallback?.apiUrl || '',
              model: analysisModel.model || fallback?.model || '',
              apiKey: fallbackKey,
              contextWindowSize:
                analysisModel.contextWindowSize || fallback?.contextWindowSize || 0,
              maxOutputTokens:
                analysisModel.maxOutputTokens || fallback?.maxOutputTokens || undefined,
              temperature:
                typeof analysisModel.temperature === 'number'
                  ? analysisModel.temperature
                  : typeof fallback?.temperature === 'number'
                    ? fallback.temperature
                    : analysisModel.temperature,
              topP:
                typeof analysisModel.topP === 'number'
                  ? analysisModel.topP
                  : typeof fallback?.topP === 'number'
                    ? fallback.topP
                    : analysisModel.topP,
            };
          }
        }
      } catch (fallbackError) {
        Logger.warn('[ExtractionHandler] Failed to load fallback AI model config', {
          fallbackError,
        });
      }
    }

    context.taskManager.updateTaskProgress(taskId, 25);

    let platform = ANALYSIS_FORMAT.UNKNOWN_PLATFORM;
    let url = ANALYSIS_FORMAT.UNKNOWN_URL;
    let title = ANALYSIS_FORMAT.UNKNOWN_TITLE;
    let videoTime = ANALYSIS_FORMAT.UNKNOWN_TIMESTAMP;
    let postContent = ANALYSIS_FORMAT.UNKNOWN_CONTENT;

    if (historyId) {
      const historyItem = await context.storageManager.getHistoryItem(historyId);
      if (historyItem) {
        platform = historyItem.platform || 'Unknown Platform';
        url = historyItem.url || 'N/A';
        title = historyItem.title || 'Untitled';
        videoTime = (historyItem as HistoryItemWithVideoTime).videoTime || 'N/A';
        postContent = (historyItem as HistoryItemWithVideoTime).postContent || 'N/A';
      }
    } else {
      platform = task.platform || 'Unknown Platform';
      url = task.url || 'N/A';
      title = metadata?.title || title;
      videoTime = metadata?.videoTime || videoTime;
      postContent = metadata?.postContent || postContent;
    }

    const result = await context.aiService.analyzeComments(
      comments,
      analysisModel,
      settings.analyzerPromptTemplate,
      settings.language,
      {
        platform,
        url,
        title,
        videoTime,
        postContent,
      },
      signal,
      settings.aiTimeout,
    );

    context.taskManager.updateTaskProgress(taskId, 75);

    try {
      if (historyId) {
        const historyItem = await context.storageManager.getHistoryItem(historyId);
        if (historyItem) {
          historyItem.analysis = result;
          historyItem.analyzedAt = Date.now();
          await context.storageManager.saveHistory(historyItem);
        }
      } else {
        await context.storageManager.saveHistory({
          id: `history_${Date.now()}`,
          url: task.url,
          title: `Analysis ${new Date().toLocaleString()}`,
          platform: task.platform || 'unknown',
          postContent: metadata?.postContent,
          extractedAt: Date.now(),
          commentsCount: comments.length,
          comments,
          analysis: result,
          analyzedAt: Date.now(),
        });
      }
    } catch (saveError) {
      Logger.error('[ExtractionHandler] Failed to save analysis history', { saveError });
    }

    return {
      tokensUsed: result.tokensUsed,
      commentsCount: comments.length,
      title,
    };
  });

  return { taskId };
}

export async function handleAIExtractContent(
  message: Extract<Message, { type: 'AI_EXTRACT_CONTENT' }>,
  context: HandlerContext,
): Promise<{ comments: Comment[]; error?: string }> {
  const { chunks, systemPrompt } = message.payload || {};

  if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
    return { comments: [], error: 'No chunks provided' };
  }

  try {
    const settings = await context.storageManager.getSettings();
    const allComments: Comment[] = [];

    // Process chunks sequentially (or with limited concurrency if we implement it)
    // For now, sequential to avoid rate limits
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk.trim()) continue;

      try {
        const response = await context.aiService.callAI({
          prompt: chunk,
          systemPrompt: systemPrompt || 'You are a data extractor. Return JSON only.',
          config: settings.aiModel,
          timeout: settings.aiTimeout,
        });

        const chunkComments = cleanAndParseJsonArray<Partial<Comment>>(response.content);
        chunkComments.forEach((c, idx) => {
          if (!c.id) c.id = `ai_${Date.now()}_${i}_${idx}`;
          if (!c.likes) c.likes = 0;
          if (!c.replies) c.replies = [];
        });
        allComments.push(...(chunkComments as Comment[]));
      } catch (e) {
        Logger.warn('[ExtractionHandler] Failed to extract from chunk', { index: i, error: e });
        // Continue to next chunk
      }
    }

    return { comments: allComments };
  } catch (error) {
    Logger.error('[ExtractionHandler] AI extraction failed', { error });
    return {
      comments: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
