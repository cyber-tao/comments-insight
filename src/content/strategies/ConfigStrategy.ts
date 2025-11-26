import { ExtractionStrategy } from './ExtractionStrategy';
import { Comment, Platform } from '../../types';
import { CommentExtractorSelector } from '../CommentExtractorSelector';
import { ScraperConfig } from '../../types/scraper';
import { Logger } from '../../utils/logger';

export class ConfigStrategy implements ExtractionStrategy {
  constructor(
    private selectorExtractor: CommentExtractorSelector,
    private config: ScraperConfig,
  ) {}

  async execute(
    maxComments: number,
    platform: Platform,
    onProgress?: (progress: number, message: string) => void,
  ): Promise<Comment[]> {
    Logger.info('[ConfigStrategy] Executing strategy with config', {
      name: this.config.name,
    });

    if (!this.config.selectors) {
        throw new Error('Config missing selectors');
    }

    onProgress?.(15, 'analyzing');

    const comments = await this.selectorExtractor.extractWithConfig(
      this.config.selectors,
      this.config.scrollConfig,
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
