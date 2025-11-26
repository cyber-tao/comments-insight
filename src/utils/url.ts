import { HOST, REGEX } from '@/config/constants';

export interface ParsedUrl {
  hostname: string;
  domain: string;
  origin: string;
  pathname: string;
  search: string;
  hash: string;
  isValid: boolean;
}

export function parseUrl(url: string): ParsedUrl {
  const invalid: ParsedUrl = {
    hostname: '',
    domain: '',
    origin: '',
    pathname: '',
    search: '',
    hash: '',
    isValid: false,
  };

  if (!url) {
    return invalid;
  }

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const domain = extractDomain(hostname);

    return {
      hostname,
      domain,
      origin: urlObj.origin,
      pathname: urlObj.pathname,
      search: urlObj.search,
      hash: urlObj.hash,
      isValid: true,
    };
  } catch {
    const match = url.match(REGEX.DOMAIN_EXTRACT);
    if (match && match[1]) {
      const hostname = match[1];
      return {
        hostname,
        domain: extractDomain(hostname),
        origin: '',
        pathname: '',
        search: '',
        hash: '',
        isValid: true,
      };
    }
    return invalid;
  }
}

export function extractDomain(hostname: string): string {
  if (!hostname) {
    return '';
  }
  return hostname.startsWith(HOST.WWW_PREFIX)
    ? hostname.slice(HOST.WWW_PREFIX.length)
    : hostname;
}

export function getHostname(url: string): string {
  return parseUrl(url).hostname;
}

export function getDomain(url: string): string {
  return parseUrl(url).domain;
}

export function matchesDomain(hostname: string, domain: string): boolean {
  if (!hostname || !domain) {
    return false;
  }
  return (
    hostname === domain ||
    hostname.endsWith('.' + domain) ||
    domain.endsWith('.' + hostname)
  );
}

export function getCurrentDomain(): string {
  if (typeof window !== 'undefined') {
    return extractDomain(window.location.hostname);
  }
  return '';
}

export function getCurrentHostname(): string {
  if (typeof window !== 'undefined') {
    return window.location.hostname;
  }
  return '';
}

