// Core type definitions for Comments Insight Extension

export type Platform = string;

// Progress stage for extraction task
export type ProgressStage =
  | 'initializing'
  | 'analyzing'
  | 'detecting'
  | 'extracting'
  | 'expanding'
  | 'scrolling'
  | 'validating'
  | 'complete';

/**
 * Detailed task progress information for enhanced UI feedback
 */
export interface TaskProgress {
  /** Current stage of the task */
  stage: ProgressStage;
  /** Current item being processed (e.g., comment count) */
  current: number;
  /** Total items to process (e.g., max comments) */
  total: number;
  /** Estimated time remaining in seconds, -1 if unknown */
  estimatedTimeRemaining: number;
  /** Stage-specific message */
  stageMessage?: string;
}

export interface Comment {
  id: string;
  username: string;
  userId?: string;
  platform?: string;
  timestamp: string;
  likes: number;
  content: string;
  replies: Comment[];
  isHot?: boolean;
}

// Simplified DOM node for progressive extraction
export interface SimplifiedNode {
  tag: string;
  id?: string;
  classes?: string[];
  attributes?: Record<string, string>;
  text?: string;
  childCount: number;
  expanded: boolean;
  children?: SimplifiedNode[];
  selector: string;
  depth: number;
}

export interface Task {
  id: string;
  type: 'extract' | 'analyze';
  status: 'pending' | 'running' | 'completed' | 'failed';
  url: string;
  platform?: string;
  tabId?: number;
  progress: number;
  startTime: number;
  endTime?: number;
  tokensUsed: number;
  maxComments?: number;
  error?: string;
  message?: string;
  /** Detailed progress information for enhanced UI feedback */
  detailedProgress?: TaskProgress;
}

export interface AIConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  contextWindowSize: number;
  maxOutputTokens?: number;
  temperature: number;
  topP: number;
}

export interface AIRequest {
  prompt: string;
  systemPrompt?: string;
  config: AIConfig;
  timeout?: number;
  signal?: AbortSignal;
}

export interface AIResponse {
  content: string;
  tokensUsed: number;
  finishReason: string;
}

export interface SelectorMap {
  commentContainer: string;
  commentItem?: string;
  replyToggle?: string;
  replyContainer?: string;
  replyItem?: string;
  username?: string;
  timestamp?: string;
  likes?: string;
  content?: string;
}

export interface SelectorCache {
  domain: string;
  platform?: string; // Optional: for backward compatibility
  selectors: SelectorMap;
  lastUsed: number;
  successCount: number;
}

export interface SelectorRule {
  selector: string;
  type: 'css' | 'xpath';
}

export interface FieldSelector {
  name: string;
  rule: SelectorRule;
  attribute?: string;
}

export interface ReplyConfig {
  container: SelectorRule;
  item: SelectorRule;
  fields: FieldSelector[];
  expandBtn?: SelectorRule;
}

export interface CrawlingConfig {
  id: string;
  domain: string;
  siteName?: string;
  container: SelectorRule;
  item: SelectorRule;
  fields: FieldSelector[];
  replies?: ReplyConfig;
  videoTime?: SelectorRule;
  postContent?: SelectorRule;
  lastUpdated: number;
}

export interface DOMAnalysisConfig {
  initialDepth: number; // Initial DOM tree depth for analysis (default: 3)
  expandDepth: number; // Depth when expanding specific nodes (default: 2)
  maxDepth: number; // Maximum depth for full DOM structure (default: 10)
}

export interface Settings {
  maxComments: number;
  aiModel: AIConfig;
  aiTimeout: number; // Timeout in milliseconds
  analyzerPromptTemplate: string;
  language: string; // Language code (e.g., 'zh-CN', 'en-US')
  normalizeTimestamps: boolean;
  exportPostContentInMarkdown: boolean;
  selectorRetryAttempts: number;
  selectorCache: SelectorCache[];
  crawlingConfigs: CrawlingConfig[];
  domAnalysisConfig: DOMAnalysisConfig; // DOM analysis configuration for structure analysis
  developerMode: boolean;
}

export interface AnalysisResult {
  markdown: string;
  summary: {
    totalComments: number;
    sentimentDistribution: {
      positive: number;
      negative: number;
      neutral: number;
    };
    hotComments: Comment[];
    keyInsights: string[];
  };
  tokensUsed: number;
  generatedAt: number;
}

export interface HistoryItem {
  id: string;
  url: string;
  title: string;
  platform: string; // Domain or platform identifier
  videoTime?: string; // Video/post publication time (extracted from page)
  postContent?: string; // Post content or video description (extracted from page)
  extractedAt: number; // When comments were extracted
  commentsCount: number;
  comments: Comment[];
  analysis?: AnalysisResult; // Optional - may not be analyzed yet
  analyzedAt?: number; // When analysis was performed
}

export {
  type Message,
  type MessageType,
  type SystemMessage,
  type SettingsMessage,
  type ExtractionMessage,
  type AnalysisMessage,
  type TaskMessage,
  type HistoryMessage,
  type AIModelMessage,
  type ExportMessage,
} from './messages';

export {
  type PortMessage,
  type PortMessageResponse,
  type PortMessageErrorResponse,
  type MessageHandler,
  type PortMessageHandler,
  type ExtractionResult,
  type TaskResolver,
} from './handlers';
