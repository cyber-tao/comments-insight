import { AI } from '@/config/constants';
import type { Task, TaskProgress } from '@/types';

type TranslationParams = Record<string, string | number>;
type Translate = (key: string, options?: TranslationParams) => string;

interface FormatTaskProgressMessageOptions {
  type?: Task['type'];
  detailedProgress?: TaskProgress | null;
  message?: string | null;
  compact?: boolean;
  t: Translate;
}

const STAGE_KEYS: Record<string, string> = {
  initializing: 'popup.progressInitializing',
  detecting: 'popup.progressDetecting',
  analyzing: 'popup.progressAnalyzing',
  extracting: 'popup.progressExtracting',
  scrolling: 'popup.progressScrolling',
  expanding: 'popup.progressExpanding',
  validating: 'popup.progressValidating',
  complete: 'popup.progressComplete',
};

const getCompactAnalysisProgressKey = (stageMessageKey: string): string | undefined => {
  const messageKeys = AI.ANALYSIS_PROGRESS_MESSAGE_KEYS;
  const compactMessageKeys = AI.ANALYSIS_PROGRESS_COMPACT_MESSAGE_KEYS;
  const keyMap: Record<string, string> = {
    [messageKeys.WAITING]: compactMessageKeys.WAITING,
    [messageKeys.RECEIVING]: compactMessageKeys.RECEIVING,
    [messageKeys.RECEIVING_BATCH]: compactMessageKeys.RECEIVING_BATCH,
    [messageKeys.COMPLETE]: compactMessageKeys.COMPLETE,
    [messageKeys.COMPLETE_BATCH]: compactMessageKeys.COMPLETE_BATCH,
  };
  return keyMap[stageMessageKey];
};

export const getTaskStageLabel = (stage: string, t: Translate, type?: Task['type']): string => {
  if (type === 'analyze' && stage === 'analyzing') {
    return t('popup.analyzing');
  }
  return t(STAGE_KEYS[stage] || 'popup.extracting');
};

export const formatTaskProgressMessage = ({
  type,
  detailedProgress,
  message,
  compact = false,
  t,
}: FormatTaskProgressMessageOptions): string => {
  if (detailedProgress) {
    const { stage, current, total, stageMessage, stageMessageKey, stageMessageParams } =
      detailedProgress;
    const stageText = getTaskStageLabel(stage, t, type);

    if (stageMessageKey) {
      const translatedMessageKey =
        compact && type === 'analyze'
          ? (getCompactAnalysisProgressKey(stageMessageKey) ?? stageMessageKey)
          : stageMessageKey;
      const translatedMessage = t(translatedMessageKey, stageMessageParams);
      return compact ? translatedMessage : `${stageText}: ${translatedMessage}`;
    }

    if (stageMessage) {
      return compact ? stageText : `${stageText}: ${stageMessage}`;
    }

    return total > 0 && current >= 0
      ? compact
        ? stageText
        : `${stageText} ${current}/${total}`
      : stageText;
  }

  const parts = (message || '').split(':');
  if (parts.length >= 3) {
    const [stage, count, max] = parts;
    const stageText = getTaskStageLabel(stage, t, type);
    const countNum = parseInt(count, 10);
    return countNum >= 0 ? `${stageText} ${count}/${max}` : stageText;
  }

  if (type === 'config') {
    return t('popup.generatingConfig');
  }
  if (type === 'analyze') {
    return t('popup.analyzing');
  }
  return t('popup.extracting');
};
