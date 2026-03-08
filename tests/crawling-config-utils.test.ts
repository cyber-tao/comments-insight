import { describe, expect, it, vi } from 'vitest';
import type { CrawlingConfig } from '../src/types';
import {
  hasCrawlingConfigContentChanged,
  resolveCrawlingConfigLastUpdated,
} from '../src/utils/crawling-config';

function createConfig(overrides: Partial<CrawlingConfig> = {}): CrawlingConfig {
  return {
    id: 'config-1',
    domain: 'example.com',
    siteName: 'Example',
    lastUpdated: 1700000000000,
    container: { selector: '.comments', type: 'css' },
    item: { selector: '.comment', type: 'css' },
    fields: [
      { name: 'username', rule: { selector: '.author', type: 'css' } },
      { name: 'content', rule: { selector: '.content', type: 'css' } },
      { name: 'timestamp', rule: { selector: '.time', type: 'css' } },
      { name: 'likes', rule: { selector: '.likes', type: 'css' } },
    ],
    ...overrides,
  };
}

describe('crawling-config utils', () => {
  it('ignores runtime fields when comparing crawling config content', () => {
    const previous = createConfig({
      id: 'config-old',
      lastUpdated: 1700000000000,
      fieldValidation: { username: 'success' },
    });
    const next = createConfig({
      id: 'config-new',
      lastUpdated: 1800000000000,
      fieldValidation: { username: 'failed' },
    });

    expect(hasCrawlingConfigContentChanged(previous, next)).toBe(false);
  });

  it('keeps lastUpdated when only runtime fields change', () => {
    const previous = createConfig({ lastUpdated: 1700000000000 });
    const next = createConfig({
      lastUpdated: 1800000000000,
      fieldValidation: { username: 'success' },
    });

    expect(resolveCrawlingConfigLastUpdated({ previous, next })).toBe(1700000000000);
  });

  it('uses current time when local content changes without an incoming timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-09T12:00:00.000Z'));

    try {
      const previous = createConfig({ lastUpdated: 1700000000000 });
      const next = createConfig({
        lastUpdated: 1700000000000,
        siteName: 'Updated Example',
      });

      expect(resolveCrawlingConfigLastUpdated({ previous, next })).toBe(Date.now());
    } finally {
      vi.useRealTimers();
    }
  });

  it('prefers the incoming timestamp when content changes and source timestamp is provided', () => {
    const previous = createConfig({ lastUpdated: 1700000000000 });
    const next = createConfig({
      lastUpdated: 1800000000000,
      siteName: 'Updated Example',
    });

    expect(
      resolveCrawlingConfigLastUpdated({
        previous,
        next,
        preferredLastUpdated: next.lastUpdated,
      }),
    ).toBe(1800000000000);
  });
});
