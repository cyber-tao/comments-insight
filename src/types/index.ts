// Core type definitions for Comments Insight Extension

export type Platform = 
  | 'youtube' 
  | 'bilibili' 
  | 'weibo' 
  | 'douyin' 
  | 'twitter' 
  | 'tiktok' 
  | 'reddit' 
  | 'unknown';

export interface Comment {
  id: string;
  username: string;
  userId?: string;
  avatar?: string;
  timestamp: string;
  likes: number;
  content: string;
  replies: Comment[];
  isHot?: boolean;
  platform: Platform;
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
  platform: Platform;
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
  username: string;
  content: string;
  timestamp: string;
  likes: string;
  avatar?: string;
  replyButton?: string;
  replyToggle?: string;
  replyContainer?: string;
  replyItem?: string;
}

export interface SelectorCache {
  domain: string;
  platform: Platform;
  selectors: SelectorMap;
  lastUsed: number;
  successCount: number;
}

export interface Settings {
  maxComments: number;
  extractorModel: AIConfig;
  analyzerModel: AIConfig;
  analyzerPromptTemplate: string;
  language: 'zh-CN' | 'en-US';
  selectorRetryAttempts: number;
  selectorCache: SelectorCache[];
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
  platform: Platform;
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
  | 'PING';

export interface Message {
  type: MessageType;
  payload?: any;
}
