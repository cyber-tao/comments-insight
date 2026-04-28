// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  splitSelector,
  getShadowRoot,
  querySelectorDeep,
  querySelectorAllDeep,
  queryXPathAll,
} from '../src/utils/dom-query';

describe('dom-query', () => {
  describe('splitSelector', () => {
    it('should return the whole selector if no combinator found', () => {
      expect(splitSelector('.class-name')).toEqual({ current: '.class-name' });
      expect(splitSelector('#id')).toEqual({ current: '#id' });
      expect(splitSelector('div')).toEqual({ current: 'div' });
    });

    it('should split on space combinator', () => {
      const result = splitSelector('div .child');
      expect(result.current).toBe('div');
      expect(result.rest).toBe('.child');
    });

    it('should split on child combinator', () => {
      const result = splitSelector('div > .child');
      expect(result.current).toBe('div');
      expect(result.rest).toBe('> .child');
    });

    it('should handle attribute selectors correctly', () => {
      const result = splitSelector('[data-attr="value with space"] .child');
      expect(result.current).toBe('[data-attr="value with space"]');
      expect(result.rest).toBe('.child');
    });

    it('should handle :not() pseudo-selector', () => {
      const result = splitSelector('div:not(.hidden) .child');
      expect(result.current).toBe('div:not(.hidden)');
      expect(result.rest).toBe('.child');
    });

    it('should handle nested parentheses', () => {
      const result = splitSelector('div:has(> span) .child');
      expect(result.current).toBe('div:has(> span)');
      expect(result.rest).toBe('.child');
    });

    it('should handle complex selectors with multiple combinators', () => {
      const result = splitSelector('article div.content span');
      expect(result.current).toBe('article');
      expect(result.rest).toBe('div.content span');
    });

    it('should handle empty and whitespace-only input', () => {
      expect(splitSelector('')).toEqual({ current: '' });
      expect(splitSelector('   ')).toEqual({ current: '' });
    });
  });

  describe('getShadowRoot', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    it('should return null for element without shadow root', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      const result = getShadowRoot(div);

      expect(result).toBeNull();
    });

    it('should return shadow root for element with open shadow', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<span>Shadow content</span>';

      const result = getShadowRoot(host);

      expect(result).toBe(shadow);
    });

    it('should return null for element with closed shadow (not accessible)', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      host.attachShadow({ mode: 'closed' });

      const result = getShadowRoot(host);

      // Closed shadow roots are not accessible via element.shadowRoot
      expect(result).toBeNull();
    });
  });

  describe('querySelectorDeep', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    it('should find element in regular DOM', () => {
      document.body.innerHTML = '<div id="target">Content</div>';

      const result = querySelectorDeep(document, '#target');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('target');
    });

    it('should return null for non-existent selector', () => {
      document.body.innerHTML = '<div>Content</div>';

      const result = querySelectorDeep(document, '#nonexistent');

      expect(result).toBeNull();
    });

    it('should return null for empty selector', () => {
      document.body.innerHTML = '<div>Content</div>';

      const result = querySelectorDeep(document, '');

      expect(result).toBeNull();
    });

    it('should return null for whitespace-only selector', () => {
      document.body.innerHTML = '<div>Content</div>';

      const result = querySelectorDeep(document, '   ');

      expect(result).toBeNull();
    });

    it('should find element inside shadow DOM', () => {
      const host = document.createElement('div');
      host.id = 'shadow-host';
      document.body.appendChild(host);

      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<span id="shadow-target">Shadow content</span>';

      const result = querySelectorDeep(document, '#shadow-target');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('shadow-target');
    });

    it('should find nested element in shadow DOM', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);

      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<div class="outer"><span class="inner">Nested</span></div>';

      const result = querySelectorDeep(document, '.outer .inner');

      expect(result).not.toBeNull();
      expect(result?.className).toBe('inner');
    });

    it('should handle nested shadow DOMs', () => {
      // Create outer shadow host
      const outerHost = document.createElement('div');
      document.body.appendChild(outerHost);
      const outerShadow = outerHost.attachShadow({ mode: 'open' });

      // Create inner shadow host inside outer shadow
      const innerHost = document.createElement('div');
      outerShadow.appendChild(innerHost);
      const innerShadow = innerHost.attachShadow({ mode: 'open' });
      innerShadow.innerHTML = '<span id="deeply-nested">Deep</span>';

      const result = querySelectorDeep(document, '#deeply-nested');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('deeply-nested');
    });

    it('should handle invalid selector gracefully', () => {
      document.body.innerHTML = '<div>Content</div>';

      // Invalid selector should return null, not throw
      const result = querySelectorDeep(document, '[invalid selector');

      expect(result).toBeNull();
    });

    it('should search from Element root', () => {
      document.body.innerHTML = `
        <div id="container">
          <span id="inside">Inside</span>
        </div>
        <span id="outside">Outside</span>
      `;
      const container = document.getElementById('container')!;

      const result = querySelectorDeep(container, 'span');

      expect(result?.id).toBe('inside');
    });

    it('should search from ShadowRoot', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<div id="shadow-div">Content</div>';

      const result = querySelectorDeep(shadow, '#shadow-div');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('shadow-div');
    });
  });

  describe('querySelectorAllDeep', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    it('should find all matching elements in regular DOM', () => {
      document.body.innerHTML = `
        <div class="item">Item 1</div>
        <div class="item">Item 2</div>
        <div class="item">Item 3</div>
      `;

      const results = querySelectorAllDeep(document, '.item');

      expect(results).toHaveLength(3);
    });

    it('should return empty array for non-existent selector', () => {
      document.body.innerHTML = '<div>Content</div>';

      const results = querySelectorAllDeep(document, '.nonexistent');

      expect(results).toEqual([]);
    });

    it('should return empty array for empty selector', () => {
      document.body.innerHTML = '<div>Content</div>';

      const results = querySelectorAllDeep(document, '');

      expect(results).toEqual([]);
    });

    it('should find elements inside shadow DOM', () => {
      document.body.innerHTML = '<div class="item">Light DOM item</div>';

      const host = document.createElement('div');
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<div class="item">Shadow item</div>';

      const results = querySelectorAllDeep(document, '.item');

      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('should return unique elements (no duplicates)', () => {
      document.body.innerHTML = `
        <div id="unique1" class="unique"></div>
        <div id="unique2" class="unique"></div>
      `;

      const results = querySelectorAllDeep(document, '.unique');
      const ids = results.map((el) => el.id);

      // Should have unique elements
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('should handle nested shadow DOMs', () => {
      // Outer shadow
      const outerHost = document.createElement('div');
      document.body.appendChild(outerHost);
      const outerShadow = outerHost.attachShadow({ mode: 'open' });
      outerShadow.innerHTML = '<span class="nested">Outer shadow</span>';

      // Inner shadow inside outer
      const innerHost = document.createElement('div');
      outerShadow.appendChild(innerHost);
      const innerShadow = innerHost.attachShadow({ mode: 'open' });
      innerShadow.innerHTML = '<span class="nested">Inner shadow</span>';

      const results = querySelectorAllDeep(document, '.nested');

      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle complex selectors', () => {
      document.body.innerHTML = `
        <div class="parent">
          <span class="child">Match 1</span>
        </div>
        <div class="parent">
          <span class="child">Match 2</span>
        </div>
      `;

      const results = querySelectorAllDeep(document, '.parent .child');

      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle invalid selector gracefully', () => {
      document.body.innerHTML = '<div>Content</div>';

      const results = querySelectorAllDeep(document, '[invalid');

      expect(results).toEqual([]);
    });
  });

  describe('queryXPathAll', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    it('should find elements by XPath', () => {
      document.body.innerHTML = '<div id="test">Content</div>';

      const results = queryXPathAll(document, '//div[@id="test"]');

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('test');
    });

    it('should find multiple elements by XPath', () => {
      document.body.innerHTML = `
        <span>First</span>
        <span>Second</span>
        <span>Third</span>
      `;

      const results = queryXPathAll(document, '//span');

      expect(results).toHaveLength(3);
    });

    it('should return empty array for non-matching XPath', () => {
      document.body.innerHTML = '<div>Content</div>';

      const results = queryXPathAll(document, '//span');

      expect(results).toEqual([]);
    });

    it('should return empty array for empty XPath', () => {
      document.body.innerHTML = '<div>Content</div>';

      const results = queryXPathAll(document, '');

      expect(results).toEqual([]);
    });

    it('should handle invalid XPath gracefully', () => {
      document.body.innerHTML = '<div>Content</div>';

      const results = queryXPathAll(document, '///invalid[xpath');

      expect(results).toEqual([]);
    });

    it('should work with XPath predicates', () => {
      document.body.innerHTML = `
        <div class="item" data-value="1">Item 1</div>
        <div class="item" data-value="2">Item 2</div>
        <div class="item" data-value="3">Item 3</div>
      `;

      const results = queryXPathAll(document, '//div[@data-value="2"]');

      expect(results).toHaveLength(1);
      expect(results[0].textContent).toBe('Item 2');
    });

    it('should work with text content XPath', () => {
      document.body.innerHTML = `
        <button>Cancel</button>
        <button>Submit</button>
        <button>Reset</button>
      `;

      const results = queryXPathAll(document, '//button[text()="Submit"]');

      expect(results).toHaveLength(1);
      expect(results[0].textContent).toBe('Submit');
    });

    it('should search from Element root', () => {
      document.body.innerHTML = `
        <div id="container">
          <span>Inside</span>
        </div>
        <span>Outside</span>
      `;
      const container = document.getElementById('container')!;

      const results = queryXPathAll(container, './/span');

      expect(results).toHaveLength(1);
      expect(results[0].textContent).toBe('Inside');
    });

    it('should work with contains function', () => {
      document.body.innerHTML = `
        <div class="comment-item">Comment 1</div>
        <div class="reply-item">Reply 1</div>
        <div class="comment-section">Section</div>
      `;

      const results = queryXPathAll(document, '//div[contains(@class, "comment")]');

      expect(results).toHaveLength(2);
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    it('should handle elements with special characters in attributes', () => {
      document.body.innerHTML =
        '<div data-special="value with \"quotes\"" id="special">Content</div>';

      const result = querySelectorDeep(document, '#special');

      expect(result).not.toBeNull();
    });

    it('should handle deeply nested regular DOM', () => {
      let html = '<div id="target">Deep</div>';
      for (let i = 0; i < 20; i++) {
        html = `<div>${html}</div>`;
      }
      document.body.innerHTML = html;

      const result = querySelectorDeep(document, '#target');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('target');
    });

    it('should handle multiple shadow hosts at same level', () => {
      const host1 = document.createElement('div');
      const host2 = document.createElement('div');
      document.body.appendChild(host1);
      document.body.appendChild(host2);

      const shadow1 = host1.attachShadow({ mode: 'open' });
      shadow1.innerHTML = '<span class="shadow-item" id="first">First</span>';

      const shadow2 = host2.attachShadow({ mode: 'open' });
      shadow2.innerHTML = '<span class="shadow-item" id="second">Second</span>';

      const results = querySelectorAllDeep(document, '.shadow-item');

      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle empty document body', () => {
      document.body.innerHTML = '';

      const result = querySelectorDeep(document, 'div');
      const results = querySelectorAllDeep(document, 'div');

      expect(result).toBeNull();
      expect(results).toEqual([]);
    });
  });
});
