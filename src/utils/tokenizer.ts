/**
 * Tokenizer utilities for estimating token usage
 */

export const Tokenizer = {
  /**
   * Estimate the number of tokens in a text string
   * Optimized for mixed English and CJK content
   */
  estimateTokens(text: string): number {
    if (!text) return 0;

    // Normalize whitespace
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length === 0) return 0;

    // Count CJK characters (Chinese, Japanese, Korean)
    // Range covers common CJK Unified Ideographs
    const cjkRegex = /[\u4e00-\u9fa5\u3040-\u30ff\u31f0-\u31ff\uac00-\ud7af]/g;
    const cjkMatches = normalized.match(cjkRegex);
    const cjkCount = cjkMatches ? cjkMatches.length : 0;

    // Remove CJK characters to count remaining "words" (English, Numbers, etc.)
    const nonCjkText = normalized.replace(cjkRegex, ' ');

    // Count words in non-CJK text
    // Split by whitespace and filter empty strings
    const words = nonCjkText.split(/\s+/).filter((w) => w.length > 0);
    const wordCount = words.length;

    // Count remaining punctuation/symbols in non-CJK text
    const punctRegex = /[!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~]/g;
    const punctMatches = nonCjkText.match(punctRegex);
    const punctCount = punctMatches ? punctMatches.length : 0;

    // Calculation
    // 1. CJK: 1.5 tokens per character
    // 2. Words: 1.33 tokens per word (1000 tokens ~= 750 words)
    // 3. Punctuation: 1 token per symbol (roughly)

    const cjkTokens = cjkCount * 1.5;
    const wordTokens = wordCount * 1.33;
    const punctTokens = punctCount * 1.0;

    const total = Math.ceil(cjkTokens + wordTokens + punctTokens);

    // Ensure at least 1 token if text is not empty
    return Math.max(1, total);
  },

  /**
   * Chunk text into parts that fit within token limit
   */
  chunkText(text: string, maxTokens: number, reserveRatio = 0.4, minChunkSize = 200): string[] {
    const limit = Math.max(minChunkSize, Math.floor(maxTokens * (1 - reserveRatio)));
    const parts: string[] = [];
    let current: string[] = [];
    let tokens = 0;

    // Split by closing tags to preserve structure better than just newlines
    // This regex splits after > followed by newline, or just newline
    const lines = text.split(/(?<=>)\n|\n/);

    for (const line of lines) {
      const t = this.estimateTokens(line) + 1; // +1 for newline
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