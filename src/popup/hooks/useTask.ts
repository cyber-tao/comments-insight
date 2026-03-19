import { useState, useRef, useCallback, useEffect } from 'react';
import { TIMING } from '@/config/constants';
import { Comment, Task, TaskProgress } from '@/types';
import { Logger } from '@/utils/logger';
import { ExtensionAPI } from '@/utils/extension-api';

export interface CurrentTask {
  id: string;
  type: 'extract' | 'analyze' | 'config';
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  message?: string;
  detailedProgress?: TaskProgress;
}

interface UseTaskOptions {
  onTaskComplete?: (task: CurrentTask) => void;
  onStatusRefresh?: () => Promise<void>;
}

export function useTask(options: UseTaskOptions = {}) {
  const { onTaskComplete, onStatusRefresh } = options;
  const [currentTask, setCurrentTask] = useState<CurrentTask | null>(null);
  const monitorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monitorGenerationRef = useRef(0);
  const isUnmountedRef = useRef(false);
  const isStartingRef = useRef(false);
  const hasActiveTask = (task: CurrentTask | null): boolean =>
    task !== null && (task.status === 'running' || task.status === 'pending');

  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      if (monitorTimeoutRef.current) {
        clearTimeout(monitorTimeoutRef.current);
        monitorTimeoutRef.current = null;
      }
    };
  }, []);

  const monitorTask = useCallback(
    async (taskId: string) => {
      monitorGenerationRef.current += 1;
      const currentGeneration = monitorGenerationRef.current;

      if (monitorTimeoutRef.current) {
        clearTimeout(monitorTimeoutRef.current);
        monitorTimeoutRef.current = null;
      }

      const checkStatus = async () => {
        if (isUnmountedRef.current || monitorGenerationRef.current !== currentGeneration) return;

        try {
          const task = await ExtensionAPI.getTaskStatus(taskId);

          if (isUnmountedRef.current || monitorGenerationRef.current !== currentGeneration) return;

          if (!task) {
            Logger.warn('[useTask] Task status returned empty result', { taskId });
            setCurrentTask(null);
            return;
          }

          const updatedTask: CurrentTask = {
            id: task.id,
            type: task.type,
            status: task.status,
            progress: task.progress,
            message: task.message || task.error,
            detailedProgress: task.detailedProgress,
          };
          setCurrentTask(updatedTask);

          if (task.status === 'running' || task.status === 'pending') {
            monitorTimeoutRef.current = setTimeout(checkStatus, TIMING.POLL_TASK_RUNNING_MS);
          } else if (task.status === 'completed') {
            await onStatusRefresh?.();
            onTaskComplete?.(updatedTask);
            monitorTimeoutRef.current = setTimeout(() => {
              if (!isUnmountedRef.current) {
                setCurrentTask(null);
              }
            }, TIMING.CLEAR_TASK_DELAY_MS);
          } else if (task.status === 'failed') {
            monitorTimeoutRef.current = setTimeout(() => {
              if (!isUnmountedRef.current) {
                setCurrentTask(null);
              }
            }, TIMING.CLEAR_TASK_FAILED_MS);
          }
        } catch (error) {
          Logger.error('[useTask] Failed to check task status', { error });
        }
      };

      void checkStatus();
    },
    [onStatusRefresh, onTaskComplete],
  );

  const loadCurrentTask = useCallback(
    async (tabUrl: string) => {
      try {
        const tasks = await ExtensionAPI.getTasks();
        const currentUrlTask = tasks.find(
          (task: Task) =>
            task.url === tabUrl && (task.status === 'running' || task.status === 'pending'),
        );

        if (currentUrlTask) {
          Logger.debug('[useTask] Found current task', { task: currentUrlTask });
          setCurrentTask({
            id: currentUrlTask.id,
            type: currentUrlTask.type,
            status: currentUrlTask.status,
            progress: currentUrlTask.progress,
            message: currentUrlTask.message || currentUrlTask.error,
            detailedProgress: currentUrlTask.detailedProgress,
          });

          if (currentUrlTask.status === 'running' || currentUrlTask.status === 'pending') {
            monitorTask(currentUrlTask.id);
          }
        }
      } catch (error) {
        Logger.error('[useTask] Failed to load current task', { error });
      }
    },
    [monitorTask],
  );

  const ensureContentScript = useCallback(async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) {
      throw new Error('No active tab');
    }

    await ExtensionAPI.ensureContentScript(tabId);
  }, []);

  const startExtraction = async (url: string): Promise<string | null> => {
    if (isStartingRef.current || hasActiveTask(currentTask)) {
      return null;
    }

    isStartingRef.current = true;
    try {
      await ensureContentScript();
    } catch (_error) {
      Logger.error('[useTask] Failed to inject content script');
      isStartingRef.current = false;
      return null;
    }

    try {
      const response = await ExtensionAPI.startExtraction(url);

      if (response?.taskId) {
        setCurrentTask({
          id: response.taskId,
          type: 'extract',
          status: 'pending',
          progress: 0,
        });
        monitorTask(response.taskId);
        return response.taskId;
      }
      return null;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error);
      Logger.error('[useTask] Failed to start extraction', { error: message });
      setCurrentTask(null);
      return null;
    } finally {
      isStartingRef.current = false;
    }
  };

  const startConfigGeneration = async (url: string): Promise<string | null> => {
    if (isStartingRef.current || hasActiveTask(currentTask)) {
      return null;
    }

    isStartingRef.current = true;
    try {
      await ensureContentScript();
    } catch (_error) {
      Logger.error('[useTask] Failed to inject content script');
      isStartingRef.current = false;
      return null;
    }

    try {
      const response = await ExtensionAPI.startConfigGeneration(url);

      if (response?.taskId) {
        setCurrentTask({
          id: response.taskId,
          type: 'config',
          status: 'pending',
          progress: 0,
        });
        monitorTask(response.taskId);
        return response.taskId;
      }
      return null;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error);
      Logger.error('[useTask] Failed to start config generation', { error: message });
      setCurrentTask(null);
      return null;
    } finally {
      isStartingRef.current = false;
    }
  };

  const startAnalysis = async (
    historyId: string,
    comments: Comment[],
    metadata: { url?: string; platform?: string; title?: string },
  ): Promise<string | null> => {
    if (isStartingRef.current || hasActiveTask(currentTask)) {
      return null;
    }

    isStartingRef.current = true;

    try {
      const response = await ExtensionAPI.startAnalysis({ comments, historyId, metadata });

      if (response?.taskId) {
        setCurrentTask({
          id: response.taskId,
          type: 'analyze',
          status: 'pending',
          progress: 0,
        });
        monitorTask(response.taskId);
        return response.taskId;
      }
      return null;
    } catch (error) {
      Logger.error('[useTask] Failed to start analysis', { error });
      setCurrentTask(null);
      return null;
    } finally {
      isStartingRef.current = false;
    }
  };

  const cancelTask = async (taskId: string) => {
    try {
      await ExtensionAPI.cancelTask(taskId);
    } catch (error) {
      Logger.error('[useTask] Failed to cancel task', { error });
    }
  };

  return {
    currentTask,
    loadCurrentTask,
    startExtraction,
    startConfigGeneration,
    startAnalysis,
    cancelTask,
  };
}
