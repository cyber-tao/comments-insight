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
  /** Minimum progress bar width percent */
  PROGRESS_MIN_PERCENT: 0,
  /** Maximum progress bar width percent */
  PROGRESS_MAX_PERCENT: 100,
  /** Minimum visible progress bar width percent */
  MIN_PROGRESS_WIDTH_PERCENT: 5,
  MODEL_SELECT_VISIBLE_ITEMS: 8,
  MODEL_SELECT_ITEM_HEIGHT_PX: 36,
};

export const ICONS = {
  ICON_48: 'icons/icon-48.png',
  ICON_128: 'icons/icon-128.png',
};

export const PATHS = {
  HISTORY_PAGE: 'src/history/index.html',
  OPTIONS_PAGE: 'src/options/index.html',
  LOGS_PAGE: 'src/logs/index.html',
};

export const PAGINATION = {
  DEFAULT_PER_PAGE: 20,
  OPTIONS: [10, 20, 50, 100],
};

export const HISTORY_UI = {
  LIST_ITEM_HEIGHT: 108,
  LIST_OVERSCAN: 4,
  MAX_COMMENT_DEPTH: 10,
};

export const NOTIFICATION_KEYS = {
  EXTRACTION_COMPLETED: 'notification.extractionCompleted',
  ANALYSIS_COMPLETED: 'notification.analysisCompleted',
  CONFIG_GENERATION_COMPLETED: 'notification.configGenerationCompleted',
  EXTRACTION_FAILED: 'notification.extractionFailed',
  ANALYSIS_FAILED: 'notification.analysisFailed',
  CONFIG_GENERATION_FAILED: 'notification.configGenerationFailed',
  COMMENTS_COUNT: 'notification.commentsCount',
  COMMENTS_ANALYZED: 'notification.commentsAnalyzed',
} as const;

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

export const TEXT = {
  UNTITLED: 'Untitled',
  UNKNOWN: 'unknown',
  CONTENT_SCRIPT_INJECT_FAILED: 'Failed to inject content script. Please refresh the page.',
  EXTRACTION_CANCELLED_BY_USER: 'Extraction cancelled by user',
  EXTRACTION_TASK_TIMEOUT: 'Extraction timed out waiting for completion signal',
  CONFIG_TASK_TIMEOUT: 'Config generation timed out waiting for completion signal',
  ANALYSIS_TASK_TIMEOUT: 'Analysis timed out and was aborted',
  TASK_SOURCE_TAB_CLOSED: 'Task source tab was closed before completion',
  MODEL_TEST_HINT: 'Please verify API URL, API key, and network connectivity.',
  NO_RESPONSE_FROM_MODEL:
    'AI returned an empty response. Please retry or check the model output settings.',
  NO_ANALYZABLE_COMMENTS:
    'No comments could fit within the configured context window. Please reduce comment size or use a larger context window.',
  TRUNCATED_SUFFIX: '... [Truncated]',
  PREVIEW_SUFFIX: '...',
};

/**
 * Error message i18n keys for internationalization.
 * These keys map to translations in src/locales/*.json files.
 * Use with i18n.t() to get localized error messages.
 */
