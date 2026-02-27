import { REGEX, DATE_TIME } from '@/config/constants';
import { Logger } from '../../utils/logger';

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
    const pad = (value: number) => value.toString().padStart(DATE_TIME.PAD_LENGTH, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + DATE_TIME.MONTH_OFFSET);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    return `${year}${DATE_TIME.DISPLAY_DATE_SEPARATOR}${month}${DATE_TIME.DISPLAY_DATE_SEPARATOR}${day}T${hours}${DATE_TIME.DISPLAY_TIME_SEPARATOR}${minutes}`;
  }

  static normalizeTimestampToMinute(timestamp: string): string | null {
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return this.formatLocalIsoMinute(parsed);
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
