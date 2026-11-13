/**
 * Prompt templates consumed inside the content-script context. Kept separate
 * from utils/prompts so the heavy analysis/report templates stay out of the
 * content-script chunk graph.
 */

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
  container: SelectorRule; // Wrapper inside a parent comment holding its replies (use parent comment/reply list container if replies nest directly)
  item: SelectorRule;      // Selector for an INDIVIDUAL reply item within replies.container
  fields: FieldSelector[]; // REQUIRED complete FieldSelector[] array for reply items (include username, content, and timestamp/likes if present)
  expandBtn?: SelectorRule;// Optional: button/link inside a comment that expands collapsed replies (omit if none exists)
}

interface CrawlingConfig {
  domain: string;          // Extract from context (e.g. "youtube.com")
  container: SelectorRule; // The wrapper around ALL comments (the main list)
  item: SelectorRule;      // The selector for an INDIVIDUAL comment item
  fields: FieldSelector[]; // Fields to extract
  replies?: ReplyConfig;   // REQUIRED whenever reply items, nested comments, reply lists, or reply-expand buttons exist in the DOM
}
\`\`\`

## Critical Rules for Selectors
1.  **AVOID Random/Hashed Classes**: Do NOT use classes that look like \`css-1a2b3c\`, \`sc-xyz\`, or \`styled-123\`. These change frequently.
2.  **PREFER Stable Attributes**: Look for:
    *   IDs: \`#comments\`, \`#author-text\`
    *   Data Attributes: \`[data-testid="comment"]\`, \`[data-role="author"]\`
    *   ARIA Roles: \`[role="article"]\`, \`[aria-label="Comment"]\`
    *   Semantic Tags: \`article\`, \`time\`, \`h3\`
3.  **Replies & Nested Comments (\`replies\`)**:
    *   Inspect comment items carefully for nested sub-comments, reply threads/lists, or "View X replies" / "Show replies" / "More replies" / "展开回复" buttons.
    *   Whenever ANY reply structure or reply-expand trigger exists, populate \`replies\` with non-empty \`container.selector\`, \`item.selector\`, and a full \`fields\` array (even if reply items share the same markup/selectors as top-level comments).
    *   \`replies.container\` and \`replies.expandBtn\` are queried relative to a parent comment item; \`replies.item\` is queried relative to \`replies.container\`.
    *   If no collapsed-reply toggle button exists, omit \`expandBtn\` completely (do NOT emit empty selectors or \`null\`).
    *   Selector examples for \`expandBtn\`: \`.more-replies\`, \`#more-replies-sub-thread\`, \`button[aria-label*="replies"]\`.
4.  **Use Hierarchy**: If a stable class is not available, use structural paths relative to the parent.
    *   *Bad*: \`.div > .span > .text\`
    *   *Good*: \`article > header > a.author\`
5.  **Fields**:
    *   **username**: The author's name.
    *   **content**: The main text body of the comment.
    *   **timestamp**: The time element (often \`<time>\` or text like "2 hours ago").
    *   **likes**: The like/upvote count.

## Output Format
Return **ONLY** the JSON object. No markdown code blocks, no explanations.
`;

export const PROMPT_GENERATE_CRAWLING_META_CONFIG = `You are an expert Web Scraper Configuration Generator.
Your task is to analyze the provided HTML (which represents the entire page, potentially shallowly simplified) and extract selectors for the **Video/Post metadata** area. 
Do NOT look inside the comment section. 

## Target Interface
\`\`\`typescript
interface SelectorRule {
  selector: string;     // CSS selector (e.g., ".post-description", "#info-strings")
  type: "css";          // Always use "css"
}

interface MetaConfig {
  videoTime?: SelectorRule; // Optional: selector for post/video publication time
  postContent?: SelectorRule; // Optional: selector for post content or video description
}
\`\`\`

## Critical Rules for Selectors
1.  **AVOID Random/Hashed Classes**: Do NOT use classes that look like \`css-1a2b3c\`.
2.  **PREFER Stable Attributes**: Look for semantic tags or data attributes.
3.  **videoTime**: The publication time of the post/video (NOT comment time). Look for:
    *   YouTube: \`#info-strings yt-formatted-string\`, \`#date\`
    *   General: \`time[datetime]\`, \`.publish-date\`, \`.post-date\`, \`[itemprop="datePublished"]\`
4.  **postContent**: The original post content or video description. Look for:
    *   YouTube: \`#description\`, \`#description-inner\`, \`#description-inline-expander\`
    *   General: \`.post-content\`, \`.content\`, \`[itemprop="articleBody"]\`, \`.description\`

## Output Format
Return **ONLY** the JSON object matching MetaConfig. No markdown code blocks, no explanations.
`;
