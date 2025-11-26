import { ExtractionStrategy } from './ExtractionStrategy';
import { Comment, Platform } from '../../types';
import { CommentExtractorSelector } from '../CommentExtractorSelector';
import { Logger } from '../../utils/logger';

export class AIStrategy implements ExtractionStrategy {
  constructor(private selectorExtractor: CommentExtractorSelector) {}

  async execute(
    maxComments: number,
    platform: Platform,
    onProgress?: (progress: number, message: string) => void,
  ): Promise<Comment[]> {
    Logger.info('[AIStrategy] Executing AI discovery strategy');

    onProgress?.(10, 'analyzing');

    const comments = await this.selectorExtractor.extractWithDiscovery(
      maxComments,
      platform,
      (stage: string, count: number) => {
        const progress = count < 0 ? 15 : Math.min(95, 20 + Math.floor((count / maxComments) * 75));
        onProgress?.(progress, `${stage}:${count}:${maxComments}`);
      },
    );

    return comments;
  }
}
