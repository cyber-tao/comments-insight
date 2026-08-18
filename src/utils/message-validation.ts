import { z } from 'zod';
import type { Message, ProgressStage } from '@/types';
import { ExtensionError, ErrorCode } from './errors';
import { settingsPatchSchema } from '@/utils/storage-validation';
import { ANALYSIS_FORMAT } from '@/config/constants';

const nonEmptyString = z.string().trim().min(1);
const looseObjectSchema = z.object({}).passthrough();
const progressStageSchema = z.enum([
  'initializing',
  'analyzing',
  'detecting',
  'extracting',
  'expanding',
  'scrolling',
  'validating',
  'complete',
] as [ProgressStage, ...ProgressStage[]]);

// Comments arrive from persisted history as well as fresh extraction, so the
// schema must tolerate legacy rows written before timestamp/likes fallbacks
// existed: recover with sane defaults instead of rejecting the whole analysis.
const coreCommentSchema = z.object({
  id: nonEmptyString,
  username: z.string(),
  userId: z.string().optional(),
  platform: z.string().optional(),
  timestamp: z.string().catch(ANALYSIS_FORMAT.UNKNOWN_TIMESTAMP),
  likes: z.number().catch(0),
  content: z.string(),
  replies: z.array(looseObjectSchema),
});

const historyExportSchema = z.object({ type: z.literal('settings') });

const optionalUndefinedPayload = z.undefined().optional();
const taskIdPayload = z.object({ taskId: nonEmptyString });

const messagePayloadSchemas: Record<Message['type'], z.ZodTypeAny> = {
  PING: optionalUndefinedPayload,
  GET_PLATFORM_INFO: optionalUndefinedPayload,
  GET_SETTINGS: optionalUndefinedPayload,
  GET_DOM_STRUCTURE: optionalUndefinedPayload,
  SYNC_CRAWLING_CONFIGS: optionalUndefinedPayload,
  CLEAR_ALL_HISTORY: optionalUndefinedPayload,
  TASK_UPDATE: z
    .object({
      id: nonEmptyString,
    })
    .passthrough(),
  CANCEL_EXTRACTION: taskIdPayload,
  ENSURE_CONTENT_SCRIPT: z
    .object({
      tabId: z.number().int().positive().optional(),
    })
    .optional(),
  SAVE_SETTINGS: z.object({
    settings: settingsPatchSchema,
  }),
  IMPORT_SETTINGS: z.object({
    data: nonEmptyString,
  }),
  CACHE_SELECTOR: z.object({
    hostname: nonEmptyString,
    selector: nonEmptyString,
  }),
  GET_CRAWLING_CONFIG: z.object({
    domain: nonEmptyString,
  }),
  SAVE_CRAWLING_CONFIG: z.object({
    config: z
      .object({
        domain: nonEmptyString,
      })
      .passthrough(),
  }),
  UPDATE_FIELD_VALIDATION: z.object({
    domain: nonEmptyString,
    fieldValidation: z.record(nonEmptyString, z.enum(['success', 'failed'])),
  }),
  START_EXTRACTION: z.object({
    url: nonEmptyString,
    maxComments: z.number().int().positive().optional(),
    tabId: z.number().int().positive().optional(),
    taskId: nonEmptyString.optional(),
  }),
  START_CONFIG_GENERATION: z.object({
    url: nonEmptyString,
    tabId: z.number().int().positive().optional(),
  }),
  EXTRACTION_PROGRESS: z
    .object({
      taskId: nonEmptyString,
      progress: z.number().finite().min(0).max(100).optional(),
      message: z.string().optional(),
      stage: progressStageSchema.optional(),
      current: z.number().finite().nonnegative().optional(),
      total: z.number().finite().positive().optional(),
      data: z.unknown().optional(),
    })
    .superRefine((payload, context) => {
      const hasDetailedProgress =
        payload.stage !== undefined &&
        typeof payload.current === 'number' &&
        typeof payload.total === 'number';
      if (typeof payload.progress !== 'number' && !hasDetailedProgress) {
        context.addIssue({
          code: 'custom',
          path: ['progress'],
          message: 'progress is required when detailed progress fields are incomplete',
        });
      }
    }),
  EXTRACTION_COMPLETED: z.object({
    taskId: nonEmptyString,
    success: z.boolean(),
    comments: z.array(looseObjectSchema).optional(),
    postInfo: z
      .object({
        url: z.string().optional(),
        title: z.string().optional(),
        videoTime: z.string().optional(),
        postContent: z.string().optional(),
      })
      .optional(),
    error: z.string().optional(),
  }),
  CONFIG_GENERATION_COMPLETED: z.object({
    taskId: nonEmptyString,
    success: z.boolean(),
    error: z.string().optional(),
  }),
  START_ANALYSIS: z.object({
    comments: z.array(coreCommentSchema),
    historyId: nonEmptyString.optional(),
    promptTemplate: z.string().optional(),
    language: z.string().optional(),
    metadata: looseObjectSchema.optional(),
  }),
  GENERATE_DYNAMIC_REPORT: z.object({
    historyId: nonEmptyString,
  }),
  AI_ANALYZE_STRUCTURE: z.object({
    prompt: nonEmptyString,
  }),
  AI_EXTRACT_CONTENT: z.object({
    chunks: z.array(z.string()).min(1),
    systemPrompt: z.string().optional(),
  }),
  GET_TASK_STATUS: z
    .object({
      taskId: nonEmptyString.optional(),
    })
    .optional(),
  CANCEL_TASK: z.object({
    taskId: nonEmptyString,
  }),
  GET_HISTORY: z
    .object({
      page: z.number().int().nonnegative().optional(),
      pageSize: z.number().int().positive().optional(),
      query: nonEmptyString.optional(),
      id: nonEmptyString.optional(),
      metadataOnly: z.boolean().optional(),
    })
    .optional(),
  GET_HISTORY_BY_URL: z.object({
    url: nonEmptyString,
  }),
  DELETE_HISTORY: z.object({
    id: nonEmptyString,
  }),
  GET_AVAILABLE_MODELS: z.object({
    apiUrl: nonEmptyString,
    apiKey: z.string(),
  }),
  TEST_MODEL: z.object({
    config: z
      .object({
        apiUrl: nonEmptyString,
        model: nonEmptyString,
      })
      .passthrough(),
  }),
  TEST_SELECTOR: z.object({
    selector: nonEmptyString,
    selectorType: z.enum(['css', 'xpath']),
    tabId: z.number().int().positive().optional(),
  }),
  EXPORT_DATA: historyExportSchema,
  GENERATE_CRAWLING_CONFIG: z.object({
    prompt: nonEmptyString,
  }),
};

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'payload';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

export function validateMessagePayload(message: Message): Message {
  const schema = messagePayloadSchemas[message.type];
  if (!schema) {
    throw new ExtensionError(
      ErrorCode.VALIDATION_ERROR,
      `Unknown message type has no payload schema: ${message.type}`,
      { type: message.type },
    );
  }

  const result = schema.safeParse(message.payload);
  if (!result.success) {
    throw new ExtensionError(
      ErrorCode.VALIDATION_ERROR,
      `Invalid payload for ${message.type}: ${formatIssues(result.error)}`,
      {
        type: message.type,
        issues: result.error.flatten(),
      },
    );
  }

  if (typeof result.data === 'undefined') {
    return message;
  }

  return {
    ...message,
    payload: result.data,
  } as Message;
}
