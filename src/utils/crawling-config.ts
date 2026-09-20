import type { CrawlingConfig } from '@/types';

type ComparableCrawlingConfig = Omit<
  CrawlingConfig,
  'id' | 'domain' | 'lastUpdated' | 'fieldValidation'
>;

const toComparableCrawlingConfig = ({
  id: _id,
  domain: _domain,
  lastUpdated: _lastUpdated,
  fieldValidation: _fieldValidation,
  ...config
}: CrawlingConfig): ComparableCrawlingConfig => config;

// Persisted configs are rewritten by the storage schema, which emits keys in
// declaration order rather than the bundled JSON order. Compare canonically so
// an untouched bundled rule is never mistaken for a user override.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, canonicalize(entryValue)]),
    );
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hasCrawlingConfigContentChanged(
  previous: CrawlingConfig | null | undefined,
  next: CrawlingConfig,
): boolean {
  if (!previous) {
    return true;
  }

  return (
    stableStringify(toComparableCrawlingConfig(previous)) !==
    stableStringify(toComparableCrawlingConfig(next))
  );
}

export function hasPersistedCrawlingConfigChanged(
  previous: CrawlingConfig | null | undefined,
  next: CrawlingConfig,
): boolean {
  return hasCrawlingConfigContentChanged(previous, next);
}

export function crawlingConfigsFingerprint(configs: CrawlingConfig[]): string {
  return stableStringify(
    configs
      .map((config) => ({
        domain: config.domain.trim().toLowerCase(),
        ...toComparableCrawlingConfig(config),
      }))
      .sort((a, b) => a.domain.localeCompare(b.domain)),
  );
}

export function resolveCrawlingConfigLastUpdated({
  previous,
  next,
  preferredLastUpdated,
  now = Date.now(),
}: {
  previous?: CrawlingConfig | null;
  next: CrawlingConfig;
  preferredLastUpdated?: number;
  now?: number;
}): number {
  if (!previous) {
    return typeof preferredLastUpdated === 'number'
      ? preferredLastUpdated
      : typeof next.lastUpdated === 'number'
        ? next.lastUpdated
        : now;
  }

  if (!hasCrawlingConfigContentChanged(previous, next)) {
    return previous.lastUpdated;
  }

  const candidate =
    typeof preferredLastUpdated === 'number'
      ? preferredLastUpdated
      : typeof next.lastUpdated === 'number'
        ? next.lastUpdated
        : undefined;

  return typeof candidate === 'number' && candidate !== previous.lastUpdated ? candidate : now;
}
