import { Message, HistoryItem } from '../../types';
import { HandlerContext } from './types';
import { ERRORS } from '@/config/constants';

interface GetHistoryListResponse {
  history: HistoryItem[];
}

interface GetHistoryItemResponse {
  item: HistoryItem | null;
}

interface SearchHistoryResponse {
  items: HistoryItem[];
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
): Promise<GetHistoryListResponse | GetHistoryItemResponse | SearchHistoryResponse> {
  const payload = message.payload || {};
  const { id, query } = payload;

  if (id) {
    const item = await context.storageManager.getHistoryItem(id);
    return { item: item || null };
  }

  if (query) {
    const items = await context.storageManager.searchHistory(query);
    return { items };
  }

  const history = await context.storageManager.getHistory();
  return { history };
}

export async function handleGetHistoryByUrl(
  message: Extract<Message, { type: 'GET_HISTORY_BY_URL' }>,
  context: HandlerContext,
): Promise<GetHistoryItemResponse> {
  const { url } = message.payload;

  if (!url) {
    throw new Error(ERRORS.URL_REQUIRED);
  }

  const history = await context.storageManager.getHistory();
  const item = history.find((h) => h.url === url) || null;

  return { item };
}

export async function handleDeleteHistory(
  message: Extract<Message, { type: 'DELETE_HISTORY' }>,
  context: HandlerContext,
): Promise<DeleteHistoryResponse> {
  const { id } = message.payload;

  if (!id) {
    throw new Error(ERRORS.HISTORY_ITEM_ID_REQUIRED);
  }

  await context.storageManager.deleteHistoryItem(id);
  return { success: true };
}

export async function handleClearAllHistory(
  _message: Extract<Message, { type: 'CLEAR_ALL_HISTORY' }>,
  context: HandlerContext,
): Promise<ClearHistoryResponse> {
  const history = await context.storageManager.getHistory();

  for (const item of history) {
    await context.storageManager.deleteHistoryItem(item.id);
  }

  return { success: true, count: history.length };
}

export async function handleExportData(
  message: Extract<Message, { type: 'EXPORT_DATA' }>,
  context: HandlerContext,
): Promise<ExportSettingsResponse> {
  const payload = message.payload;

  if ('type' in payload && payload.type === 'settings') {
    const data = await context.storageManager.exportSettings();
    return { data };
  }

  throw new Error(ERRORS.INVALID_EXPORT_TYPE);
}
