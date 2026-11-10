import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Message } from '@/types';
import { validateMessagePayload } from '@/utils/message-validation';
import { sanitizeStoredSettings } from '@/utils/storage-validation';
import { LogLevel } from '@/utils/logger';
import { isWithinValidationBudget, VALIDATION_BUDGET } from '@/utils/validation-budget';

describe('bounded validation of untrusted input', () => {
  it('rejects oversized comment arrays before reading any element', () => {
    const comments = new Array(VALIDATION_BUDGET.maxArrayLength + 1);
    const read = vi.fn(() => ({}));
    Object.defineProperty(comments, 0, { get: read });
    const message = { type: 'START_ANALYSIS', payload: { comments } } as unknown as Message;

    expect(() => validateMessagePayload(message)).toThrow(/too large/);
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects oversized generated config fields before reading them', () => {
    const fields = new Array(VALIDATION_BUDGET.maxArrayLength + 1);
    const read = vi.fn(() => ({}));
    Object.defineProperty(fields, 0, { get: read });
    const message = {
      type: 'SAVE_CRAWLING_CONFIG',
      payload: { config: { domain: 'example.com', fields } },
    } as unknown as Message;

    expect(() => validateMessagePayload(message)).toThrow(/too large/);
    expect(read).not.toHaveBeenCalled();
  });

  it('checks record key counts before reading values', () => {
    const record: Record<string, unknown> = {};
    const read = vi.fn(() => 'value');
    Object.defineProperty(record, 'first', { enumerable: true, get: read });
    for (let index = 0; index < VALIDATION_BUDGET.maxObjectKeys; index++) {
      record[`key${index}`] = false;
    }
    expect(isWithinValidationBudget(record)).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it('bounds total nested entries and rejects cycles while allowing shared values', () => {
    const shared = { ok: true };
    expect(isWithinValidationBudget([shared, shared])).toBe(true);
    const large = Array.from({ length: 26 }, () => new Array(10_000).fill(null));
    expect(isWithinValidationBudget(large)).toBe(false);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(isWithinValidationBudget(cyclic)).toBe(false);
  });

  it('accepts normal messages and keeps log data records intact', () => {
    const message: Message = {
      type: 'APPEND_SYSTEM_LOG',
      payload: {
        entry: { level: LogLevel.INFO, timestamp: 1, message: 'test', data: { count: 3 } },
      },
    };
    expect(validateMessagePayload(message)).toEqual(message);
  });

  it('does not discard previously stored rules with large field lists', () => {
    const field = { name: 'content', rule: { type: 'css', selector: '.content' } };
    const stored = sanitizeStoredSettings({
      crawlingConfigs: [
        {
          id: 'legacy',
          domain: 'example.com',
          container: { type: 'css', selector: '#comments' },
          item: { type: 'css', selector: '.comment' },
          fields: new Array(VALIDATION_BUDGET.maxArrayLength + 1).fill(field),
          lastUpdated: 1,
        },
      ],
    });
    expect(stored.crawlingConfigs?.[0].fields).toHaveLength(VALIDATION_BUDGET.maxArrayLength + 1);
  });

  it('disables the Zod JIT for extension CSP', () => {
    expect(z.config().jitless).toBe(true);
  });
});
