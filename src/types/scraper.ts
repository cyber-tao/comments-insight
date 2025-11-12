// Scraper configuration types

export interface ScraperSelectors {
  postTitle?: string;          // Post/video title selector (optional, fallback to document.title)
  videoTime?: string;          // Video/post publication time selector (optional)
  commentContainer: string;    // Container holding all comments
  commentItem: string;         // Individual comment element
  username: string;            // Username selector
  content: string;             // Comment content selector
  timestamp: string;           // Timestamp selector
  likes: string;               // Likes count selector
  avatar?: string;             // Avatar image selector (optional)
  replyToggle?: string;        // Button to expand replies (optional)
  replyContainer?: string;     // Container holding replies (optional)
  replyItem?: string;          // Individual reply element (optional)
}

export interface SelectorValidation {
  [key: string]: 'success' | 'failed' | 'untested';
}

export interface ScrollConfig {
  enabled: boolean;            // Whether to enable auto-scrolling
  maxScrolls: number;          // Maximum number of scrolls
  scrollDelay: number;         // Delay between scrolls (ms)
}

export interface ScraperConfig {
  id: string;                  // Unique identifier
  name: string;                // Configuration name
  domains: string[];           // Matching domains (e.g., ["youtube.com", "www.youtube.com"])
  urlPatterns: string[];       // URL regex patterns (e.g., ["/watch\\?v="])
  selectors: ScraperSelectors; // CSS selectors for extraction
  scrollConfig?: ScrollConfig; // Scroll configuration (optional)
  selectorValidation?: SelectorValidation; // Validation status for each selector
  createdAt: number;           // Creation timestamp
  updatedAt: number;           // Last update timestamp
}

export interface ScraperConfigList {
  configs: ScraperConfig[];
  version: string;
}
