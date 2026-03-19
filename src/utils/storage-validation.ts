import { z } from 'zod';
import type {
  AIConfig,
  AnalysisResult,
  Comment,
  CrawlingConfig,
  DOMAnalysisConfig,
  HistoryItem,
  SelectorCache,
  Settings,
  Task,
} from '@/types';

export type StoredAiLogEntry = {
  type: 'extraction' | 'analysis';
  timestamp: number;
  prompt: string;
  response: string;
};

type PersistedTaskStateShape = {
  tasks: Task[];
  queue: string[];
  currentTaskId: string | null;
  savedAt: number;
};

type HistoryIndexEntryShape = {
  id: string;
  extractedAt: number;
  url: string;
  title: string;
  platform: string;
};

type HistorySortedIndexShape = {
  entries: HistoryIndexEntryShape[];
  lastUpdated: number;
};

const finiteNumberSchema = z.number().finite();
const nonEmptyStringSchema = z.string().trim().min(1);
const selectorRuleSchema = z.object({
  selector: nonEmptyStringSchema,
  type: z.enum(['css', 'xpath']),
});
const fieldSelectorSchema = z.object({
  name: nonEmptyStringSchema,
  rule: selectorRuleSchema,
  attribute: z.string().optional(),
});
const replyConfigSchema = z.object({
  container: selectorRuleSchema,
  item: selectorRuleSchema,
  fields: z.array(fieldSelectorSchema),
  expandBtn: selectorRuleSchema.optional(),
});
const crawlingConfigSchema = z.object({
  id: nonEmptyStringSchema,
  domain: nonEmptyStringSchema,
  siteName: z.string().optional(),
  container: selectorRuleSchema,
  item: selectorRuleSchema,
  fields: z.array(fieldSelectorSchema),
  replies: replyConfigSchema.optional(),
  videoTime: selectorRuleSchema.optional(),
  postContent: selectorRuleSchema.optional(),
  postTime: selectorRuleSchema.optional(),
  lastUpdated: finiteNumberSchema,
  fieldValidation: z.record(nonEmptyStringSchema, z.enum(['success', 'failed'])).optional(),
});
const selectorCacheSchema = z.object({
  domain: nonEmptyStringSchema,
  platform: z.string().optional(),
  selectors: z.object({
    commentContainer: nonEmptyStringSchema,
    commentItem: z.string().optional(),
    replyToggle: z.string().optional(),
    replyContainer: z.string().optional(),
    replyItem: z.string().optional(),
    username: z.string().optional(),
    timestamp: z.string().optional(),
    likes: z.string().optional(),
    content: z.string().optional(),
  }),
  lastUsed: finiteNumberSchema,
  successCount: finiteNumberSchema,
});
const aiConfigSchema = z.object({
  apiUrl: z.string(),
  apiKey: z.string(),
  model: z.string(),
  contextWindowSize: finiteNumberSchema,
  maxOutputTokens: finiteNumberSchema.optional(),
  temperature: finiteNumberSchema,
  topP: finiteNumberSchema,
});
const domAnalysisConfigSchema = z.object({
  initialDepth: finiteNumberSchema,
  expandDepth: finiteNumberSchema,
  maxDepth: finiteNumberSchema,
});
const taskProgressSchema = z.object({
  stage: z.enum([
    'initializing',
    'analyzing',
    'detecting',
    'extracting',
    'expanding',
    'scrolling',
    'validating',
    'complete',
  ]),
  current: finiteNumberSchema,
  total: finiteNumberSchema,
  estimatedTimeRemaining: finiteNumberSchema,
  stageMessage: z.string().optional(),
});
const taskSchema = z.object({
  id: nonEmptyStringSchema,
  type: z.enum(['extract', 'analyze', 'config']),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  url: nonEmptyStringSchema,
  platform: z.string().optional(),
  tabId: z.number().int().positive().optional(),
  progress: finiteNumberSchema,
  startTime: finiteNumberSchema,
  endTime: finiteNumberSchema.optional(),
  tokensUsed: finiteNumberSchema,
  maxComments: finiteNumberSchema.optional(),
  error: z.string().optional(),
  message: z.string().optional(),
  detailedProgress: taskProgressSchema.optional(),
});
const commentSchema: z.ZodType<Comment> = z.lazy(() =>
  z.object({
    id: nonEmptyStringSchema,
    username: z.string(),
    userId: z.string().optional(),
    platform: z.string().optional(),
    timestamp: z.string(),
    likes: finiteNumberSchema,
    content: z.string(),
    replies: z.array(commentSchema),
    isHot: z.boolean().optional(),
  }),
);
const analysisResultSchema: z.ZodType<AnalysisResult> = z.object({
  markdown: z.string(),
  summary: z.object({
    totalComments: finiteNumberSchema,
    sentimentDistribution: z.object({
      positive: finiteNumberSchema,
      negative: finiteNumberSchema,
      neutral: finiteNumberSchema,
    }),
    hotComments: z.array(commentSchema),
    keyInsights: z.array(z.string()),
  }),
  tokensUsed: finiteNumberSchema,
  generatedAt: finiteNumberSchema,
});
const compressedHistoryItemSchema = z.object({
  id: nonEmptyStringSchema,
  url: nonEmptyStringSchema,
  title: z.string(),
  platform: z.string(),
  videoTime: z.string().optional(),
  postContent: z.string().optional(),
  extractedAt: finiteNumberSchema,
  commentsCount: finiteNumberSchema,
  comments: z.string(),
  commentsChunks: z.number().int().nonnegative().optional(),
  analysis: analysisResultSchema.optional(),
  analyzedAt: finiteNumberSchema.optional(),
});
const historyIndexEntrySchema = z.object({
  id: nonEmptyStringSchema,
  extractedAt: finiteNumberSchema,
  url: z.string(),
  title: z.string(),
  platform: z.string(),
});
const aiLogEntrySchema = z.object({
  type: z.enum(['extraction', 'analysis']),
  timestamp: finiteNumberSchema,
  prompt: z.string(),
  response: z.string(),
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function filterValidItems<T>(items: unknown, schema: z.ZodType<T>): T[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.flatMap((item) => {
    const result = schema.safeParse(item);
    return result.success ? [result.data] : [];
  });
}

export function sanitizeStoredSettings(value: unknown): Partial<Settings> {
  if (!isPlainObject(value)) {
    return {};
  }

  const raw = value as Record<string, unknown>;
  const sanitized: Partial<Settings> = {};

  const maxComments = finiteNumberSchema.safeParse(raw.maxComments);
  if (maxComments.success) {
    sanitized.maxComments = maxComments.data;
  }

  const aiTimeout = finiteNumberSchema.safeParse(raw.aiTimeout);
  if (aiTimeout.success) {
    sanitized.aiTimeout = aiTimeout.data;
  }

  if (typeof raw.analyzerPromptTemplate === 'string') {
    sanitized.analyzerPromptTemplate = raw.analyzerPromptTemplate;
  }

  if (typeof raw.language === 'string') {
    sanitized.language = raw.language;
  }

  const theme = z.enum(['light', 'dark', 'system']).safeParse(raw.theme);
  if (theme.success) {
    sanitized.theme = theme.data;
  }

  if (typeof raw.normalizeTimestamps === 'boolean') {
    sanitized.normalizeTimestamps = raw.normalizeTimestamps;
  }

  if (typeof raw.exportPostContentInMarkdown === 'boolean') {
    sanitized.exportPostContentInMarkdown = raw.exportPostContentInMarkdown;
  }

  const selectorRetryAttempts = finiteNumberSchema.safeParse(raw.selectorRetryAttempts);
  if (selectorRetryAttempts.success) {
    sanitized.selectorRetryAttempts = selectorRetryAttempts.data;
  }

  if (typeof raw.developerMode === 'boolean') {
    sanitized.developerMode = raw.developerMode;
  }

  const aiModel = aiConfigSchema.partial().safeParse(raw.aiModel);
  if (aiModel.success) {
    sanitized.aiModel = aiModel.data as AIConfig;
  }

  const domAnalysisConfig = domAnalysisConfigSchema.safeParse(raw.domAnalysisConfig);
  if (domAnalysisConfig.success) {
    sanitized.domAnalysisConfig = domAnalysisConfig.data as DOMAnalysisConfig;
  }

  sanitized.selectorCache = filterValidItems(
    raw.selectorCache,
    selectorCacheSchema,
  ) as SelectorCache[];
  sanitized.crawlingConfigs = filterValidItems(
    raw.crawlingConfigs,
    crawlingConfigSchema,
  ) as CrawlingConfig[];

  return sanitized;
}

export function sanitizePersistedTaskState(value: unknown): PersistedTaskStateShape | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const tasks = filterValidItems(raw.tasks, taskSchema) as Task[];
  const queue = Array.isArray(raw.queue)
    ? raw.queue.filter((taskId): taskId is string => typeof taskId === 'string')
    : [];
  const currentTaskId = typeof raw.currentTaskId === 'string' ? raw.currentTaskId : null;
  const savedAt =
    typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? raw.savedAt : Date.now();

  return {
    tasks,
    queue,
    currentTaskId,
    savedAt,
  };
}

export function sanitizeHistoryIndex(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export function sanitizeHistoryUrlIndex(value: unknown): Record<string, string[]> {
  if (!isPlainObject(value)) {
    return {};
  }

  return Object.entries(value).reduce<Record<string, string[]>>((accumulator, [url, ids]) => {
    if (url.length === 0) {
      return accumulator;
    }

    const sanitizedIds = sanitizeHistoryIndex(ids);
    if (sanitizedIds.length > 0) {
      accumulator[url] = sanitizedIds;
    }

    return accumulator;
  }, {});
}

export function sanitizeHistorySortedIndex(value: unknown): HistorySortedIndexShape | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const entries = filterValidItems(
    raw.entries,
    historyIndexEntrySchema,
  ) as HistoryIndexEntryShape[];
  const lastUpdated =
    typeof raw.lastUpdated === 'number' && Number.isFinite(raw.lastUpdated)
      ? raw.lastUpdated
      : Date.now();

  return {
    entries,
    lastUpdated,
  };
}

export function sanitizeCompressedHistoryItem(value: unknown): {
  id: string;
  url: string;
  title: string;
  platform: string;
  videoTime?: string;
  postContent?: string;
  extractedAt: number;
  commentsCount: number;
  comments: string;
  commentsChunks?: number;
  analysis?: AnalysisResult;
  analyzedAt?: number;
} | null {
  const result = compressedHistoryItemSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function sanitizeHistoryComments(value: unknown): Comment[] | null {
  const result = z.array(commentSchema).safeParse(value);
  return result.success ? result.data : null;
}

export function sanitizeHistoryMetadata(value: unknown): Pick<HistoryItem, 'url'> & {
  commentsChunks?: number;
} {
  if (!isPlainObject(value)) {
    return { url: '' };
  }

  const raw = value as Record<string, unknown>;
  return {
    url: typeof raw.url === 'string' ? raw.url : '',
    commentsChunks:
      typeof raw.commentsChunks === 'number' && Number.isInteger(raw.commentsChunks)
        ? raw.commentsChunks
        : undefined,
  };
}

export function sanitizeAiLogEntry(value: unknown): StoredAiLogEntry | null {
  const result = aiLogEntrySchema.safeParse(value);
  return result.success ? result.data : null;
}
