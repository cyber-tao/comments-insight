import { describe, it, expect } from 'vitest';
import {
  generateScraperConfigPrompt,
  generateScraperTestPrompt,
  SCRAPER_CONFIG_GENERATION_SYSTEM_PROMPT,
  SCRAPER_CONFIG_TEST_SYSTEM_PROMPT,
} from '../src/utils/prompts-scraper';

describe('Scraper Prompts Utils', () => {
  describe('generateScraperConfigPrompt', () => {
    it('should generate prompt with url, title and dom structure', () => {
      const dom = '<div>...</div>';
      const url = 'http://example.com';
      const title = 'Example Page';
      
      const prompt = generateScraperConfigPrompt(dom, url, title);
      
      expect(prompt).toContain(url);
      expect(prompt).toContain(title);
      expect(prompt).toContain(dom);
      expect(prompt).toContain('Analyze the following web page');
    });
  });

  describe('generateScraperTestPrompt', () => {
    it('should generate prompt with config and dom structure', () => {
      const config = { selectors: { commentContainer: '.comment' } };
      const dom = '<div>...</div>';
      
      const prompt = generateScraperTestPrompt(config, dom);
      
      expect(prompt).toContain(JSON.stringify(config, null, 2));
      expect(prompt).toContain(dom);
      expect(prompt).toContain('Test the following scraper configuration');
    });
  });

  describe('System Prompts', () => {
    it('should export config generation system prompt', () => {
      expect(SCRAPER_CONFIG_GENERATION_SYSTEM_PROMPT).toBeDefined();
      expect(SCRAPER_CONFIG_GENERATION_SYSTEM_PROMPT.length).toBeGreaterThan(100);
    });

    it('should export config test system prompt', () => {
      expect(SCRAPER_CONFIG_TEST_SYSTEM_PROMPT).toBeDefined();
      expect(SCRAPER_CONFIG_TEST_SYSTEM_PROMPT.length).toBeGreaterThan(50);
    });
  });
});

