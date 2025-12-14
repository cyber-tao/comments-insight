import { Message } from '../../types';
import { HandlerContext, TaskStatusResponse, SuccessResponse } from './types';
import i18n from '../../utils/i18n';
import { MESSAGES } from '@/config/constants';

export function handleGetTaskStatus(
  message: Extract<Message, { type: 'GET_TASK_STATUS' }>,
  context: HandlerContext,
): TaskStatusResponse {
  const { taskId } = message.payload || {};

  if (taskId) {
    const task = context.taskManager.getTask(taskId);
    return { task };
  }

  const tasks = context.taskManager.getAllTasks();
  return { tasks };
}

export function handleCancelTask(
  message: Extract<Message, { type: 'CANCEL_TASK' }>,
  context: HandlerContext,
): SuccessResponse {
  const { taskId } = message.payload;

  if (!taskId) {
    throw new Error(i18n.t('errors.taskIdRequired'));
  }

  const task = context.taskManager.getTask(taskId);

  if (task?.type === 'extract') {
    const tabId = task.tabId;
    if (typeof tabId === 'number') {
      chrome.tabs
        .sendMessage(tabId, {
          type: MESSAGES.CANCEL_EXTRACTION,
          payload: { taskId },
        })
        .catch(() => {
          return;
        });
    }
  }

  context.taskManager.cancelTask(taskId);
  return { success: true };
}
