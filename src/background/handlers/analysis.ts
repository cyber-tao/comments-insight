import { Message, Comment, Task, CrawlingConfig } from '@/types';
import { HandlerContext } from './types';
import { Logger } from '@/utils/logger';
import { ExtensionError, ErrorCode } from '@/utils/errors';
import { AI as AI_CONST, ANALYSIS_FORMAT, TEXT } from '@/config/constants';
import { getDomain } from '@/utils/url';
import { generateUniqueId } from '@/utils/id-generator';
import { runWithConcurrencyLimit } from '@/utils/promise';
import { cleanAndParseJsonObject, cleanAndParseJsonArray } from '@/utils/json-parser';

interface ScraperAnalysisResult {
  selectors: Record<string, string>;
  structure: {
    hasReplies: boolean;
    repliesNested: boolean;
    needsExpand: boolean;
  };
  confidence: number;
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

interface StartAnalysisResponse {
  taskId: string;
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
  const domain = finalUrl ? getDomain(finalUrl) || TEXT.UNKNOWN : TEXT.UNKNOWN;

  const taskId = context.taskManager.createTask('analyze', finalUrl || TEXT.UNKNOWN, domain);

  context.taskManager.setExecutor(taskId, async (task: Task, signal: AbortSignal) => {
    const settings = await context.settingsStore.getSettings();
    const analysisModel = settings.aiModel;

    context.taskManager.updateDetailedProgress(taskId, {
      stage: 'analyzing',
      current: 0,
      total: AI_CONST.ANALYSIS_STREAM_BATCH_UNITS,
      stageMessage: AI_CONST.ANALYSIS_PROGRESS_MESSAGES.WAITING,
      stageMessageKey: AI_CONST.ANALYSIS_PROGRESS_MESSAGE_KEYS.WAITING,
    });

    let platform = ANALYSIS_FORMAT.UNKNOWN_PLATFORM;
    let url = ANALYSIS_FORMAT.UNKNOWN_URL;
    let title = ANALYSIS_FORMAT.UNKNOWN_TITLE;
    let videoTime = ANALYSIS_FORMAT.UNKNOWN_TIMESTAMP;
    let postContent = ANALYSIS_FORMAT.UNKNOWN_CONTENT;

    if (historyId) {
      const historyItem = await context.historyStore.getHistoryItem(historyId);
      if (!historyItem) {
        throw new ExtensionError(ErrorCode.TASK_NOT_FOUND, `History item not found: ${historyId}`, {
          historyId,
        });
      }
      platform = historyItem.platform || ANALYSIS_FORMAT.UNKNOWN_PLATFORM;
      url = historyItem.url || ANALYSIS_FORMAT.UNKNOWN_URL;
      title = historyItem.title || TEXT.UNTITLED;
      videoTime = historyItem.videoTime || ANALYSIS_FORMAT.UNKNOWN_TIMESTAMP;
      postContent = historyItem.postContent || ANALYSIS_FORMAT.UNKNOWN_CONTENT;
    } else {
      platform = task.platform || ANALYSIS_FORMAT.UNKNOWN_PLATFORM;
      url = task.url || ANALYSIS_FORMAT.UNKNOWN_URL;
      title = metadata?.title || title;
      videoTime = metadata?.videoTime || videoTime;
      postContent = metadata?.postContent || postContent;
    }

    const result = await context.commentAnalyzer.analyzeComments(
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
      (progress) => {
        context.taskManager.updateDetailedProgress(taskId, {
          stage: 'analyzing',
          current: progress.current,
          total: progress.total,
          stageMessage: progress.stageMessage,
          stageMessageKey: progress.stageMessageKey,
          stageMessageParams: progress.stageMessageParams,
        });
      },
    );

    context.taskManager.updateTaskProgress(taskId, 75);

    try {
      if (historyId) {
        const historyItem = await context.historyStore.getHistoryItem(historyId);
        if (!historyItem) {
          throw new ExtensionError(
            ErrorCode.TASK_NOT_FOUND,
            `History item not found: ${historyId}`,
            { historyId },
          );
        }
        historyItem.analysis = result;
        historyItem.analyzedAt = Date.now();
        await context.historyStore.saveHistory(historyItem);
      } else {
        await context.historyStore.saveHistory({
          id: generateUniqueId('history'),
          url: task.url,
          title: `Analysis ${new Date().toLocaleString()}`,
          platform: task.platform || ANALYSIS_FORMAT.UNKNOWN_PLATFORM,
          postContent: metadata?.postContent,
          extractedAt: Date.now(),
          commentsCount: comments.length,
          comments,
          analysis: result,
          analyzedAt: Date.now(),
        });
      }
    } catch (saveError) {
      Logger.error('[AnalysisHandler] Failed to save analysis history', { saveError });
      throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to save analysis history');
    }

    return {
      tokensUsed: result.tokensUsed,
      commentsCount: comments.length,
      title,
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
    throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'Prompt is required');
  }

  try {
    const settings = await context.settingsStore.getSettings();

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
      Logger.warn('[AnalysisHandler] Failed to parse AI structure response', {
        error: e,
      });
    }

    return { data: aggregated };
  } catch (error) {
    Logger.error('[AnalysisHandler] AI structure analysis failed', { error });
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
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
    const settings = await context.settingsStore.getSettings();
    const allComments: Comment[] = [];

    const tasks = chunks.map((chunk, i) => async () => {
      if (!chunk.trim()) return [];
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
        return chunkComments as Comment[];
      } catch (e) {
        Logger.warn('[AnalysisHandler] Failed to extract from chunk', { index: i, error: e });
        return [];
      }
    });

    const results = await runWithConcurrencyLimit(tasks, AI_CONST.MAX_CONCURRENT_REQUESTS || 3);

    for (const chunkComments of results) {
      allComments.push(...chunkComments);
    }

    return { comments: allComments };
  } catch (error) {
    Logger.error('[AnalysisHandler] AI extraction failed', { error });
    return {
      comments: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Re-export types used by MessageRouter tests and future callers.
export type { CrawlingConfig };
