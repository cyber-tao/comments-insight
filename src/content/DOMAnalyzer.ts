import { getShadowRoot, querySelectorDeep, querySelectorAllDeep } from '@/utils/dom-query';
import { DOM, DOM_ANALYSIS_DEFAULTS } from '@/config/constants';

export interface DOMNode {
  tag: string;
  classes: string[];
  id?: string;
  text?: string;
  children?: DOMNode[];
  attributes?: Record<string, string>;
}

/**
 * DOMAnalyzer analyzes and serializes DOM structures
 */
export class DOMAnalyzer {
  /**
   * Analyze current page and return serialized DOM
   * @param maxDepth - Maximum depth to analyze
   * @returns Serialized DOM string
   */
  analyzePage(maxDepth: number = DOM_ANALYSIS_DEFAULTS.initialDepth): string {
    const root = document.body;
    const domNode = this.analyzeNode(root, 0, maxDepth);
    return this.serializeForAI(domNode);
  }

  /**
   * Analyze DOM layer by layer
   * @param maxDepth - Maximum depth to analyze
   * @returns Root DOM node
   */
  analyzeLayerByLayer(maxDepth: number = DOM_ANALYSIS_DEFAULTS.initialDepth): DOMNode {
    const root = document.body;
    return this.analyzeNode(root, 0, maxDepth);
  }

  /**
   * Get content by CSS selector (supports Shadow DOM)
   * @param selector - CSS selector
   * @returns Text content
   */
  getContentBySelector(selector: string): string {
    const element = querySelectorDeep(document, selector);
    return element?.textContent?.trim() || '';
  }

  querySelectorAllDeep(root: Document | Element | ShadowRoot, selector: string): Element[] {
    return querySelectorAllDeep(root, selector);
  }

  /**
   * Serialize DOM node for AI
   * @param node - DOM node to serialize
   * @param depth - Current depth
   * @returns Serialized string
   */
  serializeForAI(node: DOMNode, depth: number = 0): string {
    const parts: string[] = [];
    this.buildSerializedString(node, depth, parts);
    return parts.join('');
  }

  private buildSerializedString(node: DOMNode, depth: number, parts: string[]): void {
    const indent = DOM.INDENT.repeat(depth);
    parts.push(`${indent}<${node.tag}`);

    if (node.id) {
      parts.push(` id="${node.id}"`);
    }

    if (node.classes.length > 0) {
      parts.push(` class="${node.classes.join(' ')}"`);
    }

    parts.push('>');

    if (node.text && node.text.length > 0) {
      const truncatedText =
        node.text.length > DOM.TEXT_PREVIEW_LENGTH
          ? node.text.substring(0, DOM.TEXT_PREVIEW_LENGTH) + '...'
          : node.text;
      parts.push(`\n${indent}${DOM.INDENT}${truncatedText}`);
    }

    if (node.children && node.children.length > 0) {
      parts.push('\n');
      for (const child of node.children) {
        this.buildSerializedString(child, depth + 1, parts);
        parts.push('\n');
      }
      parts.push(indent);
    }

    parts.push(`</${node.tag}>`);
  }

  /**
   * Analyze a single DOM node
   * @param element - HTML element
   * @param currentDepth - Current depth
   * @param maxDepth - Maximum depth
   * @returns DOM node
   */
  private analyzeNode(element: Element, currentDepth: number, maxDepth: number): DOMNode {
    const node: DOMNode = {
      tag: element.tagName.toLowerCase(),
      classes: Array.from(element.classList),
      id: element.id || undefined,
      text: this.getDirectText(element),
      children: [],
    };

    // Stop at max depth
    if (currentDepth >= maxDepth) {
      return node;
    }

    // Check for Shadow DOM
    const shadowRoot = getShadowRoot(element);
    if (shadowRoot) {
      // Add a marker to indicate this element has Shadow DOM
      node.attributes = { ...node.attributes, 'has-shadow-root': 'true' };

      // Analyze Shadow DOM children
      const shadowChildren = Array.from(shadowRoot.children);
      if (shadowChildren.length > 0 && shadowChildren.length < DOM.CHILDREN_MAX) {
        node.children = shadowChildren
          .slice(0, DOM.CHILDREN_LIMIT)
          .map((child) => this.analyzeNode(child as Element, currentDepth + 1, maxDepth));
      }
      return node;
    }

    // Analyze regular children
    const children = Array.from(element.children);
    if (children.length > 0 && children.length < DOM.CHILDREN_MAX) {
      // Limit children
      node.children = children
        .slice(0, DOM.CHILDREN_LIMIT)
        .map((child) => this.analyzeNode(child, currentDepth + 1, maxDepth));
    }

    return node;
  }

  /**
   * Get direct text content (not from children)
   * @param element - HTML element
   * @returns Direct text content
   */
  private getDirectText(element: Element): string {
    return Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent?.trim())
      .filter((text) => text && text.length > 0)
      .join(' ');
  }
}
