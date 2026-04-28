import { describe, it, expect } from 'vitest';
import { cleanAndParseJsonObject, cleanAndParseJsonArray } from '@/utils/json-parser';
import { ExtensionError, ErrorCode } from '@/utils/errors';

describe('json-parser', () => {
  describe('cleanAndParseJsonObject', () => {
    it('should parse valid JSON object', () => {
      const raw = '{"name": "test", "value": 123}';
      const result = cleanAndParseJsonObject<{ name: string; value: number }>(raw);

      expect(result.name).toBe('test');
      expect(result.value).toBe(123);
    });

    it('should parse JSON with whitespace', () => {
      const raw = '  { "key": "value" }  ';
      const result = cleanAndParseJsonObject<{ key: string }>(raw);

      expect(result.key).toBe('value');
    });

    it('should extract JSON from markdown code blocks', () => {
      const raw = '```json\n{"extracted": true}\n```';
      const result = cleanAndParseJsonObject<{ extracted: boolean }>(raw);

      expect(result.extracted).toBe(true);
    });

    it('should extract JSON from code blocks without json specifier', () => {
      const raw = '```\n{"data": "value"}\n```';
      const result = cleanAndParseJsonObject<{ data: string }>(raw);

      expect(result.data).toBe('value');
    });

    it('should handle JSON with text before and after', () => {
      const raw = 'Here is the result: {"result": "success"} Hope this helps!';
      const result = cleanAndParseJsonObject<{ result: string }>(raw);

      expect(result.result).toBe('success');
    });

    it('should parse nested objects', () => {
      const raw = '{"outer": {"inner": {"deep": "value"}}}';
      const result = cleanAndParseJsonObject<{
        outer: { inner: { deep: string } };
      }>(raw);

      expect(result.outer.inner.deep).toBe('value');
    });

    it('should parse objects with arrays', () => {
      const raw = '{"items": [1, 2, 3], "names": ["a", "b"]}';
      const result = cleanAndParseJsonObject<{
        items: number[];
        names: string[];
      }>(raw);

      expect(result.items).toEqual([1, 2, 3]);
      expect(result.names).toEqual(['a', 'b']);
    });

    it('should handle special characters in strings', () => {
      const raw = '{"text": "Line1\\nLine2\\tTabbed", "quote": "\\"quoted\\""}';
      const result = cleanAndParseJsonObject<{ text: string; quote: string }>(raw);

      expect(result.text).toBe('Line1\nLine2\tTabbed');
      expect(result.quote).toBe('"quoted"');
    });

    it('should handle unicode characters', () => {
      const raw = '{"chinese": "你好", "emoji": "🎉"}';
      const result = cleanAndParseJsonObject<{ chinese: string; emoji: string }>(raw);

      expect(result.chinese).toBe('你好');
      expect(result.emoji).toBe('🎉');
    });

    it('should parse boolean and null values', () => {
      const raw = '{"enabled": true, "disabled": false, "empty": null}';
      const result = cleanAndParseJsonObject<{
        enabled: boolean;
        disabled: boolean;
        empty: null;
      }>(raw);

      expect(result.enabled).toBe(true);
      expect(result.disabled).toBe(false);
      expect(result.empty).toBeNull();
    });

    it('should throw ExtensionError for invalid JSON', () => {
      const raw = '{"invalid": }';

      expect(() => cleanAndParseJsonObject(raw)).toThrow(ExtensionError);
      expect(() => cleanAndParseJsonObject(raw)).toThrow(/Failed to parse JSON object/);
    });

    it('should throw error with correct error code', () => {
      const raw = 'not json at all';

      try {
        cleanAndParseJsonObject(raw);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ExtensionError);
        expect((error as ExtensionError).code).toBe(ErrorCode.AI_INVALID_RESPONSE);
      }
    });

    it('should handle empty object', () => {
      const raw = '{}';
      const result = cleanAndParseJsonObject(raw);

      expect(result).toEqual({});
    });

    it('should handle JSON in AI response format', () => {
      const raw = `
Here's the analysis result:

\`\`\`json
{
  "sentiment": "positive",
  "score": 0.85
}
\`\`\`

Let me know if you need more details.
      `;
      const result = cleanAndParseJsonObject<{
        sentiment: string;
        score: number;
      }>(raw);

      expect(result.sentiment).toBe('positive');
      expect(result.score).toBe(0.85);
    });

    it('should handle multiple JSON blocks by extracting from first { to last }', () => {
      // The implementation extracts from first '{' to last '}'
      // So 'First: {"first": 1} Second: {"second": 2}' extracts '{"first": 1} Second: {"second": 2}'
      // which is invalid JSON and will throw
      const raw = 'First: {"first": 1} Second: {"second": 2}';
      expect(() => cleanAndParseJsonObject(raw)).toThrow();
    });
  });

  describe('cleanAndParseJsonArray', () => {
    it('should parse valid JSON array', () => {
      const raw = '[1, 2, 3, 4, 5]';
      const result = cleanAndParseJsonArray<number>(raw);

      expect(result).toEqual([1, 2, 3, 4, 5]);
    });

    it('should parse array of objects', () => {
      const raw = '[{"id": 1}, {"id": 2}]';
      const result = cleanAndParseJsonArray<{ id: number }>(raw);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(2);
    });

    it('should parse array with whitespace', () => {
      const raw = '  [ "a", "b", "c" ]  ';
      const result = cleanAndParseJsonArray<string>(raw);

      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should extract array from markdown code blocks', () => {
      const raw = '```json\n["item1", "item2"]\n```';
      const result = cleanAndParseJsonArray<string>(raw);

      expect(result).toEqual(['item1', 'item2']);
    });

    it('should handle array with text before and after', () => {
      const raw = 'Results: ["result1", "result2"] End.';
      const result = cleanAndParseJsonArray<string>(raw);

      expect(result).toEqual(['result1', 'result2']);
    });

    it('should parse nested arrays', () => {
      const raw = '[[1, 2], [3, 4], [5, 6]]';
      const result = cleanAndParseJsonArray<number[]>(raw);

      expect(result).toEqual([
        [1, 2],
        [3, 4],
        [5, 6],
      ]);
    });

    it('should handle mixed types in array', () => {
      const raw = '[1, "two", true, null, {"key": "value"}]';
      const result = cleanAndParseJsonArray<unknown>(raw);

      expect(result[0]).toBe(1);
      expect(result[1]).toBe('two');
      expect(result[2]).toBe(true);
      expect(result[3]).toBeNull();
      expect(result[4]).toEqual({ key: 'value' });
    });

    it('should handle empty array', () => {
      const raw = '[]';
      const result = cleanAndParseJsonArray(raw);

      expect(result).toEqual([]);
    });

    it('should throw ExtensionError for invalid JSON array', () => {
      const raw = '[invalid]';

      expect(() => cleanAndParseJsonArray(raw)).toThrow(ExtensionError);
      expect(() => cleanAndParseJsonArray(raw)).toThrow(/Failed to parse JSON array/);
    });

    it('should throw error with correct error code for arrays', () => {
      const raw = 'definitely not an array';

      try {
        cleanAndParseJsonArray(raw);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ExtensionError);
        expect((error as ExtensionError).code).toBe(ErrorCode.AI_INVALID_RESPONSE);
      }
    });

    it('should handle array in AI response format', () => {
      const raw = `
Here are the extracted comments:

\`\`\`json
[
  {"username": "user1", "content": "Great!"},
  {"username": "user2", "content": "Thanks!"}
]
\`\`\`
      `;
      const result = cleanAndParseJsonArray<{
        username: string;
        content: string;
      }>(raw);

      expect(result).toHaveLength(2);
      expect(result[0].username).toBe('user1');
      expect(result[1].content).toBe('Thanks!');
    });

    it('should handle special characters in array strings', () => {
      const raw = '["line\\nbreak", "tab\\there", "quote\\"here"]';
      const result = cleanAndParseJsonArray<string>(raw);

      expect(result[0]).toBe('line\nbreak');
      expect(result[1]).toBe('tab\there');
      expect(result[2]).toBe('quote"here');
    });

    it('should handle unicode in arrays', () => {
      const raw = '["中文", "日本語", "한국어", "🌍"]';
      const result = cleanAndParseJsonArray<string>(raw);

      expect(result).toEqual(['中文', '日本語', '한국어', '🌍']);
    });

    it('should handle large arrays', () => {
      const items = Array.from({ length: 1000 }, (_, i) => i);
      const raw = JSON.stringify(items);
      const result = cleanAndParseJsonArray<number>(raw);

      expect(result).toHaveLength(1000);
      expect(result[0]).toBe(0);
      expect(result[999]).toBe(999);
    });
  });

  describe('edge cases', () => {
    it('should handle JSON with BOM', () => {
      const raw = '\uFEFF{"key": "value"}';
      const result = cleanAndParseJsonObject<{ key: string }>(raw);

      expect(result.key).toBe('value');
    });

    it('should handle multiple code block markers', () => {
      const raw = '```json\n```\n{"actual": "data"}\n```';
      const result = cleanAndParseJsonObject<{ actual: string }>(raw);

      expect(result.actual).toBe('data');
    });

    it('should handle object when looking for array and vice versa', () => {
      // cleanAndParseJsonObject on array-like input
      // When input is '[1,2,3]', indexOf('{') returns -1, so it tries to parse the whole string
      // JSON.parse('[1,2,3]') succeeds and returns an array
      const arrayInput = '[1, 2, 3]';
      // This actually succeeds because JSON.parse can parse arrays too
      const arrayResult = cleanAndParseJsonObject(arrayInput);
      expect(Array.isArray(arrayResult)).toBe(true);

      // cleanAndParseJsonArray on object-like input
      // When input is '{"key": "value"}', indexOf('[') returns -1, so it tries to parse the whole string
      // JSON.parse('{"key": "value"}') succeeds and returns an object
      const objectInput = '{"key": "value"}';
      // This also succeeds because JSON.parse can parse objects too
      const objectResult = cleanAndParseJsonArray(objectInput);
      expect(Array.isArray(objectResult)).toBe(false);
    });

    it('should handle very deeply nested structures', () => {
      const deep = { a: { b: { c: { d: { e: { f: 'deep' } } } } } };
      const raw = JSON.stringify(deep);
      const result = cleanAndParseJsonObject<typeof deep>(raw);

      expect(result.a.b.c.d.e.f).toBe('deep');
    });

    it('should handle numeric edge cases', () => {
      const raw = '{"int": 42, "float": 3.14, "exp": 1e10, "neg": -100}';
      const result = cleanAndParseJsonObject<{
        int: number;
        float: number;
        exp: number;
        neg: number;
      }>(raw);

      expect(result.int).toBe(42);
      expect(result.float).toBe(3.14);
      expect(result.exp).toBe(1e10);
      expect(result.neg).toBe(-100);
    });

    it('should preserve object key order', () => {
      const raw = '{"z": 1, "a": 2, "m": 3}';
      const result = cleanAndParseJsonObject<Record<string, number>>(raw);

      const keys = Object.keys(result);
      expect(keys).toEqual(['z', 'a', 'm']);
    });
  });
});
