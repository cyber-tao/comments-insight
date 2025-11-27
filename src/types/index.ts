// Core type definitions for Comments Insight Extension

// Platform is now determined by scraper config domain, not hardcoded
export type Platform = string;

// Progress stage for extraction task
export type ProgressStage =
  | 'analyzing'
  | 'extracting'
  | 'expanding'
  | 'scrolling'
  | 'validating'
  | 'complete';

export interface Comment {
  id: string;
  username: string;
  userId?: string;
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

// AI extraction response for progressive extraction removed

export interface Task {
  id: string;
  type: 'extract' | 'analyze';
  status: 'pending' | 'running' | 'completed' | 'failed';
  url: string;
  platform?: string;
  progress: number;
  startTime: number;
  endTime?: number;
  tokensUsed: number;
  maxComments?: number;
  error?: string;
  message?: string;
}

export interface AIConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  topP: number;
}

export interface AIRequest {
  prompt: string;
  systemPrompt?: string;
  config: AIConfig;
  signal?: AbortSignal;
}

export interface AIResponse {
  content: string;
  tokensUsed: number;
  finishReason: string;
}

export interface SelectorMap {
  commentContainer: string;
  commentItem: string;
  replyToggle?: string;
  replyContainer?: string;
  replyItem?: string;
  username: string;
  timestamp: string;
  likes: string;
  content: string;
}

export interface SelectorCache {
  domain: string;
  platform?: string; // Optional: for backward compatibility
  selectors: SelectorMap;
  lastUsed: number;
  successCount: number;
}

export interface DOMAnalysisConfig {
  initialDepth: number; // Initial DOM tree depth for analysis (default: 3)
  expandDepth: number; // Depth when expanding specific nodes (default: 2)
  maxDepth: number; // Maximum depth for full DOM structure (default: 10)
}

export interface Settings {
  maxComments: number;
  aiModel: AIConfig;
  analyzerPromptTemplate: string;
  language: string; // Language code (e.g., 'zh-CN', 'en-US')
  selectorRetryAttempts: number;
  selectorCache: SelectorCache[];
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
  type ScraperConfigMessage,
  type AIModelMessage,
  type ExportMessage,
} from './messages';
