# Comments Insight Privacy Policy

Last updated: August 31, 2026

Comments Insight is a browser extension that extracts comments from webpages and, when requested by the user, sends selected page data to an AI API endpoint configured by the user. This policy describes the data handled by the extension and where it goes.

## Summary

- The extension developer does not operate an intermediary API server and does not receive extension data.
- The extension does not include advertising, analytics, tracking pixels, or developer-operated telemetry.
- Settings, extracted comments, reports, task state, usage counters, and logs are stored locally in the browser.
- AI-powered features send data directly from the extension to the AI endpoint selected by the user. The endpoint provider's own privacy policy and retention terms apply.

## Data handled by the extension

### Page and browsing data

When the user starts extraction, configuration generation, or analysis, the extension may process the current page URL, title, post content, comment text, usernames, timestamps, likes, replies, and simplified portions of the page DOM. This data is used only to provide the requested extraction, selector generation, analysis, and report features.

The extension does not send browsing history to the developer or build a developer-operated browsing profile. Its content script is available on HTTP and HTTPS pages so the user can run the extension on supported websites and can therefore access the current page URL. Normal feature records are created after user action; if local developer diagnostics are enabled, sanitized page metadata may also be written to local logs. None of this data is used for advertising or profiling.

### AI configuration and credentials

The configured API URL, model name, API key, timeout, token limits, and prompt templates are stored in `chrome.storage.local`. The API key is encrypted locally, but the key material is stored in the same extension storage. This protects against accidental plaintext exposure; it is not a security boundary against malware, a compromised browser profile, or another actor with local access.

The API key is sent only to the user-configured AI endpoint when the extension lists models, tests the connection, or invokes an AI feature. Settings exports omit the API key. If imported settings change the API endpoint without supplying a new key, the extension clears the existing key to avoid sending a credential to a different provider.

### Locally stored results

The extension stores the following data locally:

- extracted comments, page metadata, Markdown analysis, and generated visual reports in IndexedDB;
- settings, crawling rules, task state, selector cache, and token usage counters in extension storage;
- sanitized AI and system logs when needed for local diagnostics.

This data remains on the device until it is deleted or overwritten through the extension, the browser's extension data is cleared, or the extension is uninstalled.

## Data sent to third parties

### User-selected AI provider

Depending on the feature, requests to the configured AI provider may contain:

- the API key and selected model identifier;
- simplified page DOM or page fragments for selector discovery and comment extraction;
- extracted comments and post metadata for analysis;
- analysis text and a report prompt for visual report generation;
- custom prompt templates configured by the user.

Remote AI endpoints must use HTTPS. Plain HTTP is accepted only for loopback development endpoints such as `localhost` or `127.0.0.1`. The provider may process or retain requests under its own terms. Users should not configure a provider they do not trust or submit content they are not authorized to process.

### Crawling-rule updates

When the user explicitly synchronizes default crawling rules, the extension fetches a public JSON file from GitHub. GitHub receives ordinary request metadata such as the IP address and user agent; the request does not include the configured AI key, extracted comments, or stored reports.

## Sharing and sale

The developer does not sell, rent, or use extension data for advertising, credit decisions, or unrelated profiling. The extension sends data only to the user-selected AI endpoint and, during an explicit crawling-rule sync, requests the public rules from GitHub as described above. Other handled data remains in browser storage on the user's device.

## User controls

Users can:

- choose a local or remote AI endpoint and remove the API key at any time;
- disable optional AI-generated visual reports;
- delete individual history items or clear history through the extension;
- clear extension storage or uninstall the extension to remove locally stored data;
- export settings without exporting the API key.

## Permissions

- `storage` and `unlimitedStorage` store settings, task state, logs, and extracted history.
- `activeTab`, `tabs`, `scripting`, and HTTP/HTTPS host access let the user run extraction on webpages and allow the background service worker to communicate with the content script.
- `notifications` reports completion or failure of user-started background tasks.

These permissions are used only for the extension's user-facing functionality.

## Chrome Web Store Limited Use

The extension's use and transfer of information received from Chrome APIs and webpage access complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including its Limited Use requirements. Data is used only to provide or improve the extension's single purpose of extracting and analyzing comments and the related user-requested features described above. It is not used for advertising, unrelated profiling, credit decisions, or sale to data brokers.

## Security

The extension validates message and storage payloads, sanitizes logs and exported reports, renders generated reports as non-executable content in a restricted sandbox, and rejects insecure remote AI endpoints. No software or storage mechanism can guarantee absolute security, so users should protect their browser profile and API credentials.

## Changes and contact

Material changes to this policy will be reflected in this document and its last-updated date. Questions or privacy requests can be submitted at <https://github.com/cyber-tao/comments-insight/issues>.

A Simplified Chinese version is available in [PRIVACY.zh-CN.md](PRIVACY.zh-CN.md).
