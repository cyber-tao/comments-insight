import { Comment, Platform } from '../../types';

export interface ExtractionStrategy {
  execute(
    maxComments: number,
    platform: Platform,
    onProgress?: (progress: number, message: string) => void,
  ): Promise<Comment[]>;
}
