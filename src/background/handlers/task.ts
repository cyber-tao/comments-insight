import { Message } from '../../types';
import { HandlerContext, TaskStatusResponse, SuccessResponse } from './types';

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
    throw new Error('Task ID is required');
  }

  context.taskManager.cancelTask(taskId);
  return { success: true };
}
