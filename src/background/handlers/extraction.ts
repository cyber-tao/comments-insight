import { Message, Comment, Task } from '../../types';
import { HandlerContext } from './types';
import { Logger } from '../../utils/logger';
import { REGEX, AI, ERRORS, MESSAGES, DEFAULTS } from '@/config/constants';
import { getDomain } from '../../utils/url';
import { Tokenizer } from '../../utils/tokenizer';
import { ensureContentScriptInjected } from '../ContentScriptInjector';

interface ExtractionContentResponse {
  success: boolean;
  error?: string;
  comments?: Comment[];
  postInfo?: {
    url?: string;
    title?: string;
    videoTime?: string;
  };
}

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
}

interface StartExtractionResponse {
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

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new Error(ERRORS.TASK_CANCELLED_BY_USER));
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new Error(ERRORS.TASK_CANCELLED_BY_USER));
    };

    signal.addEventListener('abort', onAbort, { once: true });

    promise
      .then((value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      })
      .catch((error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      });
  });
}

export async function handleStartExtraction(
  message: Extract<Message, { type: 'START_EXTRACTION' }>,
  context: HandlerContext,
): Promise<StartExtractionResponse> {
  const { url, maxComments } = message.payload || {};

  if (!url) {
    throw new Error(ERRORS.URL_REQUIRED);
  }

  const domain = getDomain(url) || 'unknown';

  // Get maxComments from settings if not provided
  let finalMaxComments = maxComments;
  if (!finalMaxComments) {
    const settings = await context.storageManager.getSettings();
    finalMaxComments = settings.maxComments || DEFAULTS.MAX_COMMENTS;
  }

  // Get tab ID - either from sender or current active tab
  let tabId = context.sender?.tab?.id;

  // If no tab ID (e.g., message from popup), get the active tab
  if (!tabId) {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = activeTab?.id;
    } catch (error) {
      Logger.error('[ExtractionHandler] Failed to get active tab', { error });
    }
  }

  Logger.info('[ExtractionHandler] Starting extraction with maxComments', {
    maxComments: finalMaxComments,
  });

  const taskId = context.taskManager.createTask('extract', url, domain, finalMaxComments, tabId);

  context.taskManager.setExecutor(taskId, async (task: Task, signal: AbortSignal) => {
    if (!task.tabId) {
      throw new Error(ERRORS.NO_TAB_ID_AVAILABLE);
    }

    await ensureContentScriptInjected(task.tabId);

    const respPromise = chrome.tabs.sendMessage(task.tabId, {
      type: MESSAGES.START_EXTRACTION,
      payload: { taskId: task.id, maxComments: finalMaxComments },
    }) as Promise<ExtractionContentResponse>;

    const response = await abortable(respPromise, signal);

    if (!response.success) {
      throw new Error(response.error || 'Extraction failed');
    }

    const { comments, postInfo } = response;

    if (comments && comments.length > 0) {
      const historyItem = {
        id: `history_${Date.now()}`,
        url: postInfo?.url || task.url,
        title: postInfo?.title || 'Untitled',
        platform: task.platform || 'unknown',
        videoTime: postInfo?.videoTime,
        extractedAt: Date.now(),
        commentsCount: comments.length,
        comments,
      };

      await context.storageManager.saveHistory(historyItem);
    }

    return {
      tokensUsed: 0,
      commentsCount: comments?.length || 0,
    };
  });

  return { taskId };
}

export async function handleAIAnalyzeStructure(
  message: Extract<Message, { type: 'AI_ANALYZE_STRUCTURE' }>,
  context: HandlerContext,
): Promise<AIAnalyzeStructureResponse> {
  const { prompt } = message.payload || {};

  if (!prompt) {
    throw new Error(ERRORS.PROMPT_REQUIRED);
  }

  try {
    const settings = await context.storageManager.getSettings();
    const chunks = chunkDomText(prompt, settings.aiModel.maxTokens ?? AI.DEFAULT_MAX_TOKENS);
    const aggregated: ScraperAnalysisResult = {
      selectors: {},
      structure: { hasReplies: false, repliesNested: true, needsExpand: false },
      confidence: 0,
    };
    for (let i = 0; i < chunks.length; i++) {
      const response = await context.aiService.callAI({
        prompt: chunks[i],
        systemPrompt:
          'You MUST respond with ONLY valid JSON, no markdown, no explanations, no code blocks. Start with { and end with }.',
        config: settings.aiModel,
      });
      try {
        let jsonText = response.content.trim();
        if (jsonText.startsWith('```')) {
          jsonText = jsonText
            .replace(REGEX.MD_CODE_JSON_START, '')
            .replace(REGEX.MD_CODE_ANY_END, '')
            .trim();
        }
        const jsonStart = jsonText.indexOf('{');
        const jsonEnd = jsonText.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          jsonText = jsonText.substring(jsonStart, jsonEnd + 1);
        }
        const data = JSON.parse(jsonText);
        if (data.selectors && typeof data.selectors === 'object') {
          aggregated.selectors = { ...aggregated.selectors, ...data.selectors };
        }
        if (data.structure) aggregated.structure = data.structure;
        if (typeof data.confidence === 'number')
          aggregated.confidence = Math.max(aggregated.confidence, data.confidence);
      } catch (e) {
        Logger.warn('[ExtractionHandler] Failed to parse AI structure part', {
          part: i + 1,
          error: e,
        });
      }
    }
    return { data: aggregated };
  } catch (error) {
    Logger.error('[ExtractionHandler] AI structure analysis failed', { error });
    return {
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
    throw new Error(ERRORS.COMMENTS_ARRAY_REQUIRED);
  }

  const finalUrl = metadata?.url;
  const domain = finalUrl ? getDomain(finalUrl) || 'unknown' : 'unknown';

  const taskId = context.taskManager.createTask('analyze', finalUrl || 'unknown', domain);

  context.taskManager.setExecutor(taskId, async (task: Task, signal: AbortSignal) => {
    const settings = await context.storageManager.getSettings();

    context.taskManager.updateTaskProgress(taskId, 25);

    let platform = 'Unknown Platform';
    let url = 'N/A';
    let title = 'Untitled';
    let videoTime = 'N/A';

    if (historyId) {
      const historyItem = await context.storageManager.getHistoryItem(historyId);
      if (historyItem) {
        platform = historyItem.platform || 'Unknown Platform';
        url = historyItem.url || 'N/A';
        title = historyItem.title || 'Untitled';
        videoTime = (historyItem as HistoryItemWithVideoTime).videoTime || 'N/A';
      }
    } else {
      platform = task.platform || 'Unknown Platform';
      url = task.url || 'N/A';
    }

    const result = await context.aiService.analyzeComments(
      comments,
      settings.aiModel,
      settings.analyzerPromptTemplate,
      settings.language,
      {
        platform,
        url,
        title,
        videoTime,
      },
      signal,
    );

    context.taskManager.updateTaskProgress(taskId, 75);

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
        extractedAt: Date.now(),
        commentsCount: comments.length,
        comments,
        analysis: result,
        analyzedAt: Date.now(),
      });
    }

    return {
      tokensUsed: result.tokensUsed,
      commentsCount: comments.length,
    };
  });

  return { taskId };
}
