import { ScraperConfig } from './scraper';

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

// AI extraction response for progressive extraction removed

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
  extractionPromptTemplate: string; // Template for AI comment extraction
  language: 'zh-CN' | 'en-US';
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

// Discriminated Union for Messages
export type Message =
  | { type: 'PING'; payload?: never }
  | { type: 'GET_PLATFORM_INFO'; payload?: never }
  | {
      type: 'EXTRACTION_PROGRESS';
      payload: { taskId: string; progress: number; message: string; data?: any };
    }
  | { type: 'CHECK_SCRAPER_CONFIG'; payload: { url: string } }
  | { type: 'AI_EXTRACT_COMMENTS'; payload: { domStructure: string } }
  // AI_EXTRACT_PROGRESSIVE removed
  | { type: 'GET_SETTINGS'; payload?: never }
  | { type: 'SAVE_SETTINGS'; payload: { settings: Settings } }
  | {
      type: 'UPDATE_SELECTOR_VALIDATION';
      payload: {
        configId: string;
        selectorKey: string;
        status: 'success' | 'failed' | 'untested';
        count?: number;
      };
    }
  | { type: 'AI_ANALYZE_STRUCTURE'; payload: { prompt: string } }
  | { type: 'TASK_UPDATE'; payload: Task }
  | { type: 'START_EXTRACTION'; payload: { url: string; maxComments?: number } }
  | { type: 'CANCEL_EXTRACTION'; payload: { taskId: string } }
  | { type: 'GET_DOM_STRUCTURE'; payload?: never }
  | { type: 'GET_TASK_STATUS'; payload?: { taskId?: string } }
  | { type: 'GET_HISTORY_BY_URL'; payload: { url: string } }
  | {
      type: 'GENERATE_SCRAPER_CONFIG';
      payload: {
        url: string;
        domStructure?: string;
        platform?: string;
        title?: string;
      };
    }
  | {
      type: 'GET_HISTORY';
      payload?: { page?: number; limit?: number; query?: string; id?: string };
    }
  | {
      type: 'START_ANALYSIS';
      payload: {
        comments: Comment[];
        historyId?: string;
        promptTemplate?: string;
        language?: string;
        metadata?: {
          platform?: string;
          url?: string;
          title?: string;
          datetime?: string;
          videoTime?: string;
        };
      };
    }
  | {
      type: 'EXPORT_DATA';
      payload:
        | { type: 'settings' }
        | { format: 'csv' | 'md' | 'json'; taskId: string }
        | { format: 'csv' | 'md' | 'json'; historyId: string };
    }
  | {
      type: 'GET_AVAILABLE_MODELS';
      payload: { apiUrl: string; apiKey: string };
    }
  | { type: 'TEST_MODEL'; payload: { config: AIConfig } }
  | { type: 'DELETE_HISTORY'; payload: { id: string } }
  | { type: 'CLEAR_ALL_HISTORY'; payload?: never }
  | { type: 'CANCEL_TASK'; payload: { taskId: string } }
  | { type: 'GET_SCRAPER_CONFIGS'; payload?: never }
  | { type: 'SAVE_SCRAPER_CONFIG'; payload: { config: ScraperConfig } }
  | { type: 'DELETE_SCRAPER_CONFIG'; payload: { id: string } }
  | { type: 'TEST_SELECTOR_QUERY'; payload: { selector: string } };

export type MessageType = Message['type'];