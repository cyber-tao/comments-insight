import { describe, it, expect } from 'vitest';
import { chunkDomText } from '../src/background/handlers/extraction';

describe('chunkDomText', () => {
  it('should return single chunk for small input', () => {
    const input = 'line1\nline2\nline3';
    const chunks = chunkDomText(input, 1000);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(input);
  });

  it('should split large input into multiple chunks', () => {
    const lines = Array.from(
      { length: 100 },
      (_, i) => `This is line number ${i + 1} with some text content`,
    );
    const input = lines.join('\n');
    const chunks = chunkDomText(input, 100);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('\n')).toBe(input);
  });

  it('should handle empty input', () => {
    const chunks = chunkDomText('', 1000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('');
  });

  it('should respect token limit', () => {
    const longLine = 'a'.repeat(500);
    const input = `${longLine}\n${longLine}\n${longLine}`;
    const chunks = chunkDomText(input, 200);

    chunks.forEach((chunk) => {
      const lines = chunk.split('\n');
      expect(lines.length).toBeLessThanOrEqual(3);
    });
  });

  it('should preserve line content', () => {
    const specialChars = '特殊字符 <div class="test">Content</div>';
    const input = `line1\n${specialChars}\nline3`;
    const chunks = chunkDomText(input, 1000);

    expect(chunks.join('\n')).toContain(specialChars);
  });

  it('should handle single line input', () => {
    const input = 'single line without newlines';
    const chunks = chunkDomText(input, 1000);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(input);
  });
});
