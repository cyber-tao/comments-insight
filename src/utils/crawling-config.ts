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

export function hasCrawlingConfigContentChanged(
  previous: CrawlingConfig | null | undefined,
  next: CrawlingConfig,
): boolean {
  if (!previous) {
    return true;
  }

  return (
    JSON.stringify(toComparableCrawlingConfig(previous)) !==
    JSON.stringify(toComparableCrawlingConfig(next))
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
