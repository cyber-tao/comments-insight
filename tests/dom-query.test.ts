import { describe, it, expect } from 'vitest';
import { splitSelector } from '../src/utils/dom-query';

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
});
