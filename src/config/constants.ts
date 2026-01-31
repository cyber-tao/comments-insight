export const RETRY = {
  INITIAL_DELAY_MS: 1000,
  MAX_DELAY_MS: 10000,
  MAX_ATTEMPTS: 3,
  SELECTOR_ATTEMPTS: 3,
};

/**
 * Supported languages configuration
 * To add a new language:
 * 1. Add entry to SUPPORTED with code and display name
 * 2. Create the locale file in src/locales/
 * 3. Import and register it in src/utils/i18n.ts
 */
export const THEME = {
  LIGHT: 'light' as const,
  DARK: 'dark' as const,
  SYSTEM: 'system' as const,
  OPTIONS: [
    { value: 'light', labelKey: 'options.themeLight' },
    { value: 'dark', labelKey: 'options.themeDark' },
    { value: 'system', labelKey: 'options.themeSystem' },
  ] as const,
  DEFAULT: 'system' as const,
  STORAGE_KEY: 'theme' as const,
};

export const LANGUAGES = {
  /** Supported languages with display names */
  SUPPORTED: [
    { code: 'zh-CN', name: '中文' },
    { code: 'en-US', name: 'English' },
    { code: 'ja-JP', name: '日本語' },
    { code: 'fr-FR', name: 'Français' },
    { code: 'es-ES', name: 'Español' },
  ] as const,
  /** Default language code */
  DEFAULT: 'en-US' as const,
  /** Fallback language when detection fails */
  FALLBACK: 'en-US' as const,
};

export const TEMPLATE = {
  MIN_LENGTH: 50,
  MAX_LENGTH: 10000,
};

export const SECURITY = {
  SALT_LENGTH: 16,
  IV_LENGTH: 12,
  SECRET_LENGTH: 32,
  PBKDF2_ITERATIONS: 100_000,
  PBKDF2_HASH: 'SHA-256' as const,
};

export const AI = {
  ESTIMATE_WORD_WEIGHT: 0.75,
  ESTIMATE_PUNCT_WEIGHT: 0.25,
  ESTIMATE_CHAR_DIVISOR: 10,
  HOT_COMMENTS_LIMIT: 10,
  CONFIDENCE_THRESHOLD: 0.5,
  LOW_CONFIDENCE_THRESHOLD: 0.3,
  HIGH_CONFIDENCE_THRESHOLD: 0.7,
  DEFAULT_CONFIDENCE: 0.8,
  DEFAULT_CONTEXT_WINDOW: 16384,
  DEFAULT_MAX_OUTPUT_TOKENS: 4096,
  DEFAULT_TEMPERATURE: 0.7,
  DEFAULT_TOP_P: 0.9,
  DEFAULT_TIMEOUT: 120000,
  MAX_CONCURRENT_REQUESTS: 3,
  TOKEN_SAFETY_FACTOR: 0.5,
  INPUT_TOKEN_BUFFER: 2000,
  MIN_AVAILABLE_TOKENS: 1000,
  CONFIDENCE_HIGH_THRESHOLD: 0.9,
  DEFAULT_MODELS: [
    'gpt-4',
    'gpt-4-turbo',
    'gpt-3.5-turbo',
    'claude-3-opus',
    'claude-3-sonnet',
    'claude-3-haiku',
  ] as readonly string[],
};

export const ANALYSIS_FORMAT = {
  COMMENT_HEADER: 'Username | Timestamp | Likes | Content',
  FIELD_SEPARATOR: ' | ',
  REPLY_PREFIX: '↳ ',
  UNKNOWN_USERNAME: 'Unknown',
  UNKNOWN_TIMESTAMP: 'N/A',
  UNKNOWN_PLATFORM: 'Unknown Platform',
  UNKNOWN_TITLE: 'Untitled',
  UNKNOWN_URL: 'N/A',
  UNKNOWN_CONTENT: 'N/A',
};

export const TIME_NORMALIZATION = {
  PATH_SEPARATOR: '.',
  ITEM_TOKEN_ESTIMATE: 40,
};

export const DATE_TIME = {
  PAD_LENGTH: 2,
  MONTH_OFFSET: 1,
  DISPLAY_DATE_SEPARATOR: '-',
  DISPLAY_TIME_SEPARATOR: ':',
  DISPLAY_DATE_TIME_SEPARATOR: ' ',
};

export const HISTORY = {
  SORT_DESC: true,
  MAX_ITEMS: 200,
  COMMENTS_CHUNK_SIZE: 8000,
};

export const INJECTION = {
  PING_RETRY_ATTEMPTS: 10,
  PING_RETRY_DELAY_MS: 100,
};

export const API = {
  DEFAULT_URL: 'https://api.openai.com/v1',
  EXAMPLE_COMPLETIONS_URL: 'https://api.openai.com/v1',
  CRAWLING_CONFIGS_RAW_URL:
    'https://raw.githubusercontent.com/cyber-tao/comments-insight/refs/heads/master/src/config/default_rules.json',
  CRAWLING_CONFIGS_URL:
    'https://github.com/cyber-tao/comments-insight/blob/master/src/config/default_rules.json',
};

export const PATHS = {
  HISTORY_PAGE: 'src/history/index.html',
  OPTIONS_PAGE: 'src/options/index.html',
  LOGS_PAGE: 'src/logs/index.html',
};

export const ICONS = {
  ICON_48: 'icons/icon-48.png',
  ICON_128: 'icons/icon-128.png',
};

export const SCRIPTS = {
  CONTENT_MAIN: 'src/content/index.ts',
};

export const STORAGE = {
  SETTINGS_KEY: 'settings',
  HISTORY_KEY: 'history',
  HISTORY_INDEX_KEY: 'history_index',
  HISTORY_URL_INDEX_KEY: 'history_url_index',
  ENCRYPTION_SALT_KEY: 'encryption_salt',
  ENCRYPTION_SECRET_KEY: 'encryption_secret',
  TOKEN_STATS_KEY: 'token_stats',
  LOG_LEVEL_KEY: 'log_min_level',
  SYSTEM_LOG_INDEX_KEY: 'system_log_index',
  AI_LOG_INDEX_KEY: 'ai_log_index',
  TASK_STATE_KEY: 'task_state',
  SELECTOR_TESTER_STATE_KEY: 'selector_tester_state',
};

export const SCRAPER_GENERATION = {
  MAX_TEXT_SAMPLES: 16,
};

export const LOG_PREFIX = {
  SYSTEM: 'log_',
  AI: 'ai_log_',
};

export const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

export const HOST = {
  WWW_PREFIX: 'www.',
};

export const REGEX = {
  DOMAIN_EXTRACT: /^(?:https?:\/\/)?(?:www\.)?([^\/\?#]+)/i,
  FILENAME_INVALID: /[<>:"\/\\|?*]/g,
  WHITESPACE: /\s+/g,
  MD_CODE_JSON_START: /```json\n?/g,
  MD_CODE_ANY_END: /```\n?/g,
  THINK_TAGS: /<think>[\s\S]*?<\/think>/gi,
  LIKES_SANITIZE: /[^0-9KMkm.]/g,
};

export const MESSAGES = {
  PING: 'PING',
  ENSURE_CONTENT_SCRIPT: 'ENSURE_CONTENT_SCRIPT',
  GET_PLATFORM_INFO: 'GET_PLATFORM_INFO',
  EXTRACTION_PROGRESS: 'EXTRACTION_PROGRESS',
  GET_SETTINGS: 'GET_SETTINGS',
  SAVE_SETTINGS: 'SAVE_SETTINGS',
  AI_ANALYZE_STRUCTURE: 'AI_ANALYZE_STRUCTURE',
  AI_EXTRACT_CONTENT: 'AI_EXTRACT_CONTENT',
  EXTRACTION_COMPLETED: 'EXTRACTION_COMPLETED',
  TASK_UPDATE: 'TASK_UPDATE',
  START_EXTRACTION: 'START_EXTRACTION',
  START_CONFIG_GENERATION: 'START_CONFIG_GENERATION',
  CONFIG_GENERATION_COMPLETED: 'CONFIG_GENERATION_COMPLETED',
  CANCEL_EXTRACTION: 'CANCEL_EXTRACTION',
  GET_DOM_STRUCTURE: 'GET_DOM_STRUCTURE',
  GET_TASK_STATUS: 'GET_TASK_STATUS',
  GET_HISTORY_BY_URL: 'GET_HISTORY_BY_URL',
  GET_HISTORY: 'GET_HISTORY',
  START_ANALYSIS: 'START_ANALYSIS',
  EXPORT_DATA: 'EXPORT_DATA',
  GET_AVAILABLE_MODELS: 'GET_AVAILABLE_MODELS',
  TEST_MODEL: 'TEST_MODEL',
  TEST_SELECTOR: 'TEST_SELECTOR',
  DELETE_HISTORY: 'DELETE_HISTORY',
  CLEAR_ALL_HISTORY: 'CLEAR_ALL_HISTORY',
  CANCEL_TASK: 'CANCEL_TASK',
  CACHE_SELECTOR: 'CACHE_SELECTOR',
  GET_CRAWLING_CONFIG: 'GET_CRAWLING_CONFIG',
  SAVE_CRAWLING_CONFIG: 'SAVE_CRAWLING_CONFIG',
  GENERATE_CRAWLING_CONFIG: 'GENERATE_CRAWLING_CONFIG',
  SYNC_CRAWLING_CONFIGS: 'SYNC_CRAWLING_CONFIGS',
} as const;

export const TEXT = {
  APP_NAME: 'Comments Insight',
  TASK_FAILED_TITLE: 'Comments Insight - Task Failed',
  VIEW_RESULTS: 'View Results',
  DISMISS: 'Dismiss',
  ERROR_TITLE: 'Comments Insight Error',
  NOTIFICATION_AUTOCLEAR_MS: 10000,
  TASK_ALREADY_RUNNING: 'Task is already in progress. Please wait for it to complete.',
  COPY_SUCCESS: 'Copied to clipboard!',
  COPY_FAILED: 'Failed to copy to clipboard',
  LOGS_CLEARED: 'All logs cleared',
  CONFIRM_DELETE_LOG: 'Delete this log?',
  CONFIRM_CLEAR_LOGS: 'Clear all logs? This cannot be undone!',
  VIEW_AI_LOGS: 'View AI Logs',
  UNTITLED: 'Untitled',
  DEFAULT_MODEL_NAME: 'gpt-4',
  API_KEY_PLACEHOLDER: 'sk-',
  CONTENT_SCRIPT_INJECT_FAILED: 'Failed to inject content script. Please refresh the page.',
  MODEL_TEST_HINT: 'Please verify API URL, API key, and network connectivity.',
};

/**
 * Error message i18n keys for internationalization.
 * These keys map to translations in src/locales/*.json files.
 * Use with i18n.t() to get localized error messages.
 */
export const ERROR_KEYS = {
  FAILED_TO_SAVE_SETTINGS: 'errors.failedToSaveSettings',
  FAILED_TO_EXPORT_SETTINGS: 'errors.failedToExportSettings',
  INVALID_SETTINGS_FORMAT: 'errors.invalidSettingsFormat',
  FAILED_TO_IMPORT_SETTINGS: 'errors.failedToImportSettings',
  FAILED_TO_SAVE_HISTORY: 'errors.failedToSaveHistory',
  FAILED_TO_DELETE_HISTORY: 'errors.failedToDeleteHistory',
  TASK_CANCELLED_BY_USER: 'errors.taskCancelledByUser',
  TASK_INTERRUPTED_BY_RESTART: 'errors.taskInterruptedByRestart',
  URL_REQUIRED: 'errors.urlRequired',
  NO_TAB_ID_AVAILABLE: 'errors.noTabIdAvailable',
  PROMPT_REQUIRED: 'errors.promptRequired',
  COMMENTS_ARRAY_REQUIRED: 'errors.commentsArrayRequired',
  HISTORY_ITEM_ID_REQUIRED: 'errors.historyItemIdRequired',
  INVALID_EXPORT_TYPE: 'errors.invalidExportType',
  API_CONFIG_REQUIRED: 'errors.apiConfigRequired',
  COMPLETE_MODEL_CONFIG_REQUIRED: 'errors.completeModelConfigRequired',
  NO_RESPONSE_FROM_MODEL: 'errors.noResponseFromModel',
  FAILED_TO_GET_DOM_STRUCTURE: 'errors.failedToGetDomStructure',
  CONFIG_DATA_REQUIRED: 'errors.configDataRequired',
  CONFIG_ID_REQUIRED: 'errors.configIdRequired',
  SELECTOR_VALIDATION_PARAMS_REQUIRED: 'errors.selectorValidationParamsRequired',
  SETTINGS_DATA_REQUIRED: 'errors.settingsDataRequired',
  TASK_ID_REQUIRED: 'errors.taskIdRequired',
} as const;

export const DEFAULTS = {
  LOGS_MAX_STORED: 100,
  AI_LOGS_MAX_STORED: 100,
  MAX_COMMENTS: 500,
  FILENAME_MAX_LENGTH: 100,
  SENTIMENT_POSITIVE: 33,
  SENTIMENT_NEGATIVE: 33,
  SENTIMENT_NEUTRAL: 34,
  HOT_COMMENTS_PREVIEW: 5,
};

export const DOM_ANALYSIS_DEFAULTS = {
  initialDepth: 5,
  expandDepth: 3,
  maxDepth: 25,
};

export const EXTRACTION_PROGRESS = {
  AI_ANALYZING: 10,
  CONFIG_ANALYZING: 15,
  UNKNOWN_COUNT: 15,
  MIN: 20,
  RANGE: 75,
  VALIDATING: 80,
  NORMALIZING: 90,
  MAX: 95,
  COMPLETE: 100,
};

export const EXTRACTION = {
  VALIDATION_BUFFER_RATIO: 0.1,
  VALIDATION_BUFFER_MIN: 10,
  VALIDATION_BUFFER_MAX: 200,
};

export const EXTRACTION_PROGRESS_MESSAGE = {
  SEPARATOR: ':',
  MIN_PARTS: 3,
  CURRENT_INDEX: 1,
  TOTAL_INDEX: 2,
};

export const TOKENIZER = {
  CJK_TOKEN_RATIO: 1.5,
  WORD_TOKEN_RATIO: 1.33,
  PUNCT_TOKEN_RATIO: 1.0,
  RESERVE_RATIO: 0.4,
  MIN_CHUNK_SIZE: 200,
};

export const TIMING = {
  MICRO_WAIT_MS: 100,
  SCROLL_PAUSE_MS: 150,
  SHORT_WAIT_MS: 200,
  DOM_SETTLE_MS: 300,
  SCROLL_BASE_DELAY_MS: 500,
  AI_RETRY_DELAY_MS: 1000,
  SCROLL_DELAY_MS: 1500,
  PAGE_INIT_DELAY_MS: 2000,
  POLL_TASK_RUNNING_MS: 1000,
  CLEAR_TASK_DELAY_MS: 2000,
  CLEAR_TASK_FAILED_MS: 5000,
  DEBOUNCE_SAVE_MS: 500,
  TASK_STATE_PERSIST_DEBOUNCE_MS: 300,
  EXPAND_REPLY_MAX: 800,
  REPLY_POLL_INTERVAL_MS: 200,
  REPLY_POLL_TIMEOUT_MS: 6000,
  SCROLL_INTO_VIEW_WAIT_MS: 300,
  RENDER_STABILITY_WAIT_MS: 100,
};

export const SCROLL = {
  DEFAULT_MAX_SCROLLS: 10,
  SELECTOR_MAX_SCROLL_ATTEMPTS: 20,
  SCROLL_STEP_RATIO: 0.8,
  REPLY_EXPAND_REPORT_INTERVAL: 5,
  REPLY_EXPAND_SCROLL_FREQUENCY: 2,
  UNCHANGED_SCROLL_THRESHOLD: 5,
  CONTAINER_SCROLL_STEP: 500,
};

export const DOM = {
  SIMPLIFY_MAX_DEPTH: 10,
  SIMPLIFY_MAX_NODES: 1000,
  DEFAULT_EXPAND_DEPTH: 2,
  TEXT_PREVIEW_LENGTH: 100,
  HTML_PREVIEW_LENGTH: 200,
  SAMPLE_NODES_THRESHOLD: 30,
  SAMPLE_NODES_COUNT: 10,
  CHILDREN_LIMIT: 20,
  CHILDREN_MAX: 50,
  MAX_EXTRACT_DEPTH: 20,
  NO_NEW_COMMENTS_THRESHOLD: 5,
  DETECT_MAX_NODES_BASE: 2500,
  DETECT_MAX_NODES_FACTOR: 100,
  EXTRACT_MAX_NODES_BASE: 5000,
  EXTRACT_MAX_NODES_FACTOR: 200,
  DETECT_MIN_DEPTH: 10,
  INDENT: '  ',
};

export const CLICK = {
  LOAD_MORE_MAX: 5,
  REPLY_TOGGLE_MAX: 50,
};

export const TIMEOUT = {
  WAIT_ELEMENT_MS: 10000,
  COMMENTS_SECTION_MS: 5000,
  MESSAGE_RESPONSE_MS: 10000,
  MIN_AI_SECONDS: 30,
  MAX_AI_SECONDS: 600,
  MS_PER_SEC: 1000,
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

export const PERFORMANCE = {
  MAX_METRICS_COUNT: 1000,
  SLOW_OPERATION_THRESHOLD_MS: 100,
  MEMORY_CHECK_INTERVAL_MS: 30000,
  MEMORY_START_DELAY_MS: 5000,
};

export const MEMORY = {
  HIGH_USAGE_THRESHOLD_PERCENT: 80,
  BYTES_PER_MB: 1024 * 1024,
};

export const LIMITS = {
  API_KEY_MASK_PREFIX: 4,
  API_KEY_MASK_SUFFIX: 4,
  API_KEY_MASK_MIN_LENGTH: 8,
  API_KEY_MASK_MAX_STARS: 20,
  RANDOM_ID_START_INDEX: 2,
  ID_RANDOM_LENGTH: 9,
  MODEL_RESPONSE_PREVIEW_LENGTH: 100,
  LOG_PROMPT_PREVIEW_LENGTH: 500,
  NOTIFICATION_TITLE_MAX_LENGTH: 50,
  EXPORT_ISO_TIMESTAMP_LENGTH: 19,
  SELECTOR_TEST_MAX_RESULTS: 50,
  SELECTOR_TEST_MAX_TEXT_LENGTH: 200,
  SELECTOR_TEST_MAX_QUERY_LENGTH: 1000,
};

/**
 * UI input field limits for Options page
 */
export const UI_LIMITS = {
  /** Max comments input range */
  MAX_COMMENTS_MIN: 1,
  MAX_COMMENTS_MAX: 10000,
  /** Temperature range (0-2) */
  TEMPERATURE_MIN: 0,
  TEMPERATURE_MAX: 2,
  /** Top P range (0-1) */
  TOP_P_MIN: 0,
  TOP_P_MAX: 1,
  /** DOM analysis depth limits */
  INITIAL_DEPTH_MIN: 1,
  INITIAL_DEPTH_MAX: 5,
  EXPAND_DEPTH_MIN: 1,
  EXPAND_DEPTH_MAX: 3,
  MAX_DEPTH_MIN: 5,
  MAX_DEPTH_MAX: 50,
  /** Prompt template textarea rows */
  PROMPT_TEXTAREA_ROWS: 10,
};
