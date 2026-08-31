# Chrome Web Store Disclosure Checklist

Use this checklist when publishing version 0.8.0 or later. The Developer Dashboard is external to this repository and must be updated manually; committing the privacy policy does not update the store declaration.

## Single purpose

Suggested statement:

> Comments Insight lets a user extract comments from the current webpage, analyze the extracted discussion with a user-configured AI service, and save or export the resulting report.

The store description should prominently state that AI features send relevant page/comment data and the user's API credential directly to the AI endpoint selected by the user.

## Privacy policy

Use the published URL for `PRIVACY.md`, for example:

<https://github.com/cyber-tao/comments-insight/blob/master/PRIVACY.md>

Confirm that the URL is publicly accessible without authentication before submitting the release.

## Data-use disclosure

Chrome Web Store policy treats local processing and storage as handling user data. Review the current Dashboard labels and disclose every applicable category. For the current implementation, this includes at least:

- **Personally identifiable information**: usernames or display names included in extracted comments;
- **Authentication information**: the user-supplied AI API key;
- **Website content and resources**: post text, comments, replies, page metadata, and simplified DOM;
- **Web browsing activity**: the URL, domain, and title of pages on which the user runs extraction;
- **User-generated content**: comments, custom prompts, settings, and generated/saved reports;
- **Form data**: API settings, prompt templates, and crawling configuration entered in Options.

If a future supported workflow handles private messages, health data, financial data, or another listed category, update the Dashboard, privacy policy, and prominent in-product disclosure before release.

For each category, state that data is used only for extension functionality. Page data and credentials are transferred to the user-selected AI provider only when required by a requested AI feature. Locally stored history, settings, logs, and token counters are not sent to a developer-operated backend. A manual crawling-rule sync fetches public rules from GitHub without attaching the AI key or extracted content.

Complete all Limited Use certifications truthfully. Do not state that the extension handles no user data.

## Permission justifications

- **`storage`**: stores settings, encrypted API credentials, crawling rules, task state, logs, selector cache, and token counters locally.
- **`unlimitedStorage`**: stores user-requested comment history and reports in IndexedDB without a small extension-storage quota interrupting extraction.
- **`activeTab`**: identifies and acts on the tab where the user starts an extraction or configuration task.
- **`tabs`**: resolves target tabs, sends task commands, observes tab closure, and opens extension pages.
- **`scripting`**: injects the declared content script when a supported tab does not already have it.
- **`notifications`**: reports completion or failure of user-started background tasks.
- **HTTP/HTTPS host access**: supports the extension's stated cross-site comment-extraction purpose and communication with user-selected AI endpoints. The implementation rejects non-loopback remote AI endpoints that do not use HTTPS.

## Release review

Before submission:

1. Run `bun run version:check`, `bun run test:coverage`, `bun run audit`, `bun run build`, and `bun run test:e2e`.
2. Confirm the package and manifest versions match the `vX.Y.Z` tag.
3. Confirm the privacy policy and store description match current runtime behavior.
4. Recheck requested permissions and remove any that are no longer used.
5. Verify the Dashboard disclosure rather than copying an older release's answers unchanged.
