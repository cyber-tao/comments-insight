import { Logger } from './logger';
import { PERFORMANCE, MEMORY } from '@/config/constants';

export interface PerformanceMetrics {
  operation: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface AggregatedMetrics {
  operation: string;
  count: number;
  totalDuration: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
}

class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = [];
  private enabled = true;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  measure<T>(operation: string, fn: () => T, metadata?: Record<string, unknown>): T {
    if (!this.enabled) {
      return fn();
    }

    const start = performance.now();
    try {
      return fn();
    } finally {
      const duration = performance.now() - start;
      this.record(operation, duration, metadata);
    }
  }

  async measureAsync<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>,
  ): Promise<T> {
    if (!this.enabled) {
      return fn();
    }

    const start = performance.now();
    try {
      return await fn();
    } finally {
      const duration = performance.now() - start;
      this.record(operation, duration, metadata);
    }
  }

  private record(operation: string, duration: number, metadata?: Record<string, unknown>): void {
    const metric: PerformanceMetrics = {
      operation,
      duration,
      timestamp: Date.now(),
      metadata,
    };

    this.metrics.push(metric);

    if (this.metrics.length > PERFORMANCE.MAX_METRICS_COUNT) {
      this.metrics = this.metrics.slice(-PERFORMANCE.MAX_METRICS_COUNT);
    }

    if (duration > PERFORMANCE.SLOW_OPERATION_THRESHOLD_MS) {
      const metaStr = metadata ? ` | ${JSON.stringify(metadata)}` : '';
      Logger.warn(
        `[Performance] Slow operation: ${operation} took ${duration.toFixed(2)}ms${metaStr}`,
      );
    }
  }

  getMetrics(): PerformanceMetrics[] {
    return [...this.metrics];
  }

  getAggregatedMetrics(): AggregatedMetrics[] {
    const groups = new Map<string, PerformanceMetrics[]>();

    for (const metric of this.metrics) {
      const group = groups.get(metric.operation) || [];
      group.push(metric);
      groups.set(metric.operation, group);
    }

    const aggregated: AggregatedMetrics[] = [];

    for (const [operation, metrics] of groups) {
      const durations = metrics.map((m) => m.duration);
      const totalDuration = durations.reduce((a, b) => a + b, 0);
      aggregated.push({
        operation,
        count: metrics.length,
        totalDuration: totalDuration,
        avgDuration: totalDuration / durations.length,
        minDuration: Math.min(...durations),
        maxDuration: Math.max(...durations),
      });
    }

    return aggregated.sort((a, b) => b.totalDuration - a.totalDuration);
  }

  logSummary(): void {
    const aggregated = this.getAggregatedMetrics();
    Logger.info('[Performance] Summary', {
      totalOperations: this.metrics.length,
      uniqueOperations: aggregated.length,
    });

    for (const metric of aggregated) {
      Logger.info(`[Performance] ${metric.operation}`, {
        count: metric.count,
        avg: `${metric.avgDuration.toFixed(2)}ms`,
        min: `${metric.minDuration.toFixed(2)}ms`,
        max: `${metric.maxDuration.toFixed(2)}ms`,
        total: `${metric.totalDuration.toFixed(2)}ms`,
      });
    }
  }

  clear(): void {
    this.metrics = [];
  }
}

export const performanceMonitor = new PerformanceMonitor();

/**
 * Memory monitoring utilities (development only)
 */
class MemoryMonitor {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private enabled = false;

  /**
   * Start monitoring memory usage in development mode
   * @param intervalMs - Check interval in milliseconds
   */
  start(intervalMs: number = PERFORMANCE.MEMORY_CHECK_INTERVAL_MS): void {
    // Only enable in development mode
    if (process.env.NODE_ENV !== 'development') {
      Logger.debug('[Memory] Skipping memory monitor (not in development mode)');
      return;
    }

    if (this.enabled) {
      Logger.warn('[Memory] Memory monitor already running');
      return;
    }

    // Check if performance.memory is available (Chrome-specific)
    if (typeof performance === 'undefined' || !('memory' in performance)) {
      Logger.warn('[Memory] performance.memory not available in this environment');
      return;
    }

    this.enabled = true;
    Logger.info('[Memory] Starting memory monitor', { intervalMs });

    // Log initial memory state
    this.logMemoryUsage();

    // Set up periodic monitoring
    this.intervalId = setInterval(() => {
      this.logMemoryUsage();
    }, intervalMs);
  }

  /**
   * Stop monitoring memory usage
   */
  stop(): void {
    if (!this.enabled) {
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.enabled = false;
    Logger.info('[Memory] Memory monitor stopped');
  }

  /**
   * Log current memory usage
   */
  private logMemoryUsage(): void {
    if (typeof performance === 'undefined' || !('memory' in performance)) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const memory = (performance as any).memory;
    const usedMB = Math.round(memory.usedJSHeapSize / MEMORY.BYTES_PER_MB);
    const totalMB = Math.round(memory.totalJSHeapSize / MEMORY.BYTES_PER_MB);
    const limitMB = Math.round(memory.jsHeapSizeLimit / MEMORY.BYTES_PER_MB);
    const usagePercent = ((usedMB / limitMB) * 100).toFixed(1);

    Logger.debug('[Memory] Usage', {
      used: `${usedMB} MB`,
      total: `${totalMB} MB`,
      limit: `${limitMB} MB`,
      usage: `${usagePercent}%`,
    });

    // Warn if memory usage is high
    if (parseFloat(usagePercent) > MEMORY.HIGH_USAGE_THRESHOLD_PERCENT) {
      Logger.warn('[Memory] High memory usage detected!', {
        used: `${usedMB} MB`,
        limit: `${limitMB} MB`,
        usage: `${usagePercent}%`,
      });
    }
  }

  /**
   * Get current memory snapshot
   */
  getSnapshot(): { used: number; total: number; limit: number } | null {
    if (typeof performance === 'undefined' || !('memory' in performance)) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const memory = (performance as any).memory;
    return {
      used: memory.usedJSHeapSize,
      total: memory.totalJSHeapSize,
      limit: memory.jsHeapSizeLimit,
    };
  }
}

export const memoryMonitor = new MemoryMonitor();

// Auto-start in development mode
if (process.env.NODE_ENV === 'development') {
  // Start memory monitor after a short delay to ensure initialization
  setTimeout(() => {
    memoryMonitor.start(PERFORMANCE.MEMORY_CHECK_INTERVAL_MS);
  }, PERFORMANCE.MEMORY_START_DELAY_MS);
}
