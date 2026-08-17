export const LOG_PREFIX = {
  SYSTEM: 'log_',
  AI: 'ai_log_',
};

export const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

export const LOG_DEFAULTS = {
  LOGS_MAX_STORED: 100,
  AI_LOGS_MAX_STORED: 100,
};

export const LOG_SANITIZE = {
  SENSITIVE_FIELD_NAMES: [
    'apiKey',
    'apikey',
    'api_key',
    'token',
    'password',
    'secret',
    'credential',
    'authorization',
    'auth',
  ] as const,
  API_KEY_PATTERNS: [
    /sk-[A-Za-z0-9]{20,}/g,
    /key-[A-Za-z0-9]{20,}/g,
    /Bearer\s+[A-Za-z0-9._-]{20,}/gi,
    /\b(?=[A-Za-z0-9]{32,}\b)(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{32,}\b/g,
  ] as const,
  MASK_VISIBLE_CHARS: 4,
  MASK_CHAR: '*',
};
