// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfiguredStrategy } from '@/content/strategies/ConfiguredStrategy';
import { PageController } from '@/content/PageController';
import { setExtractionActive, resetExtractionState } from '@/content/extractionState';
import type { Comment, CrawlingConfig, SelectorRule } from '@/types';
import { CommentExtractor } from '@/content/CommentExtractor';
import { DOM, EXTRACTION, MESSAGES, TIMEOUT, TIMING } from '@/config/constants';
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

async function executeStrategy(strategy: ConfiguredStrategy, maxComments = 1): Promise<Comment[]> {
  const result = strategy.execute(maxComments, 'example.com');
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
    const comments = await executeStrategy(new ConfiguredStrategy(mockPageController, config), 2);

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

      const comments = await executeStrategy(new ConfiguredStrategy(mockPageController, config), 2);

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

    const comments = await executeStrategy(new ConfiguredStrategy(mockPageController, config), 2);

    expect(comments).toHaveLength(1);
    expect(mockPageController.scrollContainer).toHaveBeenCalledTimes(
      DOM.NO_NEW_COMMENTS_THRESHOLD + 1,
    );
    expect(item.scrollIntoView).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(commentTree(comments)).toEqual([['User', [['Loaded child', []]]]]);
  });

  it('skips a hidden YouTube reply toggle while still waiting for newly requested replies', async () => {
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
            <div id="more-replies"><button>Show replies</button></div>
          </ytd-comment-replies-renderer>
        </ytd-comment-thread-renderer>
      </ytd-item-section-renderer></ytd-comments>
    `;
    const [hiddenToggle, activeToggle] = document.querySelectorAll<HTMLButtonElement>('button');
    const hiddenClick = vi.spyOn(hiddenToggle, 'click');
    const activeClick = vi.spyOn(activeToggle, 'click');
    activeToggle.addEventListener('click', () => {
      setTimeout(() => {
        activeToggle.closest('#replies')!.insertAdjacentHTML('beforeend', reply);
      }, TIMING.REPLY_POLL_INTERVAL_MS * 3);
    });

    const config = defaultRules.find((rule) => rule.domain === 'youtube.com') as CrawlingConfig;
    const startedAt = Date.now();
    const result = new ConfiguredStrategy(mockPageController, config)
      .execute(2, 'youtube.com')
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
  });

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
    const comments = await executeStrategy(new ConfiguredStrategy(mockPageController, config));

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
    expect(scroll).toHaveBeenCalledTimes(DOM.NO_NEW_COMMENTS_THRESHOLD + 1);
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

    const comments = await executeStrategy(new ConfiguredStrategy(mockPageController, config), 2);

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

    expect(execute).toHaveBeenCalledWith(target, 'example.com', undefined, undefined);
    expect(comments).toHaveLength(1);
    expect(comments[0].content).toBe('Comment 0');
    expect(scrollIntoView).toHaveBeenCalledTimes(target);
    expect(mockPageController.scrollContainer).not.toHaveBeenCalled();
  });
});
