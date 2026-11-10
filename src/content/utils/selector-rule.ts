import type { FieldSelector, SelectorRule } from '@/types';
import { querySelectorAllDeep, queryXPathAll } from '@/utils/dom-query';

export function findElementsByRule(
  context: Document | Element,
  rule?: SelectorRule | null,
  maxResults?: number,
): Element[] {
  if (!rule || typeof rule.selector !== 'string' || !rule.selector.trim()) return [];
  if (rule.type === 'xpath') {
    const elements = queryXPathAll(context, rule.selector);
    return maxResults === undefined ? elements : elements.slice(0, maxResults);
  }
  if (rule.type !== 'css') return [];
  return querySelectorAllDeep(context, rule.selector, { maxResults });
}

export function findElementByRule(
  context: Document | Element,
  rule?: SelectorRule | null,
): Element | null {
  return findElementsByRule(context, rule, 1)[0] || null;
}

export function readField(context: Element, field?: FieldSelector): string | null {
  if (!field) return null;
  const element = findElementByRule(context, field.rule);
  if (!element) return null;
  return (
    (field.attribute ? element.getAttribute(field.attribute) : element.textContent)?.trim() || null
  );
}
