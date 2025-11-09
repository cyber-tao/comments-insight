import { SimplifiedNode } from '../types';

/**
 * DOMSimplifier - Converts complex DOM to simplified structure for AI analysis
 */
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
    maxDepth: number = 2,
    currentDepth: number = 0
  ): SimplifiedNode {
    const shouldExpand = currentDepth < maxDepth;
    const children = Array.from(element.children);

    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || undefined,
      classes: this.getClasses(element),
      attributes: this.getKeyAttributes(element),
      text: this.getTextPreview(element),
      childCount: children.length,
      expanded: shouldExpand && children.length > 0,
      children: shouldExpand && children.length > 0
        ? children.map(child => this.simplifyElement(child, maxDepth, currentDepth + 1))
        : undefined,
      selector: this.generateSelector(element),
      depth: currentDepth,
    };
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
      console.warn('[DOMSimplifier] Failed to get classes:', error);
      return undefined;
    }
  }

  /**
   * Get key attributes that might help identify comment elements
   */
  private getKeyAttributes(element: Element): Record<string, string> | undefined {
    const keyAttrs = ['data-id', 'data-comment-id', 'data-cid', 'data-testid', 'role', 'aria-label'];
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

    return fullText.length > 100 ? fullText.substring(0, 100) + '...' : fullText;
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
   * Expand a specific node by selector
   * @param selector - CSS selector
   * @param depth - Depth to expand
   * @returns Simplified node or null if not found
   */
  expandNode(selector: string, depth: number = 2): SimplifiedNode | null {
    try {
      const element = document.querySelector(selector);
      if (!element) {
        console.warn(`[DOMSimplifier] Element not found: ${selector}`);
        return null;
      }
      return this.simplifyElement(element, depth);
    } catch (error) {
      console.error(`[DOMSimplifier] Failed to expand node: ${selector}`, error);
      return null;
    }
  }

  /**
   * Convert simplified node to readable string format for AI
   */
  nodeToString(node: SimplifiedNode, indent: number = 0): string {
    const spaces = '  '.repeat(indent);
    let result = spaces + `<${node.tag}`;

    // Add ID
    if (node.id) {
      result += ` id="${node.id}"`;
    }

    // Add classes
    if (node.classes && node.classes.length > 0) {
      result += ` class="${node.classes.join(' ')}"`;
    }

    // Add key attributes
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

    // Add text preview
    if (node.text) {
      result += `\n${spaces}  ${node.text}`;
    }

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
        children: tree.children.map(child => this.updateTreeWithExpanded(child, expanded)),
      };
    }

    return tree;
  }

  /**
   * Batch expand multiple nodes
   */
  expandMultipleNodes(selectors: string[], depth: number = 2): Map<string, SimplifiedNode | null> {
    const results = new Map<string, SimplifiedNode | null>();
    
    for (const selector of selectors) {
      results.set(selector, this.expandNode(selector, depth));
    }

    return results;
  }
}
