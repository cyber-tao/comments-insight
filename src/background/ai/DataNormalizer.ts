import { REGEX } from '@/config/constants';
import { Logger } from '../../utils/logger';
import {
  formatDateTimeFromDate,
  normalizeTimestampToMinute as normalizeTimestamp,
} from '@/utils/date-formatter';

export class DataNormalizer {
  static parseTimestampNormalizationResponse(
    content: string,
  ): Array<{ path: string; timestamp: string }> | null {
    let jsonText = content.trim();
    jsonText = jsonText
      .replace(REGEX.MD_CODE_JSON_START, '')
      .replace(REGEX.MD_CODE_ANY_END, '')
      .trim();
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) {
        return null;
      }
      return parsed.filter(
        (item): item is { path: string; timestamp: string } =>
          item &&
          typeof item === 'object' &&
          typeof item.path === 'string' &&
          typeof item.timestamp === 'string',
      );
    } catch (error) {
      Logger.warn('[DataNormalizer] Failed to parse timestamp normalization response', { error });
    }
    return null;
  }

  static formatLocalIsoMinute(date: Date): string {
    return formatDateTimeFromDate(date, 'T');
  }

  static normalizeTimestampToMinute(timestamp: string): string | null {
    return normalizeTimestamp(timestamp);
  }

  static removeThinkTags(content: string): string {
    return content.replace(REGEX.THINK_TAGS, '').trim();
  }

  static normalizeTextValue(value: string | undefined | null, fallback: string): string {
    const normalized = (value ?? '').toString().replace(/\s+/g, ' ').trim();
    return normalized || fallback;
  }

  static formatLikesValue(likes?: number): string {
    if (typeof likes !== 'number' || Number.isNaN(likes)) {
      return '0';
    }
    return String(Math.max(0, Math.round(likes)));
  }
}
