// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfiguredStrategy } from '@/content/strategies/ConfiguredStrategy';
import { PageController } from '@/content/PageController';
import { setExtractionActive, resetExtractionState } from '@/content/extractionState';
import { CrawlingConfig } from '@/types';

describe('ConfiguredStrategy', () => {
  let mockPageController: PageController;

  beforeEach(() => {
    document.body.innerHTML = '';
    setExtractionActive(true, 'test-task');
    mockPageController = {
      scrollContainer: vi.fn().mockResolvedValue({ contentChanged: false }),
    } as unknown as PageController;
  });

  afterEach(() => {
    resetExtractionState();
  });

  it('should extract comments using standard CSS selectors', async () => {
    document.body.innerHTML = `
      <div id="comments-root">
        <div class="comment-item">
          <span class="user">Alice</span>
          <p class="text">Great post!</p>
          <span class="time">2 hours ago</span>
          <span class="likes">42</span>
        </div>
      </div>
    `;

    const config: CrawlingConfig = {
      id: 'test-css',
      domain: 'example.com',
      container: { selector: '#comments-root', type: 'css' },
      item: { selector: '.comment-item', type: 'css' },
      fields: [
        { name: 'username', rule: { selector: '.user', type: 'css' } },
        { name: 'content', rule: { selector: '.text', type: 'css' } },
        { name: 'timestamp', rule: { selector: '.time', type: 'css' } },
        { name: 'likes', rule: { selector: '.likes', type: 'css' } },
      ],
      lastUpdated: Date.now(),
    };

    const strategy = new ConfiguredStrategy(mockPageController, config);
    const comments = await strategy.execute(10, 'example.com');

    expect(comments).toHaveLength(1);
    expect(comments[0].username).toBe('Alice');
    expect(comments[0].content).toBe('Great post!');
    expect(comments[0].likes).toBe(42);
  });

  it('should extract comments using XPath selectors without throwing DOMException', async () => {
    document.body.innerHTML = `
      <div id="comments-root">
        <div class="comment-item">
          <span class="user">Bob</span>
          <p class="text">XPath works!</p>
          <span class="time">1 hour ago</span>
          <span class="likes">100</span>
        </div>
      </div>
    `;

    const config: CrawlingConfig = {
      id: 'test-xpath',
      domain: 'example.com',
      container: { selector: "//div[@id='comments-root']", type: 'xpath' },
      item: { selector: ".//div[contains(@class, 'comment-item')]", type: 'xpath' },
      fields: [
        {
          name: 'username',
          rule: { selector: ".//span[contains(@class, 'user')]", type: 'xpath' },
        },
        { name: 'content', rule: { selector: './/p', type: 'xpath' } },
        {
          name: 'timestamp',
          rule: { selector: ".//span[contains(@class, 'time')]", type: 'xpath' },
        },
        { name: 'likes', rule: { selector: ".//span[contains(@class, 'likes')]", type: 'xpath' } },
      ],
      lastUpdated: Date.now(),
    };

    const strategy = new ConfiguredStrategy(mockPageController, config);
    const comments = await strategy.execute(10, 'example.com');

    expect(comments).toHaveLength(1);
    expect(comments[0].username).toBe('Bob');
    expect(comments[0].content).toBe('XPath works!');
    expect(comments[0].likes).toBe(100);
  });

  it('should extract nested replies using XPath selectors without throwing DOMException', async () => {
    document.body.innerHTML = `
      <div id="comments-root">
        <div class="comment-item">
          <span class="user">Parent</span>
          <p class="text">Main comment</p>
          <span class="time">3 hours ago</span>
          <span class="likes">10</span>
          <div class="reply-container">
            <div class="reply-item">
              <span class="reply-user">Child</span>
              <p class="reply-text">Sub reply</p>
              <span class="reply-time">1 hour ago</span>
              <span class="reply-likes">5</span>
            </div>
          </div>
        </div>
      </div>
    `;

    const config: CrawlingConfig = {
      id: 'test-xpath-replies',
      domain: 'example.com',
      container: { selector: "//div[@id='comments-root']", type: 'xpath' },
      item: { selector: ".//div[contains(@class, 'comment-item')]", type: 'xpath' },
      fields: [
        {
          name: 'username',
          rule: { selector: ".//span[contains(@class, 'user')]", type: 'xpath' },
        },
        { name: 'content', rule: { selector: './/p', type: 'xpath' } },
        {
          name: 'timestamp',
          rule: { selector: ".//span[contains(@class, 'time')]", type: 'xpath' },
        },
        { name: 'likes', rule: { selector: ".//span[contains(@class, 'likes')]", type: 'xpath' } },
      ],
      replies: {
        container: { selector: ".//div[contains(@class, 'reply-container')]", type: 'xpath' },
        item: { selector: ".//div[contains(@class, 'reply-item')]", type: 'xpath' },
        fields: [
          {
            name: 'username',
            rule: { selector: ".//span[contains(@class, 'reply-user')]", type: 'xpath' },
          },
          {
            name: 'content',
            rule: { selector: ".//p[contains(@class, 'reply-text')]", type: 'xpath' },
          },
          {
            name: 'timestamp',
            rule: { selector: ".//span[contains(@class, 'reply-time')]", type: 'xpath' },
          },
          {
            name: 'likes',
            rule: { selector: ".//span[contains(@class, 'reply-likes')]", type: 'xpath' },
          },
        ],
      },
      lastUpdated: Date.now(),
    };

    const strategy = new ConfiguredStrategy(mockPageController, config);
    const comments = await strategy.execute(10, 'example.com');

    expect(comments).toHaveLength(1);
    expect(comments[0].username).toBe('Parent');
    expect(comments[0].replies).toHaveLength(1);
    expect(comments[0].replies[0].username).toBe('Child');
    expect(comments[0].replies[0].content).toBe('Sub reply');
    expect(comments[0].replies[0].likes).toBe(5);
  });
});
