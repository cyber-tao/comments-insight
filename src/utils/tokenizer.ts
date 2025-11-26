import { TOKENIZER } from '@/config/constants';

export const Tokenizer = {
  estimateTokens(text: string): number {
    if (!text) return 0;

    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length === 0) return 0;

    const cjkRegex = /[\u4e00-\u9fa5\u3040-\u30ff\u31f0-\u31ff\uac00-\ud7af]/g;
    const cjkMatches = normalized.match(cjkRegex);
    const cjkCount = cjkMatches ? cjkMatches.length : 0;

    const nonCjkText = normalized.replace(cjkRegex, ' ');

    const words = nonCjkText.split(/\s+/).filter((w) => w.length > 0);
    const wordCount = words.length;

    const punctRegex = /[!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~]/g;
    const punctMatches = nonCjkText.match(punctRegex);
    const punctCount = punctMatches ? punctMatches.length : 0;

    const cjkTokens = cjkCount * TOKENIZER.CJK_TOKEN_RATIO;
    const wordTokens = wordCount * TOKENIZER.WORD_TOKEN_RATIO;
    const punctTokens = punctCount * TOKENIZER.PUNCT_TOKEN_RATIO;

    const total = Math.ceil(cjkTokens + wordTokens + punctTokens);

    return Math.max(1, total);
  },

  chunkText(
    text: string,
    maxTokens: number,
    reserveRatio = TOKENIZER.RESERVE_RATIO,
    minChunkSize = TOKENIZER.MIN_CHUNK_SIZE,
  ): string[] {
    const limit = Math.max(minChunkSize, Math.floor(maxTokens * (1 - reserveRatio)));
    const parts: string[] = [];
    let current: string[] = [];
    let tokens = 0;

    const lines = text.split(/(?<=>)\n|\n/);

    for (const line of lines) {
      const t = this.estimateTokens(line) + 1;
      if (tokens + t > limit && current.length > 0) {
        parts.push(current.join('\n'));
        current = [line];
        tokens = t;
      } else {
        current.push(line);
        tokens += t;
      }
    }
    if (current.length > 0) parts.push(current.join('\n'));
    return parts.length > 0 ? parts : [text];
  },
};