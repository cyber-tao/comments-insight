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

    onProgress?.(20, 'Analyzing page structure...');

    const comments = await this.selectorExtractor.extractWithDiscovery(
      maxComments,
      platform,
      (message: string, count: number) => {
        const progress = Math.min(95, Math.floor((count / maxComments) * 100));
        onProgress?.(progress, `${message} (${count})`);
      },
    );

    return comments;
  }
}
