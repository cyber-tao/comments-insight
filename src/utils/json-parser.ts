import { REGEX } from '@/config/constants';
import { ExtensionError, ErrorCode } from '@/utils/errors';

/**
 * Scans `text` starting at `startIndex` (which must point at `open`) and
 * returns the index of the matching closing brace/bracket, or -1 if the
 * structure is unbalanced. Strings and escapes are honoured so that braces
 * inside string literals are not counted.
 */
function findBalancedEnd(text: string, startIndex: number, open: string, close: string): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) {
      depth += 1;
    } else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function stripCodeFences(raw: string): string {
  let text = raw.trim();
  if (text.includes('```')) {
    text = text.replace(REGEX.MD_CODE_JSON_START, '').replace(REGEX.MD_CODE_ANY_END, '').trim();
  }
  return text;
}

function extractJsonRegion(text: string, open: '{' | '['): string {
  const close = open === '{' ? '}' : ']';
  const start = text.indexOf(open);
  if (start === -1) {
    return text;
  }
  const balancedEnd = findBalancedEnd(text, start, open, close);
  if (balancedEnd !== -1) {
    return text.substring(start, balancedEnd + 1);
  }
  // Fallback: greedy slice between first opener and last closer. Preserves
  // legacy behaviour for outputs that omit a trailing brace despite being
  // otherwise well-formed.
  const lastClose = text.lastIndexOf(close);
  if (lastClose > start) {
    return text.substring(start, lastClose + 1);
  }
  return text;
}

export function cleanAndParseJsonObject<T = unknown>(raw: string): T {
  const text = extractJsonRegion(stripCodeFences(raw), '{');
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new ExtensionError(
      ErrorCode.AI_INVALID_RESPONSE,
      `Failed to parse JSON object: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export function cleanAndParseJsonArray<T = unknown>(raw: string): T[] {
  const text = extractJsonRegion(stripCodeFences(raw), '[');
  try {
    return JSON.parse(text) as T[];
  } catch (e) {
    throw new ExtensionError(
      ErrorCode.AI_INVALID_RESPONSE,
      `Failed to parse JSON array: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
