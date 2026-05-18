export function parseFiniteNumberInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseFiniteIntegerInput(value: string): number | null {
  const parsed = parseFiniteNumberInput(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}
