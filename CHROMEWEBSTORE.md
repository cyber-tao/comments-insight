# Chrome Web Store Listing — Comments Insight

> Last Updated: 2026-11-19

## Store Listing

**Extension Name**
Comments Insight: Find User Needs in Comments Across Sites

<!-- Localized item titles come from `extensionName` in `public/_locales/*/messages.json` (max 75 chars). -->

**Short Description**
Collect comments from social media posts and use your configured AI model to analyze them.

<!-- Matches `extensionDescription` in `public/_locales/en/messages.json` (90/132 chars). -->

**Detailed Description**

Extract comments and nested replies from web discussions, then use your configured AI service to summarize recurring topics, audience questions, and user feedback.

FEATURES
• Built-in site rules for major social platforms, plus custom rule editing and AI-assisted setup for additional pages
• Live collection and analysis progress tracking with completion notifications that jump straight to your saved results
• Customizable analysis and visual report prompts in 8 languages (English, Simplified Chinese, Traditional Chinese, Japanese, Korean, French, European Portuguese, and Spanish)
• Local comment and report history with search, sorting by time, likes, or replies, and Light / Dark / System themes
• One-click export as CSV comments, Markdown analysis, or standalone offline HTML reports

HOW TO USE

1. Click the Comments Insight toolbar icon and open Options to choose an AI provider preset or enter your API endpoint, API key, and model.
2. Open a post or video page with comments and click the extension icon.
3. Click Extract Comments (or Generate Config if the site does not have a rule yet) to collect comments into local history.
4. Click Analyze Comments to generate a structured summary and optional visual report, then review or export from History.

PRIVACY
Comments Insight stores your settings, credentials, extracted comments, saved reports, and diagnostic logs locally in your browser. There is no developer-operated backend, advertising, or analytics tracking. When you invoke an AI feature, relevant page or comment data and your API key are sent directly to the AI provider endpoint you configured (remote endpoints require HTTPS; HTTP is restricted to loopback development addresses).

PERMISSIONS
• Storage & Unlimited Storage — saves your settings, encrypted API key, extraction rules, task state, logs, and local comment/report history without running out of quota.
• Tabs — identifies the active tab when you start a task, observes navigation or tab closure during collection, and opens History, Options, or Logs pages.
• Scripting — injects the extraction helper into the current webpage on demand only after you start a collection, rule generation, or selector test task.
• Notifications — notifies you when a background extraction, rule generation, or analysis task finishes or fails.
• Website Access (HTTP/HTTPS) — lets you collect comments on the websites you choose and send AI requests directly to your configured provider endpoint.

SUPPORT
Found a bug or need help? Open an issue at https://github.com/cyber-tao/comments-insight/issues or check the documentation at https://github.com/cyber-tao/comments-insight.

Version 0.12.1 — Deep-linked task completion notifications, AI-generated reply extraction rules, K-unit token presets, editable API URLs with streaming connection tests, and improved layout and accessibility.

### Localized Store Listings

#### 简体中文 (`zh_CN`)

**Extension Name**: `Comments Insight：从多平台评论中发现用户需求`
**Short Description**: `采集社交媒体帖子的评论，并使用你配置的 AI 模型分析评论。`
**Detailed Description**:

```text
从网页提取评论和嵌套回复，再用你配置的 AI 服务归纳反复出现的话题、用户问题和受众反馈。

主要功能
• 内置多个主流平台评论提取规则，并支持自定义编辑和 AI 辅助生成新站点规则
• 实时展示采集与分析进度，任务完成后通过通知直达结果页面
• 支持自定义分析与可视化报告提示词，界面完整支持 8 种语言
• 本地保存历史记录，支持搜索、按时间/点赞/回复数排序以及浅色/深色/跟随系统主题
• 支持导出为 CSV 评论表、Markdown 分析文档或可离线查看的独立 HTML 报告

使用方法
1. 打开扩展设置，选择 AI 服务预设或填写 API 地址、密钥和模型名称并测试连接。
2. 打开包含评论的帖子或视频页面，点击浏览器工具栏中的扩展图标。
3. 点击“提取评论”（若当前网站暂无规则，可先点击“生成配置”）。
4. 采集完成后点击“分析评论”，随后在历史记录中查看或导出报告。

隐私说明
扩展将设置、凭证、提取的评论、报告和日志保存在浏览器本地，不包含广告、统计或开发者中转服务器。仅当你主动触发 AI 功能时，扩展才会将相关页面或评论数据与密钥直接发送至你所配置的 AI 端点（远程端点强制 HTTPS）。
```

#### 繁體中文 (`zh_TW`)

**Extension Name**: `Comments Insight：從多平台留言中找出使用者需求`
**Short Description**: `擷取社群媒體貼文的留言，並使用你設定的 AI 模型分析留言。`
**Detailed Description**:

```text
從網頁擷取留言和巢狀回覆，再用你設定的 AI 服務彙整常見主題、問題及讀者意見。

主要功能
• 內建多個主流平台的留言擷取規則，並支援自訂編輯與 AI 輔助產生規則
• 即時顯示擷取與分析進度，任務完成通知可一鍵跳轉至結果頁面
• 支援自訂分析與視覺化報告提示詞，完整支援 8 種語言
• 本地儲存歷史記錄，支援搜尋、排序與淺色/深色/跟隨系統外觀
• 可匯出為 CSV 留言、Markdown 分析或獨立離線 HTML 報告
```

#### 日本語 (`ja`)

**Extension Name**: `Comments Insight - 複数サイトのコメントからユーザーのニーズを発見`
**Short Description**: `SNSの投稿からコメントを収集し、設定したAIモデルで分析できます。`
**Detailed Description**:

```text
ウェブページのコメントや返信を取得し、設定した AI サービスで頻出する話題や質問、読者の反応を要約できます。

主な機能
• 主要プラットフォーム向けの取得ルールを内蔵し、カスタム編集や AI によるルール生成にも対応
• 収集と分析の進捗をリアルタイム表示し、完了通知から結果ページへ直接移動可能
• 分析プロンプトとビジュアルレポート用プロンプトのカスタマイズ、8言語 UI 対応
• 履歴のローカル保存、検索、時間・いいね数・返信数での並び替えに対応
• CSV・Markdown・オフライン閲覧可能なスタンドアロン HTML 形式でエクスポート可能
```

#### 한국어 (`ko`)

**Extension Name**: `Comments Insight - 여러 사이트의 댓글에서 사용자가 원하는 것 찾기`
**Short Description**: `소셜 미디어 게시물의 댓글을 수집하고 설정한 AI 모델로 분석하세요.`
**Detailed Description**:

```text
웹페이지에서 댓글과 답글을 추출하고, 설정한 AI 서비스로 반복되는 주제와 질문, 독자 반응을 요약하세요.

주요 기능
• 주요 플랫폼용 내장 수집 규칙 제공 및 사용자 지정 편집·AI 기반 규칙 생성 지원
• 수집 및 분석 진행 상황을 실시간으로 표시하며 완료 알림을 통해 결과로 바로 이동
• 분석 및 시각화 보고서 프롬프트 맞춤 설정과 8개 언어 지원
• 로컬 기록 저장, 검색, 시간·좋아요·답글 수 기준 정렬 및 라이트/다크/시스템 테마 지원
• CSV, Markdown 또는 독립 실행형 HTML 보고서로 내보내기 가능
```

#### Français (`fr`)

**Extension Name**: `Comments Insight - Cernez les besoins dans les commentaires de divers sites`
**Short Description**: `Collectez les commentaires des réseaux sociaux et analysez-les avec le modèle d’IA de votre choix.`
**Detailed Description**:

```text
Extrayez les commentaires et les réponses d’une page web, puis utilisez le service d’IA de votre choix pour résumer les sujets récurrents, les questions et les retours du public.

FONCTIONNALITÉS
• Règles intégrées pour plusieurs grandes plateformes, avec édition personnalisée et génération assistée par IA
• Suivi en direct de la progression et notifications donnant un accès direct aux résultats enregistrés
• Invites d’analyse et de rapport visuel personnalisables, avec interface en 8 langues
• Historique local avec recherche, tri et thèmes Clair / Sombre / Système
• Exportation en CSV, Markdown ou rapport HTML autonome hors ligne
```

#### Português de Portugal (`pt_PT`)

**Extension Name**: `Comments Insight - Descubra necessidades em comentários de vários sites`
**Short Description**: `Recolha comentários de publicações nas redes sociais e analise-os com o modelo de IA que configurou.`
**Detailed Description**:

```text
Extraia comentários e respostas de uma página Web e utilize o seu serviço de IA para resumir os temas recorrentes, as perguntas e as opiniões do público.

FUNCIONALIDADES
• Regras integradas para várias plataformas populares, com edição personalizada e geração assistida por IA
• Progresso em tempo real e notificações que abrem diretamente os resultados guardados
• Instruções de análise e relatório visual personalizáveis em 8 idiomas
• Histórico local com pesquisa, ordenação e temas Claro / Escuro / Sistema
• Exportação em CSV, Markdown ou relatório HTML autónomo
```

#### Español (`es`)

**Extension Name**: `Comments Insight - Detecta necesidades en comentarios de varios sitios`
**Short Description**: `Recopila comentarios de publicaciones en redes sociales y analízalos con el modelo de IA que configures.`
**Detailed Description**:

```text
Extrae comentarios y respuestas de una página web y usa tu servicio de IA para resumir los temas recurrentes, las preguntas y las opiniones del público.

FUNCIONALIDADES
• Reglas integradas para varias plataformas populares, con edición personalizada y generación asistida por IA
• Progreso en tiempo real y notificaciones con acceso directo a los resultados guardados
• Instrucciones de análisis e informe visual personalizables en 8 idiomas
• Historial local con búsqueda, ordenación y temas Claro / Oscuro / Sistema
• Exportación en CSV, Markdown o informe HTML independiente
```

**Category**
Productivity

**Single Purpose**
Extract comments and replies from a webpage and analyze them with a user-configured AI endpoint.

**Primary Language**
English

## Graphics & Assets

| Asset                          | Dimensions    | Status                      | Filename                                   |
| ------------------------------ | ------------- | --------------------------- | ------------------------------------------ |
| Store Icon [REQUIRED]          | 128×128 PNG   | ✅ Ready                    | `public/icons/icon-128.png`                |
| Screenshot 1 [REQUIRED]        | 1280×800 JPEG | ✅ Ready                    | `images/screenshots/en-US/00-cover.jpg`    |
| Screenshot 2 [RECOMMENDED]     | 1280×800 JPEG | ✅ Ready                    | `images/screenshots/en-US/01-analysis.jpg` |
| Screenshot 3 [RECOMMENDED]     | 1280×800 JPEG | ✅ Ready                    | `images/screenshots/en-US/02-collect.jpg`  |
| Screenshot 4                   | 1280×800 JPEG | ✅ Ready                    | `images/screenshots/en-US/03-comments.jpg` |
| Screenshot 5                   | 1280×800 JPEG | ✅ Ready                    | `images/screenshots/en-US/04-export.jpg`   |
| Small Promo Tile [RECOMMENDED] | 440×280 JPEG  | ✅ Ready (local/gitignored) | `images/banners/banner-440x280.jpg`        |
| Marquee Promo Tile             | 1400×560 JPEG | ✅ Ready                    | `images/banners/banner-1400x560.jpg`       |

### Screenshot Notes

- Generate localized screenshots via `bun run build && bun scripts/capture-store-ui.js && bun scripts/capture-store-screenshots.js` (outputs under `build/store-assets/v<version>/`, with `en-US` and `zh-CN` previews tracked under `images/screenshots/`).
- Screenshots demonstrate light and dark themes using anonymized paraphrases from YOUCAR's Yangwang U9 Xtreme speed-test discussion, showing popup collection, comment tree browsing, Markdown analysis, and HTML dashboard export.

## Permissions Justification

| Permission                  | Type             | Justification                                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `storage`                   | permissions      | Stores user preferences, encrypted AI API credentials, custom/overridden crawling rules, task recovery state, selector validation cache, token counters, and diagnostic logs locally in the browser.                                                                                                                                                         |
| `unlimitedStorage`          | permissions      | Stores user-extracted comment trees, analysis markdown, and generated HTML reports in local IndexedDB without hitting small extension storage limits on large threads.                                                                                                                                                                                       |
| `tabs`                      | permissions      | Reads the active tab's URL and title when the popup opens, monitors tab navigation or closure to abort stale extraction tasks safely, and opens Options, History, and Logs pages (including notification deep links).                                                                                                                                        |
| `scripting`                 | permissions      | Programmatically injects the self-contained extraction script on demand into the target tab only when the user explicitly starts comment extraction, AI rule generation, or selector testing. No static content script runs passively on pages.                                                                                                              |
| `notifications`             | permissions      | Displays desktop notifications when user-initiated background extraction, rule generation, or AI analysis tasks complete or fail, allowing one-click navigation to the saved result.                                                                                                                                                                         |
| `http://*/*`, `https://*/*` | host_permissions | Required for two core user-requested capabilities: (1) on-demand comment extraction and AI rule discovery on arbitrary websites chosen by the user, and (2) sending AI requests directly from the extension to the user's configured AI provider endpoint (remote endpoints enforce HTTPS; plain HTTP is permitted only for loopback development endpoints). |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes (Chrome Web Store policy treats local processing and storage as handling user data).

| Data Type                    | Collected?                                                        | Transmitted Off-Device?                                               | Purpose                                                  | Shared with Third Parties?            |
| ---------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------- |
| Personally identifiable info | Yes (usernames/display names inside extracted comments)           | Only when the user runs AI analysis/reports                           | Core extraction, display, and user-requested AI analysis | Only to the user-selected AI endpoint |
| Health info                  | No                                                                | No                                                                    | N/A                                                      | No                                    |
| Financial info               | No                                                                | No                                                                    | N/A                                                      | No                                    |
| Authentication info          | Yes (user-supplied AI API key stored locally encrypted)           | Only to the user-selected AI endpoint                                 | Authenticating user-configured AI API requests           | Only to the user-selected AI endpoint |
| Personal communications      | No                                                                | No                                                                    | N/A                                                      | No                                    |
| Location                     | No                                                                | No                                                                    | N/A                                                      | No                                    |
| Web history                  | Yes (URL, domain, and title of pages where user runs extraction)  | URL/metadata sent only if included in user-requested AI analysis      | History indexing, rule matching, and AI context          | Only to the user-selected AI endpoint |
| User activity                | No developer telemetry; local task/token usage counters only      | No                                                                    | Displaying local token usage statistics                  | No                                    |
| Website content              | Yes (post text, comments, replies, simplified DOM on user action) | Only when the user invokes AI rule discovery, extraction, or analysis | Comment extraction, rule discovery, and AI summarization | Only to the user-selected AI endpoint |

Note: Manual crawling-rule sync fetches public rules from GitHub (`raw.githubusercontent.com`) without attaching AI credentials, extracted comments, or stored reports.

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**
https://github.com/cyber-tao/comments-insight/blob/master/PRIVACY.md

## Distribution

**Visibility**: Public
**Regions**: All regions
**Chrome Web Store Item URL**: https://chromewebstore.google.com/detail/comments-insight/dabladpkeglokmgppgicnbnajlipgfap

## Developer Info

**Publisher Name**: `cyber-tao` (verify exact Publisher ID under Developer Dashboard → Account / Publisher Settings)
**Contact Email**: Verify monitored contact email in Chrome Web Store Developer Dashboard
**Support URL**: https://github.com/cyber-tao/comments-insight/issues
**Homepage URL**: https://github.com/cyber-tao/comments-insight

## Version History

| Version | Date       | Changes                                                                                                                                                   | Status                 |
| ------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 0.12.1  | 2026-11-19 | Deep-linked notifications, reply rule generation, API v2 auto-publish setup, on-demand injection, native `<dialog>`, accessibility & modern web hardening | Draft                  |
| 0.12.0  | 2026-11-18 | Deep-linked task notifications, AI-generated reply crawling configs, K-unit token presets, editable API URLs with streaming connection tests              | Released on GitHub     |
| 0.11.1  | 2026-11-13 | Dependency security fixes, pagination/search race fixes, streaming frame hardening, and full a11y/error recovery improvements                             | Released on GitHub     |
| 0.7.0   | Prior      | Earlier Chrome Web Store published baseline                                                                                                               | Published (Superseded) |

## Review Notes

### Known Issues / Limitations

1. **Dashboard Privacy Tab Sync Required**: Historical public store listing (`0.7.0`) previously showed "does not collect user data". Before submitting `0.12.1+`, update the Developer Dashboard **Privacy practices** tab using the 9-category matrix above so it matches `PRIVACY.md` and current runtime behavior.
2. **Platform Logos in Promotional Artwork**: `banner-440x280.jpg`, `banner-1400x560.jpg`, and cover screenshots display platform icons solely to indicate built-in extraction rules (`youtube.com`, `bilibili.com`, `reddit.com`, `x.com`, `tiktok.com`, `xiaohongshu.com`). Monitor during review in case Google requests trademark clarification.
3. **Automated Publishing**: `.github/workflows/release.yml` uses Chrome Web Store API v2 via `scripts/publish-cws.mjs` (Service Account / OIDC / OAuth2). First-time setup requires registering the Service Account email in Developer Dashboard → Account and setting `CHROME_PUBLISHER_ID` and `CHROME_EXTENSION_ID` secrets.

### Rejection History

| Date | Reason        | Fix Applied | Resubmitted |
| ---- | ------------- | ----------- | ----------- |
| —    | None recorded | —           | —           |
