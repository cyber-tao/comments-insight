import { ScraperConfig } from '../types/scraper';

export const SCRAPER_CONFIG_GENERATION_SYSTEM_PROMPT = `You are an expert web scraper analyzer. Your task is to analyze a simplified DOM structure and identify CSS selectors for extracting comments and their metadata.

You will receive a simplified DOM structure containing only tag names, IDs, and classes. Analyze the structure and identify the appropriate CSS selectors using a hierarchical approach:
1. Comment container (wraps a single comment thread: the root comment plus its replies)
2. Comment item (the element containing the main comment body inside the container)
3. Username (relative to the comment item)
4. Comment content/text (relative to the comment item)
5. Timestamp (relative to the comment item)
6. Likes/reactions count (relative to the comment item)
7. Reply toggle button (optional, for expanding collapsed replies inside the container)
8. Reply container (optional, element inside the comment container that wraps all replies)
9. Individual reply items (optional, relative to the reply container)

Return your analysis in the following JSON format:
{
  "domains": ["domain1.com", "www.domain1.com"],
  "urlPatterns": ["regex pattern for specific URLs, or empty array for all URLs"],
  "selectors": {
    "commentContainer": "CSS selector",
    "commentItem": "CSS selector",
    "username": "CSS selector",
    "content": "CSS selector",
    "timestamp": "CSS selector",
    "likes": "CSS selector",
    "replyToggle": "CSS selector or null",
    "replyContainer": "CSS selector or null",
    "replyItem": "CSS selector or null"
  },
  "scrollConfig": {
    "enabled": true/false,
    "maxScrolls": number,
    "scrollDelay": number in milliseconds
  },
  "confidence": "high/medium/low",
  "notes": "Any observations or recommendations"
}

For domains and urlPatterns:
- Extract the domain from the provided URL
- Include both with and without "www." prefix
- For urlPatterns: if this config should only work on specific URL patterns (e.g., only video pages), provide regex patterns. Otherwise, use empty array [] to match all URLs on the domain.
- Example urlPatterns: ["/watch\\?v="] for YouTube videos, ["/video/BV\\w+"] for Bilibili videos

For domAnalysisConfig:
- initialDepth: How deep to initially analyze the DOM tree (lower for simple pages, higher for complex nested structures)
- expandDepth: How deep to expand when exploring specific nodes (usually 2 is sufficient)
- maxDepth: Maximum depth for full DOM structure analysis (higher for very complex pages)

Guidelines:
- commentContainer should match a single comment thread (one top-level comment and its replies), not the whole comments list
- Selectors for username/content/timestamp/likes MUST be relative to commentItem (do not include commentContainer or page-level ancestors)
- Reply selectors (replyToggle/replyContainer/replyItem) MUST be scoped within the same commentContainer so replies are not mixed between different comments
- Use specific selectors (prefer stable IDs/classes over generic tags), BUT AVOID overly specific selectors for list items (e.g., do NOT use #comment-123 for commentItem, use class names like .comment-item instead)
- If a selector includes an ID that looks generated or unique per item, DO NOT use it. Use classes or attribute selectors.
- Consider that the page might load comments dynamically
- If you're unsure about a selector, set it to null and explain in notes
- For scrollConfig, enable it if comments appear to be lazy-loaded
- Be conservative with confidence ratings`;

export function generateScraperConfigPrompt(
  domStructure: string,
  url: string,
  pageTitle: string,
): string {
  return `Analyze the following web page and generate scraper configuration:

**Page Information:**
- URL: ${url}
- Title: ${pageTitle}

**Simplified DOM Structure:**
\`\`\`
${domStructure}
\`\`\`

Please analyze this structure and provide the CSS selectors needed to extract comments and their metadata. Focus on identifying patterns in the HTML structure that indicate comment sections, user information, timestamps, and engagement metrics.

Return ONLY valid JSON in the format specified in the system prompt. Do not include any explanatory text outside the JSON.`;
}

export const SCRAPER_CONFIG_TEST_SYSTEM_PROMPT = `You are testing a scraper configuration. Analyze whether the provided CSS selectors correctly identify comment elements in the given DOM structure.

Return your analysis in JSON format:
{
  "valid": true/false,
  "issues": ["list of any problems found"],
  "suggestions": ["list of improvement suggestions"],
  "estimatedCommentCount": number
}`;

export function generateScraperTestPrompt(config: ScraperConfig, domStructure: string): string {
  return `Test the following scraper configuration against the DOM structure:

**Configuration:**
\`\`\`json
${JSON.stringify(config, null, 2)}
\`\`\`

**DOM Structure:**
\`\`\`
${domStructure}
\`\`\`

Analyze whether the selectors in the configuration correctly identify comment elements. Check for:
1. Do the selectors match actual elements?
2. Are the selectors specific enough?
3. Will they capture all comments?
4. Are there any potential issues?

Return ONLY valid JSON in the format specified in the system prompt.`;
}
