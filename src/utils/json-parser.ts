import { REGEX } from '@/config/constants';

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
  return JSON.parse(text) as T;
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
  return JSON.parse(text) as T[];
}
