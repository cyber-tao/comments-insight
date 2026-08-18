import { LIMITS } from '@/config/constants';
import { Logger } from '@/utils/logger';

export interface DeepQueryOptions {
  maxResults?: number;
  maxVisited?: number;
  signal?: AbortSignal;
}

interface DeepQueryContext {
  maxResults: number;
  maxVisited: number;
  results: Element[];
  seen: Set<Element>;
  signal?: AbortSignal;
  visited: number;
}

function normalizeDeepSelector(selector: string): string | null {
  const trimmedSelector = selector.trim();
  if (!trimmedSelector || trimmedSelector.length > LIMITS.SELECTOR_QUERY_MAX_LENGTH) {
    return null;
  }
  return trimmedSelector;
}

function createDeepQueryContext(options: DeepQueryOptions): DeepQueryContext {
  return {
    maxResults: options.maxResults ?? LIMITS.DOM_QUERY_MAX_RESULTS,
    maxVisited: options.maxVisited ?? LIMITS.DOM_QUERY_MAX_VISITED,
    results: [],
    seen: new Set<Element>(),
    signal: options.signal,
    visited: 0,
  };
}

function shouldStopDeepQuery(context: DeepQueryContext): boolean {
  return (
    context.signal?.aborted === true ||
    context.results.length >= context.maxResults ||
    context.visited >= context.maxVisited
  );
}

function visitDeepQueryElement(context: DeepQueryContext): boolean {
  if (shouldStopDeepQuery(context)) {
    return false;
  }
  context.visited += 1;
  return context.visited <= context.maxVisited;
}

function safeQuerySelectorAll(root: Document | Element | ShadowRoot, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function addDeepQueryResult(context: DeepQueryContext, element: Element): void {
  if (!visitDeepQueryElement(context) || context.seen.has(element)) {
    return;
  }
  context.seen.add(element);
  context.results.push(element);
}

function collectDeepQueryResults(
  root: Document | Element | ShadowRoot,
  selector: string,
  context: DeepQueryContext,
): void {
  if (shouldStopDeepQuery(context)) {
    return;
  }

  for (const element of safeQuerySelectorAll(root, selector)) {
    addDeepQueryResult(context, element);
    if (shouldStopDeepQuery(context)) {
      return;
    }
  }

  if (root instanceof Element && root.shadowRoot) {
    collectDeepQueryResults(root.shadowRoot, selector, context);
  }

  const split = splitSelector(selector);
  if (split.rest) {
    for (const candidate of safeQuerySelectorAll(root, split.current)) {
      if (!visitDeepQueryElement(context)) {
        return;
      }
      collectDeepQueryResults(candidate, split.rest, context);
      const shadowRoot = getShadowRoot(candidate);
      if (shadowRoot) {
        collectDeepQueryResults(shadowRoot, split.rest, context);
      }
      if (shouldStopDeepQuery(context)) {
        return;
      }
    }
  }

  // Enumerating '*' only discovers shadow hosts; non-host elements must not
  // consume the visit budget, otherwise large pages (YouTube-scale element
  // counts) exhaust DOM_QUERY_MAX_VISITED before any deep shadow root is
  // reached and results are silently truncated.
  for (const element of safeQuerySelectorAll(root, '*')) {
    const shadowRoot = getShadowRoot(element);
    if (shadowRoot) {
      if (!visitDeepQueryElement(context)) {
        return;
      }
      collectDeepQueryResults(shadowRoot, selector, context);
    }
    if (shouldStopDeepQuery(context)) {
      return;
    }
  }
}

interface ShadowRootHost {
  shadowRoot?: ShadowRoot | null;
}

export function getShadowRoot(element: Element): ShadowRoot | null {
  return (element as unknown as ShadowRootHost).shadowRoot || null;
}

export function querySelectorDeep(
  root: Document | Element | ShadowRoot,
  selector: string,
  options: DeepQueryOptions = {},
): Element | null {
  return querySelectorAllDeep(root, selector, { ...options, maxResults: 1 })[0] || null;
}

export function querySelectorAllDeep(
  root: Document | Element | ShadowRoot,
  selector: string,
  options: DeepQueryOptions = {},
): Element[] {
  const trimmedSelector = normalizeDeepSelector(selector);
  if (!trimmedSelector) {
    return [];
  }

  const context = createDeepQueryContext(options);
  collectDeepQueryResults(root, trimmedSelector, context);
  if (
    context.visited >= context.maxVisited &&
    context.results.length < context.maxResults &&
    context.signal?.aborted !== true
  ) {
    Logger.warn('[dom-query] Visit budget exhausted; results may be truncated', {
      selector: trimmedSelector,
      visited: context.visited,
      results: context.results.length,
    });
  }
  return context.results;
}

export function queryXPathAll(root: Document | Element | ShadowRoot, selector: string): Element[] {
  const trimmedSelector = selector.trim();
  if (!trimmedSelector) {
    return [];
  }

  try {
    const ownerDocument = root instanceof Document ? root : root.ownerDocument || document;
    const snapshot = ownerDocument.evaluate(
      trimmedSelector,
      root,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    const results: Element[] = [];
    for (let i = 0; i < snapshot.snapshotLength; i++) {
      const node = snapshot.snapshotItem(i);
      if (node && node.nodeType === Node.ELEMENT_NODE) {
        results.push(node as Element);
      }
    }
    return results;
  } catch {
    return [];
  }
}

export function splitSelector(selector: string): { current: string; rest?: string } {
  const trimmed = selector.trim();
  let inAttr = false;
  let parenDepth = 0;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === '[') {
      inAttr = true;
      continue;
    }
    if (char === ']') {
      inAttr = false;
      continue;
    }
    if (char === '(') {
      parenDepth++;
      continue;
    }
    if (char === ')') {
      parenDepth = Math.max(parenDepth - 1, 0);
      continue;
    }

    if (inAttr || parenDepth > 0) {
      continue;
    }

    if (char === '>' || char === ' ') {
      let nextIndex = i + 1;
      while (nextIndex < trimmed.length && trimmed[nextIndex] === ' ') {
        nextIndex++;
      }

      const current = trimmed.substring(0, i).trim();
      const rest = trimmed.substring(nextIndex).trim();
      if (current && rest) {
        return { current, rest };
      }
    }
  }

  return { current: trimmed };
}
