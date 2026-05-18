import { afterEach, describe, expect, it, vi } from 'vitest';
import { isExtractionActive, setExtractionActive } from '../src/content/extractionState';
import { TIMEOUT } from '../src/config/constants';

const SAFETY_TIMEOUT_MS = TIMEOUT.MAX_AI_SECONDS * TIMEOUT.MS_PER_SEC;

describe('extractionState', () => {
  afterEach(() => {
    setExtractionActive(false);
    vi.useRealTimers();
  });

  it('should keep the current task active when a stale task is cleared', () => {
    setExtractionActive(true, 'task_current');

    setExtractionActive(false, 'task_stale');

    expect(isExtractionActive()).toBe(true);
    expect(isExtractionActive('task_current')).toBe(true);
    expect(isExtractionActive('task_stale')).toBe(false);
  });

  it('should refresh the safety timer when a new task becomes active', () => {
    vi.useFakeTimers();

    setExtractionActive(true, 'task_one');
    vi.advanceTimersByTime(SAFETY_TIMEOUT_MS - TIMEOUT.MS_PER_SEC);

    setExtractionActive(true, 'task_two');
    vi.advanceTimersByTime(TIMEOUT.MS_PER_SEC);

    expect(isExtractionActive('task_two')).toBe(true);
    expect(isExtractionActive('task_one')).toBe(false);

    vi.advanceTimersByTime(SAFETY_TIMEOUT_MS);

    expect(isExtractionActive()).toBe(false);
  });
});
