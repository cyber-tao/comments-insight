import { useState, useCallback, useMemo } from 'react';
import { STORAGE, LOG_PREFIX } from '@/config/constants';
import { Logger, LogLevel } from '@/utils/logger';
import { sanitizeAiLogEntry, sanitizeStringIndex } from '@/utils/storage-validation';

export interface AILog {
  type: 'extraction' | 'analysis';
  timestamp: number;
  prompt: string;
  response: string;
}

export interface SystemLog {
  level: LogLevel;
  timestamp: number;
  message: string;
  context?: string;
  data?: Record<string, unknown>;
  stack?: string;
}

export type LogEntry =
  | (AILog & { key: string; logType: 'ai' })
  | (SystemLog & { key: string; logType: 'system' });

export type AiLogEntry = AILog & { key: string; logType: 'ai' };
export type SystemLogEntry = SystemLog & { key: string; logType: 'system' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeSystemLogLevel(level: unknown): SystemLog['level'] | null {
  if (level === 'DEBUG' || level === 'INFO' || level === 'WARN' || level === 'ERROR') {
    return level as SystemLog['level'];
  }
  return null;
}

function isSystemLog(value: unknown): value is SystemLog {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.timestamp === 'number' &&
    typeof value.message === 'string' &&
    normalizeSystemLogLevel(value.level) !== null
  );
}

export function useLogs() {
  const [aiLogs, setAiLogs] = useState<AiLogEntry[]>([]);
  const [systemLogs, setSystemLogs] = useState<SystemLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<'all' | LogLevel>('all');

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const indexResult = await chrome.storage.local.get([
        STORAGE.AI_LOG_INDEX_KEY,
        STORAGE.SYSTEM_LOG_INDEX_KEY,
      ]);
      const aiLogKeys = sanitizeStringIndex(indexResult[STORAGE.AI_LOG_INDEX_KEY]);
      const systemLogKeys = sanitizeStringIndex(indexResult[STORAGE.SYSTEM_LOG_INDEX_KEY]);
      const allKeys = [...aiLogKeys, ...systemLogKeys];

      // To avoid out-of-memory on huge logs, we might want chunking.
      // But for now, get all keys. If we hit limits, we can chunk chrome.storage.local.get
      // Chrome extension storage limit for .get is quite high for local.
      const storage = allKeys.length > 0 ? await chrome.storage.local.get(allKeys) : {};

      const loadedAiLogs = Object.entries(storage)
        .filter(([key]) => key.startsWith(LOG_PREFIX.AI))
        .map(([key, value]) => {
          const aiLog = sanitizeAiLogEntry(value);
          if (!aiLog) return null;
          return { key, ...aiLog, logType: 'ai' as const };
        })
        .filter((log): log is AiLogEntry => log !== null)
        .sort((a, b) => b.timestamp - a.timestamp);

      const loadedSystemLogs = Object.entries(storage)
        .filter(([key]) => key.startsWith(LOG_PREFIX.SYSTEM))
        .map(([key, value]) => {
          if (!isSystemLog(value)) return null;
          return { key, ...(value as SystemLog), logType: 'system' as const };
        })
        .filter((log): log is SystemLogEntry => log !== null)
        .sort((a, b) => b.timestamp - a.timestamp);

      setAiLogs(loadedAiLogs);
      setSystemLogs(loadedSystemLogs);
    } catch (error) {
      Logger.error('[Logs] Failed to load logs', { error });
    } finally {
      setLoading(false);
    }
  }, []);

  const clearAllLogs = useCallback(async () => {
    try {
      const allKeys = [...aiLogs.map((l) => l.key), ...systemLogs.map((l) => l.key)];
      await chrome.storage.local.remove([
        ...allKeys,
        STORAGE.AI_LOG_INDEX_KEY,
        STORAGE.SYSTEM_LOG_INDEX_KEY,
      ]);
      setAiLogs([]);
      setSystemLogs([]);
    } catch (error) {
      Logger.error('[Logs] Failed to clear logs', { error });
      throw error;
    }
  }, [aiLogs, systemLogs]);

  const deleteLog = useCallback(async (key: string, logType: 'ai' | 'system') => {
    try {
      await chrome.storage.local.remove(key);
      const indexKey = logType === 'ai' ? STORAGE.AI_LOG_INDEX_KEY : STORAGE.SYSTEM_LOG_INDEX_KEY;

      const result = await chrome.storage.local.get(indexKey);
      const index = sanitizeStringIndex(result[indexKey]);
      const next = index.filter((k) => k !== key);
      await chrome.storage.local.set({ [indexKey]: next });

      if (logType === 'ai') {
        setAiLogs((prev) => prev.filter((l) => l.key !== key));
      } else {
        setSystemLogs((prev) => prev.filter((l) => l.key !== key));
      }
    } catch (error) {
      Logger.error('[Logs] Failed to delete log', { error });
      throw error;
    }
  }, []);

  const filteredAiLogs = useMemo(() => {
    if (!searchQuery) return aiLogs;
    const lowerQuery = searchQuery.toLowerCase();
    return aiLogs.filter(
      (log) =>
        log.prompt?.toLowerCase().includes(lowerQuery) ||
        log.response?.toLowerCase().includes(lowerQuery),
    );
  }, [aiLogs, searchQuery]);

  const filteredSystemLogs = useMemo(() => {
    return systemLogs.filter((log) => {
      if (levelFilter !== 'all' && log.level !== levelFilter) return false;
      if (searchQuery) {
        const lowerQuery = searchQuery.toLowerCase();
        return (
          log.message?.toLowerCase().includes(lowerQuery) ||
          JSON.stringify(log.data || {})
            .toLowerCase()
            .includes(lowerQuery)
        );
      }
      return true;
    });
  }, [systemLogs, levelFilter, searchQuery]);

  const systemStats = useMemo(() => {
    let errors = 0,
      debugs = 0,
      infos = 0,
      warns = 0;
    systemLogs.forEach((l) => {
      if (l.level === 'ERROR') errors++;
      else if (l.level === 'DEBUG') debugs++;
      else if (l.level === 'INFO') infos++;
      else if (l.level === 'WARN') warns++;
    });
    return { total: systemLogs.length, errors, debugs, infos, warns };
  }, [systemLogs]);

  return {
    loading,
    aiLogs: filteredAiLogs,
    systemLogs: filteredSystemLogs,
    systemStats,
    searchQuery,
    setSearchQuery,
    levelFilter,
    setLevelFilter,
    loadLogs,
    clearAllLogs,
    deleteLog,
  };
}
