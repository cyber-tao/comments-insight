// Bound untrusted messages before schema validation can accumulate an issue for
// every invalid collection element. Persisted data readers remain unchanged.
export const VALIDATION_BUDGET = {
  maxArrayLength: 10_000,
  maxObjectKeys: 10_000,
  maxEntries: 250_000,
  maxDepth: 64,
} as const;

type Frame = { value: unknown; depth: number; exit?: boolean };

export function isWithinValidationBudget(input: unknown): boolean {
  const pending: Frame[] = [{ value: input, depth: 0 }];
  const active = new WeakSet<object>();
  let entries = 0;

  try {
    while (pending.length > 0) {
      const { value, depth, exit } = pending.pop()!;
      if (typeof value !== 'object' || value === null) continue;
      if (exit) {
        active.delete(value);
        continue;
      }
      if (depth > VALIDATION_BUDGET.maxDepth || active.has(value)) return false;
      active.add(value);
      pending.push({ value, depth, exit: true });

      if (Array.isArray(value)) {
        if (value.length > VALIDATION_BUDGET.maxArrayLength) return false;
        entries += value.length;
        if (entries > VALIDATION_BUDGET.maxEntries) return false;
        for (let index = 0; index < value.length; index++) {
          pending.push({ value: value[index], depth: depth + 1 });
        }
      } else {
        let count = 0;
        for (const key in value) {
          if (Object.prototype.hasOwnProperty.call(value, key)) count++;
          if (count > VALIDATION_BUDGET.maxObjectKeys) return false;
        }
        entries += count;
        if (entries > VALIDATION_BUDGET.maxEntries) return false;
        for (const key in value) {
          if (Object.prototype.hasOwnProperty.call(value, key)) {
            pending.push({ value: (value as Record<string, unknown>)[key], depth: depth + 1 });
          }
        }
      }
    }
  } catch {
    return false;
  }
  return true;
}
