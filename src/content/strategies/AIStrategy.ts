import { ExtractionStrategy } from './ExtractionStrategy';
import { Comment, Platform } from '../../types';
import { CommentExtractorSelector } from '../CommentExtractorSelector';
import { Logger } from '../../utils/logger';
import { EXTRACTION_PROGRESS } from '@/config/constants';

export class AIStrategy implements ExtractionStrategy {
  constructor(private selectorExtractor: CommentExtractorSelector) {}

  async execute(
    maxComments: number,
    platform: Platform,
    onProgress?: (progress: number, message: string) => void,
  ): Promise<Comment[]> {
    Logger.info('[AIStrategy] Executing AI discovery strategy');

    onProgress?.(EXTRACTION_PROGRESS.AI_ANALYZING, 'analyzing');

    const comments = await this.selectorExtractor.extractWithDiscovery(
      maxComments,
      platform,
      (stage: string, count: number) => {
        const progress =
          count < 0
            ? EXTRACTION_PROGRESS.UNKNOWN_COUNT
            : Math.min(
                EXTRACTION_PROGRESS.MAX,
                EXTRACTION_PROGRESS.MIN +
                  Math.floor((count / maxComments) * EXTRACTION_PROGRESS.RANGE),
              );
        onProgress?.(progress, `${stage}:${count}:${maxComments}`);
      },
    );

    return comments;
  }
}
