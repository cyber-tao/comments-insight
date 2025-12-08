import { describe, it, expect } from 'vitest';
import { ErrorCode, getUserFriendlyMessage } from '../src/utils/errors';

describe('getUserFriendlyMessage', () => {
  it('returns predefined message for MISSING_API_KEY', () => {
    const msg = getUserFriendlyMessage(ErrorCode.MISSING_API_KEY, 'tech');
    expect(msg).toBeTruthy();
    expect(msg).not.toBe('tech');
  });

  it('falls back to technical message for unknown code', () => {
    const msg = getUserFriendlyMessage('UNKNOWN' as any, 'tech');
    expect(msg).toBe('tech');
  });
});
