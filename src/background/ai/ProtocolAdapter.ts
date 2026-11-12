import { AI } from '@/config/constants';
import type { AIConfig, AIProtocol, AIResponse, AIStreamProgress } from '@/types';
import { createAIError, ErrorCode } from '@/utils/errors';
import { redactApiKey } from '@/utils/log-sanitize';

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function tokens(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function buildAIHeaders(protocol: AIProtocol, apiKey: string): Record<string, string> {
  if (protocol === 'anthropic-messages') {
    return {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    };
  }
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

export function buildAIRequest(
  prompt: string,
  systemPrompt: string | undefined,
  config: AIConfig,
): string {
  const maxOutputTokens = config.maxOutputTokens || AI.DEFAULT_MAX_OUTPUT_TOKENS;
  const common = { model: config.model, stream: true };
  switch (config.protocol ?? AI.DEFAULT_PROTOCOL) {
    case 'openai-responses':
      return JSON.stringify({
        ...common,
        input: prompt,
        ...(systemPrompt ? { instructions: systemPrompt } : {}),
        max_output_tokens: maxOutputTokens,
        store: false,
      });
    case 'anthropic-messages':
      return JSON.stringify({
        ...common,
        messages: [{ role: 'user', content: prompt }],
        ...(systemPrompt ? { system: systemPrompt } : {}),
        max_tokens: maxOutputTokens,
      });
    default:
      return JSON.stringify({
        ...common,
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: prompt },
        ],
        max_tokens: maxOutputTokens,
        stream_options: { include_usage: true },
      });
  }
}

class ResponseAccumulator {
  content = '';
  tokensUsed = 0;
  finishReason = AI.STREAM.UNKNOWN_FINISH_REASON;
  done = false;
  private chunksReceived = 0;
  private usage: JsonObject = {};

  constructor(
    private readonly protocol: AIProtocol,
    private readonly apiKey: string,
    private readonly onProgress?: (progress: AIStreamProgress) => void,
  ) {}

  private fail(reason: string): never {
    throw createAIError(
      ErrorCode.AI_INVALID_RESPONSE,
      redactApiKey(reason, this.apiKey),
      {},
      false,
    );
  }

  private providerError(value: unknown): never {
    const error = object(value);
    const type = text(error.code) || text(error.type);
    const message = redactApiKey(
      text(error.message) || 'AI provider returned an error',
      this.apiKey,
    );
    const rateLimited = type.includes('rate_limit');
    const unauthorized = type.includes('authentication') || type.includes('invalid_api_key');
    throw createAIError(
      rateLimited
        ? ErrorCode.AI_RATE_LIMIT
        : unauthorized
          ? ErrorCode.MISSING_API_KEY
          : ErrorCode.API_ERROR,
      message,
      {},
      rateLimited || type.includes('overloaded') || type.includes('server_error'),
    );
  }

  private emit(): void {
    this.onProgress?.({
      chunksReceived: this.chunksReceived,
      charactersReceived: this.content.length,
      finishReason: this.finishReason,
    });
  }

  private append(value: unknown): void {
    const delta = text(value);
    if (delta) {
      this.content += delta;
      this.chunksReceived += 1;
      this.emit();
    }
  }

  private updateUsage(value: unknown): void {
    this.usage = { ...this.usage, ...object(value) };
    this.tokensUsed =
      this.protocol === 'anthropic-messages'
        ? tokens(this.usage.input_tokens) +
          tokens(this.usage.output_tokens) +
          tokens(this.usage.cache_creation_input_tokens) +
          tokens(this.usage.cache_read_input_tokens)
        : typeof this.usage.total_tokens === 'number'
          ? tokens(this.usage.total_tokens)
          : tokens(this.usage.input_tokens) + tokens(this.usage.output_tokens);
  }

  private responseText(data: JsonObject): string {
    let result = '';
    for (const item of Array.isArray(data.output) ? data.output : []) {
      const message = object(item);
      if (message.type !== 'message') continue;
      for (const content of Array.isArray(message.content) ? message.content : []) {
        const block = object(content);
        if (block.type === 'refusal') this.fail('Model refused to produce a response');
        if (block.type === 'output_text') result += text(block.text);
      }
    }
    return result;
  }

  private completeResponse(data: JsonObject, isEvent = false): void {
    if (data.error) this.providerError(data.error);
    if (data.status !== 'completed' && !(isEvent && data.status === undefined)) {
      this.fail(
        `Model output is incomplete (${text(object(data.incomplete_details).reason) || text(data.status) || 'unknown'})`,
      );
    }
    const finalText = this.responseText(data);
    // Completion events repeat the entire output already delivered by text deltas.
    if (Array.isArray(data.output)) {
      this.content = finalText;
      if (finalText && !this.chunksReceived) this.chunksReceived = 1;
    }
    this.updateUsage(data.usage);
    this.finishReason = 'stop';
    this.done = true;
    this.emit();
  }

  private anthropicFinish(reason: unknown): void {
    this.finishReason = text(reason) || AI.STREAM.UNKNOWN_FINISH_REASON;
    if (this.finishReason === 'end_turn' || this.finishReason === 'stop_sequence') {
      this.finishReason = 'stop';
    }
  }

  consumeJSON(value: unknown): void {
    const data = object(value);
    if (data.error) this.providerError(data.error);
    if (this.protocol === 'openai-responses') {
      this.completeResponse(data);
    } else if (this.protocol === 'anthropic-messages') {
      for (const value of Array.isArray(data.content) ? data.content : []) {
        const block = object(value);
        if (block.type === 'text') this.append(block.text);
      }
      this.updateUsage(data.usage);
      this.anthropicFinish(data.stop_reason);
      this.done = true;
      this.emit();
    } else {
      this.consumeEvent(data);
      this.done = true;
    }
  }

  consumeEvent(value: unknown, eventName = ''): void {
    const data = object(value);
    const event = text(data.type) || eventName;
    if (data.error || event === 'error') this.providerError(data.error ?? data);
    if (this.protocol === 'openai-chat-completions') {
      const choice = object(Array.isArray(data.choices) ? data.choices[0] : undefined);
      this.append(object(choice.delta).content || object(choice.message).content);
      if (choice.finish_reason) {
        this.finishReason = text(choice.finish_reason);
        this.emit();
      }
      this.updateUsage(data.usage);
    } else if (this.protocol === 'openai-responses') {
      if (event === 'response.output_text.delta') this.append(data.delta);
      else if (event === 'response.completed') this.completeResponse(object(data.response), true);
      else if (event === 'response.failed' || event === 'response.incomplete') {
        const response = object(data.response);
        if (response.error) this.providerError(response.error);
        this.fail(
          `Model output is incomplete (${text(object(response.incomplete_details).reason) || event})`,
        );
      } else if (event === 'response.refusal.delta' || event === 'response.refusal.done') {
        this.fail('Model refused to produce a response');
      }
    } else {
      if (event === 'message_start') this.updateUsage(object(data.message).usage);
      else if (event === 'content_block_start') {
        const block = object(data.content_block);
        if (block.type === 'text') this.append(block.text);
      } else if (event === 'content_block_delta') {
        const delta = object(data.delta);
        if (delta.type === 'text_delta') this.append(delta.text);
      } else if (event === 'message_delta') {
        this.updateUsage(data.usage);
        if (object(data.delta).stop_reason) this.anthropicFinish(object(data.delta).stop_reason);
        this.emit();
      } else if (event === 'message_stop') this.done = true;
    }
  }

  result(): AIResponse {
    if (
      !this.done &&
      (this.protocol !== 'openai-chat-completions' ||
        this.finishReason === AI.STREAM.UNKNOWN_FINISH_REASON)
    ) {
      this.fail('Model stream ended before completion');
    }
    if (this.protocol === 'anthropic-messages' && this.finishReason !== 'stop') {
      this.fail(`Model output is incomplete (${this.finishReason})`);
    }
    return { content: this.content, tokensUsed: this.tokensUsed, finishReason: this.finishReason };
  }
}

export async function readAIResponse(
  response: Response,
  protocol: AIProtocol,
  apiKey: string,
  onActivity: () => void,
  onProgress?: (progress: AIStreamProgress) => void,
): Promise<AIResponse> {
  const state = new ResponseAccumulator(protocol, apiKey, onProgress);
  if (!response.body || response.headers?.get('content-type')?.includes('application/json')) {
    state.consumeJSON(await response.json());
    return state.result();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let mode: 'json' | 'sse' | undefined;
  let eventName = '';
  let dataLines: string[] = [];

  const dispatch = (): void => {
    const payload = dataLines.join('\n');
    dataLines = [];
    const event = eventName;
    eventName = '';
    if (!payload || state.done) return;
    if (payload.trim() === '[DONE]' && protocol === 'openai-chat-completions') {
      state.done = true;
      return;
    }
    let data: unknown;
    try {
      data = JSON.parse(payload);
    } catch {
      throw createAIError(ErrorCode.AI_INVALID_RESPONSE, 'Malformed AI stream event', {}, false);
    }
    state.consumeEvent(data, event);
  };

  const consumeLine = (line: string): void => {
    if (line === '') dispatch();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    else if (line.startsWith('event:')) eventName = line.slice(6).trim();
  };

  const drain = (flush = false): void => {
    if (!mode && buffer.trim()) mode = buffer.trimStart().startsWith('{') ? 'json' : 'sse';
    if (mode !== 'sse') return;
    let match: RegExpExecArray | null;
    while ((match = /\r\n|\r|\n/.exec(buffer))) {
      if (!flush && match[0] === '\r' && match.index === buffer.length - 1) break;
      consumeLine(buffer.slice(0, match.index));
      buffer = buffer.slice(match.index + match[0].length);
      if (state.done) break;
    }
    if (flush && !state.done) {
      if (buffer) consumeLine(buffer);
      buffer = '';
      dispatch();
    }
  };

  try {
    while (!state.done) {
      const { value, done } = await reader.read();
      if (done) break;
      onActivity();
      buffer += decoder.decode(value, { stream: true });
      drain();
    }
    buffer += decoder.decode();
    drain(true);
    if (mode === 'json') state.consumeJSON(JSON.parse(buffer));
    return state.result();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    if (state.done) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
