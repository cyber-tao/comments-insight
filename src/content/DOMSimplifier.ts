import { SimplifiedNode } from '../types';
import { getShadowRoot, querySelectorDeep } from '@/utils/dom-query';
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
  /** Maximum number of nodes to process */
  maxNodes?: number;
  /** Internal node counter for limiting */
  _nodeCounter?: { count: number };
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
  private static instance: DOMSimplifier | null = null;
  private selectorCache = new WeakMap<Element, string>();

  /**
   * Get the singleton instance of DOMSimplifier
   * @returns The singleton DOMSimplifier instance
   */
  static getInstance(): DOMSimplifier {
    if (!DOMSimplifier.instance) {
      DOMSimplifier.instance = new DOMSimplifier();
    }
    return DOMSimplifier.instance;
  }

  /**
   * Reset the singleton instance (useful for testing)
   */
  static resetInstance(): void {
    DOMSimplifier.instance = null;
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
      _nodeCounter = { count: 0 },
    } = options;

    _nodeCounter.count++;

    const shadowRoot = getShadowRoot(element);
    const forceExpandCurrent = shadowRoot !== null || this.shouldForceExpandElement(element);

    // Stop expanding if we hit node limit (but allow current node)
    const nodeLimitReached = _nodeCounter.count > maxNodes;

    const shouldExpand =
      !nodeLimitReached && (forceExpandParent || forceExpandCurrent || currentDepth < maxDepth);

    // Light DOM children
    const lightChildren = Array.from(element.children).filter(
      (child) => !this.shouldIgnoreElement(child as Element),
    );

    let children: SimplifiedNode[] | undefined;

    if (shouldExpand) {
      children = [];

      // 1. Add Shadow Root as a virtual child node if present
      if (shadowRoot) {
        const shadowChildrenRaw = Array.from(shadowRoot.children);
        // We typically want to see inside shadow root if we are expanding the host
        const shadowChildrenProcessed = shadowChildrenRaw.map((child) =>
          this.simplifyElement(child as Element, {
            ...options,
            currentDepth: currentDepth + 1,
            forceExpandParent: forceExpandParent || forceExpandCurrent,
            _nodeCounter, // Pass the shared counter
          }),
        );

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
      const lightChildrenProcessed = lightChildren.map((child) =>
        this.simplifyElement(child as Element, {
          ...options,
          currentDepth: currentDepth + 1,
          forceExpandParent: forceExpandParent || forceExpandCurrent,
          _nodeCounter, // Pass the shared counter
        }),
      );
      children.push(...lightChildrenProcessed);
    }

    const node: SimplifiedNode = {
      tag: element.tagName.toLowerCase(),
      id: element.id || undefined,
      classes: this.getClasses(element),
      attributes: this.getKeyAttributes(element),
      text: includeText ? this.getTextPreview(element) : undefined,
      childCount: lightChildren.length + (shadowRoot ? 1 : 0),
      expanded: shouldExpand && (children ? children.length > 0 : false),
      children,
      selector: this.generateSelector(element),
      depth: currentDepth,
    };

    // Mark if element has Shadow DOM (keep this attribute for reference)
    if (shadowRoot) {
      node.attributes = { ...node.attributes, 'has-shadow-root': 'true' };
    }

    return node;
  }

  private shouldIgnoreElement(element: Element): boolean {
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
  private getTextPreview(element: Element): string | undefined {
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

    return fullText.length > DOM.TEXT_PREVIEW_LENGTH
      ? fullText.substring(0, DOM.TEXT_PREVIEW_LENGTH) + '...'
      : fullText;
  }

  /**
   * Generate a unique CSS selector for an element
   */
  private generateSelector(element: Element): string {
    // Check cache first
    if (this.selectorCache.has(element)) {
      return this.selectorCache.get(element)!;
    }

    const parts: string[] = [];
    let current: Element | null = element;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      // Add ID if available (most specific)
      if (current.id) {
        selector = `#${current.id}`;
        parts.unshift(selector);
        break; // ID is unique, we can stop here
      }

      // Add classes if available
      const classes = this.getClasses(current);
      if (classes && classes.length > 0) {
        selector += '.' + classes.join('.');
      }

      // Add nth-child if needed for uniqueness
      const parent: Element | null = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children);
        const index = siblings.indexOf(current);
        if (siblings.filter((s: Element) => s.tagName === current!.tagName).length > 1) {
          selector += `:nth-child(${index + 1})`;
        }
      }

      parts.unshift(selector);
      current = parent;
    }

    const fullSelector = parts.join(' > ');
    this.selectorCache.set(element, fullSelector);
    return fullSelector;
  }

  /**
   * Expand a specific node by selector (supports Shadow DOM)
   * @param selector - CSS selector
   * @param depth - Depth to expand
   * @returns Simplified node or null if not found
   */
  expandNode(selector: string, depth: number = DOM.DEFAULT_EXPAND_DEPTH): SimplifiedNode | null {
    try {
      const element = querySelectorDeep(document, selector);
      if (!element) {
        Logger.warn('[DOMSimplifier] Element not found', { selector });
        return null;
      }
      return this.simplifyElement(element, { maxDepth: depth });
    } catch (error) {
      Logger.error('[DOMSimplifier] Failed to expand node', { selector, error });
      return null;
    }
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

  /**
   * Simplify DOM for AI analysis (static method using singleton)
   * @param element - Root element to simplify
   * @param options - Simplification options
   * @returns Simplified node structure
   */
  static simplifyForAI(
    element: Element,
    options: {
      maxDepth?: number;
      maxNodes?: number;
      includeText?: boolean;
    } = {},
  ): SimplifiedNode {
    return DOMSimplifier.getInstance().simplifyElement(element, options);
  }

  /**
   * Convert simplified node to string format for AI (static method using singleton)
   * @param node - Simplified node
   * @returns String representation
   */
  static toStringFormat(node: SimplifiedNode): string {
    return DOMSimplifier.getInstance().nodeToString(node);
  }
}
