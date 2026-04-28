import { z } from 'zod';
import type { Message, ProgressStage } from '@/types';
import { ExtensionError, ErrorCode } from './errors';

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

const coreCommentSchema = z.object({
  id: nonEmptyString,
  username: z.string(),
  timestamp: z.string(),
  likes: z.number(),
  content: z.string(),
  replies: z.array(looseObjectSchema),
});

const historyExportSchema = z.object({ type: z.literal('settings') });

const messagePayloadSchemas: Partial<Record<Message['type'], z.ZodTypeAny>> = {
  ENSURE_CONTENT_SCRIPT: z
    .object({
      tabId: z.number().int().positive().optional(),
    })
    .optional(),
  SAVE_SETTINGS: z.object({
    settings: looseObjectSchema,
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
      progress: z.number().optional(),
      message: z.string().optional(),
      stage: progressStageSchema.optional(),
      current: z.number().optional(),
      total: z.number().optional(),
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
    return message;
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
