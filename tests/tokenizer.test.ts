import { describe, it, expect } from 'vitest';
import { Tokenizer } from '../src/utils/tokenizer';

describe('Tokenizer', () => {
  it('should estimate tokens for English text correctly', () => {
    const text = 'Hello world, this is a test.';
    const tokens = Tokenizer.estimateTokens(text);
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(15);
  });

  it('should estimate tokens for Chinese text correctly', () => {
    const text = '你好世界，这是一个测试。';
    const tokens = Tokenizer.estimateTokens(text);
    expect(tokens).toBeGreaterThan(10);
    expect(tokens).toBeLessThan(25);
  });

  it('should estimate mixed content', () => {
    const text = 'Hello 你好 world 世界';
    const tokens = Tokenizer.estimateTokens(text);
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(15);
  });

  it('should handle empty strings', () => {
    expect(Tokenizer.estimateTokens('')).toBe(0);
    expect(Tokenizer.estimateTokens('   ')).toBe(0);
  });

  it('should chunk text correctly', () => {
    const text = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
    const chunks = Tokenizer.chunkText(text, 10, 0.5, 1); // Limit 5 tokens
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('\n')).toBe(text);
  });
});
