import { Message, HistoryItem } from '@/types';
import { HandlerContext } from './types';
import { ExtensionError, ErrorCode } from '@/utils/errors';
import { PAGINATION } from '@/config/constants';

interface GetHistoryItemResponse {
  item: HistoryItem | null;
}

interface HistoryMetadataEntry {
  id: string;
  extractedAt: number;
  url: string;
  title: string;
  platform: string;
}

interface PaginatedHistoryMetadataResponse {
  entries: HistoryMetadataEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface DeleteHistoryResponse {
  success: boolean;
}

interface ClearHistoryResponse {
  success: boolean;
  count: number;
}

interface ExportSettingsResponse {
  data: unknown;
}

export async function handleGetHistory(
  message: Extract<Message, { type: 'GET_HISTORY' }>,
  context: HandlerContext,
): Promise<GetHistoryItemResponse | PaginatedHistoryMetadataResponse> {
  const payload = message.payload || {};
  const { id, query, page, pageSize } = payload;

  if (id) {
    const item = await context.historyStore.getHistoryItem(id);
    return { item: item || null };
  }

  const safePage = typeof page === 'number' && page >= 0 ? page : 0;
  const safePageSize =
    typeof pageSize === 'number' && pageSize > 0 ? pageSize : PAGINATION.DEFAULT_PER_PAGE;

  // Listing always returns metadata entries; full items are fetched by id.
  // The legacy metadataOnly flag (still accepted by the payload schema) no
  // longer selects a different path - loading full history rows for pages was
  // never used by any UI surface.
  if (query) {
    return await context.historyStore.searchHistoryMetadataPage(query, safePage, safePageSize);
  }
  return await context.historyStore.getHistoryMetadataPage(safePage, safePageSize);
}

export async function handleGetHistoryByUrl(
  message: Extract<Message, { type: 'GET_HISTORY_BY_URL' }>,
  context: HandlerContext,
): Promise<GetHistoryItemResponse> {
  const { url } = message.payload || {};

  if (!url) {
    throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'URL is required');
  }

  const id = await context.historyStore.getLatestHistoryIdByUrl(url);
  if (!id) {
    return { item: null };
  }
  const item = await context.historyStore.getHistoryItem(id);
  return { item: item || null };
}

export async function handleDeleteHistory(
  message: Extract<Message, { type: 'DELETE_HISTORY' }>,
  context: HandlerContext,
): Promise<DeleteHistoryResponse> {
  const { id } = message.payload || {};

  if (!id) {
    throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'History item ID is required');
  }

  await context.historyStore.deleteHistoryItem(id);
  return { success: true };
}

export async function handleClearAllHistory(
  _message: Extract<Message, { type: 'CLEAR_ALL_HISTORY' }>,
  context: HandlerContext,
): Promise<ClearHistoryResponse> {
  const count = await context.historyStore.clearAllHistory();
  return { success: true, count };
}

export async function handleExportData(
  message: Extract<Message, { type: 'EXPORT_DATA' }>,
  context: HandlerContext,
): Promise<ExportSettingsResponse> {
  const payload = message.payload;

  if ('type' in payload && payload.type === 'settings') {
    const data = await context.settingsStore.exportSettings();
    return { data };
  }

  throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'Invalid export type');
}
