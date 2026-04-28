import { afterEach, describe, expect, it } from 'vitest';
import { isExtractionActive, setExtractionActive } from '../src/content/extractionState';

describe('extractionState', () => {
  afterEach(() => {
    setExtractionActive(false);
  });

  it('should keep the current task active when a stale task is cleared', () => {
    setExtractionActive(true, 'task_current');

    setExtractionActive(false, 'task_stale');

    expect(isExtractionActive()).toBe(true);
    expect(isExtractionActive('task_current')).toBe(true);
    expect(isExtractionActive('task_stale')).toBe(false);
  });
});
