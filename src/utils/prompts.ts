/**
 * Prompt templates for AI-driven comment analysis
 */

import { TEMPLATE, LANGUAGES } from '@/config/constants';

/**
 * Default analysis prompt template
 * Can be customized by users in settings
 */
export const DEFAULT_ANALYSIS_PROMPT_TEMPLATE = `You are a professional social media analyst. Analyze the following comments and provide insights.

## Post Information:
- **Title**: {title}
- **Platform**: {platform}
- **URL**: {url}

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

# Comment Analysis Report

## Executive Summary
[Brief overview of the analysis]

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
*Analysis performed on: {datetime}*
*Video/Post published on: {video_time}*
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
    totalComments?: number;
    language?: string;
  },
): string {
  // Generate language instruction using language name
  const langCode = metadata?.language || LANGUAGES.DEFAULT;
  const langConfig = LANGUAGES.SUPPORTED.find((l) => l.code === langCode);
  const langName = langConfig?.name || langCode;
  const languageInstruction = `\n\n## Language Requirement:\nYou MUST write the entire analysis in ${langName}.`;

  const prompt =
    template
      .replace(/{comments_data}/g, commentsData)
      .replace(/{datetime}/g, metadata?.datetime || new Date().toISOString())
      .replace(/{video_time}/g, metadata?.videoTime || 'N/A')
      .replace(/{platform}/g, metadata?.platform || 'Unknown Platform')
      .replace(/{url}/g, metadata?.url || 'N/A')
      .replace(/{title}/g, metadata?.title || 'Untitled')
      .replace('{total_comments}', String(metadata?.totalComments || 0)) + languageInstruction;

  return prompt;
}

/**
 * Validate prompt template
 * Checks if template contains required placeholders
 * @param template - Template to validate
 * @returns True if valid
 */
export function validatePromptTemplate(template: string): boolean {
  // Must contain comments_data placeholder
  if (!template.includes('{comments_data}')) {
    return false;
  }

  // Should be reasonable length
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
      key: '{comments_data}',
      description: 'Comments data in dense text format (required)',
      detailedDescription:
        'The complete comments data structure in a dense text format (table-like), including all comment fields like username, content, timestamp, likes, and nested replies. This format is optimized for token efficiency.',
    },
    {
      key: '{datetime}',
      description: 'Current analysis date and time',
      detailedDescription:
        'The current date and time when the analysis is being performed. Format: ISO 8601 (e.g., 2024-01-15T10:30:00Z)',
    },
    {
      key: '{video_time}',
      description: 'Video/post publication date and time',
      detailedDescription:
        'The date and time when the video or post was originally published. This is extracted from the page using the videoTime selector in scraper config. Helps provide temporal context for understanding comment trends over time.',
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

export const PROMPT_DETECT_COMMENTS_SECTION = `You are a web page structure analyzer. Your goal is to identify the single best CSS selector that uniquely wraps the **entire comment section** or the **list of comments** on the page.

Input: Simplified DOM structure of the page body.

Task:
1. Scan the DOM for keywords like "comment", "discussion", "thread", "conversation", "response" in IDs, classes, or attributes.
2. Identify the container that holds the repeating comment items.
3. Return a unique CSS selector for this container.

Output JSON format:
{
  "sectionSelector": "CSS selector string",
  "confidence": number (0.0 - 1.0),
  "reason": "Why you chose this selector"
}

Note: If there are multiple candidates, prefer the most specific wrapper that contains *all* comments but *excludes* unrelated sidebars/footers.`;

export const PROMPT_EXTRACT_COMMENTS_FROM_HTML = `You are a precise data extraction engine. You will be given a chunk of HTML/Simplified DOM representing a part of a comment section.

Task: Extract all comments, including nested replies, into a structured JSON format.

Input:
- HTML/DOM Chunk

Output Format (JSON Array of Comment Objects):
[
  {
    "username": "User Name",
    "content": "The comment text",
    "timestamp": "Time string (e.g. '2 hours ago', '2023-10-27')",
    "likes": "Like count (raw string or number, e.g. '1.2k', '5')",
    "replies": [ ...nested comments... ]
  },
  ...
]

Rules:
1. **Preserve Hierarchy**: If a comment is visually nested or inside a replies container of another comment, place it in the "replies" array of the parent.
2. **Text Only**: Extract clear text for content. Remove "Reply", "Share" button texts if possible.
3. **Missing Data**: If a field (like likes) is missing, use null or "0".
4. **Accuracy**: Do not hallucinate content. Only extract what is present.
5. **No Markdown**: Return RAW JSON only.`;

export const PROMPT_GENERATE_CRAWLING_CONFIG = `You are an expert Web Scraper Configuration Generator.
Your task is to analyze the provided HTML (Simplified DOM) and generate a **JSON Configuration** directly mapping to the following TypeScript interface.

## Target Interface
\`\`\`typescript
interface SelectorRule {
  selector: string;     // CSS selector (e.g., ".comment-body", "#author")
  type: "css";          // Always use "css"
}

interface FieldSelector {
  name: string;         // One of: "username", "content", "timestamp", "likes"
  rule: SelectorRule;
  attribute?: string;   // Optional: if data is in attribute (e.g. "datetime", "title", "aria-label")
}

interface ReplyConfig {
  container: SelectorRule; // The wrapper around ALL replies for a single comment
  item: SelectorRule;      // The selector for an INDIVIDUAL reply item
  fields: FieldSelector[]; // Same fields as main comment
}

interface CrawlingConfig {
  domain: string;          // Extract from context (e.g. "youtube.com")
  container: SelectorRule; // The wrapper around ALL comments (the main list)
  item: SelectorRule;      // The selector for an INDIVIDUAL comment item
  fields: FieldSelector[]; // Fields to extract
  replies?: ReplyConfig;   // Optional: if replies are detected
  videoTime?: SelectorRule; // Optional: selector for post/video publication time (outside comment section)
}
\`\`\`

## Critical Rules for Selectors
1.  **AVOID Random/Hashed Classes**: Do NOT use classes that look like \`css-1a2b3c\`, \`sc-xyz\`, or \`styled-123\`. These change frequently.
2.  **PREFER Stable Attributes**: Look for:
    *   IDs: \`#comments\`, \`#author-text\`
    *   Data Attributes: \`[data-testid="comment"]\`, \`[data-role="author"]\`
    *   ARIA Roles: \`[role="article"]\`, \`[aria-label="Comment"]\`
    *   Semantic Tags: \`article\`, \`time\`, \`h3\`
3.  **Replies Toggle**: Look for elements that expand replies, often buttons or links with text "View X replies", "Show replies", "More replies".
    *   Selector examples: \`.more-replies\`, \`#more-replies-sub-thread\`, \`button[aria-label*="replies"]\`.
4.  **Use Hierarchy**: If a stable class is not available, use structural paths relative to the parent.
    *   *Bad*: \`.div > .span > .text\`
    *   *Good*: \`article > header > a.author\`
5.  **Fields**:
    *   **username**: The author's name.
    *   **content**: The main text body of the comment.
    *   **timestamp**: The time element (often \`<time>\` or text like "2 hours ago").
    *   **likes**: The like/upvote count.
6.  **videoTime**: The publication time of the post/video (NOT comment time). Look for:
    *   YouTube: \`#info-strings yt-formatted-string\`, \`#date\`
    *   General: \`time[datetime]\`, \`.publish-date\`, \`.post-date\`, \`[itemprop="datePublished"]\`
    *   This is usually near the title or author info, NOT in the comment section.

## Output Format
Return **ONLY** the JSON object. No markdown code blocks, no explanations.
`;
