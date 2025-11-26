import { SelectorMap } from '../../types';
import { querySelectorAllDeep } from '@/utils/dom-query';

export interface SelectorTestResult {
  [key: string]: number;
}

export interface CategorizedSelectors {
  successful: Partial<SelectorMap>;
  failed: string[];
}

export class SelectorValidator {
  private static readonly REQUIRED_FIELDS = [
    'commentContainer',
    'commentItem',
    'username',
    'content',
    'timestamp',
    'likes',
  ];

  testSelectors(selectors: Partial<SelectorMap>): SelectorTestResult {
    const results: SelectorTestResult = {};

    for (const [key, selector] of Object.entries(selectors)) {
      if (selector) {
        try {
          const elements = querySelectorAllDeep(document, selector);
          results[key] = elements.length;
        } catch {
          results[key] = -1;
        }
      }
    }

    return results;
  }

  validateSelectorResults(testResult: SelectorTestResult): boolean {
    if (!testResult.commentItem || testResult.commentItem === 0) {
      return false;
    }

    if (!testResult.username || testResult.username === 0) {
      return false;
    }

    if (!testResult.content || testResult.content === 0) {
      return false;
    }

    return true;
  }

  buildValidationError(testResult: SelectorTestResult): string {
    const errors: string[] = [];

    if (!testResult.commentItem || testResult.commentItem === 0) {
      errors.push('commentItem selector found 0 elements');
    }

    if (!testResult.username || testResult.username === 0) {
      errors.push('username selector found 0 elements');
    }

    if (!testResult.content || testResult.content === 0) {
      errors.push('content selector found 0 elements');
    }

    if (testResult.timestamp === 0) {
      errors.push('timestamp selector found 0 elements (optional but recommended)');
    }

    return errors.join('; ');
  }

  categorizeSelectors(
    selectors: Partial<SelectorMap>,
    testResults: SelectorTestResult,
  ): CategorizedSelectors {
    const successful: Partial<SelectorMap> = {};
    const failed: string[] = [];

    for (const [key, selector] of Object.entries(selectors)) {
      if (!selector) continue;

      const count = testResults[key] || 0;

      if (SelectorValidator.REQUIRED_FIELDS.includes(key)) {
        if (count > 0) {
          successful[key as keyof SelectorMap] = selector;
        } else {
          failed.push(key);
        }
      } else {
        successful[key as keyof SelectorMap] = selector;
      }
    }

    return { successful, failed };
  }

  getMissingFields(selectors: Partial<SelectorMap>): string[] {
    const missing: string[] = [];

    for (const field of SelectorValidator.REQUIRED_FIELDS) {
      if (!selectors[field as keyof SelectorMap]) {
        missing.push(field);
      }
    }

    return missing;
  }
}

export const selectorValidator = new SelectorValidator();


