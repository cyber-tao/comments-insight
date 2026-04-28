// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { DOMAnalyzer, DOMNode } from '@/content/DOMAnalyzer';

describe('DOMAnalyzer', () => {
  let analyzer: DOMAnalyzer;

  beforeEach(() => {
    analyzer = new DOMAnalyzer();
    document.body.innerHTML = '';
  });

  describe('analyzeNode (via analyzeLayerByLayer)', () => {
    it('should analyze a basic element', () => {
      document.body.innerHTML = '<div id="test" class="container">Hello</div>';
      const result = analyzer.analyzeLayerByLayer(1);

      expect(result.tag).toBe('body');
      expect(result.children).toBeDefined();
      expect(result.children!.length).toBeGreaterThan(0);

      const divNode = result.children!.find((c) => c.tag === 'div');
      expect(divNode).toBeDefined();
      expect(divNode!.id).toBe('test');
      expect(divNode!.classes).toContain('container');
    });

    it('should respect maxDepth', () => {
      document.body.innerHTML = `
        <div id="level1">
          <div id="level2">
            <div id="level3">Deep content</div>
          </div>
        </div>
      `;
      const result = analyzer.analyzeLayerByLayer(1);

      // At maxDepth 1, we should see level1 but level2 should not be expanded
      const level1 = result.children!.find((c) => c.id === 'level1');
      expect(level1).toBeDefined();
      expect(level1!.children).toEqual([]); // Stopped at maxDepth
    });

    it('should analyze deeper with larger maxDepth', () => {
      document.body.innerHTML = `
        <div id="level1">
          <div id="level2">
            <div id="level3">Deep content</div>
          </div>
        </div>
      `;
      const result = analyzer.analyzeLayerByLayer(3);

      const level1 = result.children!.find((c) => c.id === 'level1');
      expect(level1!.children!.length).toBeGreaterThan(0);

      const level2 = level1!.children!.find((c) => c.id === 'level2');
      expect(level2).toBeDefined();
      expect(level2!.children!.length).toBeGreaterThan(0);

      const level3 = level2!.children!.find((c) => c.id === 'level3');
      expect(level3).toBeDefined();
    });

    it('should handle element with multiple classes', () => {
      document.body.innerHTML = '<div class="class1 class2 class3">Content</div>';
      const result = analyzer.analyzeLayerByLayer(1);

      const div = result.children!.find((c) => c.tag === 'div');
      expect(div!.classes).toEqual(['class1', 'class2', 'class3']);
    });

    it('should handle element without id', () => {
      document.body.innerHTML = '<div class="my-class">Content</div>';
      const result = analyzer.analyzeLayerByLayer(1);

      const div = result.children!.find((c) => c.tag === 'div');
      expect(div!.id).toBeUndefined();
    });
  });

  describe('getDirectText', () => {
    it('should get direct text only, not from children', () => {
      document.body.innerHTML = `
        <div id="parent">
          Parent text
          <span>Child text</span>
        </div>
      `;
      const result = analyzer.analyzeLayerByLayer(2);

      const parent = result.children!.find((c) => c.id === 'parent');
      expect(parent!.text).toBe('Parent text');
    });

    it('should handle empty text content', () => {
      document.body.innerHTML = '<div id="empty"><span>Only child</span></div>';
      const result = analyzer.analyzeLayerByLayer(1);

      const empty = result.children!.find((c) => c.id === 'empty');
      expect(empty!.text).toBe('');
    });

    it('should handle multiple text nodes', () => {
      document.body.innerHTML = '<div id="multi">First <span>child</span> Second</div>';
      const result = analyzer.analyzeLayerByLayer(1);

      const multi = result.children!.find((c) => c.id === 'multi');
      expect(multi!.text).toContain('First');
      expect(multi!.text).toContain('Second');
    });
  });

  describe('getContentBySelector', () => {
    it('should get text content by selector', () => {
      document.body.innerHTML = '<div id="target">Target content</div>';
      const content = analyzer.getContentBySelector('#target');

      expect(content).toBe('Target content');
    });

    it('should return empty string for non-existent selector', () => {
      document.body.innerHTML = '<div>Content</div>';
      const content = analyzer.getContentBySelector('#nonexistent');

      expect(content).toBe('');
    });

    it('should work with class selectors', () => {
      document.body.innerHTML = '<span class="my-class">Class content</span>';
      const content = analyzer.getContentBySelector('.my-class');

      expect(content).toBe('Class content');
    });

    it('should trim whitespace', () => {
      document.body.innerHTML = '<div id="test">   Trimmed   </div>';
      const content = analyzer.getContentBySelector('#test');

      expect(content).toBe('Trimmed');
    });
  });

  describe('querySelectorAllDeep', () => {
    it('should find elements by selector', () => {
      document.body.innerHTML = `
        <div class="item">Item 1</div>
        <div class="item">Item 2</div>
        <div class="item">Item 3</div>
      `;
      const elements = analyzer.querySelectorAllDeep(document, '.item');

      expect(elements.length).toBe(3);
    });

    it('should return empty array for non-matching selector', () => {
      document.body.innerHTML = '<div>Content</div>';
      const elements = analyzer.querySelectorAllDeep(document, '.nonexistent');

      expect(elements).toEqual([]);
    });

    it('should find nested elements', () => {
      document.body.innerHTML = `
        <div id="outer">
          <div class="nested">Nested 1</div>
          <div>
            <div class="nested">Nested 2</div>
          </div>
        </div>
      `;
      const elements = analyzer.querySelectorAllDeep(document, '.nested');

      expect(elements.length).toBe(2);
    });
  });

  describe('serializeForAI', () => {
    it('should serialize a simple node', () => {
      const node: DOMNode = {
        tag: 'div',
        classes: ['container'],
        id: 'main',
        text: 'Hello',
        children: [],
      };

      const result = analyzer.serializeForAI(node);

      expect(result).toContain('<div');
      expect(result).toContain('id="main"');
      expect(result).toContain('class="container"');
      expect(result).toContain('Hello');
      expect(result).toContain('</div>');
    });

    it('should serialize nested nodes', () => {
      const node: DOMNode = {
        tag: 'div',
        classes: [],
        children: [
          {
            tag: 'span',
            classes: ['child'],
            text: 'Child text',
            children: [],
          },
        ],
      };

      const result = analyzer.serializeForAI(node);

      expect(result).toContain('<div>');
      expect(result).toContain('<span');
      expect(result).toContain('class="child"');
      expect(result).toContain('Child text');
      expect(result).toContain('</span>');
      expect(result).toContain('</div>');
    });

    it('should handle node without classes', () => {
      const node: DOMNode = {
        tag: 'p',
        classes: [],
        text: 'Paragraph',
        children: [],
      };

      const result = analyzer.serializeForAI(node);

      expect(result).toContain('<p>');
      expect(result).not.toContain('class=');
    });

    it('should truncate long text', () => {
      const longText = 'A'.repeat(200);
      const node: DOMNode = {
        tag: 'div',
        classes: [],
        text: longText,
        children: [],
      };

      const result = analyzer.serializeForAI(node);

      expect(result).toContain('...');
      expect(result.length).toBeLessThan(longText.length + 50);
    });

    it('should handle proper indentation for nested elements', () => {
      const node: DOMNode = {
        tag: 'div',
        classes: [],
        children: [
          {
            tag: 'span',
            classes: [],
            children: [],
          },
        ],
      };

      const result = analyzer.serializeForAI(node);
      const lines = result.split('\n');

      // The child span should be indented more than the parent div
      const divLine = lines.find((l) => l.includes('<div'));
      const spanLine = lines.find((l) => l.includes('<span'));

      expect(divLine).toBeDefined();
      expect(spanLine).toBeDefined();

      const divIndent = divLine!.search(/\S/);
      const spanIndent = spanLine!.search(/\S/);
      expect(spanIndent).toBeGreaterThan(divIndent);
    });
  });

  describe('analyzePage', () => {
    it('should return serialized DOM structure', () => {
      document.body.innerHTML = `
        <div id="content">
          <h1>Title</h1>
          <p>Paragraph</p>
        </div>
      `;

      const result = analyzer.analyzePage(3);

      expect(result).toContain('<body>');
      expect(result).toContain('<div');
      expect(result).toContain('id="content"');
      expect(result).toContain('<h1>');
      expect(result).toContain('Title');
      expect(result).toContain('<p>');
      expect(result).toContain('Paragraph');
      expect(result).toContain('</body>');
    });

    it('should handle empty body', () => {
      document.body.innerHTML = '';

      const result = analyzer.analyzePage(1);

      expect(result).toContain('<body>');
      expect(result).toContain('</body>');
    });
  });

  describe('edge cases', () => {
    it('should handle deeply nested empty elements', () => {
      document.body.innerHTML = `
        <div><div><div><div></div></div></div></div>
      `;
      const result = analyzer.analyzeLayerByLayer(5);

      expect(result.tag).toBe('body');
      expect(result.children).toBeDefined();
    });

    it('should handle elements with no children', () => {
      document.body.innerHTML = '<br /><hr /><img src="test.jpg" />';
      const result = analyzer.analyzeLayerByLayer(1);

      expect(result.children).toBeDefined();
      const tags = result.children!.map((c) => c.tag);
      expect(tags).toContain('br');
      expect(tags).toContain('hr');
      expect(tags).toContain('img');
    });

    it('should handle special characters in text', () => {
      document.body.innerHTML = '<div id="special">&lt;script&gt;alert("XSS")&lt;/script&gt;</div>';
      const result = analyzer.analyzeLayerByLayer(1);

      const special = result.children!.find((c) => c.id === 'special');
      expect(special!.text).toContain('<script>');
    });

    it('should handle whitespace-only text nodes', () => {
      document.body.innerHTML = '<div id="whitespace">   \n\t  </div>';
      const result = analyzer.analyzeLayerByLayer(1);

      const whitespace = result.children!.find((c) => c.id === 'whitespace');
      expect(whitespace!.text).toBe('');
    });
  });

  describe('children limit', () => {
    it('should limit number of children analyzed', () => {
      // Create many children (more than DOM.CHILDREN_LIMIT which is 20)
      const items = Array.from({ length: 30 }, (_, i) => `<div>Item ${i}</div>`).join('');
      document.body.innerHTML = `<div id="container">${items}</div>`;

      const result = analyzer.analyzeLayerByLayer(2);
      const container = result.children!.find((c) => c.id === 'container');

      // Children should be limited to DOM.CHILDREN_LIMIT (20)
      expect(container!.children!.length).toBeLessThanOrEqual(20);
    });

    it('should skip analysis for containers with too many children', () => {
      // Create more than DOM.CHILDREN_MAX (50) children
      const items = Array.from({ length: 60 }, (_, i) => `<div>Item ${i}</div>`).join('');
      document.body.innerHTML = `<div id="container">${items}</div>`;

      const result = analyzer.analyzeLayerByLayer(2);
      const container = result.children!.find((c) => c.id === 'container');

      // Children array should be empty when there are too many
      expect(container!.children!.length).toBe(0);
    });
  });
});
