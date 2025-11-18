// Core type definitions for Comments Insight Extension

// Platform is now determined by scraper config domain, not hardcoded
export type Platform = string;

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

// AI extraction response for progressive extraction
export interface AIExtractionResponse {
  comments: Comment[];
  nodesToExpand: {
    selector: string;
    reason: string;
    priority: number;
  }[];
  needsScroll: boolean;
  completed: boolean;
  analysis: string;
}

export interface Task {
  id: string;
  type: 'extract' | 'analyze';
  status: 'pending' | 'running' | 'completed' | 'failed';
  url: string;
  platform?: string; // Optional: domain or platform identifier
  progress: number;
  startTime: number;
  endTime?: number;
  tokensUsed: number;
  error?: string;
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

export interface SelectorValidation {
  [key: string]: 'success' | 'failed' | 'untested';
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
  language: 'zh-CN' | 'en-US';
  selectorRetryAttempts: number;
  selectorCache: SelectorCache[];
  domAnalysisConfig: DOMAnalysisConfig; // DOM analysis configuration for structure analysis
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

export type MessageType =
  | 'START_EXTRACTION'
  | 'AI_EXTRACT_COMMENTS'
  | 'AI_EXTRACT_PROGRESSIVE'
  | 'AI_ANALYZE_STRUCTURE'
  | 'EXTRACTION_PROGRESS'
  | 'START_ANALYSIS'
  | 'GET_TASK_STATUS'
  | 'CANCEL_TASK'
  | 'GET_SETTINGS'
  | 'SAVE_SETTINGS'
  | 'GET_HISTORY'
  | 'GET_HISTORY_BY_URL'
  | 'DELETE_HISTORY'
  | 'CLEAR_ALL_HISTORY'
  | 'EXPORT_DATA'
  | 'GET_AVAILABLE_MODELS'
  | 'TEST_MODEL'
  | 'CHECK_SCRAPER_CONFIG'
  | 'GENERATE_SCRAPER_CONFIG'
  | 'GET_SCRAPER_CONFIGS'
  | 'SAVE_SCRAPER_CONFIG'
  | 'DELETE_SCRAPER_CONFIG'
  | 'UPDATE_SELECTOR_VALIDATION'
  | 'PING';

export interface Message {
  type: MessageType;
  payload?: any;
}
