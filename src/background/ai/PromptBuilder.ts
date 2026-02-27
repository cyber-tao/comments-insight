import { Comment, AnalysisResult } from '../../types';
import { buildAnalysisPrompt } from '../../utils/prompts';
import { Tokenizer } from '../../utils/tokenizer';
import { DataNormalizer } from './DataNormalizer';
import {
    ANALYSIS_FORMAT,
    LANGUAGES,
    DEFAULTS,
    AI as AI_CONST,
    TIME_NORMALIZATION,
} from '@/config/constants';

export class PromptBuilder {
    static mergeAnalysisResults(results: AnalysisResult[]): AnalysisResult {
        const mergedMarkdown = results
            .map((r, i) => `## Batch ${i + 1}\n\n${r.markdown}`)
            .join('\n\n---\n\n');

        const totalComments = results.reduce((sum, r) => sum + r.summary.totalComments, 0);
        const totalTokens = results.reduce((sum, r) => sum + r.tokensUsed, 0);

        const sentimentDistribution = {
            positive: 0,
            negative: 0,
            neutral: 0,
        };

        results.forEach((r) => {
            sentimentDistribution.positive += r.summary.sentimentDistribution.positive;
            sentimentDistribution.negative += r.summary.sentimentDistribution.negative;
            sentimentDistribution.neutral += r.summary.sentimentDistribution.neutral;
        });

        const total =
            sentimentDistribution.positive +
            sentimentDistribution.negative +
            sentimentDistribution.neutral;
        if (total > 0) {
            sentimentDistribution.positive = Math.round((sentimentDistribution.positive / total) * 100);
            sentimentDistribution.negative = Math.round((sentimentDistribution.negative / total) * 100);
            sentimentDistribution.neutral =
                100 - sentimentDistribution.positive - sentimentDistribution.negative;
        }

        const allHotComments = results.flatMap((r) => r.summary.hotComments);
        const hotComments = allHotComments.slice(0, AI_CONST.HOT_COMMENTS_LIMIT);

        const keyInsights = results.flatMap((r) => r.summary.keyInsights);

        return {
            markdown: mergedMarkdown,
            summary: {
                totalComments,
                sentimentDistribution,
                hotComments,
                keyInsights,
            },
            tokensUsed: totalTokens,
            generatedAt: Date.now(),
        };
    }

    static buildAnalysisPromptWrapper(
        commentsData: string,
        template: string,
        metadata?: {
            platform?: string;
            url?: string;
            title?: string;
            datetime?: string;
            videoTime?: string;
            postContent?: string;
        },
        totalComments: number = 0,
        language: string = LANGUAGES.DEFAULT,
    ): string {
        return buildAnalysisPrompt(commentsData, template, {
            datetime: new Date().toISOString(),
            videoTime: metadata?.videoTime || 'N/A',
            platform: metadata?.platform || 'Unknown Platform',
            url: metadata?.url || 'N/A',
            title: metadata?.title || 'Untitled',
            postContent: metadata?.postContent || 'N/A',
            totalComments,
            language,
        });
    }

    static extractSummaryFromMarkdown(markdown: string, comments: Comment[]): AnalysisResult['summary'] {
        const parsePercent = (re: RegExp): number | undefined => {
            const match = markdown.match(re);
            return match ? parseInt(match[1]) : undefined;
        };

        const positive =
            parsePercent(/\|\s*Positive\s*\|\s*(\d+)%/i) ?? parsePercent(/Positive:\s*(\d+)%/i);
        const negative =
            parsePercent(/\|\s*Negative\s*\|\s*(\d+)%/i) ?? parsePercent(/Negative:\s*(\d+)%/i);
        const neutral =
            parsePercent(/\|\s*Neutral\s*\|\s*(\d+)%/i) ?? parsePercent(/Neutral:\s*(\d+)%/i);

        return {
            totalComments: comments.length,
            sentimentDistribution: {
                positive: typeof positive === 'number' ? positive : DEFAULTS.SENTIMENT_POSITIVE,
                negative: typeof negative === 'number' ? negative : DEFAULTS.SENTIMENT_NEGATIVE,
                neutral: typeof neutral === 'number' ? neutral : DEFAULTS.SENTIMENT_NEUTRAL,
            },
            hotComments: comments.slice(0, DEFAULTS.HOT_COMMENTS_PREVIEW),
            keyInsights: [],
        };
    }

    static serializeCommentsDense(comments: Comment[]): { text: string; total: number } {
        const lines: string[] = [ANALYSIS_FORMAT.COMMENT_HEADER];
        let total = 0;

        const traverse = (items: Comment[], depth: number) => {
            for (const comment of items) {
                lines.push(this.formatCommentLine(comment, depth));
                total += 1;
                if (Array.isArray(comment.replies) && comment.replies.length > 0) {
                    traverse(comment.replies, depth + 1);
                }
            }
        };

        traverse(comments, 0);

        return {
            text: lines.join('\n'),
            total,
        };
    }

    static formatCommentLine(comment: Comment, depth: number): string {
        const prefix = depth > 0 ? ANALYSIS_FORMAT.REPLY_PREFIX.repeat(depth) : '';
        const username = DataNormalizer.normalizeTextValue(comment.username, ANALYSIS_FORMAT.UNKNOWN_USERNAME);
        const timestamp = DataNormalizer.normalizeTextValue(comment.timestamp, ANALYSIS_FORMAT.UNKNOWN_TIMESTAMP);
        const likes = DataNormalizer.formatLikesValue(comment.likes);
        const content = DataNormalizer.normalizeTextValue(comment.content, ANALYSIS_FORMAT.UNKNOWN_CONTENT);

        return [`${prefix}${username}`, timestamp, likes, content].join(
            ANALYSIS_FORMAT.FIELD_SEPARATOR,
        );
    }

    static estimateTokensForComment(comment: Comment, depth: number = 0): number {
        let tokens = Tokenizer.estimateTokens(this.formatCommentLine(comment, depth));
        if (Array.isArray(comment.replies)) {
            for (const reply of comment.replies) {
                tokens += this.estimateTokensForComment(reply, depth + 1);
            }
        }
        return tokens;
    }

    static collectTimestampItems(
        comments: Comment[],
        parentPath: string = '',
        items: Array<{ path: string; timestamp: string }> = [],
    ): Array<{ path: string; timestamp: string }> {
        comments.forEach((comment, index) => {
            const path = parentPath
                ? `${parentPath}${TIME_NORMALIZATION.PATH_SEPARATOR}${index}`
                : `${index}`;
            items.push({ path, timestamp: comment.timestamp });
            if (comment.replies?.length) {
                this.collectTimestampItems(comment.replies, path, items);
            }
        });
        return items;
    }

    static applyTimestampNormalization(
        comments: Comment[],
        normalizedMap: Map<string, string>,
        parentPath: string = '',
    ): void {
        comments.forEach((comment, index) => {
            const path = parentPath
                ? `${parentPath}${TIME_NORMALIZATION.PATH_SEPARATOR}${index}`
                : `${index}`;
            const normalized = normalizedMap.get(path);
            if (normalized) {
                comment.timestamp = normalized;
            }
            if (comment.replies?.length) {
                this.applyTimestampNormalization(comment.replies, normalizedMap, path);
            }
        });
    }
}
