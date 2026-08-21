/**
 * Prompt templates for AI-driven comment analysis
 */

import { TEMPLATE, LANGUAGES, ANALYSIS_FORMAT } from '@/config/constants';

/**
 * Default analysis prompt template
 * Can be customized by users in settings
 */
export const DEFAULT_ANALYSIS_PROMPT_TEMPLATE = `You are a professional social media analyst. Analyze the following comments and provide insights.

## Post Information:
- **Title**: {title}
- **Platform**: {platform}
- **URL**: {url}

## Post Content (Original):
{post_content}

## Comments Data (Dense Format):
{comments_data}

Note on data format:
- Lines starting with "↳" indicate replies to the preceding comment.
- Multiple "↳" symbols (e.g., "↳ ↳") indicate nested replies.
- Replies shown are top/popular replies only (sorted by likes), not all replies.

## Analysis Requirements:
1. Sentiment Analysis: Categorize comments as positive, negative, or neutral
2. Hot Comments: Identify top comments by engagement and explain why they're popular
3. Key Insights: Extract main themes, concerns, and trends
4. Summary Statistics: Provide overall metrics
5. Interaction Analysis: Analyze notable interactions between top replies and their parent comments

## Output Format:
Generate a comprehensive analysis report in Markdown format with the following sections.
**IMPORTANT: Use tables for structured data to ensure a clean and beautiful layout.**
When referencing a single comment or reply, append the original text after the summary in this format: Original: <comment or reply text>.

# Comment Analysis Report

## Executive Summary
[Brief overview of the analysis]

## Post Content Summary
[Summarize the original post content or video description to capture the author's intent]

## Sentiment Distribution
| Sentiment | Percentage | Description |
|-----------|------------|-------------|
| Positive  | X%         | [Brief note] |
| Negative  | Y%         | [Brief note] |
| Neutral   | Z%         | [Brief note] |

## Hot Comments Analysis (Top Liked)
| Rank | User | Likes | Content | Why it's hot |
|------|------|-------|---------|--------------|
| 1    | [User]| [Num] | [Text]  | [Reason]     |
| ...  | ...  | ...   | ...     | ...          |

## Interaction Highlights (Top Replies vs Original)
| Original Comment (User) | Top Reply (User) | Interaction Type | Insight |
|-------------------------|------------------|------------------|---------|
| [Text] ([User])         | [Text] ([User])  | [Agreement/Disagreement/Joke/etc.] | [Analysis of the dynamic] |
| ...                     | ...              | ...              | ...     |

## Key Insights
1. [First major insight]
2. [Second major insight]
3. [Third major insight]
[Continue as needed]

## Detailed Findings

### Main Themes
[Describe the main themes discussed in comments]

### User Concerns
[List and explain major concerns raised]

### Positive Feedback
[Summarize positive aspects mentioned]

### Negative Feedback
[Summarize criticisms and complaints]

## Recommendations
[Actionable suggestions based on the analysis]

---
*Analysis performed on: {date_time}*
*Video/Post published on: {post_time}*
*Platform: {platform}*
*Total comments analyzed: {total_comments}*`;

/**
 * Build analysis prompt with comments data
 * @param commentsData - Comments in dense text format
 * @param template - Custom template (optional)
 * @param metadata - Additional metadata
 * @returns Formatted prompt
 */
export function buildAnalysisPrompt(
  commentsData: string,
  template: string = DEFAULT_ANALYSIS_PROMPT_TEMPLATE,
  metadata?: {
    datetime?: string;
    videoTime?: string;
    platform?: string;
    url?: string;
    title?: string;
    postContent?: string;
    totalComments?: number;
    language?: string;
  },
): string {
  const langCode = metadata?.language || LANGUAGES.DEFAULT;
  const langConfig = LANGUAGES.SUPPORTED.find((l) => l.code === langCode);
  const langName = langConfig?.name || langCode;
  const languageInstruction = `\n\n## Language Requirement:\nYou MUST write the entire analysis in ${langName}.`;
  const analysisDateTime = metadata?.datetime || new Date().toISOString();
  const promptTemplate = template.includes(TEMPLATE.COMMENTS_DATA_PLACEHOLDER)
    ? template
    : template + TEMPLATE.COMMENTS_DATA_FALLBACK_SECTION;

  const prompt =
    promptTemplate
      .split(TEMPLATE.COMMENTS_DATA_PLACEHOLDER)
      .join(commentsData)
      .replace(/{date_time}/g, analysisDateTime)
      .replace(/{datetime}/g, analysisDateTime)
      .replace(/{post_time}/g, metadata?.videoTime || 'N/A')
      .replace(/{video_time}/g, metadata?.videoTime || 'N/A')
      .replace(/{platform}/g, metadata?.platform || 'Unknown Platform')
      .replace(/{url}/g, metadata?.url || 'N/A')
      .replace(/{title}/g, metadata?.title || ANALYSIS_FORMAT.UNKNOWN_TITLE)
      .replace(/{post_content}/g, metadata?.postContent || 'N/A')
      .replace(/{total_comments}/g, String(metadata?.totalComments || 0)) + languageInstruction;

  return prompt;
}

/**
 * Default dynamic HTML report prompt template
 */
export const DEFAULT_DYNAMIC_REPORT_PROMPT_TEMPLATE = `You are an expert UI/UX designer and frontend web engineer.
Generate a modern, visually rich, and responsive standalone single-page HTML report based on the provided comment analysis data.

## Post & Analysis Information:
- **Title**: {title}
- **Platform**: {platform}
- **URL**: {url}
- **Post Published**: {post_time}
- **Analysis Time**: {date_time}
- **Total Comments Analyzed**: {total_comments}

## Analysis Report Content:
{analysis_markdown}

## Top & Representative Comments Data:
{top_comments_data}

## Page Design & Feature Requirements:
1. **Self-Contained Static File**:
   - Output valid HTML5 starting with <!DOCTYPE html> and ending with </html>.
   - Include all styling in a <style> block.
   - Do NOT include <script>, inline event handlers, forms, frames, external resources, or network-dependent content.
   - The report must work completely offline in a sandboxed iframe.

2. **Dashboard Layout & Direct Section Visibility**:
   - The page MUST be laid out as a rich, full vertical dashboard where ALL 5 sections (#overview, #sentiment, #comments, #insights, #recommendations) are visible and fully populated with real synthesized text and data by default (do NOT hide sections behind unselected tabs or leave them empty).
   - Top sticky navigation bar provides smooth jump links (\`href="#overview"\`, \`href="#sentiment"\`, \`href="#comments"\`, \`href="#insights"\`, \`href="#recommendations"\`).
   - Every section MUST be thoroughly populated with real content extracted from the Analysis Report and Comments data:
     - \`<section id="overview">\`: Key metrics cards (total comments, overall sentiment %, engagement, core topics) and executive summary text.
     - \`<section id="sentiment">\`: Static SVG or CSS donut/bar chart with percentage breakdown and legend.
     - \`<section id="comments">\`: MUST pre-render HTML comment cards for each top comment in {top_comments_data} directly into the DOM. Include author name, likes badge, sentiment label, and comment body, grouped by sentiment where useful.
     - \`<section id="insights">\`: Thematic breakdown cards, positive highlights, user pain points, and perspective analysis.
     - \`<section id="recommendations">\`: Actionable takeaways and strategic advice.

3. **Link & Navigation Rules**:
   - In-page navigation links MUST use \`href="#overview"\`, \`href="#sentiment"\`, \`href="#comments"\`, \`href="#insights"\`, \`href="#recommendations"\` and include \`html { scroll-behavior: smooth; }\`.
   - NEVER generate \`chrome-extension://\` or internal extension URLs. All data and comments MUST be embedded and viewable directly within this standalone HTML page.
   - Do not create external links. Render source URLs as plain text.

4. **Visual & Aesthetic Excellence**:
   - Modern, sleek dashboard (dark/light clean aesthetic, smooth gradients, subtle card shadows/glassmorphism, clean typography, responsive flex/grid).
   - CSS-only micro-animations and hover effects on cards and charts.

5. **Language Requirement**:
   - You MUST write all UI texts, labels, summaries, and descriptions in {language_name}.

## Output Format:
Output ONLY the raw standalone HTML code. Do NOT include markdown code blocks, do NOT include conversational text before or after. Start directly with <!DOCTYPE html>.`;

/**
 * Build dynamic HTML report prompt
 */
export function buildDynamicReportPrompt(
  analysisMarkdown: string,
  template: string = DEFAULT_DYNAMIC_REPORT_PROMPT_TEMPLATE,
  metadata?: {
    datetime?: string;
    videoTime?: string;
    platform?: string;
    url?: string;
    title?: string;
    totalComments?: number;
    language?: string;
    topCommentsData?: string;
  },
): string {
  const langCode = metadata?.language || LANGUAGES.DEFAULT;
  const langConfig = LANGUAGES.SUPPORTED.find((l) => l.code === langCode);
  const langName = langConfig?.name || langCode;
  const analysisDateTime = metadata?.datetime || new Date().toISOString();
  const topComments = metadata?.topCommentsData || 'N/A';

  let prompt = template
    .replace(/{analysis_markdown}/g, analysisMarkdown)
    .replace(/{date_time}/g, analysisDateTime)
    .replace(/{datetime}/g, analysisDateTime)
    .replace(/{post_time}/g, metadata?.videoTime || 'N/A')
    .replace(/{video_time}/g, metadata?.videoTime || 'N/A')
    .replace(/{platform}/g, metadata?.platform || 'Unknown Platform')
    .replace(/{url}/g, metadata?.url || 'N/A')
    .replace(/{title}/g, metadata?.title || ANALYSIS_FORMAT.UNKNOWN_TITLE)
    .replace(/{total_comments}/g, String(metadata?.totalComments || 0))
    .replace(/{language_name}/g, langName)
    .replace(/{top_comments_data}/g, topComments)
    .replace(/{comments_data}/g, topComments);

  if (!prompt.includes(analysisMarkdown)) {
    prompt += `\n\n## Analysis Markdown:\n${analysisMarkdown}`;
  }

  if (topComments !== 'N/A' && !prompt.includes(topComments)) {
    prompt += `\n\n## Top Comments Data:\n${topComments}`;
  }

  return prompt;
}

/**
 * Validate prompt template
 * Checks if template contains required placeholders
 * @param template - Template to validate
 * @returns True if valid
 */
export function validatePromptTemplate(template: string): boolean {
  if (!template.includes(TEMPLATE.COMMENTS_DATA_PLACEHOLDER)) {
    return false;
  }

  if (template.length < TEMPLATE.MIN_LENGTH || template.length > TEMPLATE.MAX_LENGTH) {
    return false;
  }

  return true;
}

/**
 * Get available placeholders for prompt templates
 * @returns List of available placeholders with descriptions
 */
export function getAvailablePlaceholders(): Array<{
  key: string;
  description: string;
  detailedDescription: string;
}> {
  return [
    {
      key: TEMPLATE.COMMENTS_DATA_PLACEHOLDER,
      description: 'Comments data in dense text format (required)',
      detailedDescription:
        'The complete comments data structure in a dense text format (table-like), including all comment fields like username, content, timestamp, likes, and nested replies. This format is optimized for token efficiency.',
    },
    {
      key: '{date_time}',
      description: 'Current analysis date and time',
      detailedDescription:
        'The current date and time when the analysis is being performed. Format: ISO 8601 (e.g., 2024-01-15T10:30:00Z)',
    },
    {
      key: '{post_time}',
      description: 'Video/post publication date and time',
      detailedDescription:
        'The date and time when the video or post was originally published. This is extracted from the page using the videoTime selector in scraper config. Helps provide temporal context for understanding comment trends over time.',
    },
    {
      key: '{post_content}',
      description: 'Original post content or video description',
      detailedDescription:
        'The original post content or video description extracted from the page. This helps the AI understand the author’s intent and provide a better analysis.',
    },
    {
      key: '{platform}',
      description: 'Platform/domain name',
      detailedDescription:
        'The platform or domain where the comments were extracted from (e.g., youtube.com, twitter.com, reddit.com). This helps the AI understand platform-specific comment patterns and culture.',
    },
    {
      key: '{url}',
      description: 'Post/video URL',
      detailedDescription:
        'The complete URL of the post or video being analyzed. This provides context about the source and can be used for reference in the analysis report.',
    },
    {
      key: '{title}',
      description: 'Post/video title',
      detailedDescription:
        'The title or headline of the post/video. This is crucial context for understanding what the comments are discussing and helps the AI provide more relevant analysis.',
    },
    {
      key: '{total_comments}',
      description: 'Total number of comments',
      detailedDescription:
        'The total count of comments being analyzed (including all nested replies). This helps the AI understand the scale of engagement and adjust its analysis accordingly.',
    },
  ];
}

export const PROMPT_NORMALIZE_COMMENT_TIMESTAMPS = `You are a time normalization engine.

Input JSON Array:
{items_json}

Reference time (local time, ISO 8601 without timezone):
{reference_time}

Task:
1. Convert each item's "timestamp" into local time based on the reference time when needed.
2. The format should be ISO 8601 without timezone and precision to minutes only (e.g., "2024-01-15T10:30").
3. If the source timestamp is coarse (e.g., "3 days ago", "1 month ago"), use 00:00 for the time.
4. If the timestamp is already an absolute date, normalize it to local time with minute precision.
5. If a timestamp cannot be parsed, return it unchanged.

Output JSON Array (same order, same paths):
[
  { "path": "0", "timestamp": "2024-01-15T10:30" }
]

Return ONLY valid JSON. No markdown, no explanations.`;

export function buildTimestampNormalizationPrompt(
  itemsJson: string,
  referenceTime: string,
): string {
  return PROMPT_NORMALIZE_COMMENT_TIMESTAMPS.replace(/{items_json}/g, itemsJson).replace(
    /{reference_time}/g,
    referenceTime,
  );
}
