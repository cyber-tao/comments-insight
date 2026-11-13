import { Comment, AIConfig } from '../src/types';

export const mockComment = (overrides: Partial<Comment> = {}): Comment => ({
  id: `comment_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
  username: 'Test User',
  content: 'This is a test comment',
  likes: 10,
  timestamp: new Date().toISOString(),
  replies: [],
  ...overrides,
});

export const mockComments = (count: number, overrides: Partial<Comment> = {}): Comment[] =>
  Array.from({ length: count }, (_, i) =>
    mockComment({
      id: `comment_${i}`,
      username: `User ${i + 1}`,
      content: `Test comment ${i + 1}`,
      likes: Math.floor(Math.random() * 100),
      ...overrides,
    }),
  );

export const mockAIConfig = (overrides: Partial<AIConfig> = {}): AIConfig => ({
  protocol: 'openai-chat-completions',
  apiUrl: 'https://api.openai.com/v1',
  apiKey: 'test-api-key',
  model: 'gpt-4o-mini',
  contextWindowSize: 128000,
  maxOutputTokens: 4000,
  ...overrides,
});
