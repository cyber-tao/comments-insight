let active = false;

export function setExtractionActive(next: boolean) {
  active = next;
}

export function isExtractionActive(): boolean {
  return active;
}
