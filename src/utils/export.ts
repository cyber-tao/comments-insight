/**
 * Export utilities for Comments Insight
 */
import { HistoryItem, Comment } from '../types';
import { REGEX, EXPORT_DEFAULTS, LIMITS } from '../config/constants';
import { t } from './i18n';
import { formatDateTimeFromTimestamp, formatCommentTimestamp } from './date-formatter';

const STATIC_REPORT_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "media-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
].join('; ');

const STATIC_REPORT_BLOCKED_ELEMENTS = new Set([
  'applet',
  'audio',
  'base',
  'embed',
  'form',
  'frame',
  'frameset',
  'iframe',
  'link',
  'object',
  'portal',
  'script',
  'source',
  'track',
  'video',
]);

const STATIC_REPORT_URL_ATTRIBUTES = new Set([
  'action',
  'background',
  'data',
  'formaction',
  'href',
  'imagesrcset',
  'ping',
  'poster',
  'src',
  'srcdoc',
  'srcset',
  'xlink:href',
]);

function removeExecutableHtml(root: ParentNode): void {
  for (const element of Array.from(root.querySelectorAll('*'))) {
    const tagName = element.localName.toLowerCase();
    const isRefreshMeta =
      tagName === 'meta' && element.getAttribute('http-equiv')?.trim().toLowerCase() === 'refresh';
    if (STATIC_REPORT_BLOCKED_ELEMENTS.has(tagName) || isRefreshMeta) {
      element.remove();
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const attributeName = attribute.name.toLowerCase();
      if (
        attributeName.startsWith('on') ||
        attributeName === 'target' ||
        STATIC_REPORT_URL_ATTRIBUTES.has(attributeName)
      ) {
        if (
          (tagName === 'a' && attributeName === 'href' && attribute.value.trim().startsWith('#')) ||
          (tagName === 'img' &&
            attributeName === 'src' &&
            /^(data|blob):/i.test(attribute.value.trim()))
        ) {
          continue;
        }
        element.removeAttribute(attribute.name);
      }
    }

    if (tagName === 'template') {
      removeExecutableHtml((element as HTMLTemplateElement).content);
    }
  }
}

function createStaticReportHtml(rawHtml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');
  removeExecutableHtml(doc);

  const cspMeta = doc.createElement('meta');
  cspMeta.setAttribute('http-equiv', 'Content-Security-Policy');
  cspMeta.setAttribute('content', `${STATIC_REPORT_CSP};`);
  doc.head.insertBefore(cspMeta, doc.head.firstChild);

  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

/**
 * Flatten comment tree to include all replies
 * @param comments - Comments to flatten
 * @param depth - Current depth level
 * @returns Flattened array of comments with depth information
 */
function flattenComments(
  comments: Comment[],
  depth: number = 0,
): Array<
  Comment & {
    depth: number;
    likes: number;
    timestamp: string;
    replies: Comment[];
    username: string;
    content: string;
  }
> {
  const result: Array<
    Comment & {
      depth: number;
      likes: number;
      timestamp: string;
      replies: Comment[];
      username: string;
      content: string;
    }
  > = [];

  for (const comment of comments) {
    const normalized: Comment & {
      depth: number;
      likes: number;
      timestamp: string;
      replies: Comment[];
      username: string;
      content: string;
    } = {
      ...comment,
      depth,
      likes: typeof comment.likes === 'number' ? comment.likes : 0,
      timestamp: comment.timestamp ?? '',
      replies: Array.isArray(comment.replies) ? comment.replies : [],
      username: comment.username ?? '',
      content: comment.content ?? '',
    };

    result.push(normalized);
    if (normalized.replies.length > 0) {
      result.push(...flattenComments(normalized.replies, depth + 1));
    }
  }

  return result;
}

/**
 * Sanitize filename by removing invalid characters
 * @param filename - Original filename
 * @returns Sanitized filename
 */
function sanitizeFilename(filename: string): string {
  return filename
    .replace(REGEX.FILENAME_INVALID, '-')
    .replace(REGEX.WHITESPACE, '_')
    .substring(0, EXPORT_DEFAULTS.FILENAME_MAX_LENGTH);
}

function escapeCsvText(value: string): string {
  const neutralized = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${neutralized.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '')}"`;
}

const formatDateTime = formatDateTimeFromTimestamp;

/**
 * Export comments as CSV
 * @param comments - Comments to export
 * @param title - Title for filename
 * @param filename - Output filename (optional)
 */
export function exportCommentsAsCSV(comments: Comment[], title?: string, filename?: string): void {
  // Flatten the comment tree to include all replies
  const flatComments = flattenComments(comments);

  const headers = [
    t('export.depth'),
    t('export.username'),
    t('export.timestamp'),
    t('export.likes'),
    t('export.content'),
    t('export.repliesCount'),
  ];
  const rows = flatComments.map((comment) => [
    comment.depth.toString(),
    escapeCsvText(comment.username),
    escapeCsvText(formatCommentTimestamp(comment.timestamp)),
    comment.likes.toString(),
    escapeCsvText(comment.content),
    comment.replies.length.toString(),
  ]);

  const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

  // Prepend BOM to ensure Excel correctly recognizes UTF-8 (avoids garbled characters)
  const csvWithBom = '\uFEFF' + csv;

  // Generate filename with title and timestamp
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .substring(0, LIMITS.EXPORT_ISO_TIMESTAMP_LENGTH);
  const defaultFilename = title
    ? `${sanitizeFilename(title)}_comments_${timestamp}.csv`
    : `comments_${timestamp}.csv`;

  downloadFile(csvWithBom, filename || defaultFilename, 'text/csv');
}

/**
 * Export analysis as Markdown
 * @param item - History item with analysis
 * @param filename - Output filename
 */
export function exportAnalysisAsMarkdown(
  item: HistoryItem,
  includePostContent: boolean = false,
  filename?: string,
): void {
  if (!item.analysis) {
    throw new Error(t('export.noAnalysisAvailable'));
  }

  const postContentSection =
    includePostContent && item.postContent
      ? `- **${t('export.postContent')}**: ${item.postContent}\n`
      : '';

  const markdown = `# ${t('export.reportTitle')}

## ${t('export.postInfo')}
- **${t('export.title')}**: ${item.title}
- **${t('export.platform')}**: ${item.platform}
- **${t('export.url')}**: ${item.url}
- **${t('export.extracted')}**: ${formatDateTime(item.extractedAt)}
- **${t('export.totalComments')}**: ${item.commentsCount}
${postContentSection}

## ${t('export.analysisResults')}

${item.analysis.markdown}

---

*${t('export.reportGeneratedBy')}*
*${t('export.analysisDate')}: ${formatDateTime(item.analysis.generatedAt)}*
*${t('export.tokensUsed')}: ${item.analysis.tokensUsed}*
`;

  // Generate filename with title and timestamp
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .substring(0, LIMITS.EXPORT_ISO_TIMESTAMP_LENGTH);
  const defaultFilename = `${sanitizeFilename(item.title)}_analysis_${timestamp}.md`;

  downloadFile(markdown, filename || defaultFilename, 'text/markdown');
}

/**
 * Export dynamic analysis as standalone HTML
 * @param item - History item with dynamicHtml
 * @param filename - Output filename
 */
export function exportAnalysisAsHTML(item: HistoryItem, filename?: string): void {
  if (!item.analysis?.dynamicHtml) {
    throw new Error(t('export.noDynamicHtmlAvailable'));
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .substring(0, LIMITS.EXPORT_ISO_TIMESTAMP_LENGTH);
  const defaultFilename = `${sanitizeFilename(item.title)}_dynamic_report_${timestamp}.html`;

  const staticHtml = createStaticReportHtml(item.analysis.dynamicHtml);
  downloadFile(staticHtml, filename || defaultFilename, 'text/html;charset=utf-8');
}

/**
 * Download file helper
 * @param content - File content
 * @param filename - Filename
 * @param mimeType - MIME type
 */
function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
