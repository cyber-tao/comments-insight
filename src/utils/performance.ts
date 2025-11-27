import { Logger } from './logger';
import { PERFORMANCE } from '@/config/constants';

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
      aggregated.push({
        operation,
        count: metrics.length,
        totalDuration: durations.reduce((a, b) => a + b, 0),
        avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
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
