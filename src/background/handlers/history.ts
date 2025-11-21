import { Message } from '../../types';
import { HandlerContext } from './types';

export async function handleGetHistory(
  message: Extract<Message, { type: 'GET_HISTORY' }>,
  context: HandlerContext,
): Promise<any> {
  // message.payload structure: { page: number; limit: number; query?: string }
  // But MessageRouter logic was: const { id, query } = message.payload || {};
  // My new type definition is: { page: number; limit: number; query?: string }
  // This is a mismatch.
  // I need to check what Popup/History actually sends.
  // MessageRouter had:
  // if (id) return getHistoryItem(id)
  // if (query) return searchHistory(query)
  // else getHistory() (all)
  
  // My new type definition enforces pagination.
  // If I want to support 'get by id', I should have a separate message or union type payload.
  // Or I used 'GET_HISTORY' for multiple things (bad practice).
  
  // Actually, I didn't define a separate `GET_HISTORY_ITEM` message.
  // I'll assume `GET_HISTORY` is for LISTING.
  // If consumers need an item by ID, they probably use `GET_HISTORY` with query? No.
  // The original code supported `id` in payload.
  // My new type `GET_HISTORY` payload is `{ page: number; limit: number; query?: string }`.
  // It MISSES `id`.
  
  // I should check if `id` is actually used. `MessageRouter` says yes.
  // "const { id, query } = message.payload || {};"
  
  // I will implement it assuming the type definition is what I WANT (pagination), 
  // but I need to fix the type definition to include `id` if I want to support getting a single item.
  // OR I create a new message `GET_HISTORY_ITEM`.
  // Given I am refactoring types, I should clarify this.
  // But to minimize breakage, I should probably allow `id` in `GET_HISTORY`.
  
  // Let's fix `src/types/index.ts` AGAIN for `GET_HISTORY`.
  // Payload: `{ page?: number; limit?: number; query?: string; id?: string }`
  // Make everything optional to support the different modes.
  
  // I'll proceed with writing this file assuming I WILL fix the type.
  
  const payload = message.payload || {}; // Cast to any for now to support existing logic while type catches up
  const { id, query } = payload as any;

  if (id) {
    const item = await context.storageManager.getHistoryItem(id);
    return { item };
  }

  if (query) {
    const items = await context.storageManager.searchHistory(query);
    return { items };
  }

  // Fallback to getting all history (pagination not implemented in StorageManager yet?)
  const history = await context.storageManager.getHistory();
  return { history };
}

export async function handleGetHistoryByUrl(
  message: Extract<Message, { type: 'GET_HISTORY_BY_URL' }>,
  context: HandlerContext,
): Promise<any> {
  const { url } = message.payload;

  if (!url) {
    throw new Error('URL is required');
  }

  const history = await context.storageManager.getHistory();
  const item = history.find((h) => h.url === url);

  return { item: item || null };
}

export async function handleDeleteHistory(
  message: Extract<Message, { type: 'DELETE_HISTORY' }>,
  context: HandlerContext,
): Promise<any> {
  const { id } = message.payload;

  if (!id) {
    throw new Error('History item ID is required');
  }

  await context.storageManager.deleteHistoryItem(id);
  return { success: true };
}

export async function handleClearAllHistory(
  _message: Extract<Message, { type: 'CLEAR_ALL_HISTORY' }>,
  context: HandlerContext,
): Promise<any> {
  const history = await context.storageManager.getHistory();

  // Delete all history items
  for (const item of history) {
    await context.storageManager.deleteHistoryItem(item.id);
  }

  return { success: true, count: history.length };
}

export async function handleExportData(
  message: Extract<Message, { type: 'EXPORT_DATA' }>,
  context: HandlerContext,
): Promise<any> {
  // MessageRouter logic: const { type } = message.payload || {};
  // But my new type is: payload: { format: 'csv' | 'md' | 'json'; taskId: string }
  // This is a mismatch.
  // Original logic: `if (type === 'settings') exportSettings()`.
  // It seems EXPORT_DATA was used for SETTINGS export?
  // "if (type === 'settings') ..."
  // What about exporting comments?
  // `src/utils/export.ts` likely handles client-side export.
  // But `MessageRouter` has `handleExportData`.
  
  // If the ONLY usage in MessageRouter is for settings, then my type definition `format: 'csv' ...` is WRONG for this message handler.
  // Or the `EXPORT_DATA` message is overloaded.
  
  // I'll support the existing `settings` export logic.
  const payload = message.payload as any;
  
  if (payload.type === 'settings') {
    const data = await context.storageManager.exportSettings();
    return { data };
  }

  // If it's my new type usage (taskId), maybe implementation is missing in router?
  // Router only threw "Invalid export type" if not settings.
  
  throw new Error('Invalid export type');
}
