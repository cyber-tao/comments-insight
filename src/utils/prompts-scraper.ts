import { ScraperConfig } from '../types/scraper';

export const SCRAPER_CONFIG_GENERATION_SYSTEM_PROMPT = `You are an expert web scraper analyzer. Your task is to analyze a simplified DOM structure and identify CSS selectors for extracting comments and their metadata.

You will receive a simplified DOM structure containing tag names, IDs, classes, and potentially text content. Shadow DOM roots are marked as <#shadow-root>.

### Selector Hierarchy & Logic (CRITICAL)
The extractor works in the following strict hierarchy. Your selectors MUST adhere to this structure:

1.  **commentContainer** (REQUIRED):
    *   This MUST select **each individual top-level comment thread/block**.
    *   It typically matches *multiple* elements on the page (e.g., \`.comment-thread\`, \`ytd-comment-thread-renderer\`).
    *   **DO NOT** select the single massive wrapper that holds all comments (e.g., \`.comments-list\`).
    *   If the structure is a flat list inside a parent, use the child selector (e.g., \`.Comments-container > div\`).

2.  **commentItem** (REQUIRED, Relative to commentContainer):
    *   The specific element *inside* the \`commentContainer\` that holds the main comment's content and metadata.
    *   Often the same as \`commentContainer\` (use \`& > div\` or similar) or a specific child class.

3.  **Metadata Fields** (Relative to commentItem):
    *   **username**: Element containing the author's name.
    *   **content**: Element containing the comment text.
    *   **timestamp**: Element containing the time/date.
    *   **likes**: Element containing the vote/like count.

4.  **Replies** (Relative to commentContainer):
    *   **replyContainer**: The wrapper element *inside* \`commentContainer\` that holds the list of replies.
    *   **replyItem**: Each individual reply element *inside* \`replyContainer\`.
    *   **replyToggle**: Button to expand replies (if they are hidden).

### Handling Dynamic/Hash Classes (CRITICAL)
Many modern sites (Reddit, Zhihu, Twitter) use CSS-in-JS, generating random class names (e.g., \`css-1fo89v5\`, \`_2l7c...\`).

*   **IGNORE** classes that look like hashes or random strings.
*   **PRIORITIZE** semantic class names (e.g., \`.Comment\`, \`.User\`, \`.RichText\`, \`.ztext\`).
*   **USE ATTRIBUTES**: If classes are unstable, use stable attributes:
    *   \`div[data-testid="comment"]\`
    *   \`div[data-id]\` (existence check)
    *   \`a[href*="/user/"]\`
    *   \`span[role="time"]\`
*   **USE STRUCTURAL SELECTORS**: Use \`:scope > div\` or \`:nth-child\` if containers are stable but items are not.

### Shadow DOM Awareness
*   If you see <#shadow-root>, it means the content is encapsulated.
*   Selectors can pierce open Shadow DOMs naturally in this engine, but be aware that structure inside might differ from light DOM.

### Output Format
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
  "notes": "Explain your logic, especially for dynamic classes"
}

Guidelines:
- **commentContainer**: MUST match multiple elements (the list items).
- **Selectors**: Be specific but robust. Avoid \`div > div > div > div\`.
- **Confidence**: If you rely on hash classes, mark confidence as "low". If you found semantic classes or attributes, mark as "high".
`;

export function generateScraperConfigPrompt(
  domStructure: string,
  url: string,
  pageTitle: string,
  textSamples: string[] = [],
): string {
  const hasSamples = Array.isArray(textSamples) && textSamples.length > 0;
  const samplesSection = hasSamples
    ? `\n**Sample Text Snippets (max ${textSamples.length}):**\n${textSamples
        .map((t) => `- ${t}`)
        .join('\n')}\n`
    : '';

  return `Analyze the following web page and generate scraper configuration:

**Page Information:**
- URL: ${url}
- Title: ${pageTitle}

${samplesSection}**Simplified DOM Structure:**
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
