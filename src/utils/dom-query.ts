interface ShadowRootHost {
  shadowRoot?: ShadowRoot | null;
}

export function getShadowRoot(element: Element): ShadowRoot | null {
  return (element as unknown as ShadowRootHost).shadowRoot || null;
}

export function querySelectorDeep(
  root: Document | Element | ShadowRoot,
  selector: string,
): Element | null {
  const trimmedSelector = selector.trim();
  if (!trimmedSelector) {
    return null;
  }

  let directHit: Element | null = null;
  try {
    directHit = root.querySelector(trimmedSelector);
  } catch {
    directHit = null;
  }
  if (directHit) {
    return directHit;
  }

  const split = splitSelector(trimmedSelector);
  if (split.rest) {
    let candidates: Element[] = [];
    try {
      candidates = Array.from(root.querySelectorAll(split.current));
    } catch {
      candidates = [];
    }

    for (const candidate of candidates) {
      const fromLightDom = querySelectorDeep(candidate, split.rest);
      if (fromLightDom) {
        return fromLightDom;
      }

      const shadowRoot = getShadowRoot(candidate);
      if (shadowRoot) {
        const fromShadow = querySelectorDeep(shadowRoot, split.rest);
        if (fromShadow) {
          return fromShadow;
        }
      }
    }
  }

  if (root instanceof Element && root.shadowRoot) {
    const withinShadow = querySelectorDeep(root.shadowRoot, trimmedSelector);
    if (withinShadow) {
      return withinShadow;
    }
  }

  const elements = root.querySelectorAll('*');
  for (const el of Array.from(elements)) {
    const shadowRoot = getShadowRoot(el);
    if (shadowRoot) {
      const found = querySelectorDeep(shadowRoot, trimmedSelector);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

export function querySelectorAllDeep(
  root: Document | Element | ShadowRoot,
  selector: string,
): Element[] {
  const trimmedSelector = selector.trim();
  if (!trimmedSelector) {
    return [];
  }

  const results: Element[] = [];
  try {
    results.push(...Array.from(root.querySelectorAll(trimmedSelector)));
  } catch {
    // ignore
  }

  if (root instanceof Element && root.shadowRoot) {
    results.push(...querySelectorAllDeep(root.shadowRoot, trimmedSelector));
  }

  const split = splitSelector(trimmedSelector);
  if (split.rest) {
    let candidates: Element[] = [];
    try {
      candidates = Array.from(root.querySelectorAll(split.current));
    } catch {
      candidates = [];
    }

    for (const candidate of candidates) {
      results.push(...querySelectorAllDeep(candidate, split.rest));
      const shadowRoot = getShadowRoot(candidate);
      if (shadowRoot) {
        results.push(...querySelectorAllDeep(shadowRoot, split.rest));
      }
    }
  }

  const descendants = root.querySelectorAll('*');
  for (const el of Array.from(descendants)) {
    const shadowRoot = getShadowRoot(el);
    if (shadowRoot) {
      results.push(...querySelectorAllDeep(shadowRoot, trimmedSelector));
    }
  }

  return Array.from(new Set(results));
}

export function queryXPathAll(root: Document | Element | ShadowRoot, selector: string): Element[] {
  const trimmedSelector = selector.trim();
  if (!trimmedSelector) {
    return [];
  }

  try {
    const ownerDocument = root instanceof Document ? root : root.ownerDocument || document;
    const snapshot = ownerDocument.evaluate(
      trimmedSelector,
      root,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    const results: Element[] = [];
    for (let i = 0; i < snapshot.snapshotLength; i++) {
      const node = snapshot.snapshotItem(i);
      if (node && node.nodeType === Node.ELEMENT_NODE) {
        results.push(node as Element);
      }
    }
    return results;
  } catch {
    return [];
  }
}

export function splitSelector(selector: string): { current: string; rest?: string } {
  const trimmed = selector.trim();
  let inAttr = false;
  let parenDepth = 0;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === '[') {
      inAttr = true;
      continue;
    }
    if (char === ']') {
      inAttr = false;
      continue;
    }
    if (char === '(') {
      parenDepth++;
      continue;
    }
    if (char === ')') {
      parenDepth = Math.max(parenDepth - 1, 0);
      continue;
    }

    if (inAttr || parenDepth > 0) {
      continue;
    }

    if (char === '>' || char === ' ') {
      let nextIndex = i + 1;
      while (nextIndex < trimmed.length && trimmed[nextIndex] === ' ') {
        nextIndex++;
      }

      const current = trimmed.substring(0, i).trim();
      const rest = trimmed.substring(nextIndex).trim();
      if (current && rest) {
        return { current, rest };
      }
    }
  }

  return { current: trimmed };
}
