import { ExtractionStrategy } from './ExtractionStrategy';
import { Comment, Platform } from '../../types';
import { CommentExtractorSelector } from '../CommentExtractorSelector';
import { ScraperConfig } from '../../types/scraper';
import { Logger } from '../../utils/logger';
import { EXTRACTION_PROGRESS } from '@/config/constants';

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

    onProgress?.(EXTRACTION_PROGRESS.CONFIG_ANALYZING, 'analyzing');

    const comments = await this.selectorExtractor.extractWithConfig(
      this.config.selectors,
      this.config.scrollConfig,
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
