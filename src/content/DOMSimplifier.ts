import { SimplifiedNode } from '../types';
import { getShadowRoot } from '@/utils/dom-query';
import { Logger } from '@/utils/logger';
import { DOM } from '@/config/constants';

/**
 * Options for DOM simplification.
 */
interface SimplificationOptions {
  /** Maximum depth to traverse (default: 2) */
  maxDepth?: number;
  /** Current depth in recursion (internal use) */
  currentDepth?: number;
  /** Force expansion of parent elements */
  forceExpandParent?: boolean;
  /** Include text content in output */
  includeText?: boolean;
  textMode?: 'preview' | 'full';
  /** Maximum number of nodes to process */
  maxNodes?: number;
  /** Elements to ignore during simplification */
  ignoreElements?: WeakSet<Element> | Set<Element>;
  /** Parent selector to avoid full tree traversal */
  parentSelector?: string;
}

/**
 * DOMSimplifier converts complex DOM structures into lightweight
 * simplified representations suitable for AI analysis.
 *
 * This class uses a singleton pattern to avoid repeated instantiation
 * and maintains a selector cache for performance.
 *
 * Features:
 * - Converts DOM elements to SimplifiedNode structures
 * - Handles Shadow DOM traversal
 * - Generates unique CSS selectors for elements
 * - Limits output size with maxDepth and maxNodes
 * - Caches selectors for performance
 *
 * @example
 * ```typescript
 * const simplified = DOMSimplifier.simplifyForAI(document.body, {
 *   maxDepth: 10,
 *   includeText: true,
 *   maxNodes: 1000,
 * });
 * const htmlString = DOMSimplifier.toStringFormat(simplified);
 * ```
 */
export class DOMSimplifier {
  private selectorCache = new WeakMap<Element, string>();
  private nodeCount = 0;
  private deferredElements: Element[] = [];

  takeDeferredElements(): Element[] {
    const pending = this.deferredElements;
    this.deferredElements = [];
    return pending;
  }

  /**
   * Simplify a DOM element to a lightweight structure
   */
  simplifyElement(element: Element, options: SimplificationOptions = {}): SimplifiedNode {
    const {
      maxDepth = DOM.DEFAULT_EXPAND_DEPTH,
      currentDepth = 0,
      forceExpandParent = false,
      includeText = true,
      maxNodes = DOM.SIMPLIFY_MAX_NODES,
    } = options;

    // Reset node counter at the entry point (when called externally, not recursively)
    if (currentDepth === 0) {
      this.nodeCount = 0;
      this.deferredElements = [];
    }

    this.nodeCount++;

    const shadowRoot = getShadowRoot(element);
    const forceExpandCurrent = shadowRoot !== null || this.shouldForceExpandElement(element);

    // Stop expanding if we hit node limit (but allow current node)
    const nodeLimitReached = this.nodeCount >= Math.max(1, maxNodes);

    const shouldExpand =
      !nodeLimitReached && (forceExpandParent || forceExpandCurrent || currentDepth < maxDepth);

    // Light DOM children
    const lightChildren = Array.from(element.children).filter(
      (child) => !this.shouldIgnoreElement(child as Element, options),
    );

    let children: SimplifiedNode[] | undefined;
    let currentSelector = '';
    let truncated = false;
    const simplifyChildren = (elements: Element[]): SimplifiedNode[] => {
      const result: SimplifiedNode[] = [];
      for (const child of elements) {
        if (this.shouldIgnoreElement(child, options)) continue;
        if (this.nodeCount >= Math.max(1, maxNodes)) {
          truncated = true;
          if (options.textMode === 'full') this.deferredElements.push(child);
          continue;
        }
        result.push(
          this.simplifyElement(child, {
            ...options,
            currentDepth: currentDepth + 1,
            forceExpandParent: forceExpandParent || forceExpandCurrent,
            parentSelector: currentSelector,
          }),
        );
      }
      return result;
    };

    if (shouldExpand) {
      currentSelector = this.generateSelector(element, options.parentSelector);
      children = [];

      // 1. Add Shadow Root as a virtual child node if present
      if (shadowRoot) {
        const shadowChildrenRaw = Array.from(shadowRoot.children);
        // We typically want to see inside shadow root if we are expanding the host
        const shadowChildrenProcessed = simplifyChildren(shadowChildrenRaw);

        if (shadowChildrenProcessed.length > 0) {
          children.push({
            tag: '#shadow-root',
            id: undefined,
            classes: [],
            attributes: { mode: shadowRoot.mode },
            text: undefined,
            childCount: shadowChildrenRaw.length,
            expanded: true,
            children: shadowChildrenProcessed,
            selector: '',
            depth: currentDepth + 1,
          });
        }
      }

      // 2. Add Light DOM children
      const lightChildrenProcessed = simplifyChildren(lightChildren);
      children.push(...lightChildrenProcessed);
    } else {
      currentSelector = this.generateSelector(element, options.parentSelector);
      truncated = lightChildren.length > 0 || Boolean(shadowRoot?.children.length);
      if (options.textMode === 'full') {
        this.deferredElements.push(
          ...lightChildren,
          ...Array.from(shadowRoot?.children || []).filter(
            (child) => !this.shouldIgnoreElement(child, options),
          ),
        );
      }
    }

    const node: SimplifiedNode = {
      tag: element.tagName.toLowerCase(),
      id: element.id || undefined,
      classes: this.getClasses(element),
      attributes: this.getKeyAttributes(element),
      text: includeText ? this.getTextPreview(element, options.textMode === 'full') : undefined,
      childCount: lightChildren.length + (shadowRoot ? 1 : 0),
      expanded: shouldExpand && (children ? children.length > 0 : false),
      children,
      selector: currentSelector,
      depth: currentDepth,
      ...(truncated ? { truncated: true } : {}),
    };

    // Mark if element has Shadow DOM (keep this attribute for reference)
    if (shadowRoot) {
      node.attributes = { ...node.attributes, 'has-shadow-root': 'true' };
    }

    return node;
  }

  private shouldIgnoreElement(element: Element, options?: SimplificationOptions): boolean {
    if (options?.ignoreElements?.has(element)) {
      return true;
    }

    const tag = element.tagName.toLowerCase();
    // Ignore technical tags
    if (
      [
        'script',
        'style',
        'svg',
        'path',
        'noscript',
        'meta',
        'link',
        'iframe',
        'head',
        'hr',
        'link',
      ].includes(tag)
    ) {
      return true;
    }

    // Ignore obviously hidden elements
    if (element.getAttribute('hidden') !== null || element.getAttribute('aria-hidden') === 'true') {
      return true;
    }

    return false;
  }

  private shouldForceExpandElement(element: Element): boolean {
    const tag = element.tagName.toLowerCase();
    if (tag.includes('-')) {
      return true; // Custom elements often container important info
    }

    const id = element.id?.toLowerCase();
    if (
      id &&
      (id.includes('comment') ||
        id.includes('reply') ||
        id.includes('contents') ||
        id.includes('discussion') ||
        id.includes('feed'))
    ) {
      return true;
    }

    const className = typeof element.className === 'string' ? element.className.toLowerCase() : '';
    if (
      className.includes('comment') ||
      className.includes('reply') ||
      className.includes('thread') ||
      className.includes('content') ||
      className.includes('discussion') ||
      className.includes('feed')
    ) {
      return true;
    }

    const role = element.getAttribute('role')?.toLowerCase();
    if (role && (role.includes('comment') || role.includes('article') || role.includes('feed'))) {
      return true;
    }

    return false;
  }

  /**
   * Get classes from element (handles both string and DOMTokenList)
   */
  private getClasses(element: Element): string[] | undefined {
    try {
      // Use classList which is more reliable
      if (element.classList && element.classList.length > 0) {
        return Array.from(element.classList);
      }

      // Fallback to className if it's a string
      const className = element.className;
      if (typeof className === 'string' && className.trim()) {
        return className.split(/\s+/).filter(Boolean);
      }

      return undefined;
    } catch (error) {
      Logger.warn('[DOMSimplifier] Failed to get classes', { error });
      return undefined;
    }
  }

  /**
   * Get key attributes that might help identify comment elements
   */
  private getKeyAttributes(element: Element): Record<string, string> | undefined {
    const ignoredAttrs = new Set([
      'style',
      'd', // SVG path data (usually huge)
      'onclick',
      'onmouseover',
      'onmouseout',
      'onmousedown',
      'onmouseup',
      'onkeydown',
      'onkeyup',
      'onkeypress',
      'onchange',
      'onsubmit',
      'class',
      'id',
    ]);
    const attrs: Record<string, string> = {};
    let hasAttrs = false;

    if (element.attributes) {
      for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes[i];
        if (ignoredAttrs.has(attr.name)) {
          continue;
        }

        // Skip event handlers just in case
        if (attr.name.startsWith('on')) {
          continue;
        }

        let value = attr.value;
        // Truncate long values to save tokens
        if (value.length > DOM.ATTRIBUTE_MAX_LENGTH) {
          value = value.substring(0, DOM.ATTRIBUTE_MAX_LENGTH) + '...';
        }

        attrs[attr.name] = value;
        hasAttrs = true;
      }
    }

    return hasAttrs ? attrs : undefined;
  }

  /**
   * Get a preview of text content (first 100 chars)
   */
  private getTextPreview(element: Element, full: boolean = false): string | undefined {
    // Get direct text nodes only (not from children)
    const textNodes: string[] = [];
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim();
        if (text) {
          textNodes.push(text);
        }
      }
    }

    const fullText = textNodes.join(' ').trim();
    if (!fullText) return undefined;

    return !full && fullText.length > DOM.TEXT_PREVIEW_LENGTH
      ? fullText.substring(0, DOM.TEXT_PREVIEW_LENGTH) + '...'
      : fullText;
  }

  /**
   * Generate a unique CSS selector for an element
   */
  private getCssEscape(): ((value: string) => string) | null {
    const css = globalThis.CSS as { escape?: (value: string) => string } | undefined;
    return typeof css?.escape === 'function' ? css.escape.bind(css) : null;
  }

  private escapeAttributeValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  private canUseBareCssIdentifier(value: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value);
  }

  private buildIdSelector(id: string): string {
    const escape = this.getCssEscape();
    if (escape) {
      return `#${escape(id)}`;
    }
    if (this.canUseBareCssIdentifier(id)) {
      return `#${id}`;
    }
    return `[id="${this.escapeAttributeValue(id)}"]`;
  }

  private buildClassSelector(className: string): string {
    const escape = this.getCssEscape();
    if (escape) {
      return `.${escape(className)}`;
    }
    if (this.canUseBareCssIdentifier(className)) {
      return `.${className}`;
    }
    return `[class~="${this.escapeAttributeValue(className)}"]`;
  }

  private generateSelector(
    element: Element,
    knownParentSelector?: string,
    depth: number = 0,
  ): string {
    if (this.selectorCache.has(element)) {
      return this.selectorCache.get(element)!;
    }

    const maxSelectorDepth = DOM.MAX_SELECTOR_DEPTH;
    if (depth > maxSelectorDepth) {
      const fallbackSelector = element.tagName.toLowerCase();
      this.selectorCache.set(element, fallbackSelector);
      return fallbackSelector;
    }

    let selector = element.tagName.toLowerCase();

    if (element.id) {
      selector = this.buildIdSelector(element.id);
      this.selectorCache.set(element, selector);
      return selector;
    }

    const classes = this.getClasses(element);
    if (classes && classes.length > 0) {
      selector += classes.map((className) => this.buildClassSelector(className)).join('');
    }

    const parent: Element | null = element.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children);
      const index = siblings.indexOf(element);
      if (siblings.filter((sibling: Element) => sibling.tagName === element.tagName).length > 1) {
        selector += `:nth-child(${index + 1})`;
      }
    }

    let fullSelector = selector;
    if (knownParentSelector) {
      fullSelector = `${knownParentSelector} > ${selector}`;
    } else if (parent && parent !== document.body) {
      fullSelector = `${this.generateSelector(parent, undefined, depth + 1)} > ${selector}`;
    }

    this.selectorCache.set(element, fullSelector);
    return fullSelector;
  }

  /**
   * Convert simplified node to string format for AI
   * @param node - Simplified node
   * @param indent - Indent level
   * @returns String representation
   */
  public nodeToString(node: SimplifiedNode, indent: number = 0): string {
    const spaces = '  '.repeat(indent);
    let result = `${spaces}<${node.tag}`;

    // Add ID
    if (node.id) {
      result += ` id="${node.id}"`;
    }

    // Add classes
    if (node.classes && node.classes.length > 0) {
      result += ` class="${node.classes.join(' ')}"`;
    }

    // Add attributes
    if (node.attributes) {
      for (const [key, value] of Object.entries(node.attributes)) {
        result += ` ${key}="${value}"`;
      }
    }

    // Add child count if not expanded
    if (!node.expanded && node.childCount > 0) {
      result += ` childCount="${node.childCount}"`;
    }

    result += '>';

    let hasContent = false;

    // Add text content if available
    if (node.text && node.text.trim().length > 0) {
      result += ` ${node.text}`;
      hasContent = true;
    }

    // Add children if expanded
    if (node.expanded && node.children && node.children.length > 0) {
      result += '\n';
      for (const child of node.children) {
        result += this.nodeToString(child, indent + 1) + '\n';
      }
      result += spaces;
    } else if (!node.expanded && node.childCount > 0) {
      if (!hasContent) result += '\n'; // Only add newline if no text was added inline
      result += `${spaces}  <!-- ${node.childCount} children (not expanded) -->`;
      if (!hasContent) result += `\n${spaces}`;
    }

    result += `</${node.tag}>`;

    return result;
  }
}
