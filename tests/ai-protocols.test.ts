import { describe, expect, it, vi } from 'vitest';
import {
  buildAIHeaders,
  buildAIRequest,
  readAIResponse,
} from '../src/background/ai/ProtocolAdapter';
import type { AIProtocol } from '../src/types';
import { ErrorCode } from '../src/utils/errors';
import { mockAIConfig } from './fixtures';

const protocols: AIProtocol[] = [
  'openai-chat-completions',
  'openai-responses',
  'anthropic-messages',
];
const frame = (type: string, data: Record<string, unknown>) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const completedResponse = {
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello 世界' }] }],
  usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
};

function stream(source: string, splitBytes = false): Response {
  const bytes = new TextEncoder().encode(source);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        if (splitBytes) for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        else controller.enqueue(bytes);
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

async function read(response: Response, protocol: AIProtocol) {
  return readAIResponse(response, protocol, 'secret-key', vi.fn());
}

describe('AI protocol requests', () => {
  it.each(protocols)('omits sampling parameters for %s even with legacy input', (protocol) => {
    const config = { ...mockAIConfig({ protocol }), temperature: 0.7, topP: 0.9, topK: 20 };
    const body = JSON.parse(buildAIRequest('Question', 'Rules', config));
    for (const name of ['temperature', 'top_p', 'top_k', 'topP', 'topK'])
      expect(body).not.toHaveProperty(name);
    expect(body).toMatchObject({ model: config.model, stream: true });
  });

  it('builds stateless Responses requests', () => {
    expect(
      JSON.parse(
        buildAIRequest(
          'Question',
          'Rules',
          mockAIConfig({ protocol: 'openai-responses', maxOutputTokens: 123 }),
        ),
      ),
    ).toEqual({
      model: 'gpt-4o-mini',
      stream: true,
      input: 'Question',
      instructions: 'Rules',
      max_output_tokens: 123,
      store: false,
    });
  });

  it('builds Anthropic system prompts and versioned API-key headers', () => {
    const config = mockAIConfig({ protocol: 'anthropic-messages', maxOutputTokens: 456 });
    expect(JSON.parse(buildAIRequest('Question', 'Rules', config))).toEqual({
      model: config.model,
      stream: true,
      messages: [{ role: 'user', content: 'Question' }],
      system: 'Rules',
      max_tokens: 456,
    });
    expect(buildAIHeaders(config.protocol, 'secret-key')).toEqual({
      Accept: 'text/event-stream, application/json',
      'Content-Type': 'application/json',
      'x-api-key': 'secret-key',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
  });

  it.each(protocols)('omits empty authentication and optional system prompt for %s', (protocol) => {
    const body = JSON.parse(buildAIRequest('Question', undefined, mockAIConfig({ protocol })));
    expect(body).not.toHaveProperty('system');
    expect(body).not.toHaveProperty('instructions');
    expect(buildAIHeaders(protocol, '')).not.toHaveProperty('Authorization');
    expect(buildAIHeaders(protocol, '')).not.toHaveProperty('x-api-key');
  });
});

describe('Stream integrity', () => {
  it.each(protocols)('cancels and unlocks malformed %s streams', async (protocol) => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {not-json\n\n'));
      },
      cancel,
    });

    await expect(
      read(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), protocol),
    ).rejects.toMatchObject({ code: ErrorCode.AI_INVALID_RESPONSE, retryable: false });
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it.each(['first', 'middle', 'last'])(
    'rejects a malformed %s Chat Completions frame',
    async (position) => {
      const valid = [
        'data: {"choices":[{"delta":{"content":"Revenue was "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"profitable."},"finish_reason":"stop"}]}\n\n',
      ];
      const index = position === 'first' ? 0 : position === 'middle' ? 1 : 2;
      valid.splice(index, 0, 'data: {"choices":[{"delta":{"content":"not "}}]\n\n');
      await expect(
        read(stream(valid.join('') + 'data: [DONE]\n\n', true), 'openai-chat-completions'),
      ).rejects.toMatchObject({ code: ErrorCode.AI_INVALID_RESPONSE, retryable: false });
    },
  );

  it('accepts fragmented Chat Completions text, CRLF, comments and empty events', async () => {
    const source =
      ': heartbeat\n\nevent: ping\n\n' +
      'data: {"choices":[{"delta":{"content":"Hello 世界"}}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
      'data: [DONE]\n\n';
    expect(
      await read(stream(source.replace(/\n/g, '\r\n'), true), 'openai-chat-completions'),
    ).toEqual({
      content: 'Hello 世界',
      tokensUsed: 0,
      finishReason: 'stop',
    });
  });
});

describe('Responses parsing', () => {
  it('decodes fragmented UTF-8 and CRLF, ignores reasoning, and avoids repeated final output', async () => {
    const progress = vi.fn();
    const activity = vi.fn();
    const source =
      ': heartbeat\n\n' +
      frame('response.reasoning_text.delta', { delta: 'Private reasoning' }) +
      frame('response.output_text.delta', { delta: 'Hello ' }) +
      frame('response.output_text.delta', { delta: '世界' }) +
      frame('response.completed', { response: completedResponse });
    const result = await readAIResponse(
      stream(source.replace(/\n/g, '\r\n'), true),
      'openai-responses',
      '',
      activity,
      progress,
    );
    expect(result).toEqual({ content: 'Hello 世界', tokensUsed: 20, finishReason: 'stop' });
    expect(progress).toHaveBeenLastCalledWith({
      chunksReceived: 2,
      charactersReceived: 8,
      finishReason: 'stop',
    });
    expect(activity).toHaveBeenCalled();
  });

  it('accepts multiline SSE data fields', async () => {
    const response = stream(
      'event: response.completed\ndata: {"type":"response.completed",\ndata: "response":' +
        JSON.stringify(completedResponse) +
        '}\n\n',
    );
    expect((await read(response, 'openai-responses')).content).toBe('Hello 世界');
  });

  it.each([true, false])('parses JSON response with content-type=%s', async (contentType) => {
    const response = contentType
      ? Response.json(completedResponse)
      : stream(JSON.stringify(completedResponse, null, 2));
    expect(await read(response, 'openai-responses')).toEqual({
      content: 'Hello 世界',
      tokensUsed: 20,
      finishReason: 'stop',
    });
  });

  it.each(['response.incomplete', 'response.failed'])(
    'rejects %s after partial text',
    async (type) => {
      const source =
        frame('response.output_text.delta', { delta: 'Partial' }) +
        frame(type, {
          response: { status: type.slice(9), incomplete_details: { reason: 'max_output_tokens' } },
        });
      await expect(read(stream(source), 'openai-responses')).rejects.toMatchObject({
        code: ErrorCode.AI_INVALID_RESPONSE,
        retryable: false,
      });
    },
  );

  it('rejects premature EOF and malformed frames', async () => {
    for (const source of [
      frame('response.output_text.delta', { delta: 'Partial' }),
      'data: {not-json\n\n',
    ]) {
      await expect(read(stream(source), 'openai-responses')).rejects.toMatchObject({
        code: ErrorCode.AI_INVALID_RESPONSE,
        retryable: false,
      });
    }
  });

  it('rejects refusals in both JSON and streaming output', async () => {
    await expect(
      read(
        Response.json({
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }],
        }),
        'openai-responses',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.AI_INVALID_RESPONSE });
    await expect(
      read(stream(frame('response.refusal.delta', { delta: 'No' })), 'openai-responses'),
    ).rejects.toMatchObject({ code: ErrorCode.AI_INVALID_RESPONSE });
  });

  it('redacts top-level streaming API errors', async () => {
    await expect(
      read(
        stream(frame('error', { code: 'invalid_api_key', message: 'Bad secret-key' })),
        'openai-responses',
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.MISSING_API_KEY,
      message: 'Bad [redacted]',
      retryable: false,
    });
  });
});

describe('Anthropic parsing', () => {
  it('merges cumulative usage and includes cache tokens without including thinking text', async () => {
    const source =
      frame('message_start', {
        message: {
          usage: {
            input_tokens: 10,
            cache_creation_input_tokens: 20,
            cache_read_input_tokens: 30,
            output_tokens: 1,
          },
        },
      }) +
      frame('ping', {}) +
      frame('content_block_start', {
        index: 0,
        content_block: { type: 'thinking', thinking: 'Private' },
      }) +
      frame('content_block_delta', {
        index: 0,
        delta: { type: 'thinking_delta', thinking: ' reasoning' },
      }) +
      frame('content_block_start', { index: 1, content_block: { type: 'text', text: '' } }) +
      frame('content_block_delta', {
        index: 1,
        delta: { type: 'text_delta', text: 'Hello 世界' },
      }) +
      frame('message_delta', { delta: {}, usage: { output_tokens: 3 } }) +
      frame('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } }) +
      frame('message_stop', {});
    expect(await read(stream(source, true), 'anthropic-messages')).toEqual({
      content: 'Hello 世界',
      tokensUsed: 68,
      finishReason: 'stop',
    });
  });

  it('parses nonstreaming content and stop sequences', async () => {
    expect(
      await read(
        Response.json({
          content: [
            { type: 'thinking', thinking: 'Private' },
            { type: 'text', text: 'Hello' },
            { type: 'text', text: ' 世界' },
          ],
          stop_reason: 'stop_sequence',
          usage: { input_tokens: 12, output_tokens: 8 },
        }),
        'anthropic-messages',
      ),
    ).toEqual({ content: 'Hello 世界', tokensUsed: 20, finishReason: 'stop' });
  });

  it.each(['max_tokens', 'tool_use', 'refusal', 'pause_turn', null])(
    'rejects stop reason %s',
    async (reason) => {
      await expect(
        read(
          Response.json({ content: [{ type: 'text', text: 'Partial' }], stop_reason: reason }),
          'anthropic-messages',
        ),
      ).rejects.toMatchObject({ code: ErrorCode.AI_INVALID_RESPONSE, retryable: false });
    },
  );

  it('requires message_stop even after end_turn', async () => {
    await expect(
      read(
        stream(frame('message_delta', { delta: { stop_reason: 'end_turn' } })),
        'anthropic-messages',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.AI_INVALID_RESPONSE });
  });

  it('classifies overloaded stream errors and redacts credentials', async () => {
    await expect(
      read(
        stream(
          frame('error', { error: { type: 'overloaded_error', message: 'Overloaded secret-key' } }),
        ),
        'anthropic-messages',
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.API_ERROR,
      message: 'Overloaded [redacted]',
      retryable: true,
    });
  });

  it('auto-detects SSE streams even when Content-Type is application/json and handles single-newline frames', async () => {
    const encoder = new TextEncoder();
    const sseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"OK"}}]}\n' +
              'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":5}}\n' +
              'data: [DONE]\n',
          ),
        );
        controller.close();
      },
    });
    const response = new Response(sseBody, {
      headers: { 'content-type': 'application/json' },
    });
    expect(await read(response, 'openai-chat-completions')).toEqual({
      content: 'OK',
      tokensUsed: 5,
      finishReason: 'stop',
    });
  });
});
