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

export const TEMPLATE = {
  MIN_LENGTH: 50,
  MAX_LENGTH: 10000,
  COMMENTS_DATA_PLACEHOLDER: '{comments_data}',
};

export const REGEX = {
  DOMAIN_EXTRACT: /^(?:https?:\/\/)?(?:www\.)?([^/?#]+)/i,
  FILENAME_INVALID: /[<>:"/\\|?*]/g,
  WHITESPACE: /\s+/g,
  MD_CODE_JSON_START: /```json\n?/g,
  MD_CODE_ANY_END: /```\n?/g,
  THINK_TAGS: /<think>[\s\S]*?<\/think>/gi,
  LIKES_SANITIZE: /[^0-9KMkm.]/g,
};

export const LIKES = {
  MULTIPLIER_K: 1000,
  MULTIPLIER_M: 1000000,
};

export const EXPORT_DEFAULTS = {
  FILENAME_MAX_LENGTH: 100,
};

export const TOKENIZER = {
  CJK_TOKEN_RATIO: 1.5,
  WORD_TOKEN_RATIO: 1.33,
  PUNCT_TOKEN_RATIO: 1.0,
  RESERVE_RATIO: 0.4,
  MIN_CHUNK_SIZE: 200,
  CHARS_PER_TOKEN: 4,
};
