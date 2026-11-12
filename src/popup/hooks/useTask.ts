import { useState, useRef, useCallback, useEffect } from 'react';
import { ERROR_KEYS, LANGUAGES, RETRY, TIMING } from '@/config/constants';
import { Comment, Task, TaskProgress } from '@/types';
import { Logger } from '@/utils/logger';
import { ExtensionAPI } from '@/utils/extension-api';
import i18n from '@/utils/i18n';

export interface CurrentTask {
  id: string;
  type: Task['type'];
  status: Task['status'] | 'unavailable';
  progress: number;
  message?: string;
  detailedProgress?: TaskProgress;
}

interface UseTaskOptions {
  onTaskComplete?: (task: CurrentTask) => void;
  onStatusRefresh?: () => Promise<void>;
}

const hasActiveTask = (task: Pick<CurrentTask, 'status'> | null): boolean =>
  task?.status === 'running' || task?.status === 'pending';

function toCurrentTask(task: Task): CurrentTask {
  return {
    id: task.id,
    type: task.type,
    status: task.status,
    progress: task.progress,
    message: task.status === 'failed' ? task.error || task.message : task.message || task.error,
    detailedProgress: task.detailedProgress,
  };
}

function isCancelledTask(task: Task): boolean {
  return (
    task.status === 'failed' &&
    (task.cancelledByUser === true ||
      task.error === ERROR_KEYS.TASK_CANCELLED_BY_USER ||
      LANGUAGES.SUPPORTED.some(
        ({ code }) => task.error === i18n.t(ERROR_KEYS.TASK_CANCELLED_BY_USER, { lng: code }),
      ))
  );
}

export function useTask(options: UseTaskOptions = {}) {
  const { onTaskComplete, onStatusRefresh } = options;
  const [currentTask, setCurrentTask] = useState<CurrentTask | null>(null);
  const monitorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monitorGenerationRef = useRef(0);
  const isUnmountedRef = useRef(false);
  const isStartingRef = useRef(false);

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
    (taskId: string, type: Task['type']) => {
      monitorGenerationRef.current += 1;
      const currentGeneration = monitorGenerationRef.current;
      const isCurrentMonitor = () =>
        !isUnmountedRef.current && monitorGenerationRef.current === currentGeneration;

      if (monitorTimeoutRef.current) {
        clearTimeout(monitorTimeoutRef.current);
        monitorTimeoutRef.current = null;
      }

      const clearTaskAfter = (delay: number) => {
        monitorTimeoutRef.current = setTimeout(() => {
          if (isCurrentMonitor()) setCurrentTask(null);
        }, delay);
      };

      let consecutiveErrors = 0;
      const checkStatus = async () => {
        if (!isCurrentMonitor()) return;

        try {
          const task = await ExtensionAPI.getTaskStatus(taskId);

          if (!isCurrentMonitor()) return;
          consecutiveErrors = 0;

          if (!task) {
            Logger.warn('[useTask] Task status returned empty result', { taskId });
            setCurrentTask((current) =>
              current?.id === taskId && type === 'analyze'
                ? { ...current, status: 'unavailable', message: i18n.t('errors.taskNotFound') }
                : null,
            );
            return;
          }

          if (isCancelledTask(task)) {
            setCurrentTask(null);
            return;
          }

          const updatedTask = toCurrentTask(task);
          setCurrentTask(updatedTask);

          if (hasActiveTask(task)) {
            monitorTimeoutRef.current = setTimeout(checkStatus, TIMING.POLL_TASK_RUNNING_MS);
          } else if (task.status === 'completed') {
            await onStatusRefresh?.();
            if (!isCurrentMonitor()) return;
            onTaskComplete?.(updatedTask);
            clearTaskAfter(TIMING.CLEAR_TASK_DELAY_MS);
          }
        } catch (error) {
          if (!isCurrentMonitor()) return;
          Logger.error('[useTask] Failed to check task status', { error });
          consecutiveErrors += 1;
          if (consecutiveErrors < RETRY.MAX_ATTEMPTS) {
            monitorTimeoutRef.current = setTimeout(
              checkStatus,
              TIMING.POLL_TASK_RUNNING_MS * consecutiveErrors,
            );
            return;
          }

          const message = error instanceof Error ? error.message : String(error);
          setCurrentTask((current) =>
            current?.id === taskId
              ? { ...current, status: type === 'analyze' ? 'unavailable' : 'failed', message }
              : current,
          );
        }
      };

      void checkStatus();
    },
    [onStatusRefresh, onTaskComplete],
  );

  const loadCurrentTask = useCallback(
    async (tabUrl: string, tabId?: number) => {
      const generation = monitorGenerationRef.current;
      try {
        const tasks = await ExtensionAPI.getTasks();
        if (
          isUnmountedRef.current ||
          isStartingRef.current ||
          monitorGenerationRef.current !== generation
        ) {
          return;
        }
        const matchingTasks = tasks.filter(
          (task: Task) =>
            task.url === tabUrl &&
            (typeof tabId !== 'number' || typeof task.tabId !== 'number' || task.tabId === tabId),
        );
        const activeTask = matchingTasks.find(hasActiveTask);

        if (activeTask) {
          Logger.debug('[useTask] Found current task', { task: activeTask });
          setCurrentTask(toCurrentTask(activeTask));
          monitorTask(activeTask.id, activeTask.type);
          return;
        }

        let latestAnalysis: Task | undefined;
        for (const task of matchingTasks) {
          if (
            task.type === 'analyze' &&
            (!latestAnalysis || task.startTime >= latestAnalysis.startTime)
          ) {
            latestAnalysis = task;
          }
        }
        setCurrentTask(
          latestAnalysis?.status === 'failed' && !isCancelledTask(latestAnalysis)
            ? toCurrentTask(latestAnalysis)
            : null,
        );
      } catch (error) {
        Logger.error('[useTask] Failed to load current task', { error });
      }
    },
    [monitorTask],
  );

  const getActiveTabId = useCallback(async (): Promise<number | undefined> => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs[0]?.id;
    } catch {
      return undefined;
    }
  }, []);

  const ensureContentScript = useCallback(
    async (tabId?: number) => {
      const targetTabId = tabId ?? (await getActiveTabId());
      if (!targetTabId) {
        throw new Error('No active tab');
      }

      await ExtensionAPI.ensureContentScript(targetTabId);
      return targetTabId;
    },
    [getActiveTabId],
  );

  const startExtraction = async (url: string, tabId?: number): Promise<string | null> => {
    if (isStartingRef.current || hasActiveTask(currentTask)) {
      return null;
    }

    isStartingRef.current = true;
    let targetTabId = tabId;
    try {
      targetTabId = await ensureContentScript(tabId);
    } catch (error) {
      Logger.error('[useTask] Failed to inject content script');
      isStartingRef.current = false;
      throw error;
    }

    try {
      const response = await ExtensionAPI.startExtraction(url, targetTabId);

      if (response?.taskId) {
        setCurrentTask({
          id: response.taskId,
          type: 'extract',
          status: 'pending',
          progress: 0,
        });
        monitorTask(response.taskId, 'extract');
        return response.taskId;
      }
      throw new Error(i18n.t('errors.unknownError'));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error);
      Logger.error('[useTask] Failed to start extraction', { error: message });
      setCurrentTask(null);
      throw error;
    } finally {
      isStartingRef.current = false;
    }
  };

  const startConfigGeneration = async (url: string, tabId?: number): Promise<string | null> => {
    if (isStartingRef.current || hasActiveTask(currentTask)) {
      return null;
    }

    isStartingRef.current = true;
    let targetTabId = tabId;
    try {
      targetTabId = await ensureContentScript(tabId);
    } catch (error) {
      Logger.error('[useTask] Failed to inject content script');
      isStartingRef.current = false;
      throw error;
    }

    try {
      const response = await ExtensionAPI.startConfigGeneration(url, targetTabId);

      if (response?.taskId) {
        setCurrentTask({
          id: response.taskId,
          type: 'config',
          status: 'pending',
          progress: 0,
        });
        monitorTask(response.taskId, 'config');
        return response.taskId;
      }
      throw new Error(i18n.t('errors.unknownError'));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error);
      Logger.error('[useTask] Failed to start config generation', { error: message });
      setCurrentTask(null);
      throw error;
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
        monitorTask(response.taskId, 'analyze');
        return response.taskId;
      }
      return null;
    } catch (error) {
      Logger.error('[useTask] Failed to start analysis', { error });
      setCurrentTask(null);
      // Bubble up so the UI can surface why the analysis never started.
      throw error;
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
