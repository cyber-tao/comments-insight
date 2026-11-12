// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import defaultRules from '@/config/default_rules.json';
import { resetExtractionState, setExtractionActive } from '@/content/extractionState';
import type { PageController } from '@/content/PageController';
import { ConfiguredStrategy } from '@/content/strategies/ConfiguredStrategy';
import { findElementsByRule, readField } from '@/content/utils/selector-rule';
import { crawlingConfigSchema } from '@/utils/storage-validation';

vi.mock('@/utils/chrome-message', () => ({
  sendMessage: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('@/utils/logger', () => ({
  Logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function bundledConfig(domain: string) {
  return crawlingConfigSchema.parse(defaultRules.find((rule) => rule.domain === domain));
}

async function extract(domain: string, maxComments: number) {
  const pageController = {
    scrollContainer: vi.fn().mockResolvedValue({ contentChanged: false }),
  } as unknown as PageController;
  const result = new ConfiguredStrategy(pageController, bundledConfig(domain)).execute(
    maxComments,
    domain,
  );
  await vi.runAllTimersAsync();
  return result;
}

describe('bundled crawling rules', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setExtractionActive(true, 'bundled-rules-test');
  });

  afterEach(() => {
    resetExtractionState();
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reads TikTok first batch replies without borrowing their likes or selecting pagination', async () => {
    document.body.innerHTML = `
      <div class="layout-DivCommentListContainer">
        <div class="layout-DivCommentObjectWrapper">
          <div class="layout-DivCommentItemWrapper">
            <a data-e2e="comment-username-1">First author</a>
            <span data-e2e="comment-level-1">First comment</span>
            <div class="layout-DivCommentSubContentWrapper"><span>2d ago</span></div>
            <div class="layout-DivLikeContainer"><span>24.5K</span></div>
          </div>
          <div class="layout-DivReplyContainer" id="collapsed-replies">
            <div class="layout-DivViewMoreRepliesWrapper">
              <div class="layout-DivViewRepliesContainer">
                <button id="expand">View 5 replies</button>
              </div>
            </div>
          </div>
        </div>
        <div class="layout-DivCommentObjectWrapper">
          <div class="layout-DivCommentItemWrapper">
            <a data-e2e="comment-username-1">Second author</a>
            <span data-e2e="comment-level-1">Comment without a like count</span>
          </div>
          <div class="layout-DivReplyContainer">
            <div class="layout-DivCommentItemWrapper">
              <a data-e2e="comment-username-2">Existing author</a>
              <span data-e2e="comment-level-2">Already visible reply</span>
              <div class="layout-DivLikeContainer"><span>31</span></div>
            </div>
          </div>
        </div>
      </div>`;
    const toggle = document.querySelector<HTMLButtonElement>('#expand')!;
    const firstClick = vi.spyOn(toggle, 'click');
    const replyContainer = document.querySelector('#collapsed-replies')!;
    toggle.addEventListener('click', () => {
      replyContainer.innerHTML = `
        <div class="layout-DivCommentItemWrapper">
          <a data-e2e="comment-username-2">Reply author</a>
          <span data-e2e="comment-level-2">First batch reply</span>
          <div class="layout-DivCommentSubContentWrapper"><span>1d ago</span></div>
          <div class="layout-DivLikeContainer"><span>12</span></div>
        </div>
        <div class="layout-DivViewMoreRepliesWrapper">
          <div class="layout-DivViewRepliesContainer" data-key-interaction="comment_view_replies">View more replies</div>
          <div class="layout-DivViewRepliesContainer" data-key-interaction="comment_view_replies">Hide replies</div>
        </div>`;
    });

    const comments = await extract('tiktok.com', 2);

    expect(firstClick).toHaveBeenCalledOnce();
    expect(comments).toMatchObject([
      {
        content: 'First comment',
        likes: 24_500,
        timestamp: '2d ago',
        replies: [{ username: 'Reply author', content: 'First batch reply', likes: 12 }],
      },
      {
        content: 'Comment without a like count',
        likes: 0,
        replies: [{ content: 'Already visible reply', likes: 31 }],
      },
    ]);
    expect(
      findElementsByRule(replyContainer, bundledConfig('tiktok.com').replies?.expandBtn),
    ).toEqual([]);
  });

  it('still opens the first batch in the older TikTok layout', async () => {
    document.body.innerHTML = `
      <div class="legacy-DivCommentListContainer">
        <div class="legacy-DivCommentItemContainer">
          <a data-e2e="comment-username-1">Old comment author</a>
          <span data-e2e="comment-level-1">Old comment</span>
          <span data-e2e="comment-time-1">4d ago</span>
          <span data-e2e="comment-like-count">20</span>
          <div class="legacy-DivReplyContainer">
            <button data-e2e="view-more-1">View replies</button>
          </div>
        </div>
      </div>`;
    const toggle = document.querySelector('button')!;
    const click = vi.spyOn(toggle, 'click');
    toggle.addEventListener('click', () => {
      toggle.parentElement!.insertAdjacentHTML(
        'beforeend',
        `<div class="legacy-DivContentContainer">
          <a data-e2e="comment-username-2">Old reply author</a>
          <span data-e2e="comment-level-2">Old reply</span>
          <span data-e2e="comment-time-2">2d ago</span>
          <span data-e2e="comment-like-count">6</span>
        </div>`,
      );
      toggle.remove();
    });

    expect(await extract('tiktok.com', 1)).toMatchObject([
      { content: 'Old comment', likes: 20, replies: [{ content: 'Old reply', likes: 6 }] },
    ]);
    expect(click).toHaveBeenCalledOnce();
  });

  it('reads each Reddit score and opens the available reply control', async () => {
    document.body.innerHTML = `
      <shreddit-comment-tree>
        <shreddit-comment score="37">
          <a noun="comment_author">Root author</a><div slot="comment">Root comment</div>
          <faceplate-partial loading="action" slot="children" src="/svc/shreddit/other/r/example">
            <button data-skip>Unrelated action</button>
          </faceplate-partial>
          <faceplate-partial loading="action" slot="children" src="/svc/shreddit/more-comments/r/example">
            <button data-skip class="pointer-events-none">Loading</button>
            <button data-skip class="invisible">Hidden</button>
            <button data-skip disabled>Unavailable</button>
            <button id="expand">More replies</button>
          </faceplate-partial>
        </shreddit-comment>
      </shreddit-comment-tree>`;
    const unavailableClicks = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-skip]'),
    ).map((button) => vi.spyOn(button, 'click'));
    const toggle = document.querySelector<HTMLButtonElement>('#expand')!;
    const expandClick = vi.spyOn(toggle, 'click');
    toggle.addEventListener('click', () => {
      toggle.closest('faceplate-partial')!.outerHTML = `
        <shreddit-comment score="8">
          <a noun="comment_author">First reply author</a><div slot="comment">Positive reply</div>
        </shreddit-comment>
        <shreddit-comment score="-9">
          <a noun="comment_author">Second reply author</a><div slot="comment">Negative reply</div>
        </shreddit-comment>`;
    });

    expect(await extract('reddit.com', 1)).toMatchObject([
      {
        content: 'Root comment',
        likes: 37,
        replies: [
          { content: 'Positive reply', likes: 8 },
          { content: 'Negative reply', likes: 0 },
        ],
      },
    ]);
    expect(expandClick).toHaveBeenCalledOnce();
    for (const click of unavailableClicks) expect(click).not.toHaveBeenCalled();
  });

  it.each(['like', 'unlike'])('reads X likes when the button is %s', (state) => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <button data-testid="reply"><span data-testid="app-text-transition-container">2</span></button>
        <button data-testid="${state}"><span data-testid="app-text-transition-container">13</span></button>
      </article>`;
    const field = bundledConfig('x.com').fields.find((item) => item.name === 'likes');

    expect(readField(document.querySelector('article')!, field)).toBe('13');
  });
});
