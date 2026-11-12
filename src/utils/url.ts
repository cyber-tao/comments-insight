import { API, HOST, REGEX } from '@/config/constants';
import type { AIProtocol } from '@/types';

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
  return hostname.startsWith(HOST.WWW_PREFIX) ? hostname.slice(HOST.WWW_PREFIX.length) : hostname;
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
  return hostname === domain || hostname.endsWith('.' + domain) || domain.endsWith('.' + hostname);
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

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1' ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

export function parseAllowedAiApiUrl(value: string): URL | null {
  try {
    const parsed = new URL(value.trim());
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.username ||
      parsed.password ||
      (parsed.protocol === 'http:' && !isLoopbackHostname(parsed.hostname))
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function normalizeAiApiUrl(value: string): string | null {
  const parsed = parseAllowedAiApiUrl(value);
  if (!parsed) {
    return null;
  }

  const pathname = aiBasePath(parsed.pathname);
  parsed.pathname = pathname || '/';
  parsed.hash = '';
  parsed.searchParams.sort();
  return parsed.toString();
}

function aiBasePath(pathname: string): string {
  const path = pathname.replace(/\/+$/, '');
  const suffix = [
    API.ENDPOINTS.CHAT_COMPLETIONS,
    API.ENDPOINTS.RESPONSES,
    API.ENDPOINTS.MESSAGES,
  ].find((endpoint) => path.endsWith(endpoint));
  return suffix ? path.slice(0, -suffix.length) : path;
}

function buildAiEndpointUrl(value: string, endpoint: string): string | null {
  const parsed = parseAllowedAiApiUrl(value);
  if (!parsed) {
    return null;
  }

  parsed.pathname = `${aiBasePath(parsed.pathname)}${endpoint}`;
  parsed.hash = '';
  return parsed.toString();
}

export function buildAiRequestUrl(value: string, protocol: AIProtocol): string | null {
  const endpoints: Record<AIProtocol, string> = {
    'openai-chat-completions': API.ENDPOINTS.CHAT_COMPLETIONS,
    'openai-responses': API.ENDPOINTS.RESPONSES,
    'anthropic-messages': API.ENDPOINTS.MESSAGES,
  };
  return endpoints[protocol] ? buildAiEndpointUrl(value, endpoints[protocol]) : null;
}

export function buildAiModelsUrl(value: string): string | null {
  return buildAiEndpointUrl(value, API.ENDPOINTS.MODELS);
}
