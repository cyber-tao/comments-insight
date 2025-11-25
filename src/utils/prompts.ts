/**
 * Prompt templates for AI-driven comment extraction and analysis
 */

import { TEMPLATE } from '@/config/constants';

/**
 * Extraction prompt template
 * Instructs AI to extract comments from DOM structure
 */
export const EXTRACTION_PROMPT_TEMPLATE = `You are a web scraping expert. Your task is to analyze the DOM structure and extract comment data.

## DOM Structure:
{dom_content}

## Task:
1. Identify the comment section in the DOM
2. Extract all comments with the following information:
   - id (generate unique ID if not available)
   - username
   - timestamp
   - likes count
   - comment content
   - replies (nested structure)

## Output Format:
Return ONLY a valid JSON array with no additional text:
[
  {
    "id": "unique_id",
    "username": "user_name",
    "timestamp": "time_string",
    "likes": 0,
    "content": "comment_text",
    "replies": []
  }
]

## Important:
- Return ONLY valid JSON, no markdown code blocks
- If no comments found, return empty array []
- Preserve the nested structure for replies
- Generate unique IDs for each comment
- Extract actual data from the DOM, don't make up content`;

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

## Analysis Requirements:
1. Sentiment Analysis: Categorize comments as positive, negative, or neutral
2. Hot Comments: Identify top comments by engagement and explain why they're popular
3. Key Insights: Extract main themes, concerns, and trends
4. Summary Statistics: Provide overall metrics
5. Top Replied: Identify comments that sparked the most discussion (most replies)
6. Interaction Analysis: Analyze the interaction between top-liked replies and the original comment

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

## Top Discussed Comments (Most Replies)
| Rank | User | Replies | Content | Discussion Topic |
|------|------|---------|---------|------------------|
| 1    | [User]| [Num]  | [Text]  | [Topic]          |
| ...  | ...  | ...    | ...     | ...              |

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
 * Build extraction prompt with DOM content
 * @param domContent - Serialized DOM content
 * @param template - Custom template (optional)
 * @returns Formatted prompt
 */
export function buildExtractionPrompt(
  domContent: string,
  template: string = EXTRACTION_PROMPT_TEMPLATE,
): string {
  return template.replace('{dom_content}', domContent);
}

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
  // Add language instruction
  const languageInstruction =
    metadata?.language === 'zh-CN'
      ? '\n\n## Language Requirement:\nYou MUST write the entire analysis in Chinese (简体中文). All sections, insights, and summaries must be in Chinese.'
      : '\n\n## Language Requirement:\nYou MUST write the entire analysis in English.';

  let prompt =
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
