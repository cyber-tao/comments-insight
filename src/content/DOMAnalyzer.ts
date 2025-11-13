/**
 * DOMNode represents a simplified DOM structure
 */
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
  analyzePage(maxDepth: number = 5): string {
    const root = document.body;
    const domNode = this.analyzeNode(root, 0, maxDepth);
    return this.serializeForAI(domNode);
  }

  /**
   * Analyze DOM layer by layer
   * @param maxDepth - Maximum depth to analyze
   * @returns Root DOM node
   */
  async analyzeLayerByLayer(maxDepth: number = 5): Promise<DOMNode> {
    const root = document.body;
    return this.analyzeNode(root, 0, maxDepth);
  }

  /**
   * Get content by CSS selector (supports Shadow DOM)
   * @param selector - CSS selector
   * @returns Text content
   */
  getContentBySelector(selector: string): string {
    const element = this.querySelectorDeep(document, selector);
    return element?.textContent?.trim() || '';
  }

  /**
   * Query selector that traverses Shadow DOM
   * @param root - Root element or document
   * @param selector - CSS selector
   * @returns Found element or null
   */
  private querySelectorDeep(
    root: Document | Element | ShadowRoot,
    selector: string,
  ): Element | null {
    // Try to find in current root
    const element = root.querySelector(selector);
    if (element) {
      return element;
    }

    // Search in Shadow DOM
    const elements = root.querySelectorAll('*');
    for (const el of Array.from(elements)) {
      const shadowRoot = (el as any).shadowRoot;
      if (shadowRoot) {
        const found = this.querySelectorDeep(shadowRoot, selector);
        if (found) {
          return found;
        }
      }
    }

    return null;
  }

  /**
   * Query all selectors that traverse Shadow DOM
   * @param root - Root element or document
   * @param selector - CSS selector
   * @returns Array of found elements
   */
  querySelectorAllDeep(root: Document | Element | ShadowRoot, selector: string): Element[] {
    const results: Element[] = [];

    // Find in current root
    const elements = root.querySelectorAll(selector);
    results.push(...Array.from(elements));

    // Search in Shadow DOM
    const allElements = root.querySelectorAll('*');
    for (const el of Array.from(allElements)) {
      const shadowRoot = (el as any).shadowRoot;
      if (shadowRoot) {
        const found = this.querySelectorAllDeep(shadowRoot, selector);
        results.push(...found);
      }
    }

    return results;
  }

  /**
   * Serialize DOM node for AI
   * @param node - DOM node to serialize
   * @param depth - Current depth
   * @returns Serialized string
   */
  serializeForAI(node: DOMNode, depth: number = 0): string {
    const indent = '  '.repeat(depth);
    let result = `${indent}<${node.tag}`;

    if (node.id) {
      result += ` id="${node.id}"`;
    }

    if (node.classes.length > 0) {
      result += ` class="${node.classes.join(' ')}"`;
    }

    result += '>';

    if (node.text && node.text.length > 0) {
      const truncatedText =
        node.text.length > 100 ? node.text.substring(0, 100) + '...' : node.text;
      result += `\n${indent}  ${truncatedText}`;
    }

    if (node.children && node.children.length > 0) {
      result += '\n';
      for (const child of node.children) {
        result += this.serializeForAI(child, depth + 1) + '\n';
      }
      result += indent;
    }

    result += `</${node.tag}>`;
    return result;
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
    const shadowRoot = (element as any).shadowRoot;
    if (shadowRoot) {
      // Add a marker to indicate this element has Shadow DOM
      node.attributes = { ...node.attributes, 'has-shadow-root': 'true' };

      // Analyze Shadow DOM children
      const shadowChildren = Array.from(shadowRoot.children);
      if (shadowChildren.length > 0 && shadowChildren.length < 50) {
        node.children = shadowChildren
          .slice(0, 20)
          .map((child) => this.analyzeNode(child as Element, currentDepth + 1, maxDepth));
      }
      return node;
    }

    // Analyze regular children
    const children = Array.from(element.children);
    if (children.length > 0 && children.length < 50) {
      // Limit children
      node.children = children
        .slice(0, 20) // Limit to first 20 children
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
    let text = '';
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent?.trim() + ' ';
      }
    }
    return text.trim();
  }
}
