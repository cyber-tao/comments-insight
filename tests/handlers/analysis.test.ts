import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleStartAnalysis,
  handleAIAnalyzeStructure,
  handleAIExtractContent,
} from '@/background/handlers/analysis';
import { HandlerContext } from '@/background/handlers/types';
import { ExtensionError, ErrorCode } from '@/utils/errors';
import { ANALYSIS_FORMAT, TIMEOUT } from '@/config/constants';
import type { HistoryItem, Task } from '@/types';

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
      createHistory: vi.fn().mockResolvedValue(undefined),
      updateHistory: vi.fn().mockResolvedValue(true),
      updateDynamicReport: vi.fn().mockResolvedValue(true),
    },
    commentAnalyzer: {
      analyzeComments: vi.fn().mockResolvedValue({
        markdown: '# Analysis Report',
        generatedAt: 2000,
        tokensUsed: 50,
      }),
      generateDynamicHtml: vi
        .fn()
        .mockResolvedValue({ html: '<main>Report</main>', tokensUsed: 7 }),
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
          ...context.commentAnalyzer,
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
          stageMessageKey: expect.any(String),
        },
      );
      expect(localContext.taskManager.updateDetailedProgress).toHaveBeenCalledWith(
        'task_analysis_123',
        {
          stage: 'analyzing',
          current: 12,
          total: 100,
          stageMessageKey: 'receiving',
          stageMessageParams: { characters: 512 },
        },
      );
      expect(localContext.historyStore.createHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          comments: message.payload.comments,
          analysis: analysisResult,
        }),
        expect.any(AbortSignal),
      );
      expect(localContext.historyStore.updateHistory).not.toHaveBeenCalled();
    });

    it.each(['create', 'update'] as const)(
      'saves the Markdown before generating HTML and attaches HTML to the same record (%s)',
      async (operation) => {
        const history: HistoryItem = {
          id: 'history-analysis',
          url: 'https://example.com/post',
          title: 'Post',
          platform: 'example.com',
          extractedAt: 1000,
          commentsCount: 0,
          comments: [],
        };
        const task: Task = {
          id: 'task_analysis_123',
          type: 'analyze',
          status: 'running',
          url: history.url,
          platform: history.platform,
          progress: 0,
          startTime: Date.now(),
          tokensUsed: 0,
        };
        vi.mocked(context.historyStore.getHistoryItem).mockResolvedValue(history);
        const writeHistory = vi.mocked(
          operation === 'create'
            ? context.historyStore.createHistory
            : context.historyStore.updateHistory,
        );
        await handleStartAnalysis(
          {
            type: 'START_ANALYSIS',
            payload: { comments: [], historyId: operation === 'update' ? history.id : undefined },
          },
          context,
        );
        const executor = vi.mocked(context.taskManager.setExecutor).mock.calls[0][1];
        await expect(executor(task, new AbortController().signal)).resolves.toMatchObject({
          tokensUsed: 57,
        });

        expect(writeHistory).toHaveBeenCalledBefore(
          vi.mocked(context.commentAnalyzer.generateDynamicHtml),
        );
        const [saved] = writeHistory.mock.calls[0];
        expect(saved.analysis).toEqual({
          markdown: '# Analysis Report',
          generatedAt: 2000,
          tokensUsed: 50,
        });
        expect(context.historyStore.updateDynamicReport).toHaveBeenCalledWith(
          saved.id,
          saved.analysis,
          { html: '<main>Report</main>', tokensUsed: 7 },
          expect.any(AbortSignal),
        );
      },
    );

    it.each(['timeout', 'cancel'] as const)(
      'preserves saved Markdown when optional HTML generation is interrupted by %s',
      async (interruption) => {
        vi.useFakeTimers();
        const controller = new AbortController();
        try {
          let startGenerating!: () => void;
          const generating = new Promise<void>((resolve) => {
            startGenerating = resolve;
          });
          vi.mocked(context.commentAnalyzer.generateDynamicHtml).mockImplementation(
            (_markdown, _model, _prompt, _language, _metadata, _count, signal) =>
              new Promise((_resolve, reject) => {
                signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
                startGenerating();
              }),
          );
          await handleStartAnalysis({ type: 'START_ANALYSIS', payload: { comments: [] } }, context);
          const executor = vi.mocked(context.taskManager.setExecutor).mock.calls[0][1];
          const running = executor(
            {
              id: 'task_analysis_123',
              type: 'analyze',
              status: 'running',
              url: 'https://example.com/post',
              platform: 'example.com',
              progress: 0,
              startTime: Date.now(),
              tokensUsed: 0,
            },
            controller.signal,
          );
          const result =
            interruption === 'timeout'
              ? expect(running).resolves.toMatchObject({ tokensUsed: 50 })
              : expect(running).rejects.toMatchObject({ name: 'AbortError' });
          await generating;
          expect(context.historyStore.createHistory).toHaveBeenCalledWith(
            expect.objectContaining({
              analysis: expect.objectContaining({ markdown: '# Analysis Report' }),
            }),
            expect.any(AbortSignal),
          );
          if (interruption === 'timeout') {
            await vi.advanceTimersByTimeAsync(TIMEOUT.ANALYSIS_TASK_COMPLETION_MS);
          } else {
            controller.abort();
          }
          await result;
          expect(context.historyStore.updateDynamicReport).not.toHaveBeenCalled();
        } finally {
          controller.abort();
          vi.useRealTimers();
        }
      },
    );

    it('does not mutate or save reanalysis cancelled while re-reading the history target', async () => {
      const original: HistoryItem = {
        id: 'history_read_gate',
        url: 'https://example.com/post',
        title: 'Original',
        platform: 'example.com',
        extractedAt: 1000,
        commentsCount: 0,
        comments: [],
        analysis: { markdown: '# Original', generatedAt: 1000, tokensUsed: 3 },
        analyzedAt: 1000,
      };
      const originalSnapshot = structuredClone(original);
      let enterRead!: () => void;
      let releaseRead!: (item: HistoryItem) => void;
      const entered = new Promise<void>((resolve) => {
        enterRead = resolve;
      });
      const readGate = new Promise<HistoryItem>((resolve) => {
        releaseRead = resolve;
      });
      const localContext = createMockContext({
        historyStore: {
          ...createMockContext().historyStore,
          getHistoryItem: vi
            .fn()
            .mockResolvedValueOnce(original)
            .mockImplementationOnce(() => {
              enterRead();
              return readGate;
            }),
        },
      } as unknown as Partial<HandlerContext>);
      await handleStartAnalysis(
        { type: 'START_ANALYSIS', payload: { comments: [], historyId: original.id } },
        localContext,
      );
      const executor = vi.mocked(localContext.taskManager.setExecutor).mock.calls[0][1];
      const controller = new AbortController();
      const task: Task = {
        id: 'task_analysis_123',
        type: 'analyze',
        status: 'running',
        url: original.url,
        platform: original.platform,
        progress: 0,
        startTime: Date.now(),
        tokensUsed: 0,
      };
      const running = executor(task, controller.signal);
      const rejected = expect(running).rejects.toMatchObject({ code: ErrorCode.TASK_CANCELLED });
      try {
        await entered;
        controller.abort();
        releaseRead(original);
        await rejected;
      } finally {
        releaseRead(original);
      }
      expect(original).toEqual(originalSnapshot);
      expect(localContext.historyStore.updateHistory).not.toHaveBeenCalled();
      expect(localContext.historyStore.createHistory).not.toHaveBeenCalled();
    });

    it.each(['create', 'update'] as const)(
      'passes the task signal into %s and preserves storage cancellation errors',
      async (operation) => {
        const history: HistoryItem = {
          id: 'history_signal',
          url: 'https://example.com/post',
          title: 'Post',
          platform: 'example.com',
          extractedAt: 1000,
          commentsCount: 0,
          comments: [],
        };
        const localContext = createMockContext();
        vi.mocked(localContext.historyStore.getHistoryItem).mockResolvedValue(history);
        const controller = new AbortController();
        let persistenceSignal: AbortSignal | undefined;
        const cancelledWrite = async (_item: HistoryItem, signal?: AbortSignal) => {
          persistenceSignal = signal;
          controller.abort();
          throw new ExtensionError(ErrorCode.TASK_CANCELLED, 'History write cancelled');
        };
        if (operation === 'create')
          vi.mocked(localContext.historyStore.createHistory).mockImplementation(cancelledWrite);
        else vi.mocked(localContext.historyStore.updateHistory).mockImplementation(cancelledWrite);
        await handleStartAnalysis(
          {
            type: 'START_ANALYSIS',
            payload: { comments: [], historyId: operation === 'update' ? history.id : undefined },
          },
          localContext,
        );
        const executor = vi.mocked(localContext.taskManager.setExecutor).mock.calls[0][1];
        const task: Task = {
          id: 'task_analysis_123',
          type: 'analyze',
          status: 'running',
          url: history.url,
          platform: history.platform,
          progress: 0,
          startTime: Date.now(),
          tokensUsed: 0,
        };
        await expect(executor(task, controller.signal)).rejects.toMatchObject({
          code: ErrorCode.TASK_CANCELLED,
          message: 'History write cancelled',
        });
        expect(persistenceSignal).toBe(
          vi.mocked(localContext.commentAnalyzer.analyzeComments).mock.calls[0][5],
        );
        expect(persistenceSignal?.aborted).toBe(true);
      },
    );

    it('keeps the saved Markdown when automatic HTML exceeds the context budget', async () => {
      vi.mocked(context.commentAnalyzer.generateDynamicHtml).mockRejectedValue(
        new ExtensionError(ErrorCode.INVALID_CONFIG, 'Dynamic report exceeds context', {}, false),
      );
      await handleStartAnalysis(
        {
          type: 'START_ANALYSIS',
          payload: { comments: [], metadata: { url: 'https://example.com/budget' } },
        },
        context,
      );
      const executor = vi.mocked(context.taskManager.setExecutor).mock.calls[0][1];
      await expect(
        executor(
          {
            id: 'task_analysis_123',
            type: 'analyze',
            status: 'running',
            url: 'https://example.com/budget',
            platform: 'example.com',
            startTime: 1000,
            progress: 0,
            tokensUsed: 0,
          },
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({ tokensUsed: 50 });
      expect(context.historyStore.createHistory).toHaveBeenCalledOnce();
      expect(context.historyStore.createHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          analysis: { markdown: '# Analysis Report', generatedAt: 2000, tokensUsed: 50 },
        }),
        expect.any(AbortSignal),
      );
      expect(context.historyStore.updateDynamicReport).not.toHaveBeenCalled();
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

    it('should throw task not found when a reanalysis target is deleted before update', async () => {
      const historyItem = {
        id: 'history_deleted_during_analysis',
        url: 'https://example.com/post',
        title: 'Post',
        platform: 'example.com',
        extractedAt: 1000,
        commentsCount: 1,
        comments: [],
      };
      const analysisResult = {
        markdown: '# Updated analysis',
        tokensUsed: 5,
        generatedAt: 2000,
      };
      const localContext = createMockContext({
        settingsStore: {
          getSettings: vi.fn().mockResolvedValue({
            aiModel: {},
            analyzerPromptTemplate: '',
            language: 'en-US',
            generateDynamicReport: false,
          }),
        },
        historyStore: {
          ...createMockContext().historyStore,
          getHistoryItem: vi.fn().mockResolvedValue(historyItem),
          updateHistory: vi.fn().mockResolvedValue(false),
        },
        commentAnalyzer: {
          analyzeComments: vi.fn().mockResolvedValue(analysisResult),
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
          historyId: historyItem.id,
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
          { id: 'task_123', url: historyItem.url, platform: historyItem.platform },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.TASK_NOT_FOUND,
        message: `History item not found: ${historyItem.id}`,
      });
      expect(localContext.historyStore.updateHistory).toHaveBeenCalledWith(
        expect.objectContaining({ id: historyItem.id, analysis: analysisResult }),
        expect.any(AbortSignal),
      );
      expect(localContext.historyStore.createHistory).not.toHaveBeenCalled();
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
      const requestSignal = new AbortController().signal;
      const callAI = vi.fn().mockResolvedValue({
        content: JSON.stringify([
          { username: 'user1', content: 'hello' },
          { username: 'user2', content: 'hi', timestamp: '2h ago' },
        ]),
        tokensUsed: 10,
      });
      const localContext = createMockContext({
        aiService: { callAI },
        requestSignal,
      } as unknown as Partial<HandlerContext>);

      const result = await handleAIExtractContent(message, localContext);

      expect(result.comments).toHaveLength(2);
      expect(callAI).toHaveBeenCalledWith(expect.objectContaining({ signal: requestSignal }));
      for (const comment of result.comments) {
        expect(comment.id).toBeTruthy();
        expect(comment.timestamp).toBeDefined();
        expect(comment.likes).toBe(0);
        expect(comment.replies).toEqual([]);
      }
      expect(result.comments[0].timestamp).toBe(ANALYSIS_FORMAT.UNKNOWN_TIMESTAMP);
      expect(result.comments[1].timestamp).toBe('2h ago');
    });

    it('returns an error instead of an empty success when a chunk request fails', async () => {
      const message = {
        type: 'AI_EXTRACT_CONTENT' as const,
        payload: { chunks: ['<div>chunk</div>'] },
      };
      const localContext = createMockContext({
        aiService: {
          callAI: vi.fn().mockRejectedValue(new Error('provider failed')),
        },
      } as unknown as Partial<HandlerContext>);

      const result = await handleAIExtractContent(message, localContext);

      expect(result).toEqual({ comments: [], error: 'provider failed' });
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
          updateHistory: vi.fn().mockResolvedValue(true),
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
      expect(localContext.historyStore.updateDynamicReport).toHaveBeenCalledWith(
        mockHistoryItem.id,
        {
          markdown: mockHistoryItem.analysis.markdown,
          generatedAt: mockHistoryItem.analysis.generatedAt,
        },
        {
          html: '<!DOCTYPE html><html><body>Dashboard</body></html>',
          tokensUsed: 50,
        },
        expect.any(AbortSignal),
      );
      expect(localContext.historyStore.updateHistory).not.toHaveBeenCalled();
      expect(localContext.historyStore.createHistory).not.toHaveBeenCalled();
    });

    it('should not recreate history deleted while a dynamic report is generated', async () => {
      const { handleGenerateDynamicReport } = await import('@/background/handlers/analysis');
      const historyItem = {
        id: 'hist_deleted_during_generation',
        url: 'https://example.com',
        title: 'Example',
        platform: 'example',
        extractedAt: 1000,
        commentsCount: 1,
        comments: [],
        analysis: {
          markdown: '# Analysis Markdown',
          tokensUsed: 100,
          generatedAt: 1000,
        },
      };
      let executorFn: any;
      const localContext = createMockContext({
        taskManager: {
          ...createMockContext().taskManager,
          setExecutor: vi.fn().mockImplementation((_taskId, fn) => {
            executorFn = fn;
          }),
        },
        historyStore: {
          ...createMockContext().historyStore,
          getHistoryItem: vi.fn().mockResolvedValue(historyItem),
          updateDynamicReport: vi.fn().mockResolvedValue(false),
        },
        commentAnalyzer: {
          generateDynamicHtml: vi.fn().mockResolvedValue({
            html: '<!DOCTYPE html><html><body>Dashboard</body></html>',
            tokensUsed: 50,
          }),
        },
      } as unknown as Partial<HandlerContext>);

      await handleGenerateDynamicReport(
        {
          type: 'GENERATE_DYNAMIC_REPORT',
          payload: { historyId: historyItem.id },
        },
        localContext,
      );

      await expect(
        executorFn({ id: 'task_dynamic_123' }, new AbortController().signal),
      ).rejects.toMatchObject({
        code: ErrorCode.TASK_NOT_FOUND,
        message: `History item not found: ${historyItem.id}`,
      });
      expect(localContext.historyStore.updateDynamicReport).toHaveBeenCalledOnce();
      expect(localContext.historyStore.updateHistory).not.toHaveBeenCalled();
      expect(localContext.historyStore.createHistory).not.toHaveBeenCalled();
    });
  });
});
