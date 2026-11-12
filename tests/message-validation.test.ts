import { describe, it, expect } from 'vitest';
import { validateMessagePayload } from '../src/utils/message-validation';
import { Message } from '../src/types';
import { ANALYSIS_FORMAT, TIMEOUT, UI_LIMITS } from '../src/config/constants';

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

describe('validateMessagePayload SAVE_SETTINGS limits', () => {
  const makeMessage = (settings: Record<string, unknown>): Message =>
    ({ type: 'SAVE_SETTINGS', payload: { settings } }) as unknown as Message;

  it('rejects numeric settings outside supported ranges', () => {
    expect(() =>
      validateMessagePayload(makeMessage({ maxComments: UI_LIMITS.MAX_COMMENTS_MIN - 1 })),
    ).toThrowError(/SAVE_SETTINGS/);
    expect(() =>
      validateMessagePayload(
        makeMessage({ aiTimeout: TIMEOUT.MIN_AI_SECONDS * TIMEOUT.MS_PER_SEC - 1 }),
      ),
    ).toThrowError(/SAVE_SETTINGS/);
    expect(() =>
      validateMessagePayload(
        makeMessage({ domAnalysisConfig: { maxDepth: UI_LIMITS.MAX_DEPTH_MAX + 1 } }),
      ),
    ).toThrowError(/SAVE_SETTINGS/);
    expect(() =>
      validateMessagePayload(makeMessage({ aiModel: { protocol: 'unknown-protocol' } })),
    ).toThrowError(/SAVE_SETTINGS/);
  });

  it('keeps empty endpoint preconditions and rejects non-string endpoint identities', () => {
    const message: Message = {
      type: 'SAVE_SETTINGS',
      payload: { settings: { aiModel: { apiKey: 'new-key' } }, expectedAiEndpoint: '' },
    };
    expect(validateMessagePayload(message)).toEqual(message);
    expect(() =>
      validateMessagePayload({
        ...message,
        payload: { ...message.payload, expectedAiEndpoint: 123 },
      } as unknown as Message),
    ).toThrowError(/SAVE_SETTINGS/);
  });

  it('accepts values on supported boundaries', () => {
    expect(() =>
      validateMessagePayload(
        makeMessage({
          maxComments: UI_LIMITS.MAX_COMMENTS_MAX,
          aiTimeout: TIMEOUT.MAX_AI_SECONDS * TIMEOUT.MS_PER_SEC,
          domAnalysisConfig: { maxDepth: UI_LIMITS.MAX_DEPTH_MAX },
          aiModel: { protocol: 'anthropic-messages' },
        }),
      ),
    ).not.toThrow();
  });
});

describe('AI protocol message validation', () => {
  it('defaults legacy model discovery and testing messages to Chat Completions', () => {
    expect(
      validateMessagePayload({
        type: 'GET_AVAILABLE_MODELS',
        payload: { apiUrl: 'https://api.example/v1', apiKey: '' },
      }),
    ).toMatchObject({ payload: { protocol: 'openai-chat-completions' } });
    expect(
      validateMessagePayload({
        type: 'TEST_MODEL',
        payload: { config: { apiUrl: 'https://api.example/v1', model: 'test' } },
      } as Message),
    ).toMatchObject({ payload: { config: { protocol: 'openai-chat-completions' } } });
  });

  it('rejects unknown discovery, test, and save precondition protocols', () => {
    for (const message of [
      {
        type: 'GET_AVAILABLE_MODELS',
        payload: { apiUrl: 'https://api.example/v1', apiKey: '', protocol: 'unknown' },
      },
      {
        type: 'TEST_MODEL',
        payload: {
          config: { apiUrl: 'https://api.example/v1', model: 'test', protocol: 'unknown' },
        },
      },
      { type: 'SAVE_SETTINGS', payload: { settings: {}, expectedAiProtocol: 'unknown' } },
    ]) {
      expect(() => validateMessagePayload(message as Message)).toThrow();
    }
  });

  it('does not add a protocol to partial settings patches', () => {
    const message: Message = {
      type: 'SAVE_SETTINGS',
      payload: {
        settings: { aiModel: { model: 'new-model' } },
        expectedAiProtocol: 'openai-responses',
      },
    };
    expect(validateMessagePayload(message)).toEqual(message);
  });
});
