import { Comment, HistoryItem, Task, Settings, AIConfig } from '../src/types';
import { LANGUAGES } from '../src/config/constants';

export const mockComment = (overrides: Partial<Comment> = {}): Comment => ({
  id: `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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

export const mockHistoryItem = (overrides: Partial<HistoryItem> = {}): HistoryItem => ({
  id: `history_${Date.now()}`,
  url: 'https://example.com/post/123',
  title: 'Test Post Title',
  platform: 'Generic',
  extractedAt: Date.now(),
  commentsCount: 10,
  comments: mockComments(10),
  ...overrides,
});

export const mockTask = (overrides: Partial<Task> = {}): Task => ({
  id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  type: 'extract',
  status: 'pending',
  url: 'https://example.com/post/123',
  platform: 'Generic',
  progress: 0,
  startTime: Date.now(),
  tokensUsed: 0,
  ...overrides,
});

export const mockAIConfig = (overrides: Partial<AIConfig> = {}): AIConfig => ({
  apiUrl: 'https://api.openai.com/v1',
  apiKey: 'test-api-key',
  model: 'gpt-4o-mini',
  maxTokens: 4000,
  temperature: 0.7,
  topP: 1.0,
  ...overrides,
});

export const mockSettings = (overrides: Partial<Settings> = {}): Settings => ({
  maxComments: 100,
  language: LANGUAGES.DEFAULT,
  aiModel: mockAIConfig(),
  analyzerPromptTemplate: '',
  selectorRetryAttempts: 3,
  selectorCache: [],
  domAnalysisConfig: {
    initialDepth: 3,
    expandDepth: 2,
    maxDepth: 10,
  },
  developerMode: false,
  ...overrides,
});

export const mockDomStructure = (): string => `
<div class="comments-container">
  <div class="comment" data-id="1">
    <span class="author">User 1</span>
    <p class="content">First comment content</p>
    <span class="likes">10 likes</span>
    <span class="time">2 hours ago</span>
  </div>
  <div class="comment" data-id="2">
    <span class="author">User 2</span>
    <p class="content">Second comment content</p>
    <span class="likes">5 likes</span>
    <span class="time">1 hour ago</span>
    <div class="replies">
      <div class="reply" data-id="2-1">
        <span class="author">User 3</span>
        <p class="content">Reply to second comment</p>
      </div>
    </div>
  </div>
</div>
`.trim();

export const mockApiResponse = (content: string): { content: string; tokensUsed: number } => ({
  content,
  tokensUsed: Math.floor(content.length / 4),
});

export const mockAnalysisResult = () => ({
  summary: 'Test analysis summary',
  sentiment: {
    positive: 0.6,
    neutral: 0.3,
    negative: 0.1,
  },
  topics: ['topic1', 'topic2', 'topic3'],
  keyInsights: ['Insight 1', 'Insight 2'],
  tokensUsed: 500,
});

export const mockScraperConfig = () => ({
  name: 'Test Scraper',
  urlPattern: 'example.com/*',
  selectors: {
    container: '.comments-container',
    comment: '.comment',
    author: '.author',
    content: '.content',
    likes: '.likes',
    timestamp: '.time',
  },
  structure: {
    hasReplies: true,
    repliesNested: true,
    needsExpand: false,
  },
});
