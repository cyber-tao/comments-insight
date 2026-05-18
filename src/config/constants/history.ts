export const HISTORY = {
  MAX_ITEMS: 200,
  // Maximum number of full HistoryItem records to scan during a comment-content search.
  // Metadata-only searches use Dexie indexes and do not rely on this cap.
  SEARCH_FULL_SCAN_HARD_CAP: 500,
};

export const COMMENT_HASH = {
  SEED_1: 0xdeadbeef,
  SEED_2: 0x41c6ce57,
  MULT_1: 2654435761,
  MULT_2: 1597334677,
  XOR_1: 2246822507,
  XOR_2: 3266489909,
  FINAL_MULT: 4294967296,
  FINAL_MASK: 2097151,
  RADIX: 36,
};
