import { REGEX } from '@/config/constants';
import { ExtensionError, ErrorCode } from '@/utils/errors';

export function cleanAndParseJsonObject<T = unknown>(raw: string): T {
  let text = raw.trim();
  if (text.includes('```')) {
    text = text.replace(REGEX.MD_CODE_JSON_START, '').replace(REGEX.MD_CODE_ANY_END, '').trim();
  }
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1) {
    text = text.substring(jsonStart, jsonEnd + 1);
  }
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
  let text = raw.trim();
  if (text.includes('```')) {
    text = text.replace(REGEX.MD_CODE_JSON_START, '').replace(REGEX.MD_CODE_ANY_END, '').trim();
  }
  const jsonStart = text.indexOf('[');
  const jsonEnd = text.lastIndexOf(']');
  if (jsonStart !== -1 && jsonEnd !== -1) {
    text = text.substring(jsonStart, jsonEnd + 1);
  }
  try {
    return JSON.parse(text) as T[];
  } catch (e) {
    throw new ExtensionError(
      ErrorCode.AI_INVALID_RESPONSE,
      `Failed to parse JSON array: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
