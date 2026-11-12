# Comments Insight

## Store title, icon, and promo tiles

The localized item title comes from `extensionName` in `public/_locales/*/messages.json`. A title change takes effect with a new extension package after review.

Upload [the 128 × 128 extension icon](../public/icons/icon-128.png), [the 440 × 280 small promo tile](../images/banners/banner-440x280.jpg), and [the 1400 × 560 marquee tile](../images/banners/banner-1400x560.jpg) under **Store listing → Graphic assets**. These assets are shared across languages. The platform logos on the artwork identify the built-in extraction rules.

## Store screenshots

Build with `bun run build`, then run `bun scripts/capture-store-ui.js` to capture the current extension in an isolated Chromium profile. The script uses the local `dist/` build and writes PNGs to `build/store-v<version>-raw/`. Its first and second optional arguments override the capture directory and the extension build directory.

Run `bun scripts/capture-store-screenshots.js` to turn those captures into five 1280 × 800 JPEGs per locale under `build/store-assets/v<version>/`. The first and second optional arguments override the output directory and the raw capture directory. The screenshots show the light and dark themes using anonymized excerpts and a summary of the discussion on [YOUCAR’s Yangwang U9 Xtreme speed-test video](https://www.youtube.com/watch?v=uxdE0I-VaFc).

In the **Store listing** tab, choose a language and upload the five numbered files to **Localized screenshots** in filename order. Use the files at the top level of each locale directory. English and Simplified Chinese previews are also tracked under `images/screenshots/`.

[Chrome Web Store listing and localization instructions](https://developer.chrome.com/docs/webstore/cws-dashboard-listing#localize-screenshots-and-promotional-video)

## English (`en`)

Extract comments and replies from a webpage, then use your AI service to summarize recurring topics, questions, and audience feedback.

- Collect comments with built-in rules for several major platforms. Add or edit custom extraction rules in the extension settings to collect comments from more sites or adapt to different page layouts.
- Customize the analysis prompt, review saved comments and reports, and export results as CSV, Markdown, or a standalone HTML report.

The extension keeps settings and history in your browser. To use AI features, configure an API endpoint and credential. The extension sends the relevant page or comment data and the credential directly to the service you select. That service handles requests under its own privacy policy.

## 简体中文（`zh_CN`）

从网页提取评论和回复，再用你配置的 AI 服务归纳反复出现的话题、问题和受众反馈。

- 内置适用于多个主流平台的评论提取规则。你可以在扩展设置中自行添加或编辑提取规则，采集更多平台上的评论，也能适配不同的页面布局。
- 自定义分析提示词，回看保存的评论和报告，并将结果导出为 CSV、Markdown 或独立 HTML 报告。

扩展在浏览器中保存设置和历史记录。使用 AI 功能前，请配置 API 端点和凭证。扩展会将相关网页或评论数据及凭证直接发送至你选择的服务，该服务依据其隐私政策处理请求。

## 繁體中文（`zh_TW`）

從網頁擷取留言和回覆，再用你設定的 AI 服務彙整常見主題、問題及讀者意見。

- 內建適用於多個主流平台的留言擷取規則。你可以在擴充功能設定中自行新增或編輯擷取規則，以擷取更多平台的留言，並配合不同的網頁版面。
- 自訂分析提示詞，查看已儲存的留言與報告，並將結果匯出為 CSV、Markdown 或獨立的 HTML 報告。

擴充功能會將設定和歷史記錄儲存在瀏覽器中。使用 AI 功能前，請設定 API 端點和憑證。擴充功能會將相關網頁或留言資料及憑證直接傳送至你選擇的服務，該服務會依照自己的隱私權政策處理請求。

## 日本語（`ja`）

ウェブページのコメントや返信を取得し、設定した AI サービスで、頻出する話題や質問、読者の反応を要約できます。

- 複数の主要プラットフォームからコメントを取得するルールが組み込まれています。拡張機能の設定で取得ルールを追加・編集し、ほかのサイトや異なるページ構成にも対応できます。
- 分析プロンプトをカスタマイズし、保存したコメントやレポートを確認できます。結果は CSV、Markdown、単独で閲覧できる HTML レポートとしてエクスポートできます。

設定と履歴はブラウザーに保存されます。AI 機能を使うには、API エンドポイントと認証情報を設定してください。拡張機能は関連するページやコメントのデータと認証情報を、選択したサービスに直接送信します。そのサービスは独自のプライバシーポリシーに従ってリクエストを処理します。

## 한국어 (`ko`)

웹페이지에서 댓글과 답글을 추출하고, 설정한 AI 서비스로 반복해서 등장하는 주제와 질문, 독자의 반응을 요약할 수 있습니다.

- 여러 주요 플랫폼의 댓글 추출 규칙이 기본으로 제공됩니다. 확장 프로그램 설정에서 추출 규칙을 직접 추가하거나 편집해 더 많은 사이트의 댓글을 수집하고 다양한 페이지 구조에 맞출 수 있습니다.
- 분석 프롬프트를 맞춤 설정하고, 저장된 댓글과 보고서를 다시 확인하세요. 결과는 CSV, Markdown 또는 별도로 열 수 있는 HTML 보고서로 내보낼 수 있습니다.

설정과 기록은 브라우저에 저장됩니다. AI 기능을 사용하려면 API 엔드포인트와 인증 정보를 설정하세요. 확장 프로그램은 관련 페이지 또는 댓글 데이터와 인증 정보를 선택한 서비스에 직접 전송합니다. 해당 서비스는 자체 개인정보 처리방침에 따라 요청을 처리합니다.

## Français (`fr`)

Extrayez les commentaires et les réponses d’une page web, puis utilisez le service d’IA de votre choix pour résumer les sujets récurrents, les questions et les retours du public.

- Des règles intégrées permettent de collecter les commentaires sur plusieurs grandes plateformes. Ajoutez ou modifiez vos propres règles d’extraction dans les paramètres de l’extension pour collecter les commentaires sur d’autres sites ou vous adapter à la structure de leurs pages.
- Personnalisez l’invite d’analyse, consultez les commentaires et rapports enregistrés, puis exportez les résultats au format CSV, Markdown ou sous forme de rapport HTML autonome.

L’extension conserve les paramètres et l’historique dans votre navigateur. Pour utiliser les fonctions d’IA, configurez un point de terminaison d’API et une clé. L’extension envoie directement les données pertinentes de la page ou des commentaires et la clé au service choisi. Celui-ci traite les requêtes selon sa propre politique de confidentialité.

## Português de Portugal (`pt_PT`)

Extraia comentários e respostas de uma página Web e utilize o seu serviço de IA para resumir os temas recorrentes, as perguntas e as opiniões do público.

- Recolha comentários com regras integradas para várias plataformas populares. Adicione ou edite regras de extração nas definições da extensão para recolher comentários noutros sites ou adaptar as regras a diferentes estruturas de página.
- Personalize a instrução de análise, reveja os comentários e relatórios guardados e exporte os resultados em CSV, Markdown ou num relatório HTML autónomo.

A extensão guarda as definições e o histórico no navegador. Para utilizar as funcionalidades de IA, configure um endpoint e uma credencial da API. A extensão envia os dados relevantes da página ou dos comentários e a credencial diretamente ao serviço que escolher. Esse serviço trata os pedidos de acordo com a sua própria política de privacidade.

## Español (`es`)

Extrae comentarios y respuestas de una página web y usa tu servicio de IA para resumir los temas recurrentes, las preguntas y las opiniones del público.

- Recopila comentarios con reglas integradas para varias plataformas populares. Añade o edita tus propias reglas de extracción en los ajustes de la extensión para recopilar comentarios en otros sitios o adaptarte a distintas estructuras de página.
- Personaliza la instrucción de análisis, revisa los comentarios e informes guardados y exporta los resultados como CSV, Markdown o un informe HTML independiente.

La extensión guarda la configuración y el historial en tu navegador. Para usar las funciones de IA, configura un endpoint y una credencial de API. La extensión envía directamente los datos pertinentes de la página o de los comentarios y la credencial al servicio que elijas. Ese servicio procesa las solicitudes conforme a su propia política de privacidad.
