// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfiguredStrategy } from '@/content/strategies/ConfiguredStrategy';
import { PageController } from '@/content/PageController';
import { setExtractionActive, resetExtractionState } from '@/content/extractionState';
import type { Comment, CrawlingConfig, SelectorRule } from '@/types';
import { CommentExtractor } from '@/content/CommentExtractor';
import { countComments } from '@/utils/comment-tree';
import {
  DOM,
  EXTRACTION,
  EXTRACTION_DEFAULTS,
  MESSAGES,
  TIMEOUT,
  TIMING,
} from '@/config/constants';
import defaultRules from '@/config/default_rules.json';
import { findElementsByRule, readField } from '@/content/utils/selector-rule';

const sendMessageMock = vi.hoisted(() => vi.fn());

vi.mock('@/utils/chrome-message', () => ({ sendMessage: sendMessageMock }));
vi.mock('@/utils/logger', () => ({
  Logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function createConfig(type: SelectorRule['type'] = 'css'): CrawlingConfig {
  const rule = (css: string, xpath: string): SelectorRule => ({
    type,
    selector: type === 'css' ? css : xpath,
  });
  return {
    id: `test-${type}`,
    domain: 'example.com',
    container: rule('#comments-root', "//section[@id='comments-root']"),
    item: rule('.comment-item', ".//*[@class='comment-item']"),
    fields: [
      { name: 'username', rule: rule('.user', ".//*[@class='user']") },
      { name: 'content', rule: rule('.text', ".//*[@class='text']") },
    ],
    replies: {
      container: rule('.reply-container', ".//*[@class='reply-container']"),
      item: rule('.reply-item', ".//*[@class='reply-item']"),
      fields: [
        { name: 'username', rule: rule('.user', ".//*[@class='user']") },
        { name: 'content', rule: rule('.text', ".//*[@class='text']") },
      ],
    },
    lastUpdated: 1,
  };
}

function commentTree(comments: Comment[]): unknown[] {
  return comments.map((comment) => [comment.username, commentTree(comment.replies)]);
}

async function executeStrategy(
  strategy: ConfiguredStrategy,
  maxComments = 10,
  onProgress?: Parameters<ConfiguredStrategy['execute']>[2],
  maxReplyDepth?: number,
): Promise<Comment[]> {
  const result = strategy.execute(maxComments, 'example.com', onProgress, undefined, maxReplyDepth);
  await vi.runAllTimersAsync();
  return result;
}

describe('ConfiguredStrategy', () => {
  let mockPageController: PageController;

  beforeEach(() => {
    vi.useFakeTimers();
    sendMessageMock.mockReset();
    sendMessageMock.mockResolvedValue({ success: true });
    document.body.innerHTML = '';
    setExtractionActive(true, 'test-task');
    mockPageController = {
      scrollContainer: vi.fn().mockResolvedValue({ contentChanged: false }),
    } as unknown as PageController;
  });

  afterEach(() => {
    resetExtractionState();
    vi.useRealTimers();
    vi.restoreAllMocks();
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
    const comments = await executeStrategy(strategy, 10);

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
    const comments = await executeStrategy(strategy, 10);

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
    const comments = await executeStrategy(strategy, 10);

    expect(comments).toHaveLength(1);
    expect(comments[0].username).toBe('Parent');
    expect(comments[0].replies).toHaveLength(1);
    expect(comments[0].replies[0].username).toBe('Child');
    expect(comments[0].replies[0].content).toBe('Sub reply');
    expect(comments[0].replies[0].likes).toBe(5);
  });

  it.each([2, 3])('preserves %i Reddit levels with the unmodified bundled rule', async (levels) => {
    const grandchild =
      levels === 3
        ? '<shreddit-comment><a noun="comment_author">Grandchild</a><div slot="comment">Third level</div></shreddit-comment>'
        : '';
    document.body.innerHTML = `
      <shreddit-comment-tree>
        <shreddit-comment>
          <a noun="comment_author">Parent</a><div slot="comment">Main comment</div>
          <shreddit-comment>
            <a noun="comment_author">Child</a><div slot="comment">Child comment</div>
            ${grandchild}
          </shreddit-comment>
          <shreddit-comment><a noun="comment_author">Sibling reply</a><div slot="comment">Other reply</div></shreddit-comment>
        </shreddit-comment>
        <shreddit-comment><a noun="comment_author">Other root</a><div slot="comment">Another thread</div></shreddit-comment>
      </shreddit-comment-tree>
    `;
    const config = defaultRules.find((rule) => rule.id === 'reddit') as CrawlingConfig;
    const comments = await executeStrategy(new ConfiguredStrategy(mockPageController, config), 10);

    expect(commentTree(comments)).toEqual([
      [
        'Parent',
        [
          ['Child', levels === 3 ? [['Grandchild', []]] : []],
          ['Sibling reply', []],
        ],
      ],
      ['Other root', []],
    ]);
  });

  it.each(['css', 'xpath'] as const)(
    'includes reply containers that are themselves items with %s selectors',
    async (type) => {
      document.body.innerHTML = `
        <section id="comments-root">
          <article class="node"><b class="user">Parent</b><p class="text">Main</p>
            <article class="node"><b class="user">Child</b><p class="text">Reply</p>
              <article class="node"><b class="user">Grandchild</b><p class="text">Nested</p></article>
            </article>
            <article class="node"><b class="user">Sibling</b><p class="text">Other reply</p></article>
          </article>
          <article class="node"><b class="user">Other root</b><p class="text">Other thread</p></article>
        </section>
      `;
      const config = createConfig(type);
      config.item = { type, selector: type === 'css' ? '.node' : ".//*[@class='node']" };
      config.replies!.container = config.item;
      config.replies!.item = config.item;

      const comments = await executeStrategy(
        new ConfiguredStrategy(mockPageController, config),
        10,
      );

      expect(commentTree(comments)).toEqual([
        [
          'Parent',
          [
            ['Child', [['Grandchild', []]]],
            ['Sibling', []],
          ],
        ],
        ['Other root', []],
      ]);
    },
  );

  it.each(['css', 'xpath', 'shadow'] as const)(
    'collects sibling and overlapping reply containers with nearest-parent ownership (%s)',
    async (mode) => {
      const html = `
        <section id="comments-root">
          <article class="comment-item"><b class="user">Parent</b><p class="text">Main</p>
            <div class="reply-container">
              <article class="reply-item"><b class="user">Child</b><p class="text">Reply</p>
                <div class="reply-container">
                  <article class="reply-item"><b class="user">Grandchild</b><p class="text">Nested</p></article>
                </div>
              </article>
            </div>
            <div class="reply-container">
              <article class="reply-item"><b class="user">Sibling A</b><p class="text">Other reply</p></article>
            </div>
            <div class="reply-container"><div class="reply-container">
              <article class="reply-item"><b class="user">Sibling B</b><p class="text">Overlapping containers</p></article>
            </div></div>
          </article>
        </section>
      `;
      if (mode === 'shadow') {
        const host = document.createElement('test-comments');
        document.body.append(host);
        host.attachShadow({ mode: 'open' }).innerHTML = html;
        const parent = host.shadowRoot!.querySelector('.comment-item')!;
        const replyHost = document.createElement('reply-host');
        const replyRoot = replyHost.attachShadow({ mode: 'open' });
        for (const group of Array.from(parent.children).filter((node) =>
          node.matches('.reply-container'),
        )) {
          replyRoot.append(group);
        }
        parent.append(replyHost);
      } else {
        document.body.innerHTML = html;
      }
      const config = createConfig(mode === 'xpath' ? 'xpath' : 'css');
      const comments = await executeStrategy(new ConfiguredStrategy(mockPageController, config));

      expect(commentTree(comments)).toEqual([
        [
          'Parent',
          [
            ['Child', [['Grandchild', []]]],
            ['Sibling A', []],
            ['Sibling B', []],
          ],
        ],
      ]);
    },
  );

  it('does not promote nested shadow comments to top-level roots', async () => {
    document.body.innerHTML =
      '<section id="comments-root"><article class="node"><b class="user">Parent</b><p class="text">Main</p><reply-host></reply-host></article></section>';
    document.querySelector('reply-host')!.attachShadow({ mode: 'open' }).innerHTML = `
      <article class="node"><b class="user">Child</b><p class="text">Reply</p>
        <article class="node"><b class="user">Grandchild</b><p class="text">Nested</p></article>
      </article>
      <article class="node"><b class="user">Sibling</b><p class="text">Other reply</p></article>
    `;
    const config = createConfig();
    config.item = { type: 'css', selector: '.node' };
    config.replies!.container = config.item;
    config.replies!.item = config.item;

    const comments = await executeStrategy(new ConfiguredStrategy(mockPageController, config), 10);

    expect(commentTree(comments)).toEqual([
      [
        'Parent',
        [
          ['Child', [['Grandchild', []]]],
          ['Sibling', []],
        ],
      ],
    ]);
  });

  it.each(['css', 'xpath'] as const)(
    'keeps selector helper self-exclusion unchanged (%s)',
    (type) => {
      document.body.innerHTML =
        '<article class="node"><article class="node">Child</article></article>';
      const parent = document.querySelector('article')!;
      const rule: SelectorRule = {
        type,
        selector: type === 'css' ? '.node' : ".//*[@class='node']",
      };

      expect(findElementsByRule(parent, rule)).toEqual([parent.firstElementChild]);
      expect(findElementsByRule(parent.firstElementChild!, rule)).toEqual([]);
      expect(readField(parent.firstElementChild!, { name: 'content', rule })).toBeNull();
    },
  );

  it('extracts a second comment when a virtualized list reuses the same DOM node', async () => {
    document.body.innerHTML =
      '<section id="comments-root"><article class="comment-item" data-comment-id="first"><b class="user">First user</b><p class="text">First comment</p></article></section>';
    const item = document.querySelector<HTMLElement>('.comment-item')!;
    item.scrollIntoView = vi.fn();
    vi.mocked(mockPageController.scrollContainer).mockImplementationOnce(async () => {
      item.dataset.commentId = 'second';
      item.querySelector('.user')!.textContent = 'Second user';
      item.querySelector('.text')!.textContent = 'Second comment';
      return { contentChanged: true, scrollPositionChanged: true, hasMore: true };
    });

    const comments = await executeStrategy(
      new ConfiguredStrategy(mockPageController, createConfig()),
      2,
    );

    expect(comments.map((comment) => comment.content)).toEqual(['First comment', 'Second comment']);
    expect(item.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('retries an empty skeleton instead of marking it as permanently processed', async () => {
    document.body.innerHTML =
      '<section id="comments-root"><article class="comment-item"></article></section>';
    const item = document.querySelector<HTMLElement>('.comment-item')!;
    item.scrollIntoView = vi.fn();
    vi.mocked(mockPageController.scrollContainer).mockImplementationOnce(async () => {
      item.innerHTML = '<b class="user">Loaded user</b><p class="text">Loaded content</p>';
      return { contentChanged: true, scrollPositionChanged: true, hasMore: true };
    });

    const comments = await executeStrategy(
      new ConfiguredStrategy(mockPageController, createConfig()),
      1,
    );

    expect(comments).toHaveLength(1);
    expect(comments[0].content).toBe('Loaded content');
    expect(item.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('retries an author-only skeleton until its content arrives without consuming max=1', async () => {
    document.body.innerHTML =
      '<section id="comments-root"><article class="comment-item"><b class="user">Early author</b><p class="text"></p></article></section>';
    const item = document.querySelector<HTMLElement>('.comment-item')!;
    item.scrollIntoView = vi.fn();
    vi.mocked(mockPageController.scrollContainer).mockImplementationOnce(async () => {
      item.querySelector('.text')!.textContent = 'Content loaded later';
      return { contentChanged: true };
    });

    const comments = await executeStrategy(
      new ConfiguredStrategy(mockPageController, createConfig()),
      1,
    );

    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      username: 'Early author',
      content: 'Content loaded later',
    });
    expect(item.scrollIntoView).toHaveBeenCalledTimes(2);
    expect(mockPageController.scrollContainer).toHaveBeenCalledOnce();
  });

  it('does not re-scroll or re-click an unchanged successfully extracted item', async () => {
    document.body.innerHTML =
      '<section id="comments-root"><article class="comment-item"><b class="user">User</b><p class="text">Content</p><button class="expand">Expand</button></article></section>';
    const item = document.querySelector<HTMLElement>('.comment-item')!;
    const button = document.querySelector<HTMLButtonElement>('button')!;
    item.scrollIntoView = vi.fn();
    const click = vi.spyOn(button, 'click');
    button.addEventListener('click', () => {
      item.insertAdjacentHTML(
        'beforeend',
        '<div class="reply-container"><article class="reply-item"><b class="user">Loaded child</b><p class="text">Expanded reply</p></article></div>',
      );
    });
    const config = createConfig();
    config.replies!.expandBtn = { type: 'css', selector: '.expand' };

    const comments = await executeStrategy(new ConfiguredStrategy(mockPageController, config), 5);

    expect(comments).toHaveLength(1);
    expect(mockPageController.scrollContainer).toHaveBeenCalledTimes(DOM.NO_NEW_COMMENTS_THRESHOLD);
    expect(item.scrollIntoView).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(commentTree(comments)).toEqual([['User', [['Loaded child', []]]]]);
  });

  it.each(['more-replies', 'more-replies-sub-thread'])(
    'opens the visible YouTube %s control and extracts the delayed reply',
    async (controlId) => {
      const reply =
        '<ytd-comment-view-model><a id="author-text"><span>Reply user</span></a><div id="content-text">Reply</div></ytd-comment-view-model>';
      document.body.innerHTML = `
      <ytd-comments id="comments"><ytd-item-section-renderer id="sections">
        <ytd-comment-thread-renderer>
          <a id="author-text"><span>First</span></a><div id="content-text">First comment</div>
          <ytd-comment-replies-renderer id="replies">
            <div id="more-replies" hidden><button>Show replies</button></div>
            ${reply}
          </ytd-comment-replies-renderer>
        </ytd-comment-thread-renderer>
        <ytd-comment-thread-renderer>
          <a id="author-text"><span>Second</span></a><div id="content-text">Second comment</div>
          <ytd-comment-replies-renderer id="replies">
            <ytd-button-renderer id="${controlId}"><yt-button-shape><button>Show replies</button></yt-button-shape></ytd-button-renderer>
          </ytd-comment-replies-renderer>
        </ytd-comment-thread-renderer>
      </ytd-item-section-renderer></ytd-comments>
    `;
      const [hiddenToggle, activeToggle] = document.querySelectorAll<HTMLButtonElement>('button');
      const hiddenClick = vi.spyOn(hiddenToggle, 'click');
      const activeClick = vi.spyOn(activeToggle, 'click');
      activeToggle.addEventListener('click', () => {
        const markup =
          controlId === 'more-replies-sub-thread'
            ? `<div id="expanded-threads"><yt-sub-thread><ytd-comment-thread-renderer>${reply}</ytd-comment-thread-renderer></yt-sub-thread></div>`
            : reply;
        setTimeout(() => {
          activeToggle.closest('#replies')!.insertAdjacentHTML('beforeend', markup);
        }, TIMING.REPLY_POLL_INTERVAL_MS * 3);
      });

      const config = defaultRules.find((rule) => rule.domain === 'youtube.com') as CrawlingConfig;
      const startedAt = Date.now();
      const result = new ConfiguredStrategy(mockPageController, config)
        .execute(4, 'youtube.com')
        .then((comments) => ({ comments, elapsed: Date.now() - startedAt }));
      await vi.runAllTimersAsync();
      const { comments, elapsed } = await result;

      expect(hiddenClick).not.toHaveBeenCalled();
      expect(activeClick).toHaveBeenCalledOnce();
      expect(elapsed).toBeLessThan(TIMING.REPLY_POLL_TIMEOUT_MS);
      expect(commentTree(comments)).toEqual([
        ['First', [['Reply user', []]]],
        ['Second', [['Reply user', []]]],
      ]);
    },
  );

  it('scrolls a lazy YouTube section into view and waits for its first comment', async () => {
    const section = document.createElement('ytd-comments');
    section.id = 'comments';
    section.innerHTML = '<ytd-item-section-renderer id="sections"></ytd-item-section-renderer>';
    section.scrollIntoView = vi.fn(() => {
      setTimeout(() => {
        section.querySelector('#sections')!.innerHTML = `
          <ytd-comment-thread-renderer>
            <a id="author-text"><span>Author</span></a><div id="content-text">Lazy comment</div>
          </ytd-comment-thread-renderer>
        `;
      }, TIMEOUT.COMMENTS_SECTION_MS / 2);
    });
    setTimeout(() => document.body.append(section), TIMING.SHORT_WAIT_MS * 2);

    const config = defaultRules.find((rule) => rule.domain === 'youtube.com') as CrawlingConfig;
    const comments = await executeStrategy(new ConfiguredStrategy(mockPageController, config), 1);

    expect(section.scrollIntoView).toHaveBeenCalledOnce();
    expect(comments.map((comment) => comment.content)).toEqual(['Lazy comment']);
    expect(mockPageController.scrollContainer).not.toHaveBeenCalled();
  });

  it('stops after repeated scrolls with no new comments despite unrelated layout changes', async () => {
    document.body.innerHTML =
      '<section id="comments-root"><article class="comment-item"><b class="user">User</b><p class="text">Content</p></article></section>';
    const scroll = vi.mocked(mockPageController.scrollContainer);
    for (let round = 0; round < DOM.NO_NEW_COMMENTS_THRESHOLD * 2; round++) {
      scroll.mockResolvedValueOnce({ contentChanged: true });
    }

    const comments = await executeStrategy(
      new ConfiguredStrategy(mockPageController, createConfig()),
      2,
    );

    expect(comments.map((comment) => comment.content)).toEqual(['Content']);
    expect(scroll).toHaveBeenCalledTimes(DOM.NO_NEW_COMMENTS_THRESHOLD);
  });

  it('refreshes and deduplicates a previously extracted parent when its reply fields change', async () => {
    document.body.innerHTML =
      '<section id="comments-root"><article class="comment-item"><b class="user">Parent</b><p class="text">Main</p><div class="reply-container"><article class="reply-item"><b class="user">Child</b><p class="text">Reply</p><button class="expand">Child expand</button></article></div></article></section>';
    const childClick = vi.spyOn(document.querySelector<HTMLButtonElement>('button')!, 'click');
    const config = createConfig();
    config.replies!.expandBtn = { type: 'css', selector: '.expand' };
    vi.mocked(mockPageController.scrollContainer).mockImplementationOnce(async () => {
      document
        .querySelector('.reply-container')!
        .insertAdjacentHTML(
          'beforeend',
          '<article class="reply-item"><b class="user">Second child</b><p class="text">New reply</p></article>',
        );
      return { contentChanged: true, scrollPositionChanged: true, hasMore: true };
    });

    const comments = await executeStrategy(new ConfiguredStrategy(mockPageController, config), 5);

    expect(commentTree(comments)).toEqual([
      [
        'Parent',
        [
          ['Child', []],
          ['Second child', []],
        ],
      ],
    ]);
    expect(childClick).toHaveBeenCalledOnce();
  });

  it.each([1, 3])(
    'stops processing a visible batch as soon as %i roots are collected',
    async (maxComments) => {
      document.body.innerHTML = `<section id="comments-root">${Array.from({ length: 6 }, (_, index) => `<article class="comment-item"><b class="user">User ${index}</b><p class="text">Comment ${index}</p></article>`).join('')}</section>`;
      const scrollIntoView = vi.fn();
      for (const element of document.querySelectorAll<HTMLElement>('.comment-item')) {
        element.scrollIntoView = scrollIntoView;
      }
      const strategy = new ConfiguredStrategy(mockPageController, createConfig());
      const extract = vi.spyOn(
        strategy as unknown as {
          extractCommentFromElement(
            element: HTMLElement,
            platform: string,
            signal?: AbortSignal,
          ): Promise<Comment | null>;
        },
        'extractCommentFromElement',
      );

      const comments = await executeStrategy(strategy, maxComments);

      expect(comments).toHaveLength(maxComments);
      expect(extract).toHaveBeenCalledTimes(maxComments);
      expect(scrollIntoView).toHaveBeenCalledTimes(maxComments);
      expect(mockPageController.scrollContainer).not.toHaveBeenCalled();
    },
  );

  it('honors the caller target including CommentExtractor validation buffering without processing the rest of the batch', async () => {
    const config = createConfig();
    const target =
      1 +
      Math.min(
        EXTRACTION.VALIDATION_BUFFER_MAX,
        Math.max(EXTRACTION.VALIDATION_BUFFER_MIN, Math.ceil(EXTRACTION.VALIDATION_BUFFER_RATIO)),
      );
    document.body.innerHTML = `<section id="comments-root">${Array.from({ length: target + 5 }, (_, index) => `<article class="comment-item"><b class="user">User ${index}</b><p class="text">Comment ${index}</p></article>`).join('')}</section>`;
    const scrollIntoView = vi.fn();
    for (const element of document.querySelectorAll<HTMLElement>('.comment-item')) {
      element.scrollIntoView = scrollIntoView;
    }
    sendMessageMock.mockImplementation(async (message: { type: string }) =>
      message.type === MESSAGES.GET_CRAWLING_CONFIG ? { config } : { success: true },
    );
    const execute = vi.spyOn(ConfiguredStrategy.prototype, 'execute');
    const result = new CommentExtractor(mockPageController).extractWithAI(1, 'example.com');
    await vi.runAllTimersAsync();
    const comments = await result;

    expect(execute).toHaveBeenCalledWith(
      target,
      'example.com',
      undefined,
      undefined,
      EXTRACTION_DEFAULTS.MAX_REPLY_DEPTH,
    );
    expect(comments).toHaveLength(1);
    expect(comments[0].content).toBe('Comment 0');
    expect(scrollIntoView).toHaveBeenCalledTimes(target);
    expect(mockPageController.scrollContainer).not.toHaveBeenCalled();
  });

  it('counts replies toward maxComments, stops immediately at budget, and emits per-item progress', async () => {
    document.body.innerHTML = `
      <section id="comments-root">
        <article class="comment-item">
          <b class="user">Root 1</b><p class="text">First root</p>
          <div class="reply-container">
            <article class="reply-item">
              <b class="user">Reply 1.1</b><p class="text">L1 reply</p>
              <div class="reply-container">
                <article class="reply-item"><b class="user">Reply 1.1.1</b><p class="text">L2 reply</p></article>
              </div>
            </article>
            <article class="reply-item"><b class="user">Reply 1.2</b><p class="text">L1 sibling</p></article>
          </div>
          <button class="expand">More replies</button>
        </article>
        <article class="comment-item"><b class="user">Root 2</b><p class="text">Second root</p></article>
      </section>
    `;
    const expandBtn = document.querySelector<HTMLButtonElement>('.expand')!;
    const expandClick = vi.spyOn(expandBtn, 'click');
    const config = createConfig();
    config.replies!.expandBtn = { type: 'css', selector: '.expand' };

    const progressUpdates: Array<{ stage?: string; current?: number; total?: number }> = [];
    const comments = await executeStrategy(
      new ConfiguredStrategy(mockPageController, config),
      3,
      (_percent, _message, stage, current, total) => {
        progressUpdates.push({ stage, current, total });
      },
      10,
    );

    expect(commentTree(comments)).toEqual([
      ['Root 1', [['Reply 1.1', []]]],
      ['Root 2', []],
    ]);
    expect(expandClick).not.toHaveBeenCalled();
    expect(mockPageController.scrollContainer).not.toHaveBeenCalled();

    const extractingCounts = progressUpdates
      .filter((u) => u.stage === 'extracting')
      .map((u) => u.current);
    expect(extractingCounts).toEqual([0, 1, 2, 3]);
  });

  it('supports deep multi-level nesting beyond 5 levels and respects maxReplyDepth=0 and custom depths', async () => {
    const buildLevel = (level: number, maxLevel: number): string => `
      <shreddit-comment score="${level}">
        <a noun="comment_author">User L${level}</a>
        <div slot="comment">Comment at level ${level}</div>
        ${level < maxLevel ? buildLevel(level + 1, maxLevel) : ''}
      </shreddit-comment>
    `;
    document.body.innerHTML = `<shreddit-comment-tree>${buildLevel(0, 7)}</shreddit-comment-tree>`;
    const redditConfig = defaultRules.find((rule) => rule.id === 'reddit') as CrawlingConfig;

    const full = await executeStrategy(
      new ConfiguredStrategy(mockPageController, redditConfig),
      20,
      undefined,
      10,
    );
    let node = full[0];
    let depthReached = 0;
    while (node.replies.length > 0) {
      node = node.replies[0];
      depthReached += 1;
    }
    expect(depthReached).toBe(7);

    setExtractionActive(true, 'test-task-roots');
    const rootsOnly = await executeStrategy(
      new ConfiguredStrategy(mockPageController, redditConfig),
      20,
      undefined,
      0,
    );
    expect(commentTree(rootsOnly)).toEqual([['User L0', []]]);

    setExtractionActive(true, 'test-task-depth-2');
    const depthTwo = await executeStrategy(
      new ConfiguredStrategy(mockPageController, redditConfig),
      20,
      undefined,
      2,
    );
    expect(commentTree(depthTwo)).toEqual([['User L0', [['User L1', [['User L2', []]]]]]]);
  });

  it('expands multiple reply batches at the same level and clicks top-level loadMoreBtn', async () => {
    document.body.innerHTML = `
      <section id="comments-root">
        <article class="comment-item">
          <b class="user">Root 1</b><p class="text">First</p>
          <div class="reply-container">
            <button class="expand" id="batch-1">Load batch 1</button>
          </div>
        </article>
        <button class="load-more">View more comments</button>
      </section>
    `;
    const replyContainer = document.querySelector('.reply-container')!;
    const batch1Btn = document.querySelector<HTMLButtonElement>('#batch-1')!;
    batch1Btn.addEventListener('click', () => {
      batch1Btn.remove();
      replyContainer.insertAdjacentHTML(
        'beforeend',
        `
          <article class="reply-item"><b class="user">Reply A</b><p class="text">Batch 1</p></article>
          <button class="expand" id="batch-2">Load batch 2</button>
        `,
      );
      const batch2Btn = document.querySelector<HTMLButtonElement>('#batch-2')!;
      batch2Btn.addEventListener('click', () => {
        batch2Btn.remove();
        replyContainer.insertAdjacentHTML(
          'beforeend',
          '<article class="reply-item"><b class="user">Reply B</b><p class="text">Batch 2</p></article>',
        );
      });
    });

    const loadMoreBtn = document.querySelector<HTMLButtonElement>('.load-more')!;
    loadMoreBtn.addEventListener('click', () => {
      loadMoreBtn.remove();
      document
        .querySelector('#comments-root')!
        .insertAdjacentHTML(
          'beforeend',
          '<article class="comment-item"><b class="user">Root 2</b><p class="text">Second</p></article>',
        );
    });

    const config = createConfig();
    config.replies!.expandBtn = { type: 'css', selector: '.expand' };
    config.loadMoreBtn = { type: 'css', selector: '.load-more' };

    const comments = await executeStrategy(
      new ConfiguredStrategy(mockPageController, config),
      4,
      undefined,
      5,
    );

    expect(commentTree(comments)).toEqual([
      [
        'Root 1',
        [
          ['Reply A', []],
          ['Reply B', []],
        ],
      ],
      ['Root 2', []],
    ]);
  });

  it('does not borrow fields from nested child replies when a parent lacks an author', async () => {
    document.body.innerHTML = `
      <shreddit-comment-tree>
        <shreddit-comment score="5">
          <div slot="comment">[deleted]</div>
          <shreddit-comment score="12">
            <a noun="comment_author">ChildAuthor</a>
            <div slot="comment">Actual child comment</div>
          </shreddit-comment>
        </shreddit-comment>
      </shreddit-comment-tree>
    `;
    const redditConfig = defaultRules.find((rule) => rule.id === 'reddit') as CrawlingConfig;
    const comments = await executeStrategy(
      new ConfiguredStrategy(mockPageController, redditConfig),
      10,
    );

    expect(comments).toHaveLength(1);
    expect(comments[0].username).toBe('Unknown');
    expect(comments[0].content).toBe('[deleted]');
    expect(comments[0].replies).toHaveLength(1);
    expect(comments[0].replies[0].username).toBe('ChildAuthor');
    expect(comments[0].replies[0].content).toBe('Actual child comment');
  });

  it('prevents a 120-reply Reddit mega-thread from monopolizing budget while capturing deep viral gems and bridges', async () => {
    const buildNestedChain = (
      prefix: string,
      depth: number,
      maxDepth: number,
      score: number,
      branchCount: number,
    ): string => {
      if (depth > maxDepth) return '';
      return Array.from({ length: branchCount }, (_, idx) => {
        const childScore = Math.max(1, Math.round(score / (idx + 1.2)));
        const childBranches =
          depth < maxDepth && idx < 3 ? Math.max(1, Math.floor(branchCount / (idx + 2))) : 0;
        return `
          <shreddit-comment score="${childScore}">
            <a noun="comment_author">${prefix}_d${depth}_${idx}</a>
            <div slot="comment">Reply ${prefix} d${depth} #${idx}</div>
            ${childBranches > 0 ? buildNestedChain(`${prefix}_${idx}`, depth + 1, maxDepth, childScore, childBranches) : ''}
          </shreddit-comment>
        `;
      }).join('');
    };

    // Root 0 has 120+ nested replies across 5 levels
    const root0Subtree = buildNestedChain('R0', 1, 5, 1600, 30);
    const otherRoots = Array.from({ length: 25 }, (_, idx) => {
      const r = idx + 1;
      const rootScore = Math.round(1200 / (r + 1));
      if (r === 3) {
        // 0-score [deleted] bridge hiding a 1500-score child
        return `
          <shreddit-comment score="${rootScore}">
            <a noun="comment_author">Root ${r}</a>
            <div slot="comment">Root comment ${r}</div>
            <shreddit-comment score="0">
              <a noun="comment_author">BridgeAuthor</a>
              <div slot="comment">[deleted]</div>
              <shreddit-comment score="1500">
                <a noun="comment_author">BridgedChild</a>
                <div slot="comment">High value explanation behind bridge</div>
              </shreddit-comment>
            </shreddit-comment>
          </shreddit-comment>
        `;
      }
      if (r === 8) {
        // Deep viral gem in Root 8
        return `
          <shreddit-comment score="${rootScore}">
            <a noun="comment_author">Root ${r}</a>
            <div slot="comment">Root comment ${r}</div>
            <shreddit-comment score="2200">
              <a noun="comment_author">ViralL1</a>
              <div slot="comment">Viral L1 reply</div>
              <shreddit-comment score="1400">
                <a noun="comment_author">ViralL2</a>
                <div slot="comment">Viral L2 reply</div>
              </shreddit-comment>
            </shreddit-comment>
          </shreddit-comment>
        `;
      }
      return `
        <shreddit-comment score="${rootScore}">
          <a noun="comment_author">Root ${r}</a>
          <div slot="comment">Root comment ${r}</div>
          <shreddit-comment score="${Math.round(rootScore * 0.4)}">
            <a noun="comment_author">Reply_R${r}_0</a>
            <div slot="comment">Child of Root ${r}</div>
          </shreddit-comment>
        </shreddit-comment>
      `;
    }).join('');

    document.body.innerHTML = `
      <shreddit-comment-tree>
        <shreddit-comment score="3000">
          <a noun="comment_author">Root 0</a>
          <div slot="comment">Mega-thread root</div>
          ${root0Subtree}
        </shreddit-comment>
        ${otherRoots}
      </shreddit-comment-tree>
    `;

    const redditConfig = defaultRules.find((rule) => rule.id === 'reddit') as CrawlingConfig;
    const comments = await executeStrategy(
      new ConfiguredStrategy(mockPageController, redditConfig),
      50,
      undefined,
      10,
    );

    expect(countComments(comments)).toBe(50);
    expect(comments.length).toBeGreaterThanOrEqual(15);
    expect(countComments([comments[0]])).toBeLessThan(20);

    // Preserves DOM root order
    const rootIds = comments.map((c) => Number(c.username.replace('Root ', '')));
    expect(rootIds).toEqual([...rootIds].sort((a, b) => a - b));

    // Reaches depth >= 2
    const maxDepthReached = (items: Comment[], depth = 0): number =>
      items.reduce(
        (max, item) => Math.max(max, depth, maxDepthReached(item.replies, depth + 1)),
        depth,
      );
    expect(maxDepthReached(comments)).toBeGreaterThanOrEqual(2);

    // Captures viral deep gem in Root 8 and bridged child in Root 3
    const root3 = comments.find((c) => c.username === 'Root 3');
    expect(root3?.replies.some((r) => r.username === 'BridgeAuthor')).toBe(true);
    expect(root3?.replies[0]?.replies.some((r) => r.username === 'BridgedChild')).toBe(true);

    const root8 = comments.find((c) => c.username === 'Root 8');
    expect(root8?.replies.some((r) => r.username === 'ViralL1')).toBe(true);
    expect(root8?.replies[0]?.replies.some((r) => r.username === 'ViralL2')).toBe(true);
  });

  it('interleaves collapsed expand buttons fairly across multiple roots instead of draining one thread', async () => {
    document.body.innerHTML = `
      <section id="comments-root">
        <article class="comment-item" id="root-1">
          <b class="user">Root 1</b><p class="text">First root</p>
          <div class="reply-container">
            <button class="expand" id="exp-r1-b1">Expand R1 batch 1</button>
          </div>
        </article>
        <article class="comment-item" id="root-2">
          <b class="user">Root 2</b><p class="text">Second root</p>
          <div class="reply-container">
            <button class="expand" id="exp-r2">Expand R2</button>
          </div>
        </article>
        <article class="comment-item" id="root-3">
          <b class="user">Root 3</b><p class="text">Third root</p>
          <div class="reply-container">
            <button class="expand" id="exp-r3">Expand R3</button>
          </div>
        </article>
      </section>
    `;

    const attachExpand = (btnId: string, rootLabel: string, hasSecondBatch = false) => {
      const btn = document.querySelector<HTMLButtonElement>(`#${btnId}`)!;
      btn.addEventListener('click', () => {
        const container = btn.closest('.reply-container')!;
        btn.remove();
        const replies = Array.from(
          { length: 5 },
          (_, idx) =>
            `<article class="reply-item"><b class="user">${rootLabel}_Reply_${idx}</b><p class="text">${rootLabel} reply ${idx}</p></article>`,
        ).join('');
        container.insertAdjacentHTML('beforeend', replies);
        if (hasSecondBatch) {
          container.insertAdjacentHTML(
            'beforeend',
            '<button class="expand" id="exp-r1-b2">Expand R1 batch 2</button>',
          );
          attachExpand('exp-r1-b2', `${rootLabel}_B2`, false);
        }
      });
    };

    attachExpand('exp-r1-b1', 'R1', true);
    attachExpand('exp-r2', 'R2', false);
    attachExpand('exp-r3', 'R3', false);

    const config = createConfig();
    config.replies!.expandBtn = { type: 'css', selector: '.expand' };

    const comments = await executeStrategy(
      new ConfiguredStrategy(mockPageController, config),
      10,
      undefined,
      5,
    );

    expect(countComments(comments)).toBe(10);
    expect(comments.map((c) => c.username)).toEqual(['Root 1', 'Root 2', 'Root 3']);
    expect(comments[1].replies.length).toBeGreaterThan(0);
    expect(comments[2].replies.length).toBeGreaterThan(0);
    // Root 1's second batch should not have been needed or allowed to starve Root 2/3
    expect(document.querySelector('#exp-r1-b2')).not.toBeNull();
  });

  it('spills remaining budget fairly into nested replies when only two roots exist', async () => {
    const makeReplyTree = (prefix: string) =>
      Array.from(
        { length: 5 },
        (_, i) => `
        <div class="reply-container">
          <article class="reply-item">
            <b class="user">${prefix}_L1_${i}</b><p class="text">${prefix} L1 ${i}</p>
            <div class="reply-container">
              <article class="reply-item">
                <b class="user">${prefix}_L2_${i}_0</b><p class="text">${prefix} L2 ${i} 0</p>
                <div class="reply-container">
                  <article class="reply-item">
                    <b class="user">${prefix}_L3_${i}_0</b><p class="text">${prefix} L3 ${i} 0</p>
                  </article>
                </div>
              </article>
            </div>
          </article>
        </div>
      `,
      ).join('');

    document.body.innerHTML = `
      <section id="comments-root">
        <article class="comment-item"><b class="user">Root A</b><p class="text">Thread A</p>${makeReplyTree('A')}</article>
        <article class="comment-item"><b class="user">Root B</b><p class="text">Thread B</p>${makeReplyTree('B')}</article>
      </section>
    `;

    const comments = await executeStrategy(
      new ConfiguredStrategy(mockPageController, createConfig()),
      20,
      undefined,
      10,
    );

    expect(countComments(comments)).toBe(20);
    expect(comments).toHaveLength(2);
    const shareA = countComments([comments[0]]);
    const shareB = countComments([comments[1]]);
    expect(shareA).toBeGreaterThanOrEqual(7);
    expect(shareB).toBeGreaterThanOrEqual(7);
  });

  it('restores top-level scroll watermark after expanding an earlier thread before scrolling for more roots', async () => {
    document.body.innerHTML = `
      <section id="comments-root">
        <article class="comment-item" id="r1">
          <b class="user">Root 1</b><p class="text">First</p>
          <div class="reply-container"><button class="expand" id="exp-r1">Expand</button></div>
        </article>
        <article class="comment-item" id="r2">
          <b class="user">Root 2</b><p class="text">Second</p>
        </article>
      </section>
    `;

    let currentScrollY = 0;
    const originalScrollYDesc = Object.getOwnPropertyDescriptor(window, 'scrollY');
    const originalScrollTo = window.scrollTo;
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => currentScrollY,
    });
    window.scrollTo = vi.fn((opts?: ScrollToOptions | number, y?: number) => {
      if (typeof opts === 'number') {
        currentScrollY = y ?? 0;
      } else if (opts && typeof opts.top === 'number') {
        currentScrollY = opts.top;
      }
    }) as typeof window.scrollTo;

    const r1 = document.querySelector<HTMLElement>('#r1')!;
    const r2 = document.querySelector<HTMLElement>('#r2')!;
    const expBtn = document.querySelector<HTMLButtonElement>('#exp-r1')!;
    r1.scrollIntoView = vi.fn(() => {
      currentScrollY = 50;
    });
    r2.scrollIntoView = vi.fn(() => {
      currentScrollY = 400;
    });
    expBtn.scrollIntoView = vi.fn(() => {
      // Simulates viewport jumping back up to Root 1 before clicking expand
      currentScrollY = 50;
    });
    expBtn.addEventListener('click', () => {
      expBtn.closest('.reply-container')!.innerHTML =
        '<article class="reply-item"><b class="user">Child 1</b><p class="text">Expanded</p></article>';
    });

    const scrollObservedY: number[] = [];
    vi.mocked(mockPageController.scrollContainer).mockImplementation(async () => {
      scrollObservedY.push(window.scrollY);
      if (scrollObservedY.length === 1) {
        document
          .querySelector('#comments-root')!
          .insertAdjacentHTML(
            'beforeend',
            '<article class="comment-item" id="r3"><b class="user">Root 3</b><p class="text">Third</p></article>',
          );
      }
      return { contentChanged: scrollObservedY.length === 1 };
    });

    try {
      const config = createConfig();
      config.replies!.expandBtn = { type: 'css', selector: '.expand' };

      const comments = await executeStrategy(
        new ConfiguredStrategy(mockPageController, config),
        4,
        undefined,
        5,
      );

      expect(commentTree(comments)).toEqual([
        ['Root 1', [['Child 1', []]]],
        ['Root 2', []],
        ['Root 3', []],
      ]);
      expect(scrollObservedY[0]).toBe(400);
    } finally {
      window.scrollTo = originalScrollTo;
      if (originalScrollYDesc) {
        Object.defineProperty(window, 'scrollY', originalScrollYDesc);
      } else {
        delete (window as unknown as { scrollY?: number }).scrollY;
      }
    }
  });
});
