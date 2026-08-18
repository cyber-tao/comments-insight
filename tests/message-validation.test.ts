import { describe, it, expect } from 'vitest';
import { validateMessagePayload } from '../src/utils/message-validation';
import { Message } from '../src/types';
import { ANALYSIS_FORMAT } from '../src/config/constants';

function makeStartAnalysisMessage(comments: unknown[]): Message {
  return {
    type: 'START_ANALYSIS',
    payload: { comments },
  } as unknown as Message;
}

describe('validateMessagePayload START_ANALYSIS comments', () => {
  it('accepts comments written by the AI fallback extraction path without timestamp', () => {
    const message = makeStartAnalysisMessage([
      { id: 'a', username: 'u', content: 'c', likes: 0, replies: [] },
    ]);

    const validated = validateMessagePayload(message) as Extract<
      Message,
      { type: 'START_ANALYSIS' }
    >;

    expect(validated.payload.comments[0].timestamp).toBe(ANALYSIS_FORMAT.UNKNOWN_TIMESTAMP);
    expect(validated.payload.comments[0].likes).toBe(0);
  });

  it('recovers legacy rows with non-string timestamp and non-number likes', () => {
    const message = makeStartAnalysisMessage([
      { id: 'a', username: 'u', content: 'c', timestamp: null, likes: '12', replies: [] },
    ]);

    const validated = validateMessagePayload(message) as Extract<
      Message,
      { type: 'START_ANALYSIS' }
    >;

    expect(validated.payload.comments[0].timestamp).toBe(ANALYSIS_FORMAT.UNKNOWN_TIMESTAMP);
    expect(validated.payload.comments[0].likes).toBe(0);
  });

  it('keeps declared optional fields instead of stripping them', () => {
    const message = makeStartAnalysisMessage([
      {
        id: 'a',
        username: 'u',
        content: 'c',
        timestamp: '1h',
        likes: 3,
        replies: [],
        userId: 'u-1',
        platform: 'example.com',
      },
    ]);

    const validated = validateMessagePayload(message) as Extract<
      Message,
      { type: 'START_ANALYSIS' }
    >;

    expect(validated.payload.comments[0].userId).toBe('u-1');
    expect(validated.payload.comments[0].platform).toBe('example.com');
  });

  it('still rejects comments missing required identity fields', () => {
    const message = makeStartAnalysisMessage([{ username: 'u', content: 'c' }]);

    expect(() => validateMessagePayload(message)).toThrowError(/START_ANALYSIS/);
  });
});
