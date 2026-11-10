import { z } from 'zod';
import type {
  AIConfig,
  AnalysisResult,
  AnalysisResultSummary,
  Comment,
  CrawlingConfig,
  DOMAnalysisConfig,
  HistoryItem,
  SelectorCache,
  Settings,
  Task,
} from '@/types';
import { Logger } from '@/utils/logger';
import { AI, ANALYSIS_FORMAT, RETRY, TIMEOUT, UI_LIMITS } from '@/config/constants';

// MV3 extension pages prohibit eval: prevent Zod's object JIT from probing it.
z.config({ jitless: true });

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

const finiteNumberSchema = z.number().finite();
const positiveIntegerSchema = z.number().int().positive().finite();
const nonEmptyStringSchema = z.string().trim().min(1);
const normalizedDomainListSchema = z
  .array(z.unknown())
  .transform((values) => [
    ...new Set(
      values.flatMap((value) =>
        typeof value === 'string' && value.trim().length > 0 ? [value.trim().toLowerCase()] : [],
      ),
    ),
  ]);
const selectorRuleSchema = z.object({
  selector: nonEmptyStringSchema,
  type: z.enum(['css', 'xpath']),
});
const fieldSelectorSchema = z.object({
  name: nonEmptyStringSchema,
  rule: selectorRuleSchema,
  attribute: z.string().optional(),
});
export const crawlingValidationSchema = z.record(
  nonEmptyStringSchema,
  z.record(nonEmptyStringSchema, z.enum(['success', 'failed'])),
);
const replyConfigSchema = z.object({
  container: selectorRuleSchema,
  item: selectorRuleSchema,
  fields: z.array(fieldSelectorSchema),
  expandBtn: selectorRuleSchema.optional(),
});
export const crawlingConfigSchema = z.object({
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
export const selectorCacheSchema = z.object({
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
export const aiConfigSchema = z.object({
  apiUrl: z.string(),
  apiKey: z.string(),
  model: z.string(),
  contextWindowSize: positiveIntegerSchema.min(AI.MIN_CONTEXT_WINDOW),
  maxOutputTokens: positiveIntegerSchema.min(AI.MIN_OUTPUT_TOKENS).optional(),
  temperature: finiteNumberSchema.min(UI_LIMITS.TEMPERATURE_MIN).max(UI_LIMITS.TEMPERATURE_MAX),
  topP: finiteNumberSchema.min(UI_LIMITS.TOP_P_MIN).max(UI_LIMITS.TOP_P_MAX),
});
export const completeAiConfigSchema = aiConfigSchema.superRefine((config, context) => {
  const maxOutputTokens = config.maxOutputTokens ?? AI.DEFAULT_MAX_OUTPUT_TOKENS;
  if (
    maxOutputTokens + AI.INPUT_TOKEN_BUFFER + AI.MIN_AVAILABLE_TOKENS >
    config.contextWindowSize
  ) {
    context.addIssue({
      code: 'custom',
      path: ['maxOutputTokens'],
      message: 'The output and input reserves must fit within contextWindowSize',
    });
  }
});
export const domAnalysisConfigSchema = z.object({
  initialDepth: positiveIntegerSchema
    .min(UI_LIMITS.INITIAL_DEPTH_MIN)
    .max(UI_LIMITS.INITIAL_DEPTH_MAX),
  expandDepth: positiveIntegerSchema
    .min(UI_LIMITS.EXPAND_DEPTH_MIN)
    .max(UI_LIMITS.EXPAND_DEPTH_MAX),
  maxDepth: positiveIntegerSchema.min(UI_LIMITS.MAX_DEPTH_MIN).max(UI_LIMITS.MAX_DEPTH_MAX),
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
    'normalizing',
    'generating',
    'complete',
  ]),
  current: finiteNumberSchema,
  total: finiteNumberSchema,
  estimatedTimeRemaining: finiteNumberSchema,
  stageMessage: z.string().optional(),
  stageMessageKey: z.string().optional(),
  stageMessageParams: z.record(z.string(), z.union([z.string(), finiteNumberSchema])).optional(),
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
  interruptedByRestart: z.boolean().optional(),
  detailedProgress: taskProgressSchema.optional(),
});
const historyItemSchema = z.object({
  id: nonEmptyStringSchema,
  url: nonEmptyStringSchema,
  title: z.string(),
  platform: z.string(),
  videoTime: z.string().optional(),
  postContent: z.string().optional(),
  extractedAt: finiteNumberSchema,
  commentsCount: finiteNumberSchema,
  comments: z.array(z.unknown()),
  analysis: z.unknown().optional(),
  analyzedAt: finiteNumberSchema.optional(),
});
const analysisResultSchema = z.object({
  markdown: z.string(),
  dynamicHtml: z.string().optional(),
  summary: z.unknown().optional(),
  tokensUsed: finiteNumberSchema,
  generatedAt: finiteNumberSchema,
});
const analysisResultSummarySchema = z.object({
  totalComments: finiteNumberSchema,
  sentimentDistribution: z.object({
    positive: finiteNumberSchema,
    negative: finiteNumberSchema,
    neutral: finiteNumberSchema,
  }),
  hotComments: z.array(z.unknown()),
  keyInsights: z.array(z.string()),
});
const tokenStatsSchema = z.object({
  today: finiteNumberSchema,
  total: finiteNumberSchema,
  lastReset: finiteNumberSchema,
});
const aiLogEntrySchema = z.object({
  type: z.enum(['extraction', 'analysis']),
  timestamp: finiteNumberSchema,
  prompt: z.string(),
  response: z.string(),
});

export const settingsPatchSchema = z
  .object({
    maxComments: positiveIntegerSchema
      .min(UI_LIMITS.MAX_COMMENTS_MIN)
      .max(UI_LIMITS.MAX_COMMENTS_MAX)
      .optional(),
    aiModel: aiConfigSchema.partial().optional(),
    aiTimeout: positiveIntegerSchema
      .min(TIMEOUT.MIN_AI_SECONDS * TIMEOUT.MS_PER_SEC)
      .max(TIMEOUT.MAX_AI_SECONDS * TIMEOUT.MS_PER_SEC)
      .optional(),
    analyzerPromptTemplate: z.string().optional(),
    generateDynamicReport: z.boolean().optional(),
    dynamicReportPromptTemplate: z.string().optional(),
    language: z.string().optional(),
    theme: z.enum(['light', 'dark', 'system']).optional(),
    normalizeTimestamps: z.boolean().optional(),
    exportPostContentInMarkdown: z.boolean().optional(),
    selectorRetryAttempts: positiveIntegerSchema.max(RETRY.SELECTOR_MAX_ATTEMPTS).optional(),
    selectorCache: z.array(selectorCacheSchema).optional(),
    crawlingConfigs: z.array(crawlingConfigSchema).optional(),
    crawlingConfigValidationByDomain: crawlingValidationSchema.optional(),
    disabledDefaultConfigDomains: normalizedDomainListSchema.optional(),
    domAnalysisConfig: domAnalysisConfigSchema.partial().optional(),
    developerMode: z.boolean().optional(),
  })
  .strict();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeComment(value: unknown): Comment | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const id = nonEmptyStringSchema.safeParse(value.id);
  if (!id.success || typeof value.username !== 'string' || typeof value.content !== 'string') {
    return null;
  }

  const replies = Array.isArray(value.replies)
    ? value.replies.flatMap((reply) => {
        const sanitized = sanitizeComment(reply);
        return sanitized ? [sanitized] : [];
      })
    : [];
  const likes = finiteNumberSchema.safeParse(value.likes);
  const comment: Comment = {
    id: id.data,
    username: value.username,
    timestamp:
      typeof value.timestamp === 'string' && value.timestamp.trim().length > 0
        ? value.timestamp
        : ANALYSIS_FORMAT.UNKNOWN_TIMESTAMP,
    likes: likes.success ? Math.max(0, likes.data) : 0,
    content: value.content,
    replies,
  };

  if (typeof value.userId === 'string') {
    comment.userId = value.userId;
  }
  if (typeof value.platform === 'string') {
    comment.platform = value.platform;
  }

  return comment;
}

function sanitizeAnalysisResultSummary(value: unknown): AnalysisResultSummary | undefined {
  const result = analysisResultSummarySchema.safeParse(value);
  if (!result.success) {
    return undefined;
  }

  return {
    totalComments: result.data.totalComments,
    sentimentDistribution: result.data.sentimentDistribution,
    hotComments: result.data.hotComments.flatMap((comment) => {
      const sanitized = sanitizeComment(comment);
      return sanitized ? [sanitized] : [];
    }),
    keyInsights: result.data.keyInsights,
  };
}

function sanitizeAnalysisResult(value: unknown): AnalysisResult | null {
  const result = analysisResultSchema.safeParse(value);
  if (!result.success) {
    return null;
  }

  const sanitized: AnalysisResult = {
    markdown: result.data.markdown,
    tokensUsed: result.data.tokensUsed,
    generatedAt: result.data.generatedAt,
  };
  if (result.data.dynamicHtml !== undefined) {
    sanitized.dynamicHtml = result.data.dynamicHtml;
  }

  const summary = sanitizeAnalysisResultSummary(result.data.summary);
  if (summary) {
    sanitized.summary = summary;
  }

  return sanitized;
}

function filterValidItems<T>(items: unknown, schema: z.ZodType<T>): T[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.flatMap((item, index) => {
    const result = schema.safeParse(item);
    if (result.success) {
      return [result.data];
    }
    Logger.warn('[storage-validation] Item validation failed', {
      index,
      errors: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return [];
  });
}

export function sanitizeStoredSettings(value: unknown): Partial<Settings> {
  if (!isPlainObject(value)) {
    return {};
  }

  const raw = value as Record<string, unknown>;
  const sanitized: Partial<Settings> = {};

  const maxComments = positiveIntegerSchema
    .min(UI_LIMITS.MAX_COMMENTS_MIN)
    .max(UI_LIMITS.MAX_COMMENTS_MAX)
    .safeParse(raw.maxComments);
  if (maxComments.success) {
    sanitized.maxComments = maxComments.data;
  }

  const aiTimeout = positiveIntegerSchema
    .min(TIMEOUT.MIN_AI_SECONDS * TIMEOUT.MS_PER_SEC)
    .max(TIMEOUT.MAX_AI_SECONDS * TIMEOUT.MS_PER_SEC)
    .safeParse(raw.aiTimeout);
  if (aiTimeout.success) {
    sanitized.aiTimeout = aiTimeout.data;
  }

  if (typeof raw.analyzerPromptTemplate === 'string') {
    sanitized.analyzerPromptTemplate = raw.analyzerPromptTemplate;
  }

  if (typeof raw.generateDynamicReport === 'boolean') {
    sanitized.generateDynamicReport = raw.generateDynamicReport;
  }

  if (typeof raw.dynamicReportPromptTemplate === 'string') {
    sanitized.dynamicReportPromptTemplate = raw.dynamicReportPromptTemplate;
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

  const selectorRetryAttempts = positiveIntegerSchema
    .max(RETRY.SELECTOR_MAX_ATTEMPTS)
    .safeParse(raw.selectorRetryAttempts);
  if (selectorRetryAttempts.success) {
    sanitized.selectorRetryAttempts = selectorRetryAttempts.data;
  }

  if (typeof raw.developerMode === 'boolean') {
    sanitized.developerMode = raw.developerMode;
  }

  const disabledDefaultConfigDomains = normalizedDomainListSchema.safeParse(
    raw.disabledDefaultConfigDomains,
  );
  sanitized.disabledDefaultConfigDomains = disabledDefaultConfigDomains.success
    ? disabledDefaultConfigDomains.data
    : [];

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
  const validation = crawlingValidationSchema.safeParse(raw.crawlingConfigValidationByDomain);
  if (validation.success) {
    sanitized.crawlingConfigValidationByDomain = validation.data;
  }

  return sanitized;
}

export function sanitizeHistoryItem(
  value: unknown,
  options: { dropInvalidAnalysis?: boolean } = {},
): HistoryItem | null {
  const result = historyItemSchema.safeParse(value);
  if (!result.success) {
    return null;
  }

  const comments = result.data.comments.flatMap((comment) => {
    const sanitized = sanitizeComment(comment);
    return sanitized ? [sanitized] : [];
  });
  let analysis: AnalysisResult | undefined;
  if (result.data.analysis !== undefined) {
    const sanitizedAnalysis = sanitizeAnalysisResult(result.data.analysis);
    if (!sanitizedAnalysis && !options.dropInvalidAnalysis) {
      return null;
    }
    analysis = sanitizedAnalysis ?? undefined;
  }

  return {
    id: result.data.id,
    url: result.data.url,
    title: result.data.title,
    platform: result.data.platform,
    videoTime: result.data.videoTime,
    postContent: result.data.postContent,
    extractedAt: result.data.extractedAt,
    commentsCount: comments.length,
    comments,
    analysis,
    analyzedAt: result.data.analyzedAt,
  };
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

export function sanitizeStringIndex(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export function sanitizeAiLogEntry(value: unknown): StoredAiLogEntry | null {
  const result = aiLogEntrySchema.safeParse(value);
  return result.success ? result.data : null;
}

export function sanitizeTokenStats(value: unknown): {
  today: number;
  total: number;
  lastReset: number;
} {
  const result = tokenStatsSchema.safeParse(value);
  return result.success ? result.data : { today: 0, total: 0, lastReset: 0 };
}
