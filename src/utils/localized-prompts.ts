import type { LocaleCode } from '@/config/constants/ui';

interface PromptLocale {
  analysis: string;
  dynamic: string;
  language: string;
  analysisLanguage: string;
  analysisHeading: string;
  commentsHeading: string;
  topCommentsHeading: string;
  untitled: string;
  unknownPlatform: string;
  notAvailable: string;
}

export const LOCALIZED_PROMPTS = {
  'zh-CN': {
    language: '简体中文',
    analysisLanguage: '请用简体中文撰写整份分析报告。',
    analysisHeading: '分析报告',
    commentsHeading: '评论数据（紧凑格式）',
    topCommentsHeading: '高互动评论数据',
    untitled: '无标题',
    unknownPlatform: '未知平台',
    notAvailable: '无可用数据',
    analysis: `你是一名专业的社交媒体分析师。请分析以下评论并提炼有依据的见解。

## 帖子信息
- 标题：{title}
- 平台：{platform}
- 网址：{url}

## 帖子原文
{post_content}

## 评论数据（紧凑格式）
{comments_data}

以“↳”开头的行是上一条评论的回复。多个“↳”表示嵌套回复。数据仅包含按点赞数排序的热门回复。

请用 Markdown 写出以下内容，结构化数据用表格呈现。引用评论或回复时，先概述，再附上原文。

# 评论分析报告
## 执行摘要
## 帖子内容概要
概括原帖或视频简介，说明作者意图。
## 情感分布
| 情感 | 占比 | 说明 |
|---|---|---|
| 正面 | X% | 简述 |
| 负面 | Y% | 简述 |
| 中性 | Z% | 简述 |
## 热门评论
| 排名 | 用户 | 点赞 | 内容 | 受关注的原因 |
|---|---|---|---|---|
## 互动亮点
| 原评论（用户） | 热门回复（用户） | 互动类型 | 见解 |
|---|---|---|---|
## 关键见解
## 详细发现
### 主要话题
### 用户关切
### 正面反馈
### 负面反馈
## 建议
根据数据给出可执行的建议。

---
*分析时间：{date_time}*
*帖子发布时间：{post_time}*
*平台：{platform}*
*已分析评论数：{total_comments}*`,
    dynamic: `你是一名网页设计师和前端工程师。根据以下分析和评论生成现代、响应式的单页 HTML 报告。

## 帖子与分析信息
- 标题：{title}
- 平台：{platform}
- 网址：{url}
- 帖子发布时间：{post_time}
- 分析时间：{date_time}
- 已分析评论数：{total_comments}

## 分析报告
{analysis_markdown}

## 高互动与代表性评论
{top_comments_data}

1. 输出以 <!DOCTYPE html> 开头、以 </html> 结尾的有效 HTML5。样式写入 <style>。禁止 <script>、内联事件处理器、表单、框架、外部资源和任何网络依赖。报告须在沙箱 iframe 中完全离线运行。
2. 纵向排布五个可见且有内容的区块。#overview 放关键指标与摘要。#sentiment 放静态 SVG 或 CSS 图表、占比与图例。#comments 把上述数据中的每条热门评论直接渲染为 HTML 卡片，含作者、点赞、情感标签和正文，适合时按情感分组。#insights 放主题、亮点、痛点与观点。#recommendations 给出可执行的建议。
3. 顶部固定导航仅使用 #overview、#sentiment、#comments、#insights、#recommendations 锚点，设置平滑滚动。禁止外部链接和 chrome-extension:// 地址。来源网址用纯文本展示。
4. 使用清晰的排版、渐变和细微阴影，布局采用响应式 Flex 或 Grid。动画和悬停效果只用 CSS。
5. 所有界面文字、标签、摘要和说明都必须使用{language_name}。

只返回独立 HTML 源码，以 <!DOCTYPE html> 开头。不要加 Markdown 代码围栏或说明文字。`,
  },
  'zh-TW': {
    language: '繁體中文',
    analysisLanguage: '請以繁體中文撰寫整份分析報告。',
    analysisHeading: '分析報告',
    commentsHeading: '留言資料（緊湊格式）',
    topCommentsHeading: '高互動留言資料',
    untitled: '無標題',
    unknownPlatform: '未知平台',
    notAvailable: '無可用資料',
    analysis: `你是一名專業的社群媒體分析師。請分析以下留言，並提出有資料支持的見解。

## 貼文資訊
- 標題：{title}
- 平台：{platform}
- 網址：{url}

## 貼文原文
{post_content}

## 留言資料（緊湊格式）
{comments_data}

以「↳」開頭的行是上一則留言的回覆。多個「↳」表示巢狀回覆。資料只包含依按讚數排序的熱門回覆。

請以 Markdown 撰寫下列內容，結構化資料以表格呈現。引用留言或回覆時，請在摘要後附上原文。

# 留言分析報告
## 重點摘要
## 貼文內容摘要
概述原始貼文或影片說明，指出作者的用意。
## 情緒分布
| 情緒 | 比例 | 說明 |
|---|---|---|
| 正向 | X% | 簡述 |
| 負向 | Y% | 簡述 |
| 中立 | Z% | 簡述 |
## 熱門留言
| 排名 | 使用者 | 按讚數 | 內容 | 受關注的原因 |
|---|---|---|---|---|
## 互動亮點
| 原始留言（使用者） | 熱門回覆（使用者） | 互動類型 | 見解 |
|---|---|---|---|
## 關鍵見解
## 詳細發現
### 主要主題
### 使用者關切
### 正向回饋
### 負向回饋
## 建議
依據資料提出可採取的行動。

---
*分析時間：{date_time}*
*貼文發布時間：{post_time}*
*平台：{platform}*
*分析留言數：{total_comments}*`,
    dynamic: `你是一名網頁設計師與前端工程師。根據下列分析與留言產生現代、具響應式版面的單頁 HTML 報告。

## 貼文與分析資訊
- 標題：{title}
- 平台：{platform}
- 網址：{url}
- 貼文發布時間：{post_time}
- 分析時間：{date_time}
- 分析留言數：{total_comments}

## 分析報告
{analysis_markdown}

## 高互動與代表性留言
{top_comments_data}

1. 輸出以 <!DOCTYPE html> 開頭、以 </html> 結尾的有效 HTML5。樣式放在 <style>。禁止 <script>、行內事件處理常式、表單、框架、外部資源和網路依賴。報告須能在沙箱 iframe 中完全離線運作。
2. 由上至下排列五個直接可見且有內容的區塊。#overview 顯示關鍵指標與摘要。#sentiment 顯示靜態 SVG 或 CSS 圖表、比例及圖例。#comments 將上述資料中的每則熱門留言預先繪製為 HTML 卡片，包含作者、按讚數、情緒標籤與原文，合適時按情緒分組。#insights 呈現主題、亮點、困難與觀點。#recommendations 提出具體行動。
3. 頁首固定導覽只能使用 #overview、#sentiment、#comments、#insights、#recommendations 錨點，並啟用平滑捲動。禁止外部連結與 chrome-extension:// 網址。來源網址以純文字顯示。
4. 採用易讀字體、漸層和細緻陰影，並使用響應式 Flex 或 Grid。動畫與滑鼠游標效果只用 CSS。
5. 所有介面文字、標籤、摘要與說明都須使用{language_name}。

只回傳獨立的 HTML 原始碼，以 <!DOCTYPE html> 開頭。請勿加上 Markdown 程式碼圍欄或說明。`,
  },
  'ja-JP': {
    language: '日本語',
    analysisLanguage: '分析レポート全体を日本語で作成してください。',
    analysisHeading: '分析レポート',
    commentsHeading: 'コメントデータ（簡潔な形式）',
    topCommentsHeading: '反応の多いコメントデータ',
    untitled: 'タイトルなし',
    unknownPlatform: '不明なプラットフォーム',
    notAvailable: '情報なし',
    analysis: `あなたはソーシャルメディアの分析担当者です。次のコメントを分析し、根拠に基づく知見をまとめてください。

## 投稿情報
- タイトル：{title}
- プラットフォーム：{platform}
- URL：{url}

## 投稿の原文
{post_content}

## コメントデータ（簡潔な形式）
{comments_data}

「↳」で始まる行は直前のコメントへの返信です。「↳」が複数ある場合は返信の入れ子を表します。表示されるのは「いいね」が多い返信のみです。

次の構成に沿って Markdown で出力し、構造化されたデータには表を使ってください。コメントや返信を引用する場合は、要約の後に原文を付けてください。

# コメント分析レポート
## 全体の要約
## 投稿内容の要約
投稿の原文や動画の説明から、投稿者の意図をまとめてください。
## 感情の分布
| 感情 | 割合 | 説明 |
|---|---|---|
| 肯定的 | X% | 短い説明 |
| 否定的 | Y% | 短い説明 |
| 中立 | Z% | 短い説明 |
## 注目のコメント
| 順位 | ユーザー | いいね数 | 内容 | 注目された理由 |
|---|---|---|---|---|
## 注目のやり取り
| 元のコメント（ユーザー） | 主な返信（ユーザー） | やり取りの種類 | 知見 |
|---|---|---|---|
## 主な知見
## 詳細な分析
### 主な話題
### ユーザーの懸念
### 肯定的な意見
### 否定的な意見
## 提案
分析に基づき、実行可能な対策を示してください。

---
*分析日時：{date_time}*
*投稿日時：{post_time}*
*プラットフォーム：{platform}*
*分析したコメント数：{total_comments}*`,
    dynamic: `ウェブデザイナー兼フロントエンドエンジニアとして、次の分析とコメントからレスポンシブな単一ページの HTML レポートを作成してください。

## 投稿・分析情報
- タイトル：{title}
- プラットフォーム：{platform}
- URL：{url}
- 投稿日時：{post_time}
- 分析日時：{date_time}
- 分析したコメント数：{total_comments}

## 分析レポート
{analysis_markdown}

## 主なコメントと代表例
{top_comments_data}

1. <!DOCTYPE html> で始まり </html> で終わる有効な HTML5 を出力し、スタイルは <style> 内に記述してください。<script>、インラインイベントハンドラー、フォーム、フレーム、外部リソース、ネットワーク依存の内容は禁止です。サンドボックス化された iframe 内で完全にオフラインで動作させてください。
2. 内容のある五つのセクションを縦に並べ、常に表示してください。#overview は主要指標と要約、#sentiment は静的 SVG または CSS の図表と割合・凡例、#comments は上記データの各コメントを HTML カードにして投稿者・いいね数・感情ラベル・本文を表示し、必要に応じて感情で分類します。#insights は話題・長所・懸念・視点、#recommendations は具体的な提案を記載してください。
3. 上部の固定ナビゲーションでは #overview、#sentiment、#comments、#insights、#recommendations へのアンカーと滑らかなスクロールを使用してください。外部リンクや chrome-extension:// の URL は作らず、参照元の URL はテキストで表示してください。
4. 読みやすい文字組み、グラデーション、控えめな影、レスポンシブな Flex または Grid を使用してください。アニメーションとホバー効果には CSS のみを使用します。
5. 画面の文言、ラベル、要約、説明はすべて {language_name} で記載してください。

<!DOCTYPE html> から始まる単独の HTML コードのみを返してください。Markdown のコードフェンスや前後の説明は不要です。`,
  },
  'ko-KR': {
    language: '한국어',
    analysisLanguage: '분석 보고서 전체를 한국어로 작성하세요.',
    analysisHeading: '분석 보고서',
    commentsHeading: '댓글 데이터(간결한 형식)',
    topCommentsHeading: '반응이 많은 댓글 데이터',
    untitled: '제목 없음',
    unknownPlatform: '알 수 없는 플랫폼',
    notAvailable: '정보 없음',
    analysis: `소셜 미디어 전문 분석가로서 아래 댓글을 분석하고 근거에 기반한 인사이트를 정리하세요.

## 게시물 정보
- 제목: {title}
- 플랫폼: {platform}
- URL: {url}

## 게시물 원문
{post_content}

## 댓글 데이터(간결한 형식)
{comments_data}

‘↳’로 시작하는 줄은 바로 앞 댓글에 대한 답글입니다. 기호가 여러 번 나오면 중첩된 답글입니다. 좋아요가 많은 답글만 포함되어 있습니다.

아래 구조를 따라 Markdown 보고서를 작성하고 구조화된 데이터는 표로 제시하세요. 댓글이나 답글을 인용할 때는 요약 뒤에 원문을 덧붙이세요.

# 댓글 분석 보고서
## 핵심 요약
## 게시물 내용 요약
게시물 원문이나 동영상 설명을 요약하고 작성자의 의도를 정리하세요.
## 감성 분포
| 감성 | 비율 | 설명 |
|---|---|---|
| 긍정 | X% | 짧은 설명 |
| 부정 | Y% | 짧은 설명 |
| 중립 | Z% | 짧은 설명 |
## 인기 댓글
| 순위 | 사용자 | 좋아요 | 내용 | 주목받은 이유 |
|---|---|---|---|---|
## 주요 상호작용
| 원댓글(사용자) | 인기 답글(사용자) | 상호작용 유형 | 인사이트 |
|---|---|---|---|
## 핵심 인사이트
## 세부 분석
### 주요 주제
### 사용자의 우려
### 긍정적 반응
### 부정적 반응
## 권장 조치
분석에 근거한 구체적인 조치를 제안하세요.

---
*분석 시각: {date_time}*
*게시 시각: {post_time}*
*플랫폼: {platform}*
*분석한 댓글 수: {total_comments}*`,
    dynamic: `웹 디자이너이자 프런트엔드 개발자로서 아래 분석과 댓글을 바탕으로 반응형 단일 페이지 HTML 보고서를 만드세요.

## 게시물 및 분석 정보
- 제목: {title}
- 플랫폼: {platform}
- URL: {url}
- 게시 시각: {post_time}
- 분석 시각: {date_time}
- 분석한 댓글 수: {total_comments}

## 분석 보고서
{analysis_markdown}

## 인기 댓글 및 대표 댓글
{top_comments_data}

1. <!DOCTYPE html>로 시작하고 </html>로 끝나는 유효한 HTML5를 출력하세요. 스타일은 <style>에 넣으세요. <script>, 인라인 이벤트 핸들러, 양식, 프레임, 외부 리소스 및 네트워크가 필요한 요소는 금지됩니다. 샌드박스 iframe에서 완전히 오프라인으로 동작해야 합니다.
2. 내용이 채워진 다섯 섹션을 세로로 배치하고 모두 표시하세요. #overview에는 주요 지표와 요약을, #sentiment에는 정적 SVG 또는 CSS 차트와 비율 및 범례를 넣으세요. #comments에는 위 데이터의 각 댓글을 작성자, 좋아요, 감성 레이블, 본문이 있는 HTML 카드로 미리 렌더링하고 필요하면 감성별로 묶으세요. #insights에는 주제, 장점, 불편 사항, 관점을, #recommendations에는 실행 가능한 제안을 넣으세요.
3. 상단 고정 탐색은 #overview, #sentiment, #comments, #insights, #recommendations 앵커와 부드러운 스크롤만 사용하세요. 외부 링크나 chrome-extension:// URL은 금지하고 출처 URL은 일반 텍스트로 표시하세요.
4. 읽기 쉬운 글꼴, 그라데이션, 은은한 그림자, 반응형 Flex 또는 Grid를 사용하세요. 애니메이션과 호버 효과는 CSS로만 구현하세요.
5. 모든 화면 문구, 레이블, 요약, 설명은 {language_name}로 작성하세요.

<!DOCTYPE html>로 시작하는 독립형 HTML 소스만 반환하세요. Markdown 코드 울타리나 앞뒤 설명은 넣지 마세요.`,
  },
  'fr-FR': {
    language: 'français',
    analysisLanguage: 'Rédigez le rapport complet en français.',
    analysisHeading: 'Rapport d’analyse',
    commentsHeading: 'Données des commentaires (format compact)',
    topCommentsHeading: 'Données des commentaires les plus populaires',
    untitled: 'Sans titre',
    unknownPlatform: 'Plateforme inconnue',
    notAvailable: 'Non disponible',
    analysis: `Vous êtes spécialiste de l’analyse des réseaux sociaux. Analysez les commentaires ci-dessous et formulez des conclusions étayées.

## Informations sur la publication
- Titre : {title}
- Plateforme : {platform}
- URL : {url}

## Contenu original de la publication
{post_content}

## Données des commentaires (format compact)
{comments_data}

Une ligne commençant par « ↳ » répond au commentaire précédent. Plusieurs symboles signalent des réponses imbriquées. Seules les réponses les plus appréciées sont présentées.

Rédigez le rapport suivant en Markdown. Utilisez des tableaux pour les données structurées. Lorsque vous citez un commentaire ou une réponse, ajoutez le texte original après le résumé.

# Rapport d’analyse des commentaires
## Résumé
## Résumé de la publication
Synthétisez la publication ou la description de la vidéo et précisez l’intention de son auteur.
## Répartition des sentiments
| Sentiment | Pourcentage | Description |
|---|---|---|
| Positif | X % | Brève note |
| Négatif | Y % | Brève note |
| Neutre | Z % | Brève note |
## Commentaires populaires
| Rang | Utilisateur | Mentions J’aime | Contenu | Raisons de sa popularité |
|---|---|---|---|---|
## Interactions marquantes
| Commentaire original (auteur) | Réponse populaire (auteur) | Type d’interaction | Conclusion |
|---|---|---|---|
## Enseignements clés
## Observations détaillées
### Principaux thèmes
### Préoccupations des utilisateurs
### Avis positifs
### Avis négatifs
## Recommandations
Proposez des actions concrètes à partir de l’analyse.

---
*Date de l’analyse : {date_time}*
*Date de publication : {post_time}*
*Plateforme : {platform}*
*Nombre de commentaires analysés : {total_comments}*`,
    dynamic: `En tant que concepteur web et développeur front-end, créez un rapport HTML autonome, moderne et adapté aux différentes tailles d’écran à partir de l’analyse et des commentaires.

## Informations sur la publication et l’analyse
- Titre : {title}
- Plateforme : {platform}
- URL : {url}
- Date de publication : {post_time}
- Date de l’analyse : {date_time}
- Nombre de commentaires analysés : {total_comments}

## Rapport d’analyse
{analysis_markdown}

## Commentaires populaires et représentatifs
{top_comments_data}

1. Produisez du HTML5 valide de <!DOCTYPE html> à </html>. Placez les styles dans <style>. Interdisez <script>, les gestionnaires d’événements intégrés, les formulaires, les cadres, les ressources externes et tout contenu dépendant du réseau. Le rapport doit fonctionner entièrement hors ligne dans un iframe isolé.
2. Affichez cinq sections remplies et empilées verticalement. #overview présente les indicateurs et le résumé. #sentiment présente un graphique SVG ou CSS statique, les pourcentages et la légende. #comments intègre chaque commentaire fourni ci-dessus dans une carte HTML avec auteur, mentions J’aime, sentiment et texte, groupée par sentiment si pertinent. #insights présente les thèmes, points forts, difficultés et perspectives. #recommendations propose des actions concrètes.
3. Le menu fixe utilise uniquement les ancres #overview, #sentiment, #comments, #insights et #recommendations avec un défilement fluide. Ne créez aucun lien externe ni URL chrome-extension://. Affichez les URL sources en texte brut.
4. Utilisez une typographie lisible, des dégradés, des ombres discrètes et une disposition Flex ou Grid adaptative. Réalisez les animations et effets de survol uniquement en CSS.
5. Rédigez tous les textes d’interface, libellés, résumés et descriptions en {language_name}.

Renvoyez uniquement le HTML autonome commençant par <!DOCTYPE html>, sans bloc de code Markdown ni explications.`,
  },
  'pt-PT': {
    language: 'português europeu (Portugal)',
    analysisLanguage: 'Escreva todo o relatório em português europeu (Portugal).',
    analysisHeading: 'Relatório de análise',
    commentsHeading: 'Dados dos comentários (formato compacto)',
    topCommentsHeading: 'Dados dos comentários mais populares',
    untitled: 'Sem título',
    unknownPlatform: 'Plataforma desconhecida',
    notAvailable: 'Indisponível',
    analysis: `Atue como especialista em análise de redes sociais. Analise os comentários abaixo e apresente conclusões sustentadas pelos dados.

## Informações sobre a publicação
- Título: {title}
- Plataforma: {platform}
- URL: {url}

## Conteúdo original da publicação
{post_content}

## Dados dos comentários (formato compacto)
{comments_data}

As linhas que começam por «↳» respondem ao comentário anterior. Vários símbolos indicam respostas em níveis sucessivos. São apresentadas apenas as respostas com mais gostos.

Escreva o relatório abaixo em Markdown e use tabelas para os dados estruturados. Ao citar um comentário ou uma resposta, inclua o texto original depois do resumo.

# Relatório de análise dos comentários
## Resumo executivo
## Resumo da publicação
Resuma a publicação original ou a descrição do vídeo e identifique a intenção do autor.
## Distribuição de sentimentos
| Sentimento | Percentagem | Descrição |
|---|---|---|
| Positivo | X% | Nota breve |
| Negativo | Y% | Nota breve |
| Neutro | Z% | Nota breve |
## Comentários populares
| Posição | Utilizador | Gostos | Conteúdo | Razão da popularidade |
|---|---|---|---|---|
## Interações em destaque
| Comentário original (utilizador) | Resposta popular (utilizador) | Tipo de interação | Conclusão |
|---|---|---|---|
## Principais conclusões
## Resultados detalhados
### Temas principais
### Preocupações dos utilizadores
### Reações positivas
### Reações negativas
## Recomendações
Proponha ações concretas com base na análise.

---
*Data da análise: {date_time}*
*Data da publicação: {post_time}*
*Plataforma: {platform}*
*Número de comentários analisados: {total_comments}*`,
    dynamic: `Atue como designer de interfaces e programador front-end. Crie um relatório HTML moderno, autónomo, de página única, adaptado a vários ecrãs, com base na análise e nos comentários.

## Dados da publicação e da análise
- Título: {title}
- Plataforma: {platform}
- URL: {url}
- Data da publicação: {post_time}
- Data da análise: {date_time}
- Número de comentários analisados: {total_comments}

## Relatório de análise
{analysis_markdown}

## Comentários populares e representativos
{top_comments_data}

1. Gere HTML5 válido, de <!DOCTYPE html> até </html>. Coloque os estilos em <style>. Não inclua <script>, eventos em linha, formulários, molduras, recursos externos ou conteúdo que dependa da rede. O relatório tem de funcionar inteiramente sem ligação à Internet, num iframe isolado.
2. Disponha cinco secções preenchidas e visíveis na vertical. #overview apresenta os indicadores e o resumo. #sentiment apresenta um gráfico SVG ou CSS estático com percentagens e legenda. #comments inclui cada comentário fornecido acima num cartão HTML com autor, gostos, etiqueta de sentimento e texto, agrupados por sentimento quando útil. #insights apresenta temas, pontos fortes, dificuldades e perspetivas. #recommendations indica medidas concretas.
3. A navegação fixa usa apenas as âncoras #overview, #sentiment, #comments, #insights e #recommendations, com deslocamento suave. Não crie ligações externas nem URL chrome-extension://. Mostre os URL de origem como texto simples.
4. Use tipografia legível, gradientes, sombras discretas e um esquema responsivo em Flex ou Grid. Use apenas CSS para animações e efeitos ao passar o cursor.
5. Escreva todos os textos da interface, etiquetas, resumos e descrições em {language_name}.

Devolva apenas o código HTML autónomo a partir de <!DOCTYPE html>, sem blocos de código Markdown nem explicações.`,
  },
  'es-ES': {
    language: 'español',
    analysisLanguage: 'Redacta todo el informe de análisis en español.',
    analysisHeading: 'Informe de análisis',
    commentsHeading: 'Datos de los comentarios (formato compacto)',
    topCommentsHeading: 'Datos de los comentarios más populares',
    untitled: 'Sin título',
    unknownPlatform: 'Plataforma desconocida',
    notAvailable: 'No disponible',
    analysis: `Actúa como especialista en análisis de redes sociales. Analiza los siguientes comentarios y presenta conclusiones basadas en los datos.

## Información de la publicación
- Título: {title}
- Plataforma: {platform}
- URL: {url}

## Contenido original de la publicación
{post_content}

## Datos de los comentarios (formato compacto)
{comments_data}

Las líneas que empiezan por «↳» responden al comentario anterior. Varios símbolos indican respuestas anidadas. Solo se muestran las respuestas con más Me gusta.

Redacta el informe siguiente en Markdown y utiliza tablas para los datos estructurados. Al citar un comentario o respuesta, añade el texto original después del resumen.

# Informe de análisis de comentarios
## Resumen ejecutivo
## Resumen de la publicación
Resume la publicación original o la descripción del vídeo e identifica la intención de su autor.
## Distribución de sentimientos
| Sentimiento | Porcentaje | Descripción |
|---|---|---|
| Positivo | X % | Nota breve |
| Negativo | Y % | Nota breve |
| Neutro | Z % | Nota breve |
## Comentarios populares
| Puesto | Usuario | Me gusta | Contenido | Motivo de su popularidad |
|---|---|---|---|---|
## Interacciones destacadas
| Comentario original (usuario) | Respuesta popular (usuario) | Tipo de interacción | Conclusión |
|---|---|---|---|
## Conclusiones clave
## Hallazgos detallados
### Temas principales
### Preocupaciones de los usuarios
### Opiniones positivas
### Opiniones negativas
## Recomendaciones
Propón acciones concretas a partir del análisis.

---
*Fecha del análisis: {date_time}*
*Fecha de publicación: {post_time}*
*Plataforma: {platform}*
*Número de comentarios analizados: {total_comments}*`,
    dynamic: `Como profesional del diseño web y el desarrollo front-end, crea un informe HTML moderno, autónomo, de una sola página y adaptable a distintos tamaños de pantalla, a partir del análisis y los comentarios.

## Datos de la publicación y del análisis
- Título: {title}
- Plataforma: {platform}
- URL: {url}
- Fecha de publicación: {post_time}
- Fecha del análisis: {date_time}
- Número de comentarios analizados: {total_comments}

## Informe de análisis
{analysis_markdown}

## Comentarios populares y representativos
{top_comments_data}

1. Genera HTML5 válido, desde <!DOCTYPE html> hasta </html>. Incluye los estilos en <style>. No uses <script>, controladores de eventos en línea, formularios, marcos, recursos externos ni contenido que dependa de la red. El informe debe funcionar completamente sin conexión en un iframe aislado.
2. Coloca cinco secciones completas y visibles en vertical. #overview incluye métricas y un resumen. #sentiment presenta un gráfico SVG o CSS estático con porcentajes y leyenda. #comments muestra cada comentario proporcionado arriba en una tarjeta HTML con autor, Me gusta, etiqueta de sentimiento y texto, agrupadas por sentimiento si procede. #insights presenta temas, puntos fuertes, problemas y perspectivas. #recommendations propone medidas concretas.
3. La navegación fija solo utiliza las anclas #overview, #sentiment, #comments, #insights y #recommendations, con desplazamiento suave. Evita enlaces externos y URL chrome-extension://. Muestra las URL de origen en texto sin formato.
4. Utiliza tipografía legible, degradados, sombras discretas y un diseño adaptable con Flex o Grid. Usa solo CSS para las animaciones y los efectos al pasar el cursor.
5. Redacta todos los textos de la interfaz, las etiquetas, los resúmenes y las descripciones en {language_name}.

Devuelve únicamente el código HTML autónomo, empezando por <!DOCTYPE html>, sin bloques de código Markdown ni explicaciones.`,
  },
} satisfies Record<Exclude<LocaleCode, 'en-US'>, PromptLocale>;
