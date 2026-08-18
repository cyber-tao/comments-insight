// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { DOMAnalyzer, DOMNode } from '@/content/DOMAnalyzer';

describe('DOMAnalyzer', () => {
  let analyzer: DOMAnalyzer;

  beforeEach(() => {
    analyzer = new DOMAnalyzer();
    document.body.innerHTML = '';
  });

  describe('analyzePage', () => {
    it('should serialize id, classes, and text of child elements', () => {
      document.body.innerHTML = '<div id="test" class="container">Hello</div>';

      const result = analyzer.analyzePage(1);

      expect(result).toContain('<body>');
      expect(result).toContain('<div');
      expect(result).toContain('id="test"');
      expect(result).toContain('class="container"');
      expect(result).toContain('Hello');
      expect(result).toContain('</body>');
    });

    it('should respect maxDepth', () => {
      document.body.innerHTML = `
        <div id="level1">
          <div id="level2">
            <span id="level3">deep</span>
          </div>
        </div>
      `;

      const shallow = analyzer.analyzePage(1);
      const deeper = analyzer.analyzePage(3);

      expect(shallow).toContain('id="level1"');
      expect(shallow).not.toContain('id="level2"');
      expect(deeper).toContain('id="level2"');
      expect(deeper).toContain('id="level3"');
    });

    it('should include direct text without descending into children', () => {
      document.body.innerHTML = '<div id="outer">direct<span>inner</span></div>';

      const result = analyzer.analyzePage(2);

      expect(result).toContain('direct');
      expect(result).toContain('inner');
    });

    it('should handle empty body', () => {
      const result = analyzer.analyzePage(1);

      expect(result).toContain('<body>');
      expect(result).toContain('</body>');
    });
  });

  describe('querySelectorAllDeep', () => {
    it('should find elements by selector', () => {
      document.body.innerHTML =
        '<div class="target"></div><div class="target"></div><div class="other"></div>';

      const result = analyzer.querySelectorAllDeep(document, '.target');

      expect(result).toHaveLength(2);
    });

    it('should return empty array for non-matching selector', () => {
      document.body.innerHTML = '<div></div>';

      const result = analyzer.querySelectorAllDeep(document, '.missing');

      expect(result).toEqual([]);
    });

    it('should find nested elements', () => {
      document.body.innerHTML =
        '<div id="outer"><div id="inner"><span class="leaf"></span></div></div>';

      const result = analyzer.querySelectorAllDeep(document, '.leaf');

      expect(result).toHaveLength(1);
    });
  });

  describe('serializeForAI', () => {
    it('should serialize a simple node', () => {
      const node: DOMNode = {
        tag: 'div',
        classes: ['a', 'b'],
        id: 'x',
        text: 'hello',
      };

      const result = analyzer.serializeForAI(node);

      expect(result).toContain('<div');
      expect(result).toContain('id="x"');
      expect(result).toContain('class="a b"');
      expect(result).toContain('hello');
    });

    it('should serialize nested nodes', () => {
      const node: DOMNode = {
        tag: 'div',
        classes: [],
        children: [{ tag: 'span', classes: [], text: 'child' }],
      };

      const result = analyzer.serializeForAI(node);

      expect(result).toContain('<div');
      expect(result).toContain('<span');
      expect(result).toContain('child');
    });

    it('should handle node without classes', () => {
      const node: DOMNode = { tag: 'p', classes: [], text: 'text' };

      const result = analyzer.serializeForAI(node);

      expect(result).toContain('<p');
      expect(result).not.toContain('class=');
    });

    it('should truncate long text', () => {
      const node: DOMNode = { tag: 'p', classes: [], text: 'a'.repeat(1000) };

      const result = analyzer.serializeForAI(node);

      expect(result.length).toBeLessThan(1000);
    });

    it('should handle proper indentation for nested elements', () => {
      const node: DOMNode = {
        tag: 'div',
        classes: [],
        children: [{ tag: 'span', classes: [], text: 'inner' }],
      };

      const result = analyzer.serializeForAI(node);
      const lines = result.split('\n');
      const spanLine = lines.find((line) => line.includes('<span'));

      expect(lines[0].startsWith('  ')).toBe(false);
      expect(spanLine?.startsWith('  ')).toBe(true);
    });
  });
});
