import { DATE_TIME } from '../config/constants';

export type DateTimeSeparator = ' ' | 'T';

const pad = (value: number): string => value.toString().padStart(DATE_TIME.PAD_LENGTH, '0');

export function formatDateTimeFromDate(
  date: Date,
  dateTimeSeparator: DateTimeSeparator = ' ',
): string {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + DATE_TIME.MONTH_OFFSET);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}${DATE_TIME.DISPLAY_DATE_SEPARATOR}${month}${DATE_TIME.DISPLAY_DATE_SEPARATOR}${day}${dateTimeSeparator}${hours}${DATE_TIME.DISPLAY_TIME_SEPARATOR}${minutes}`;
}

export function formatDateTimeFromTimestamp(
  timestamp: number,
  dateTimeSeparator: DateTimeSeparator = ' ',
): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return formatDateTimeFromDate(date, dateTimeSeparator);
}

export function formatCommentTimestamp(
  timestamp: string,
  dateTimeSeparator: DateTimeSeparator = ' ',
): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return timestamp;
  }
  return formatDateTimeFromDate(parsed, dateTimeSeparator);
}

export function normalizeTimestampToMinute(timestamp: string): string | null {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return formatDateTimeFromDate(parsed, 'T');
}
