import { Message } from '../../types';
import { HandlerContext } from './types';

export function handleGetTaskStatus(
  message: Extract<Message, { type: 'GET_TASK_STATUS' }>,
  context: HandlerContext,
): any {
  const { taskId } = message.payload || {};

  if (taskId) {
    const task = context.taskManager.getTask(taskId);
    return { task };
  }

  // Return all tasks if no specific ID
  // But type definition says taskId is REQUIRED.
  // Original code: const { taskId } = message.payload || {};
  // If taskId is missing, it returns all tasks.
  // My type definition enforces taskId.
  // I should make taskId optional in type if I want to support "get all tasks".
  // For now, if taskId is present, return task. If not (and forced by type?), this code is unreachable strictly speaking but safe.
  
  // Wait, if I enforce taskId in type, I can't get all tasks?
  // I should fix the type to optional taskId.
  
  const tasks = context.taskManager.getAllTasks();
  return { tasks };
}

export function handleCancelTask(
  message: Extract<Message, { type: 'CANCEL_TASK' }>,
  context: HandlerContext,
): any {
  const { taskId } = message.payload;

  if (!taskId) {
    throw new Error('Task ID is required');
  }

  context.taskManager.cancelTask(taskId);
  return { success: true };
}
