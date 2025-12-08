/**
 * Export utilities for Comments Insight
 */
import { HistoryItem, Comment } from '../types';
import { REGEX, DEFAULTS } from '../config/constants';
import { t } from './i18n';

/**
 * Flatten comment tree to include all replies
 * @param comments - Comments to flatten
 * @param depth - Current depth level
 * @returns Flattened array of comments with depth information
 */
function flattenComments(
  comments: Comment[],
  depth: number = 0,
): Array<Comment & { depth: number }> {
  const result: Array<Comment & { depth: number }> = [];

  for (const comment of comments) {
    result.push({ ...comment, depth });
    if (comment.replies && comment.replies.length > 0) {
      result.push(...flattenComments(comment.replies, depth + 1));
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
    .substring(0, DEFAULTS.FILENAME_MAX_LENGTH);
}

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
    `"${comment.username.replace(/"/g, '""')}"`,
    `"${comment.timestamp}"`,
    comment.likes.toString(),
    `"${comment.content.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '')}"`,
    comment.replies.length.toString(),
  ]);

  const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

  // Generate filename with title and timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const defaultFilename = title
    ? `${sanitizeFilename(title)}_comments_${timestamp}.csv`
    : `comments_${timestamp}.csv`;

  downloadFile(csv, filename || defaultFilename, 'text/csv');
}

/**
 * Export analysis as Markdown
 * @param item - History item with analysis
 * @param filename - Output filename
 */
export function exportAnalysisAsMarkdown(item: HistoryItem, filename?: string): void {
  if (!item.analysis) {
    throw new Error(t('export.noAnalysisAvailable'));
  }

  const markdown = `# ${t('export.reportTitle')}

## ${t('export.postInfo')}
- **${t('export.title')}**: ${item.title}
- **${t('export.platform')}**: ${item.platform}
- **${t('export.url')}**: ${item.url}
- **${t('export.extracted')}**: ${new Date(item.extractedAt).toLocaleString()}
- **${t('export.totalComments')}**: ${item.commentsCount}

## ${t('export.analysisResults')}

${item.analysis.markdown}

---

*${t('export.reportGeneratedBy')}*
*${t('export.analysisDate')}: ${new Date(item.analysis.generatedAt).toLocaleString()}*
*${t('export.tokensUsed')}: ${item.analysis.tokensUsed}*
`;

  // Generate filename with title and timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const defaultFilename = `${sanitizeFilename(item.title)}_analysis_${timestamp}.md`;

  downloadFile(markdown, filename || defaultFilename, 'text/markdown');
}

/**
 * Export complete data (comments + analysis) as JSON
 * @param item - History item
 * @param filename - Output filename
 */
export function exportCompleteData(item: HistoryItem, filename?: string): void {
  const data = {
    metadata: {
      title: item.title,
      platform: item.platform,
      url: item.url,
      extractedAt: item.extractedAt,
      analyzedAt: item.analyzedAt,
      commentsCount: item.commentsCount,
      exportDate: Date.now(),
    },
    comments: item.comments,
    analysis: item.analysis,
  };

  const json = JSON.stringify(data, null, 2);
  downloadFile(json, filename || `complete-data-${Date.now()}.json`, 'application/json');
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
