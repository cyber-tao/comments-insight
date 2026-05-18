export const API = {
  DEFAULT_URL: 'https://api.openai.com/v1',
  EXAMPLE_COMPLETIONS_URL: 'https://api.openai.com/v1',
  CRAWLING_CONFIGS_RAW_URL:
    'https://raw.githubusercontent.com/cyber-tao/comments-insight/refs/heads/master/src/config/default_rules.json',
  CRAWLING_CONFIGS_URL:
    'https://github.com/cyber-tao/comments-insight/blob/master/src/config/default_rules.json',
  ENDPOINTS: {
    CHAT_COMPLETIONS: '/chat/completions',
    MODELS: '/models',
  },
};

export const CHROME_MESSAGE_ERRORS = {
  TIMEOUT: 'Message timeout',
  PORT_CLOSED: 'The message port closed before a response was received',
  RECEIVING_END_MISSING: 'Receiving end does not exist',
};

export const INJECTION = {
  PING_RETRY_ATTEMPTS: 10,
  PING_RETRY_DELAY_MS: 100,
  // URL prefixes/hosts where content scripts cannot run regardless of permissions.
  // Used to short-circuit retries instead of relying on locale-specific Chrome
  // error messages, which differ across browser UI languages.
  RESTRICTED_URL_PREFIXES: [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'about:',
    'view-source:',
    'devtools://',
    'chrome-search://',
    'chrome-untrusted://',
    'chrome-error://',
    'data:',
    'file://',
  ],
  RESTRICTED_HOSTS: ['chrome.google.com', 'chromewebstore.google.com', 'addons.mozilla.org'],
};

export const HOST = {
  WWW_PREFIX: 'www.',
};
