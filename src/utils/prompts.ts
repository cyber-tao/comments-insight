/**
 * Prompt templates for AI-driven comment extraction and analysis
 */

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

## Comments Data:
{comments_json}

## Analysis Requirements:
1. Sentiment Analysis: Categorize comments as positive, negative, or neutral
2. Hot Comments: Identify top comments by engagement and explain why they're popular
3. Key Insights: Extract main themes, concerns, and trends
4. Summary Statistics: Provide overall metrics

## Output Format:
Generate a comprehensive analysis report in Markdown format with the following sections:

# Comment Analysis Report

## Executive Summary
[Brief overview of the analysis]

## Sentiment Distribution
- Positive: X%
- Negative: Y%
- Neutral: Z%

## Hot Comments Analysis
### Top Comment 1
- **Content**: [quote the comment]
- **Engagement**: [likes count]
- **Why it's hot**: [analysis of why this comment resonates]

### Top Comment 2
- **Content**: [quote]
- **Engagement**: [likes]
- **Why it's hot**: [analysis]

[Continue for top 5 comments]

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
*Analysis generated on {timestamp}*
*Platform: {platform}*
*Total comments analyzed: {total_comments}*`;

/**
 * Build extraction prompt with DOM content
 * @param domContent - Serialized DOM content
 * @returns Formatted prompt
 */
export function buildExtractionPrompt(domContent: string): string {
  return EXTRACTION_PROMPT_TEMPLATE.replace('{dom_content}', domContent);
}

/**
 * Build analysis prompt with comments data
 * @param commentsJson - Comments in JSON format
 * @param template - Custom template (optional)
 * @param metadata - Additional metadata
 * @returns Formatted prompt
 */
export function buildAnalysisPrompt(
  commentsJson: string,
  template: string = DEFAULT_ANALYSIS_PROMPT_TEMPLATE,
  metadata?: {
    timestamp?: string;
    platform?: string;
    url?: string;
    totalComments?: number;
  }
): string {
  let prompt = template
    .replace('{comments_json}', commentsJson)
    .replace('{timestamp}', metadata?.timestamp || new Date().toISOString())
    .replace('{platform}', metadata?.platform || 'social media')
    .replace('{url}', metadata?.url || 'N/A')
    .replace('{total_comments}', String(metadata?.totalComments || 0));

  return prompt;
}

/**
 * Validate prompt template
 * Checks if template contains required placeholders
 * @param template - Template to validate
 * @returns True if valid
 */
export function validatePromptTemplate(template: string): boolean {
  // Must contain comments_json placeholder
  if (!template.includes('{comments_json}')) {
    return false;
  }

  // Should be reasonable length
  if (template.length < 50 || template.length > 10000) {
    return false;
  }

  return true;
}

/**
 * Get available placeholders for prompt templates
 * @returns List of available placeholders with descriptions
 */
export function getAvailablePlaceholders(): Array<{ key: string; description: string }> {
  return [
    { key: '{comments_json}', description: 'Comments data in JSON format (required)' },
    { key: '{timestamp}', description: 'Current timestamp' },
    { key: '{platform}', description: 'Platform name (e.g., YouTube, Twitter)' },
    { key: '{url}', description: 'Post URL' },
    { key: '{total_comments}', description: 'Total number of comments' },
  ];
}
