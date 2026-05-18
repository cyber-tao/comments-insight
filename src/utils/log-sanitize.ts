import { LOG_SANITIZE } from '@/config/constants';

export function maskSensitiveValue(value: string): string {
  if (value.length <= LOG_SANITIZE.MASK_VISIBLE_CHARS * 2) {
    return LOG_SANITIZE.MASK_CHAR.repeat(value.length);
  }

  const prefix = value.slice(0, LOG_SANITIZE.MASK_VISIBLE_CHARS);
  const suffix = value.slice(-LOG_SANITIZE.MASK_VISIBLE_CHARS);
  const maskLength = Math.min(value.length - LOG_SANITIZE.MASK_VISIBLE_CHARS * 2, 8);
  return `${prefix}${LOG_SANITIZE.MASK_CHAR.repeat(maskLength)}${suffix}`;
}

export function sanitizeLogText(text: string): string {
  let result = text;
  for (const pattern of LOG_SANITIZE.API_KEY_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    result = result.replace(regex, (match) => maskSensitiveValue(match));
  }
  return result;
}

export function isSensitiveLogField(fieldName: string): boolean {
  const normalized = fieldName.toLowerCase();
  return LOG_SANITIZE.SENSITIVE_FIELD_NAMES.some((field) =>
    normalized.includes(field.toLowerCase()),
  );
}

export function sanitizeLogValue(value: unknown, fieldName?: string): unknown {
  if (typeof value === 'string') {
    return fieldName && isSensitiveLogField(fieldName) && value.length > 0
      ? maskSensitiveValue(value)
      : sanitizeLogText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item));
  }

  if (value !== null && typeof value === 'object') {
    return sanitizeLogObject(value as Record<string, unknown>);
  }

  return value;
}

export function sanitizeLogObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = sanitizeLogValue(value, key);
  }
  return result;
}
