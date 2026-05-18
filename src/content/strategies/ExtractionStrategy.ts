import { Comment, Platform, ProgressStage } from '../../types';

/** Progress callback with optional detailed stage information */
export type ProgressCallback = (
  progress: number,
  message: string,
  stage?: ProgressStage,
  current?: number,
  total?: number,
) => void;

export interface ExtractionStrategy {
  execute(
    maxComments: number,
    platform: Platform,
    onProgress?: ProgressCallback,
    signal?: AbortSignal,
  ): Promise<Comment[]>;

  /**
   * Clean up resources
   * Optional method to release resources held by the strategy
   */
  cleanup?(): void;
}
