import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataNormalizer } from '../src/background/ai/DataNormalizer';
import { PromptBuilder } from '../src/background/ai/PromptBuilder';
import { TimestampNormalizer } from '../src/background/ai/TimestampNormalizer';
import type { AIService } from '../src/background/AIService';
import { Logger } from '../src/utils/logger';
import { mockAIConfig, mockComment } from './fixtures';

vi.mock('../src/utils/logger', () => ({
  Logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Timestamp normalization helpers & TimestampNormalizer', () => {
  let aiServiceMock: { callAI: ReturnType<typeof vi.fn> };
  let normalizer: TimestampNormalizer;

  beforeEach(() => {
    vi.clearAllMocks();
    aiServiceMock = {
      callAI: vi.fn(),
    };
    normalizer = new TimestampNormalizer(aiServiceMock as unknown as AIService);
  });

  describe('PromptBuilder timestamp helpers', () => {
    it('collects and applies timestamps across nested replies by path', () => {
      const comments = [
        mockComment({
          id: 'c1',
          timestamp: '2 hours ago',
          replies: [
            mockComment({ id: 'c1-r1', timestamp: '1 hour ago', replies: [] }),
            mockComment({ id: 'c1-r2', timestamp: '30 mins ago', replies: [] }),
          ],
        }),
        mockComment({ id: 'c2', timestamp: 'yesterday', replies: [] }),
      ];

      const items = PromptBuilder.collectTimestampItems(comments);
      expect(items).toEqual([
        { path: '0', timestamp: '2 hours ago' },
        { path: '0.0', timestamp: '1 hour ago' },
        { path: '0.1', timestamp: '30 mins ago' },
        { path: '1', timestamp: 'yesterday' },
      ]);

      PromptBuilder.applyTimestampNormalization(
        comments,
        new Map([
          ['0', '2026-03-06T10:00'],
          ['0.1', '2026-03-06T11:30'],
          ['1', '2026-03-05T12:00'],
        ]),
      );

      expect(comments[0].timestamp).toBe('2026-03-06T10:00');
      expect(comments[0].replies[0].timestamp).toBe('1 hour ago');
      expect(comments[0].replies[1].timestamp).toBe('2026-03-06T11:30');
      expect(comments[1].timestamp).toBe('2026-03-05T12:00');
    });
  });

  describe('DataNormalizer timestamp helpers', () => {
    it('formats local dates to YYYY-MM-DDTHH:mm and normalizes parseable timestamps', () => {
      const date = new Date(2026, 2, 6, 9, 5, 42);
      expect(DataNormalizer.formatLocalIsoMinute(date)).toBe('2026-03-06T09:05');
      expect(DataNormalizer.normalizeTimestampToMinute('2026-03-06T09:05:42')).toBe(
        '2026-03-06T09:05',
      );
      expect(DataNormalizer.normalizeTimestampToMinute('not-a-date')).toBeNull();
    });

    it('parses fenced or plain JSON arrays and rejects non-arrays or malformed JSON', () => {
      const fenced = '```json\n[{"path":"0","timestamp":"2026-03-06T10:00"},{"path":1}]\n```';
      expect(DataNormalizer.parseTimestampNormalizationResponse(fenced)).toEqual([
        { path: '0', timestamp: '2026-03-06T10:00' },
      ]);

      expect(
        DataNormalizer.parseTimestampNormalizationResponse('{"items":[{"path":"0"}]}'),
      ).toBeNull();
      expect(DataNormalizer.parseTimestampNormalizationResponse('{bad json')).toBeNull();
      expect(Logger.warn).toHaveBeenCalled();
    });
  });

  describe('normalizeCommentTimestamps', () => {
    it('returns early when comments array is empty', async () => {
      const result = await normalizer.normalizeCommentTimestamps(
        [],
        mockAIConfig(),
        '2026-03-06T12:00',
      );

      expect(result).toEqual([]);
      expect(aiServiceMock.callAI).not.toHaveBeenCalled();
    });

    it('normalizes comment and reply timestamps in batches based on context window', async () => {
      const comments = [
        mockComment({
          id: 'c1',
          timestamp: '2 hours ago',
          replies: [mockComment({ id: 'c1-r1', timestamp: '1 hour ago', replies: [] })],
        }),
        mockComment({ id: 'c2', timestamp: 'yesterday', replies: [] }),
      ];

      aiServiceMock.callAI.mockResolvedValue({
        content: JSON.stringify([
          { path: '0', timestamp: '2026-03-06T10:00:00' },
          { path: '0.0', timestamp: '2026-03-06T11:00:00' },
          { path: '1', timestamp: '2026-03-05T12:00:00' },
        ]),
      });

      const result = await normalizer.normalizeCommentTimestamps(
        comments,
        mockAIConfig({ contextWindowSize: 128000, maxOutputTokens: 4000 }),
        '2026-03-06T12:00',
      );

      expect(aiServiceMock.callAI).toHaveBeenCalledTimes(1);
      expect(result[0].timestamp).toBe('2026-03-06T10:00');
      expect(result[0].replies[0].timestamp).toBe('2026-03-06T11:00');
      expect(result[1].timestamp).toBe('2026-03-05T12:00');
    });

    it('logs a warning on non-abort errors and keeps original timestamps', async () => {
      const comments = [mockComment({ id: 'c1', timestamp: '2 hours ago' })];
      aiServiceMock.callAI.mockRejectedValue(new Error('network error'));

      const result = await normalizer.normalizeCommentTimestamps(
        comments,
        mockAIConfig(),
        '2026-03-06T12:00',
      );

      expect(result[0].timestamp).toBe('2 hours ago');
      expect(Logger.warn).toHaveBeenCalledWith(
        '[TimestampNormalizer] Timestamp normalization failed',
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });

    it('rethrows errors when the signal is aborted', async () => {
      const comments = [mockComment({ id: 'c1', timestamp: '2 hours ago' })];
      const controller = new AbortController();
      controller.abort();
      aiServiceMock.callAI.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

      await expect(
        normalizer.normalizeCommentTimestamps(
          comments,
          mockAIConfig(),
          '2026-03-06T12:00',
          undefined,
          controller.signal,
        ),
      ).rejects.toThrow('Aborted');
    });
  });

  describe('normalizeSingleTimestamp', () => {
    it('returns undefined when input timestamp is undefined', async () => {
      const result = await normalizer.normalizeSingleTimestamp(
        undefined,
        mockAIConfig(),
        '2026-03-06T12:00',
      );

      expect(result).toBeUndefined();
      expect(aiServiceMock.callAI).not.toHaveBeenCalled();
    });

    it('returns normalized timestamp on valid path "0" response and falls back otherwise', async () => {
      aiServiceMock.callAI.mockResolvedValueOnce({
        content: '[{"path":"0","timestamp":"2026-03-06T09:45:00"}]',
      });
      await expect(
        normalizer.normalizeSingleTimestamp('3 hours ago', mockAIConfig(), '2026-03-06T12:00'),
      ).resolves.toBe('2026-03-06T09:45');

      aiServiceMock.callAI.mockResolvedValueOnce({
        content: '[{"path":"1","timestamp":"2026-03-06T09:45:00"}]',
      });
      await expect(
        normalizer.normalizeSingleTimestamp('3 hours ago', mockAIConfig(), '2026-03-06T12:00'),
      ).resolves.toBe('3 hours ago');

      aiServiceMock.callAI.mockRejectedValueOnce(new Error('timeout'));
      await expect(
        normalizer.normalizeSingleTimestamp('3 hours ago', mockAIConfig(), '2026-03-06T12:00'),
      ).resolves.toBe('3 hours ago');
      expect(Logger.warn).toHaveBeenCalled();
    });

    it('rethrows single timestamp errors when signal is aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      aiServiceMock.callAI.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

      await expect(
        normalizer.normalizeSingleTimestamp(
          '3 hours ago',
          mockAIConfig(),
          '2026-03-06T12:00',
          undefined,
          controller.signal,
        ),
      ).rejects.toThrow('Aborted');
    });
  });
});
