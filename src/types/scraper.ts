// Scraper configuration types

export interface ScraperSelectors {
  postTitle?: string;          // Post/video title selector (optional, fallback to document.title)
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

export interface ScrollConfig {
  enabled: boolean;            // Whether to enable auto-scrolling
  maxScrolls: number;          // Maximum number of scrolls
  scrollDelay: number;         // Delay between scrolls (ms)
}

export interface DOMAnalysisConfig {
  initialDepth: number;        // Initial DOM tree depth for analysis (default: 3)
  expandDepth: number;         // Depth when expanding specific nodes (default: 2)
  maxDepth: number;            // Maximum depth for full DOM structure (default: 10)
}

export interface ScraperConfig {
  id: string;                  // Unique identifier
  name: string;                // Configuration name
  domains: string[];           // Matching domains (e.g., ["youtube.com", "www.youtube.com"])
  urlPatterns: string[];       // URL regex patterns (e.g., ["/watch\\?v="])
  selectors: ScraperSelectors; // CSS selectors for extraction
  scrollConfig?: ScrollConfig; // Scroll configuration (optional)
  domAnalysisConfig?: DOMAnalysisConfig; // DOM analysis configuration (optional)
  createdAt: number;           // Creation timestamp
  updatedAt: number;           // Last update timestamp
}

export interface ScraperConfigList {
  configs: ScraperConfig[];
  version: string;
}
