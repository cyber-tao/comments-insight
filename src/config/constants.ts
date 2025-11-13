export const SECURITY = {
  SALT_LENGTH: 16,
  IV_LENGTH: 12,
  PBKDF2_ITERATIONS: 100_000,
  PBKDF2_HASH: 'SHA-256' as const,
};

export const AI = {
  TOKEN_RESERVE_RATIO: 0.4,
  ESTIMATE_WORD_WEIGHT: 0.75,
  ESTIMATE_PUNCT_WEIGHT: 0.25,
  ESTIMATE_CHAR_DIVISOR: 10,
  HOT_COMMENTS_LIMIT: 10,
};

export const HISTORY = {
  SORT_DESC: true,
};

export const API = {
  DEFAULT_URL: 'https://api.openai.com/v1',
  EXAMPLE_COMPLETIONS_URL: 'https://api.openai.com/v1/chat/completions',
};

export const PATHS = {
  DEFAULT_SCRAPERS_JSON: 'src/config/default-scrapers.json',
  HISTORY_PAGE: 'src/history/index.html',
  OPTIONS_PAGE: 'src/options/index.html',
  LOGS_PAGE: 'src/logs/index.html',
};

export const ICONS = {
  ICON_48: 'icons/icon-48.png',
  ICON_128: 'icons/icon-128.png',
};

export const STORAGE = {
  SETTINGS_KEY: 'settings',
  HISTORY_KEY: 'history',
  HISTORY_INDEX_KEY: 'history_index',
  ENCRYPTION_SALT_KEY: 'encryption_salt',
};

export const LOG_PREFIX = {
  SYSTEM: 'log_',
  AI: 'ai_log_',
};

export const HOST = {
  WWW_PREFIX: 'www.',
};

export const REGEX = {
  DOMAIN_EXTRACT: /^(?:https?:\/\/)?(?:www\.)?([^\/\?#]+)/i,
  FILENAME_INVALID: /[<>:"/\\|?*]/g,
  WHITESPACE: /\s+/g,
  MD_CODE_JSON_START: /```json\n?/g,
  MD_CODE_ANY_END: /```\n?/g,
  THINK_TAGS: /<think>[\s\S]*?<\/think>/gi,
  LIKES_SANITIZE: /[^0-9KMkm.]/g,
};

export const MESSAGES = {
  PING: 'PING',
  GET_PLATFORM_INFO: 'GET_PLATFORM_INFO',
  EXTRACTION_PROGRESS: 'EXTRACTION_PROGRESS',
  CHECK_SCRAPER_CONFIG: 'CHECK_SCRAPER_CONFIG',
  AI_EXTRACT_COMMENTS: 'AI_EXTRACT_COMMENTS',
  AI_EXTRACT_PROGRESSIVE: 'AI_EXTRACT_PROGRESSIVE',
  GET_SETTINGS: 'GET_SETTINGS',
  SAVE_SETTINGS: 'SAVE_SETTINGS',
  UPDATE_SELECTOR_VALIDATION: 'UPDATE_SELECTOR_VALIDATION',
  AI_ANALYZE_STRUCTURE: 'AI_ANALYZE_STRUCTURE',
  TASK_UPDATE: 'TASK_UPDATE',
  START_EXTRACTION: 'START_EXTRACTION',
  CANCEL_EXTRACTION: 'CANCEL_EXTRACTION',
  GET_DOM_STRUCTURE: 'GET_DOM_STRUCTURE',
  GET_TASK_STATUS: 'GET_TASK_STATUS',
  GET_HISTORY_BY_URL: 'GET_HISTORY_BY_URL',
  GENERATE_SCRAPER_CONFIG: 'GENERATE_SCRAPER_CONFIG',
  GET_HISTORY: 'GET_HISTORY',
  START_ANALYSIS: 'START_ANALYSIS',
  EXPORT_DATA: 'EXPORT_DATA',
  GET_AVAILABLE_MODELS: 'GET_AVAILABLE_MODELS',
  TEST_MODEL: 'TEST_MODEL',
  DELETE_HISTORY: 'DELETE_HISTORY',
  CLEAR_ALL_HISTORY: 'CLEAR_ALL_HISTORY',
  CANCEL_TASK: 'CANCEL_TASK',
  GET_SCRAPER_CONFIGS: 'GET_SCRAPER_CONFIGS',
  SAVE_SCRAPER_CONFIG: 'SAVE_SCRAPER_CONFIG',
  DELETE_SCRAPER_CONFIG: 'DELETE_SCRAPER_CONFIG',
};

export const TEXT = {
  APP_NAME: 'Comments Insight',
  TASK_FAILED_TITLE: 'Comments Insight - Task Failed',
  VIEW_RESULTS: 'View Results',
  DISMISS: 'Dismiss',
  ERROR_TITLE: 'Comments Insight Error',
  NOTIFICATION_AUTOCLEAR_MS: 10000,
  SCRAPER_CONFIG_GENERATED: 'Scraper configuration generated successfully!',
  SCRAPER_CONFIG_GENERATE_FAILED_WITH_MSG: 'Failed to generate configuration: ',
  SCRAPER_CONFIG_GENERATE_FAILED: 'Failed to generate configuration',
  TASK_ALREADY_RUNNING: 'Task is already in progress. Please wait for it to complete.',
  COPY_SUCCESS: 'Copied to clipboard!',
  COPY_FAILED: 'Failed to copy to clipboard',
  LOGS_CLEARED: 'All logs cleared',
  CONFIRM_DELETE_LOG: 'Delete this log?',
  CONFIRM_CLEAR_LOGS: 'Clear all logs? This cannot be undone!',
  VIEW_AI_LOGS: 'View AI Logs',
  UNTITLED: 'Untitled',
  DEFAULT_MODEL_NAME: 'gpt-4',
  API_KEY_PLACEHOLDER: 'sk-...',
};

export const TIMING = {
  XS: 100,
  SM: 200,
  MD: 300,
  LG: 500,
  XL: 1000,
  XXL: 1500,
  XXXL: 2000,
  POLL_TASK_RUNNING_MS: 1000,
  CLEAR_TASK_DELAY_MS: 2000,
  CLEAR_TASK_FAILED_MS: 5000,
  DEBOUNCE_SAVE_MS: 500,
};

export const SCROLL = {
  DEFAULT_MAX_SCROLLS: 10,
  SELECTOR_MAX_SCROLL_ATTEMPTS: 20,
  PROGRESSIVE_SCROLLS_PER_ITERATION: 2,
};

export const DOM = {
  SIMPLIFY_MAX_DEPTH: 10,
  SIMPLIFY_MAX_NODES: 1000,
};

export const CLICK = {
  LOAD_MORE_MAX: 5,
};

export const TIMEOUT = {
  WAIT_ELEMENT_MS: 10000,
  COMMENTS_SECTION_MS: 5000,
};

export const SELECTORS = {
  COMMON_COMMENT_CONTAINER:
    '[role="article"], .comment, .reply, #comments, [id*="comment"], [class*="comment"]',
  REPLY_TOGGLE: '[aria-label*="repl"], .show-replies, .load-replies',
  COMMENT_ELEMENTS: '[role="article"], .comment, .reply-item, .comments-section, .comment-section',
};

export const PAGINATION = {
  DEFAULT_PER_PAGE: 20,
  OPTIONS: [10, 20, 50, 100],
};
