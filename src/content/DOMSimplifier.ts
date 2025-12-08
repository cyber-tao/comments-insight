import { SimplifiedNode } from '../types';
import { getShadowRoot, querySelectorDeep } from '@/utils/dom-query';
import { Logger } from '@/utils/logger';
import { DOM } from '@/config/constants';

export class DOMSimplifier {
  private selectorCache = new WeakMap<Element, string>();

  /**
   * Simplify a DOM element to a lightweight structure
   * @param element - DOM element to simplify
   * @param maxDepth - Maximum depth to traverse
   * @param currentDepth - Current depth (internal)
   * @returns Simplified node structure
   */
  simplifyElement(
    element: Element,
    maxDepth: number = DOM.DEFAULT_EXPAND_DEPTH,
    currentDepth: number = 0,
    forceExpandParent: boolean = false,
  ): SimplifiedNode {
    const shadowRoot = getShadowRoot(element);
    const forceExpandCurrent = shadowRoot !== null || this.shouldForceExpandElement(element);
    const shouldExpand = forceExpandParent || forceExpandCurrent || currentDepth < maxDepth;

    // Check for Shadow DOM and filter children
    const rawChildren = shadowRoot ? Array.from(shadowRoot.children) : Array.from(element.children);
    const children = rawChildren.filter((child) => !this.shouldIgnoreElement(child as Element));

    const node: SimplifiedNode = {
      tag: element.tagName.toLowerCase(),
      id: element.id || undefined,
      classes: this.getClasses(element),
      attributes: this.getKeyAttributes(element),
      text: this.getTextPreview(element),
      childCount: children.length,
      expanded: shouldExpand && children.length > 0,
      children:
        shouldExpand && children.length > 0
          ? children.map((child) =>
              this.simplifyElement(
                child as Element,
                maxDepth,
                currentDepth + 1,
                forceExpandParent || forceExpandCurrent,
              ),
            )
          : undefined,
      selector: this.generateSelector(element),
      depth: currentDepth,
    };

    // Mark if element has Shadow DOM
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
      return true;
    }

    const id = element.id?.toLowerCase();
    if (id && (id.includes('comment') || id.includes('reply') || id.includes('contents'))) {
      return true;
    }

    const className = typeof element.className === 'string' ? element.className.toLowerCase() : '';
    if (
      className.includes('comment') ||
      className.includes('reply') ||
      className.includes('thread') ||
      className.includes('content')
    ) {
      return true;
    }

    const role = element.getAttribute('role')?.toLowerCase();
    if (role && (role.includes('comment') || role.includes('article'))) {
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
    const keyAttrs = [
      'data-id',
      'data-comment-id',
      'data-cid',
      'data-testid',
      'role',
      'aria-label',
    ];
    const attrs: Record<string, string> = {};
    let hasAttrs = false;

    for (const attr of keyAttrs) {
      const value = element.getAttribute(attr);
      if (value) {
        attrs[attr] = value;
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
      return this.simplifyElement(element, depth);
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

    // Add child count if not expanded
    if (!node.expanded && node.childCount > 0) {
      result += ` childCount="${node.childCount}"`;
    }

    result += '>';

    // Add children if expanded
    if (node.expanded && node.children && node.children.length > 0) {
      result += '\n';
      for (const child of node.children) {
        result += this.nodeToString(child, indent + 1) + '\n';
      }
      result += spaces;
    } else if (!node.expanded && node.childCount > 0) {
      result += `\n${spaces}  <!-- ${node.childCount} children (not expanded) -->`;
      result += `\n${spaces}`;
    }

    result += `</${node.tag}>`;

    return result;
  }

  /**
   * Update a simplified DOM tree with an expanded node
   */
  updateTreeWithExpanded(tree: SimplifiedNode, expanded: SimplifiedNode): SimplifiedNode {
    if (tree.selector === expanded.selector) {
      return expanded;
    }

    if (tree.children) {
      return {
        ...tree,
        children: tree.children.map((child) => this.updateTreeWithExpanded(child, expanded)),
      };
    }

    return tree;
  }

  /**
   * Batch expand multiple nodes
   */
  expandMultipleNodes(
    selectors: string[],
    depth: number = DOM.DEFAULT_EXPAND_DEPTH,
  ): Map<string, SimplifiedNode | null> {
    const results = new Map<string, SimplifiedNode | null>();

    for (const selector of selectors) {
      results.set(selector, this.expandNode(selector, depth));
    }

    return results;
  }

  /**
   * Simplify DOM for AI analysis (static method)
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
    const { maxDepth = DOM.SIMPLIFY_MAX_DEPTH } = options;
    const simplifier = new DOMSimplifier();
    return simplifier.simplifyElement(element, maxDepth);
  }

  /**
   * Convert simplified node to string format for AI
   * @param node - Simplified node
   * @returns String representation
   */
  static toStringFormat(node: SimplifiedNode): string {
    const simplifier = new DOMSimplifier();
    return simplifier.nodeToString(node);
  }
}
