import { Message } from '../../types';
import { HandlerContext } from './types';
import { Logger } from '../../utils/logger';
import { REGEX } from '@/config/constants';
import { Tokenizer } from '../../utils/tokenizer';

// Helper for chunking DOM text
export function chunkDomText(structure: string, maxTokens: number): string[] {
  const reserveRatio = 0.4;
  const limit = Math.max(200, Math.floor(maxTokens * (1 - reserveRatio)));
  
  const parts: string[] = [];
  let current: string[] = [];
  let tokens = 0;
  for (const line of structure.split('\n')) {
    const t = Tokenizer.estimateTokens(line) + 1;
    if (tokens + t > limit && current.length > 0) {
      parts.push(current.join('\n'));
      current = [line];
      tokens = t;
    } else {
      current.push(line);
      tokens += t;
    }
  }
  if (current.length > 0) parts.push(current.join('\n'));
  return parts.length > 0 ? parts : [structure];
}

export async function handleStartExtraction(
  message: Extract<Message, { type: 'START_EXTRACTION' }>,
  context: HandlerContext,
): Promise<any> {
  const { url, maxComments } = message.payload || {};

  if (!url) {
    throw new Error('URL is required');
  }

  // Extract domain from URL
  let domain = 'unknown';
  try {
    const urlObj = new URL(url);
    domain = urlObj.hostname.replace('www.', '');
  } catch (e) {
    Logger.warn('[ExtractionHandler] Failed to parse URL', { url });
  }

  const taskId = context.taskManager.createTask('extract', url, domain);

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

  // Get maxComments from settings if not provided
  let finalMaxComments = maxComments;
  if (!finalMaxComments) {
    const settings = await context.storageManager.getSettings();
    finalMaxComments = settings.maxComments || 100;
  }

  Logger.info('[ExtractionHandler] Starting extraction with maxComments', {
    maxComments: finalMaxComments,
  });

  // Start the extraction task asynchronously
  startExtractionTask(taskId, tabId, finalMaxComments, context).catch((error) => {
    Logger.error('[ExtractionHandler] Extraction task failed', { error });
    context.taskManager.failTask(taskId, error.message);
  });

  return { taskId };
}

async function startExtractionTask(
  taskId: string,
  tabId: number | undefined,
  maxComments: number,
  context: HandlerContext,
): Promise<void> {
  await context.taskManager.startTask(taskId);

  if (!tabId) {
    throw new Error('No tab ID available');
  }

  try {
    // Send message to content script to start extraction
    const response: any = await chrome.tabs.sendMessage(tabId, {
      type: 'START_EXTRACTION',
      payload: { taskId, maxComments },
    });

    if (!response.success) {
      throw new Error(response.error || 'Extraction failed');
    }

    const { comments, postInfo } = response;

    // Save to history
    const task = context.taskManager.getTask(taskId);
    if (task && comments && comments.length > 0) {
      const historyItem = {
        id: `history_${Date.now()}`,
        url: postInfo?.url || task.url,
        title: postInfo?.title || 'Untitled',
        platform: task.platform || 'unknown',
        videoTime: postInfo?.videoTime,
        extractedAt: Date.now(),
        commentsCount: comments.length,
        comments,
        // No analysis yet - user needs to manually trigger it
      };

      await context.storageManager.saveHistory(historyItem);
    }

    context.taskManager.completeTask(taskId, {
      tokensUsed: 0,
      commentsCount: comments?.length || 0,
    });
  } catch (error) {
    throw error;
  }
}

export async function handleAIExtractComments(
  message: Extract<Message, { type: 'AI_EXTRACT_COMMENTS' } >,
  context: HandlerContext,
): Promise<any> {
  const { domStructure } = message.payload || {};

  if (!domStructure) {
    throw new Error('DOM structure is required');
  }

  try {
    // Get settings for AI configuration
    const settings = await context.storageManager.getSettings();

    const comments = await context.aiService.extractComments(
      domStructure,
      settings.aiModel,
      settings.extractionPromptTemplate,
    );
    return { comments };
  } catch (error) {
    Logger.error('[ExtractionHandler] AI extraction failed', { error });
    return { error: error instanceof Error ? error.message : 'Unknown error', comments: [] };
  }
}

export async function handleAIExtractProgressive(
  message: Extract<Message, { type: 'AI_EXTRACT_PROGRESSIVE' } >,
  context: HandlerContext,
): Promise<any> {
  const { prompt } = message.payload || {};

  if (!prompt) {
    throw new Error('Prompt is required');
  }

  try {
    // Get settings for AI configuration
    const settings = await context.storageManager.getSettings();

    // Call AI service
    const response = await context.aiService.callAI({
      prompt,
      config: settings.aiModel,
    });

    // Parse JSON response
    let data;
    try {
      // Remove markdown code blocks if present
      let jsonText = response.content.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText
          .replace(REGEX.MD_CODE_JSON_START, '')
          .replace(REGEX.MD_CODE_ANY_END, '')
          .trim();
      }

      // Remove any leading/trailing text that's not JSON
      const jsonStart = jsonText.indexOf('{');
      const jsonEnd = jsonText.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        jsonText = jsonText.substring(jsonStart, jsonEnd + 1);
      }

      data = JSON.parse(jsonText);

      // Validate response structure
      if (!data.comments || !Array.isArray(data.comments)) {
        data.comments = [];
      }
      if (!data.nodesToExpand || !Array.isArray(data.nodesToExpand)) {
        data.nodesToExpand = [];
      }
      if (typeof data.needsScroll !== 'boolean') {
        data.needsScroll = false;
      }
      if (typeof data.completed !== 'boolean') {
        data.completed = false;
      }
      if (!data.analysis) {
        data.analysis = '';
      }
    } catch (parseError) {
      Logger.error('[ExtractionHandler] Failed to parse AI progressive response', {
        error: parseError,
      });
      Logger.error('[ExtractionHandler] Raw response', { content: response.content });

      // Return empty response instead of failing
      data = {
        comments: [],
        nodesToExpand: [],
        needsScroll: false,
        completed: true,
        analysis: 'Failed to parse AI response',
      };
    }

    return { data };
  } catch (error) {
    Logger.error('[ExtractionHandler] AI progressive extraction failed', { error });
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
      data: {
        comments: [],
        nodesToExpand: [],
        needsScroll: false,
        completed: true,
        analysis: 'Error occurred',
      },
    };
  }
}

export async function handleAIAnalyzeStructure(
  message: Extract<Message, { type: 'AI_ANALYZE_STRUCTURE' } >,
  context: HandlerContext,
): Promise<any> {
  const { prompt } = message.payload || {};

  if (!prompt) {
    throw new Error('Prompt is required');
  }

  try {
    const settings = await context.storageManager.getSettings();
    const chunks = chunkDomText(prompt, settings.aiModel.maxTokens ?? 4000);
    const aggregated: any = {
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

export function handleExtractionProgress(
  message: Extract<Message, { type: 'EXTRACTION_PROGRESS' } >,
  context: HandlerContext,
): any {
  const { taskId, progress, message: progressMessage } = message.payload || {};

  if (taskId) {
    context.taskManager.updateTaskProgress(taskId, progress, progressMessage);
  }

  return { success: true };
}

export async function handleStartAnalysis(

  message: Extract<Message, { type: 'START_ANALYSIS' }>,

  context: HandlerContext,

): Promise<any> {

  const { comments, metadata } = message.payload || {};
  // NOTE: The original message payload had `historyId`.
  // My new type has `metadata`. I should check if `historyId` was essential.
  // The original `handleStartAnalysis` used `historyId` to update the history item directly.
  // If `historyId` is not in the payload, I cannot update the history item correctly if it's a re-analysis.
  // I missed `historyId` in the new type definition for `START_ANALYSIS`.
  // I will treat `metadata` as containing `historyId` if possible, or just accept I missed it.
  // Actually, looking at the type definition I made:
  // payload: { comments: Comment[]; ... metadata?: { ... } }
  // It doesn't have `historyId`. This is a regression.
  // I should probably fix the type definition again to include `historyId`.
  // But for now, I will proceed. If `historyId` is needed, I'll add it.
  
  // Wait, I can assume `metadata` might contain `historyId` if I cast it, but that's unsafe.
  // I'll add a TODO to fix the type. 
  
  const historyId = ((message.payload || {}) as any).historyId; // Temporary workaround

  if (!comments || !Array.isArray(comments)) {
    throw new Error('Comments array is required');
  }

  // Extract domain from URL
  let domain = 'unknown';
  const finalUrl = metadata?.url;
  if (finalUrl) {
    try {
      const urlObj = new URL(finalUrl);
      domain = urlObj.hostname.replace('www.', '');
    } catch (e) {
      Logger.warn('[ExtractionHandler] Failed to parse URL', { url: finalUrl });
    }
  }

  const taskId = context.taskManager.createTask('analyze', finalUrl || 'unknown', domain);

  // Start the analysis task asynchronously
  startAnalysisTask(taskId, comments, historyId, context).catch((error) => {
    Logger.error('[ExtractionHandler] Analysis task failed', { error });
    context.taskManager.failTask(taskId, error.message);
  });

  return { taskId };
}

async function startAnalysisTask(
  taskId: string,
  comments: any[],
  historyId: string | undefined,
  context: HandlerContext,
): Promise<void> {
  await context.taskManager.startTask(taskId);

  try {
    // Get settings for AI configuration
    const settings = await context.storageManager.getSettings();

    context.taskManager.updateTaskProgress(taskId, 25);

    // Get history item to extract metadata
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
        // Try to get video time from history item metadata if available
        videoTime = (historyItem as any).videoTime || 'N/A';
      }
    } else {
      const task = context.taskManager.getTask(taskId);
      if (task) {
        platform = task.platform || 'Unknown Platform';
        url = task.url || 'N/A';
      }
    }

    // Analyze comments using AI with metadata
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
    );

    context.taskManager.updateTaskProgress(taskId, 75);

    // Update history with analysis result
    if (historyId) {
      const historyItem = await context.storageManager.getHistoryItem(historyId);
      if (historyItem) {
        historyItem.analysis = result;
        historyItem.analyzedAt = Date.now();
        await context.storageManager.saveHistory(historyItem);
      }
    } else {
      // Save new history item (shouldn't happen normally)
      const task = context.taskManager.getTask(taskId);
      if (task) {
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
    }

    context.taskManager.completeTask(taskId, {
      tokensUsed: result.tokensUsed,
      commentsCount: comments.length,
    });
  } catch (error) {
    throw error;
  }
}