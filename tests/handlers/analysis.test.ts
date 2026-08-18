import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleStartAnalysis,
  handleAIAnalyzeStructure,
  handleAIExtractContent,
} from '@/background/handlers/analysis';
import { HandlerContext } from '@/background/handlers/types';
import { ErrorCode } from '@/utils/errors';
import { ANALYSIS_FORMAT } from '@/config/constants';

vi.mock('@/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createMockContext(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    taskManager: {
      createTask: vi.fn().mockReturnValue('task_analysis_123'),
      setExecutor: vi.fn(),
      startTask: vi.fn().mockResolvedValue(undefined),
      updateTaskProgress: vi.fn(),
      updateDetailedProgress: vi.fn(),
      completeTask: vi.fn(),
      failTask: vi.fn(),
      getTask: vi.fn(),
    },
    settingsStore: {
      getSettings: vi.fn().mockResolvedValue({
        aiModel: { apiUrl: 'https://api.openai.com/v1', apiKey: 'test', model: 'gpt-4o' },
        analyzerPromptTemplate: 'Analyze: {comments_data}',
        language: 'en-US',
      }),
    },
    historyStore: {
      getHistoryItem: vi.fn().mockResolvedValue(null),
      saveHistory: vi.fn().mockResolvedValue('hist_123'),
      addAnalysisToHistory: vi.fn().mockResolvedValue(undefined),
      addHistoryItem: vi.fn().mockResolvedValue('hist_123'),
    },
    commentAnalyzer: {
      analyzeComments: vi.fn().mockResolvedValue({
        report: 'Analysis Report',
        tokensUsed: 50,
      }),
    },
    aiService: {
      callAI: vi.fn().mockResolvedValue({
        content:
          '{"selectors": {"container": ".comments"}, "structure": {"hasReplies": false}, "confidence": 0.9}',
        tokensUsed: 10,
      }),
    },
    ...overrides,
  } as unknown as HandlerContext;
}

describe('analysis handlers', () => {
  let context: HandlerContext;

  beforeEach(() => {
    context = createMockContext();
  });

  describe('handleStartAnalysis', () => {
    it('should throw validation error if comments array is missing', async () => {
      const message = {
        type: 'START_ANALYSIS' as const,
        payload: {} as any,
      };

      await expect(handleStartAnalysis(message, context)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should create task and return taskId', async () => {
      const message = {
        type: 'START_ANALYSIS' as const,
        payload: {
          comments: [
            {
              id: '1',
              username: 'user1',
              content: 'test',
              timestamp: '1h',
              likes: 0,
              platform: 'test',
              replies: [],
            },
          ],
          metadata: { url: 'https://example.com/post/1', title: 'Test Post' },
        },
      };

      const result = await handleStartAnalysis(message, context);

      expect(result).toEqual({ taskId: 'task_analysis_123' });
      expect(context.taskManager.createTask).toHaveBeenCalledWith(
        'analyze',
        'https://example.com/post/1',
        'example.com',
      );
      expect(context.taskManager.setExecutor).toHaveBeenCalledWith(
        'task_analysis_123',
        expect.any(Function),
      );
    });

    it('should forward AI stream progress to detailed task progress', async () => {
      const analysisResult = {
        markdown: '# Analysis Report',
        summary: {
          totalComments: 1,
          sentimentDistribution: { positive: 0, neutral: 100, negative: 0 },
          topKeywords: [],
          keyInsights: [],
          hotComments: [],
          engagement: { totalLikes: 0, averageLikes: 0, topLikedComment: null },
        },
        tokensUsed: 5,
        generatedAt: Date.now(),
      };
      const analyzeComments = vi.fn(async (...args: unknown[]) => {
        const onProgress = args[7] as (progress: {
          current: number;
          total: number;
          stageMessage: string;
          stageMessageKey?: string;
          stageMessageParams?: Record<string, string | number>;
        }) => void;
        onProgress({
          current: 12,
          total: 100,
          stageMessage: 'receiving model response, 512 chars',
          stageMessageKey: 'receiving',
          stageMessageParams: { characters: 512 },
        });
        return analysisResult;
      });
      const localContext = createMockContext({
        commentAnalyzer: {
          analyzeComments,
        },
      } as unknown as Partial<HandlerContext>);
      const message = {
        type: 'START_ANALYSIS' as const,
        payload: {
          comments: [
            {
              id: 'comment_1',
              username: 'user',
              content: 'hello',
              likes: 0,
              timestamp: new Date().toISOString(),
              replies: [],
            },
          ],
          metadata: { url: 'https://example.com/post', title: 'Post' },
        },
      };

      await handleStartAnalysis(message, localContext);
      const setExecutorMock = localContext.taskManager.setExecutor as unknown as {
        mock: { calls: unknown[][] };
      };
      const executor = setExecutorMock.mock.calls[0][1] as (
        task: { id: string; url: string; platform?: string },
        signal: AbortSignal,
      ) => Promise<unknown>;

      await executor(
        { id: 'task_123', url: 'https://example.com/post', platform: 'example.com' },
        new AbortController().signal,
      );

      expect(localContext.taskManager.updateDetailedProgress).toHaveBeenCalledWith(
        'task_analysis_123',
        {
          stage: 'analyzing',
          current: 0,
          total: expect.any(Number),
          stageMessage: expect.any(String),
          stageMessageKey: expect.any(String),
        },
      );
      expect(localContext.taskManager.updateDetailedProgress).toHaveBeenCalledWith(
        'task_analysis_123',
        {
          stage: 'analyzing',
          current: 8,
          total: 100,
          stageMessage: 'receiving model response, 512 chars',
          stageMessageKey: 'receiving',
          stageMessageParams: { characters: 512 },
        },
      );
    });

    it('should fail analysis when history target is missing', async () => {
      const localContext = createMockContext({
        historyStore: {
          ...createMockContext().historyStore,
          getHistoryItem: vi.fn().mockResolvedValue(null),
        },
      } as unknown as Partial<HandlerContext>);
      const message = {
        type: 'START_ANALYSIS' as const,
        payload: {
          comments: [
            {
              id: 'comment_1',
              username: 'user',
              content: 'hello',
              likes: 0,
              timestamp: new Date().toISOString(),
              replies: [],
            },
          ],
          historyId: 'history-missing',
          metadata: { url: 'https://example.com/post', title: 'Post' },
        },
      };

      await handleStartAnalysis(message, localContext);
      const setExecutorMock = localContext.taskManager.setExecutor as unknown as {
        mock: { calls: unknown[][] };
      };
      const executor = setExecutorMock.mock.calls[0][1] as (
        task: { id: string; url: string; platform?: string },
        signal: AbortSignal,
      ) => Promise<unknown>;

      await expect(
        executor(
          { id: 'task_123', url: 'https://example.com/post', platform: 'example.com' },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.TASK_NOT_FOUND,
        message: 'History item not found: history-missing',
      });
      expect(localContext.commentAnalyzer.analyzeComments).not.toHaveBeenCalled();
    });
  });

  describe('handleAIAnalyzeStructure', () => {
    it('should throw error when prompt is missing', async () => {
      const message = {
        type: 'AI_ANALYZE_STRUCTURE' as const,
        payload: {} as any,
      };

      await expect(handleAIAnalyzeStructure(message, context)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should call aiService and parse json structure correctly', async () => {
      const message = {
        type: 'AI_ANALYZE_STRUCTURE' as const,
        payload: {
          prompt: 'Analyze this structure',
        },
      };

      const result = await handleAIAnalyzeStructure(message, context);

      expect(result).toBeDefined();
      expect(result.data?.selectors).toEqual({ container: '.comments' });
      expect(result.data?.confidence).toBe(0.9);
    });
  });

  describe('handleAIExtractContent', () => {
    it('fills in missing timestamp/likes/replies on LLM-extracted comments', async () => {
      const message = {
        type: 'AI_EXTRACT_CONTENT' as const,
        payload: {
          chunks: ['<div>chunk</div>'],
        },
      };
      const localContext = createMockContext({
        aiService: {
          callAI: vi.fn().mockResolvedValue({
            content: JSON.stringify([
              { username: 'user1', content: 'hello' },
              { username: 'user2', content: 'hi', timestamp: '2h ago' },
            ]),
            tokensUsed: 10,
          }),
        },
      } as unknown as Partial<HandlerContext>);

      const result = await handleAIExtractContent(message, localContext);

      expect(result.comments).toHaveLength(2);
      for (const comment of result.comments) {
        expect(comment.id).toBeTruthy();
        expect(comment.timestamp).toBeDefined();
        expect(comment.likes).toBe(0);
        expect(comment.replies).toEqual([]);
      }
      expect(result.comments[0].timestamp).toBe(ANALYSIS_FORMAT.UNKNOWN_TIMESTAMP);
      expect(result.comments[1].timestamp).toBe('2h ago');
    });
  });

  describe('handleGenerateDynamicReport', () => {
    it('should throw validation error if historyId is missing', async () => {
      const { handleGenerateDynamicReport } = await import('@/background/handlers/analysis');
      const message = {
        type: 'GENERATE_DYNAMIC_REPORT' as const,
        payload: {} as any,
      };

      await expect(handleGenerateDynamicReport(message, context)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should throw task not found if history item does not exist', async () => {
      const { handleGenerateDynamicReport } = await import('@/background/handlers/analysis');
      const message = {
        type: 'GENERATE_DYNAMIC_REPORT' as const,
        payload: { historyId: 'not_found' },
      };

      await expect(handleGenerateDynamicReport(message, context)).rejects.toMatchObject({
        code: ErrorCode.TASK_NOT_FOUND,
      });
    });

    it('should successfully create task and execute dynamic HTML generation', async () => {
      const { handleGenerateDynamicReport } = await import('@/background/handlers/analysis');
      const mockHistoryItem = {
        id: 'hist_1',
        url: 'https://example.com',
        title: 'Example',
        platform: 'example',
        commentsCount: 10,
        analysis: {
          markdown: '# Analysis Markdown',
          tokensUsed: 100,
          generatedAt: Date.now(),
        },
      };

      let executorFn: any;
      const localContext = createMockContext({
        taskManager: {
          ...createMockContext().taskManager,
          createTask: vi.fn().mockReturnValue('task_dynamic_123'),
          setExecutor: vi.fn().mockImplementation((_taskId, fn) => {
            executorFn = fn;
          }),
        },
        historyStore: {
          ...createMockContext().historyStore,
          getHistoryItem: vi.fn().mockResolvedValue(mockHistoryItem),
          saveHistory: vi.fn().mockResolvedValue('hist_1'),
        },
        commentAnalyzer: {
          generateDynamicHtml: vi.fn().mockResolvedValue({
            html: '<!DOCTYPE html><html><body>Dashboard</body></html>',
            tokensUsed: 50,
          }),
        },
      } as unknown as Partial<HandlerContext>);

      const message = {
        type: 'GENERATE_DYNAMIC_REPORT' as const,
        payload: { historyId: 'hist_1' },
      };

      const response = await handleGenerateDynamicReport(message, localContext);

      expect(response.success).toBe(true);
      expect(response.taskId).toBe('task_dynamic_123');
      expect(localContext.taskManager.createTask).toHaveBeenCalledWith(
        'analyze',
        'https://example.com',
        'example.com',
      );
      expect(localContext.taskManager.setExecutor).toHaveBeenCalled();

      // Execute the task executor
      const taskResult = await executorFn({ id: 'task_dynamic_123' }, new AbortController().signal);
      expect(taskResult.tokensUsed).toBe(50);
      expect(localContext.historyStore.saveHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          analysis: expect.objectContaining({
            dynamicHtml: '<!DOCTYPE html><html><body>Dashboard</body></html>',
            tokensUsed: 150,
          }),
        }),
      );
    });
  });
});
