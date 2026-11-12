import { describe, expect, it } from 'vitest';
import { buildAiModelsUrl, buildAiRequestUrl, normalizeAiApiUrl } from '../src/utils/url';
import type { AIProtocol } from '../src/types';

describe('AI endpoint URLs', () => {
  const endpoints: Array<[AIProtocol, string]> = [
    ['openai-chat-completions', '/chat/completions'],
    ['openai-responses', '/responses'],
    ['anthropic-messages', '/messages'],
  ];
  it.each(endpoints)('builds %s from a base or any full endpoint', (protocol, endpoint) => {
    for (const suffix of ['', '/chat/completions', '/responses', '/messages']) {
      const value = `https://API.example:443/prefix/v1${suffix}/?tenant=1#fragment`;
      expect(buildAiRequestUrl(value, protocol)).toBe(
        `https://api.example/prefix/v1${endpoint}?tenant=1`,
      );
      expect(buildAiModelsUrl(value)).toBe('https://api.example/prefix/v1/models?tenant=1');
      expect(normalizeAiApiUrl(value)).toBe('https://api.example/prefix/v1?tenant=1');
    }
  });
  it.each([
    'http://remote.example/v1',
    'https://user:password@api.example/v1',
    'file:///v1',
    'invalid',
  ])('rejects unsafe URL %s', (value) => {
    expect(buildAiRequestUrl(value, 'anthropic-messages')).toBeNull();
    expect(buildAiModelsUrl(value)).toBeNull();
  });
  it('supports loopback and preserves query parameters', () => {
    expect(buildAiRequestUrl('http://127.0.0.1:11434/v1', 'openai-responses')).toBe(
      'http://127.0.0.1:11434/v1/responses',
    );
    expect(normalizeAiApiUrl('https://api.example/v1/messages?z=1&a=2#fragment')).toBe(
      'https://api.example/v1?a=2&z=1',
    );
  });
});
