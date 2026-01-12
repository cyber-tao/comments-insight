import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  performanceMonitor,
  PerformanceMetrics,
  AggregatedMetrics,
} from '../src/utils/performance';

describe('PerformanceMonitor', () => {
  beforeEach(() => {
    performanceMonitor.clear();
    performanceMonitor.setEnabled(true);
    vi.clearAllMocks();
  });

  describe('setEnabled', () => {
    it('should enable monitoring', () => {
      performanceMonitor.setEnabled(true);
      performanceMonitor.measure('test', () => {
        expect(true).toBe(true);
      });

      const metrics = performanceMonitor.getMetrics();
      expect(metrics).toHaveLength(1);
    });

    it('should disable monitoring', () => {
      performanceMonitor.setEnabled(false);
      performanceMonitor.measure('test', () => {});

      const metrics = performanceMonitor.getMetrics();
      expect(metrics).toHaveLength(0);
    });
  });

  describe('measure', () => {
    it('should measure synchronous operation', () => {
      const result = performanceMonitor.measure('add', () => {
        return 1 + 1;
      });

      expect(result).toBe(2);

      const metrics = performanceMonitor.getMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0].operation).toBe('add');
      expect(metrics[0].duration).toBeGreaterThan(0);
    });

    it('should record metadata', () => {
      performanceMonitor.measure('fetch', () => {}, { url: 'https://example.com', count: 10 });

      const metrics = performanceMonitor.getMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0].metadata).toEqual({
        url: 'https://example.com',
        count: 10,
      });
    });

    it('should handle thrown errors', () => {
      expect(() => {
        performanceMonitor.measure('failing', () => {
          throw new Error('Test error');
        });
      }).toThrow('Test error');

      const metrics = performanceMonitor.getMetrics();
      expect(metrics).toHaveLength(1);
    });

    it('should measure zero-duration operations', () => {
      performanceMonitor.measure('instant', () => {
        return 42;
      });

      const metrics = performanceMonitor.getMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0].duration).toBeGreaterThanOrEqual(0);
    });

    it('should not measure when disabled', () => {
      performanceMonitor.setEnabled(false);

      performanceMonitor.measure('disabled', () => {
        return 'result';
      });

      const metrics = performanceMonitor.getMetrics();
      expect(metrics).toHaveLength(0);
    });
  });

  describe('measureAsync', () => {
    it('should measure async operation', async () => {
      const result = await performanceMonitor.measureAsync('async-op', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'async-result';
      });

      expect(result).toBe('async-result');

      const metrics = performanceMonitor.getMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0].operation).toBe('async-op');
      expect(metrics[0].duration).toBeGreaterThanOrEqual(10);
    });

    it('should record metadata for async operations', async () => {
      await performanceMonitor.measureAsync(
        'async-fetch',
        async () => {
          return 'data';
        },
        { endpoint: '/api/data' },
      );

      const metrics = performanceMonitor.getMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0].metadata).toEqual({
        endpoint: '/api/data',
      });
    });

    it('should handle async errors', async () => {
      await expect(
        performanceMonitor.measureAsync('async-fail', async () => {
          throw new Error('Async error');
        }),
      ).rejects.toThrow('Async error');

      const metrics = performanceMonitor.getMetrics();
      expect(metrics).toHaveLength(1);
    });

    it('should not measure async when disabled', async () => {
      performanceMonitor.setEnabled(false);

      await performanceMonitor.measureAsync('disabled-async', async () => {
        return 'result';
      });

      const metrics = performanceMonitor.getMetrics();
      expect(metrics).toHaveLength(0);
    });

    it('should handle zero-duration async operations', async () => {
      await performanceMonitor.measureAsync('instant-async', async () => {
        return Promise.resolve('quick');
      });

      const metrics = performanceMonitor.getMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0].duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getMetrics', () => {
    it('should return copy of metrics', () => {
      performanceMonitor.measure('op1', () => {});
      performanceMonitor.measure('op2', () => {});

      const metrics1 = performanceMonitor.getMetrics();
      const metrics2 = performanceMonitor.getMetrics();

      expect(metrics1).toHaveLength(2);
      expect(metrics2).toHaveLength(2);
      expect(metrics1).not.toBe(metrics2);
    });

    it('should return empty array initially', () => {
      const metrics = performanceMonitor.getMetrics();
      expect(metrics).toEqual([]);
    });

    it('should preserve order of operations', () => {
      performanceMonitor.measure('first', () => {});
      performanceMonitor.measure('second', () => {});
      performanceMonitor.measure('third', () => {});

      const metrics = performanceMonitor.getMetrics();
      expect(metrics[0].operation).toBe('first');
      expect(metrics[1].operation).toBe('second');
      expect(metrics[2].operation).toBe('third');
    });
  });

  describe('getAggregatedMetrics', () => {
    it('should aggregate metrics by operation', () => {
      performanceMonitor.measure('op', () => {});
      performanceMonitor.measure('op', () => {});
      performanceMonitor.measure('other', () => {});

      const aggregated = performanceMonitor.getAggregatedMetrics();

      expect(aggregated.length).toBeGreaterThanOrEqual(2);

      const opMetrics = aggregated.find((m) => m.operation === 'op');
      expect(opMetrics).toBeDefined();
      expect(opMetrics?.count).toBe(2);
      expect(opMetrics?.avgDuration).toBeGreaterThan(0);
      expect(opMetrics?.totalDuration).toBeGreaterThan(0);
    });

    it('should calculate min and max durations', () => {
      performanceMonitor.measure('op', () => {});
      performanceMonitor.measure('op', () => {});

      const aggregated = performanceMonitor.getAggregatedMetrics();
      const opMetrics = aggregated.find((m) => m.operation === 'op');

      expect(opMetrics?.minDuration).toBeGreaterThan(0);
      expect(opMetrics?.maxDuration).toBeGreaterThanOrEqual(opMetrics?.minDuration || 0);
    });

    it('should handle empty metrics', () => {
      const aggregated = performanceMonitor.getAggregatedMetrics();
      expect(aggregated).toEqual([]);
    });

    it('should calculate average correctly', () => {
      performanceMonitor.measure('avg', () => {});
      performanceMonitor.measure('avg', () => {});

      const aggregated = performanceMonitor.getAggregatedMetrics();
      const avgMetrics = aggregated.find((m) => m.operation === 'avg');

      expect(avgMetrics?.avgDuration).toBe(
        (avgMetrics?.totalDuration || 0) / (avgMetrics?.count || 1),
      );
    });

    it('should include timestamp in individual metrics', () => {
      const before = Date.now();
      performanceMonitor.measure('timed', () => {});
      const after = Date.now();

      const metrics = performanceMonitor.getMetrics();
      expect(metrics[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(metrics[0].timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('clear', () => {
    it('should clear all metrics', () => {
      performanceMonitor.measure('op1', () => {});
      performanceMonitor.measure('op2', () => {});

      expect(performanceMonitor.getMetrics()).toHaveLength(2);

      performanceMonitor.clear();

      expect(performanceMonitor.getMetrics()).toHaveLength(0);
    });
  });

  describe('logSummary', () => {
    it('should log summary without throwing', () => {
      performanceMonitor.measure('op1', () => {});
      performanceMonitor.measure('op2', () => {});

      expect(() => {
        performanceMonitor.logSummary();
      }).not.toThrow();
    });

    it('should log empty summary', () => {
      expect(() => {
        performanceMonitor.logSummary();
      }).not.toThrow();
    });
  });

  describe('metrics limit', () => {
    it('should limit metrics to max count', () => {
      for (let i = 0; i < 1050; i++) {
        performanceMonitor.measure(`op-${i}`, () => {});
      }

      const metrics = performanceMonitor.getMetrics();
      expect(metrics.length).toBeLessThanOrEqual(1000);
    });

    it('should keep recent metrics when limit exceeded', () => {
      for (let i = 0; i < 1005; i++) {
        performanceMonitor.measure(`op-${i}`, () => {});
      }

      const metrics = performanceMonitor.getMetrics();
      expect(metrics.length).toBe(1000);
      expect(metrics[0].operation).toBe('op-5');
      expect(metrics[999].operation).toBe('op-1004');
    });
  });

  describe('complex scenarios', () => {
    it('should handle mixed sync and async operations', async () => {
      performanceMonitor.measure('sync', () => {});
      await performanceMonitor.measureAsync('async', async () => {});
      performanceMonitor.measure('sync2', () => {});

      const metrics = performanceMonitor.getMetrics();
      expect(metrics).toHaveLength(3);
      expect(metrics[0].operation).toBe('sync');
      expect(metrics[1].operation).toBe('async');
      expect(metrics[2].operation).toBe('sync2');
    });

    it('should handle operations with same name but different metadata', () => {
      performanceMonitor.measure('fetch', () => {}, { url: 'url1' });
      performanceMonitor.measure('fetch', () => {}, { url: 'url2' });

      const aggregated = performanceMonitor.getAggregatedMetrics();
      const fetchMetrics = aggregated.find((m) => m.operation === 'fetch');

      expect(fetchMetrics?.count).toBe(2);
    });

    it('should track concurrent operations', async () => {
      await Promise.all([
        performanceMonitor.measureAsync('concurrent-1', async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }),
        performanceMonitor.measureAsync('concurrent-2', async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }),
      ]);

      const metrics = performanceMonitor.getMetrics();
      expect(metrics).toHaveLength(2);
    });
  });

  describe('edge cases', () => {
    it('should handle undefined metadata', () => {
      performanceMonitor.measure('no-meta', () => {});

      const metrics = performanceMonitor.getMetrics();
      expect(metrics[0].metadata).toBeUndefined();
    });

    it('should handle empty metadata object', () => {
      performanceMonitor.measure('empty-meta', () => {}, {});

      const metrics = performanceMonitor.getMetrics();
      expect(metrics[0].metadata).toEqual({});
    });

    it('should handle complex metadata objects', () => {
      const complexMetadata = {
        nested: { value: 42 },
        array: [1, 2, 3],
        string: 'test',
        number: 123,
        boolean: true,
        null: null,
      };

      performanceMonitor.measure('complex', () => {}, complexMetadata);

      const metrics = performanceMonitor.getMetrics();
      expect(metrics[0].metadata).toEqual(complexMetadata);
    });

    it('should handle operation names with special characters', () => {
      performanceMonitor.measure('op-with-dash', () => {});
      performanceMonitor.measure('op_with_underscore', () => {});
      performanceMonitor.measure('op.with.dots', () => {});

      const metrics = performanceMonitor.getMetrics();
      expect(metrics).toHaveLength(3);
    });

    it('should handle very long operation names', () => {
      const longName = 'a'.repeat(1000);
      performanceMonitor.measure(longName, () => {});

      const metrics = performanceMonitor.getMetrics();
      expect(metrics[0].operation).toBe(longName);
    });
  });
});
