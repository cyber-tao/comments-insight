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
  ): Promise<Comment[]>;

  /**
   * 清理资源
   * 可选方法，用于释放策略持有的资源
   */
  cleanup?(): void;
}
