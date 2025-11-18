// Scraper configuration types

export interface ScraperSelectors {
  postTitle?: string; // Post/video title selector (optional, fallback to document.title)
  videoTime?: string; // Video/post publication time selector (optional)
  commentContainer: string; // Container wrapping a comment thread (comment + replies)
  commentItem: string; // Element containing the main comment content (relative to container)
  replyToggle?: string; // Button inside container to expand replies (optional)
  replyContainer?: string; // Element holding replies for the current comment (optional)
  replyItem?: string; // Element for each reply inside replyContainer (optional)
  username: string; // Selector for username relative to the main comment item
  content: string; // Selector for comment content relative to the main comment item
  timestamp: string; // Selector for timestamp relative to the main comment item
  likes: string; // Selector for likes count relative to the main comment item
}

export interface SelectorValidation {
  [key: string]: 'success' | 'failed' | 'untested';
}

export interface ScrollConfig {
  enabled: boolean; // Whether to enable auto-scrolling
  maxScrolls: number; // Maximum number of scrolls
  scrollDelay: number; // Delay between scrolls (ms)
}

export interface ScraperConfig {
  id: string; // Unique identifier
  name: string; // Configuration name
  domains: string[]; // Matching domains (e.g., ["youtube.com", "www.youtube.com"])
  urlPatterns: string[]; // URL regex patterns (e.g., ["/watch\\?v="])
  selectors: ScraperSelectors; // CSS selectors for extraction
  scrollConfig?: ScrollConfig; // Scroll configuration (optional)
  selectorValidation?: SelectorValidation; // Validation status for each selector
  createdAt: number; // Creation timestamp
  updatedAt: number; // Last update timestamp
}

export interface ScraperConfigList {
  configs: ScraperConfig[];
  version: string;
}
