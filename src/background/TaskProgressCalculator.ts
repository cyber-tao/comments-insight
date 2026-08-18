import { ProgressStage, Task } from '@/types';
import { AI as AI_CONST, TASK, TIMEOUT } from '@/config/constants';

export interface ProgressCalculationInput {
  taskType: Task['type'];
  stage: ProgressStage;
  current: number;
  total: number;
  elapsed: number;
}

export interface ProgressCalculationResult {
  progressPercent: number;
  estimatedTimeRemaining: number;
}

/**
 * Pure calculator for detailed task progress → clamped percent + ETA seconds.
 * Extracted from TaskManager.updateDetailedProgress so it can be unit-tested
 * in isolation and reused if other schedulers need the same mapping.
 */
export const TaskProgressCalculator = {
  calculate(input: ProgressCalculationInput): ProgressCalculationResult {
    const { taskType, stage, current, total, elapsed } = input;
    const RANGES = TASK.PROGRESS_RANGES;
    let progressPercent = 0;

    if (total > 0 && current >= 0) {
      const stageProgress = current / total;
      switch (stage) {
        case 'initializing':
          progressPercent = RANGES.INITIALIZING.START + stageProgress * RANGES.INITIALIZING.RANGE;
          break;
        case 'detecting':
          progressPercent = RANGES.DETECTING.START + stageProgress * RANGES.DETECTING.RANGE;
          break;
        case 'analyzing':
          progressPercent =
            taskType === 'analyze'
              ? AI_CONST.ANALYSIS_TASK_PROGRESS_START +
                stageProgress * AI_CONST.ANALYSIS_TASK_PROGRESS_RANGE
              : RANGES.ANALYZING.START + stageProgress * RANGES.ANALYZING.RANGE;
          break;
        case 'extracting':
          progressPercent = RANGES.EXTRACTING.START + stageProgress * RANGES.EXTRACTING.RANGE;
          break;
        case 'scrolling':
          // Extract tasks alternate scroll/extract every loop iteration with
          // the same comment count; sharing the extracting range keeps the
          // percent monotonic while the stage label still reflects scrolling.
          progressPercent =
            taskType === 'extract'
              ? RANGES.EXTRACTING.START + stageProgress * RANGES.EXTRACTING.RANGE
              : RANGES.SCROLLING.START + stageProgress * RANGES.SCROLLING.RANGE;
          break;
        case 'expanding':
          progressPercent = RANGES.EXPANDING.START + stageProgress * RANGES.EXPANDING.RANGE;
          break;
        case 'validating':
          progressPercent = RANGES.VALIDATING.START + stageProgress * RANGES.VALIDATING.RANGE;
          break;
        case 'normalizing':
          progressPercent = RANGES.NORMALIZING.START + stageProgress * RANGES.NORMALIZING.RANGE;
          break;
        case 'generating':
          progressPercent = RANGES.GENERATING.START + stageProgress * RANGES.GENERATING.RANGE;
          break;
        case 'complete':
          progressPercent = RANGES.COMPLETE;
          break;
        default:
          progressPercent = (current / total) * RANGES.COMPLETE;
      }
    }

    let estimatedTimeRemaining = -1;
    if (
      progressPercent > TASK.PROGRESS_ESTIMATE_MIN_PERCENT &&
      progressPercent < RANGES.COMPLETE &&
      elapsed > 0
    ) {
      const rate = progressPercent / elapsed;
      if (Number.isFinite(rate) && rate > 0) {
        const remaining = (100 - progressPercent) / rate;
        if (Number.isFinite(remaining) && remaining >= 0) {
          estimatedTimeRemaining = Math.ceil(remaining / TIMEOUT.MS_PER_SEC);
        }
      }
    }

    return {
      progressPercent: Math.min(100, Math.max(0, progressPercent)),
      estimatedTimeRemaining,
    };
  },
};
