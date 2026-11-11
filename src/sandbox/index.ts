// Manifest V3 Sandboxed Dynamic Report Renderer

const BLOCKED_ELEMENT_NAMES = new Set([
  'applet',
  'audio',
  'base',
  'embed',
  'form',
  'frame',
  'frameset',
  'iframe',
  'link',
  'object',
  'portal',
  'source',
  'track',
  'video',
]);

const BLOCKED_ATTRIBUTES = new Set([
  'action',
  'formaction',
  'formenctype',
  'formmethod',
  'formnovalidate',
  'formtarget',
  'srcdoc',
  'target',
]);

const URL_ATTRIBUTES = new Set([
  'archive',
  'background',
  'cite',
  'classid',
  'codebase',
  'data',
  'dynsrc',
  'href',
  'icon',
  'imagesrcset',
  'longdesc',
  'lowsrc',
  'manifest',
  'ping',
  'poster',
  'profile',
  'src',
  'srcset',
  'usemap',
  'xlink:href',
]);

function cleanPreviousReport(): void {
  const previousStyles = document.head.querySelectorAll('style[data-dynamic-report]');
  previousStyles.forEach((style) => style.remove());
  const reportRoot = document.getElementById('report-root');
  if (reportRoot) {
    reportRoot.innerHTML = '';
  }
}

function isRefreshMeta(element: Element): boolean {
  return (
    element.localName.toLowerCase() === 'meta' &&
    element.getAttribute('http-equiv')?.trim().toLowerCase() === 'refresh'
  );
}

function isAllowedImageSource(value: string): boolean {
  const normalizedValue = value.trim().toLowerCase();
  return normalizedValue.startsWith('data:') || normalizedValue.startsWith('blob:');
}

function sanitizeElementAttributes(element: Element): void {
  const tagName = element.localName.toLowerCase();

  for (const attribute of Array.from(element.attributes)) {
    const attributeName = attribute.name.toLowerCase();

    if (attributeName.startsWith('on') || BLOCKED_ATTRIBUTES.has(attributeName)) {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (tagName === 'img' && attributeName === 'src') {
      if (isAllowedImageSource(attribute.value)) {
        element.setAttribute(attribute.name, attribute.value.trim());
      } else {
        element.removeAttribute(attribute.name);
      }
      continue;
    }

    if (tagName === 'a' && attributeName === 'href') {
      const href = attribute.value.trim();
      if (href.startsWith('#')) {
        element.setAttribute(attribute.name, href);
      } else {
        element.removeAttribute(attribute.name);
      }
      continue;
    }

    if (URL_ATTRIBUTES.has(attributeName)) {
      element.removeAttribute(attribute.name);
    }
  }
}

function sanitizeReportDom(root: ParentNode, removeScripts: boolean = false): void {
  for (const element of Array.from(root.querySelectorAll('*'))) {
    const tagName = element.localName.toLowerCase();

    if (
      BLOCKED_ELEMENT_NAMES.has(tagName) ||
      isRefreshMeta(element) ||
      (removeScripts && tagName === 'script')
    ) {
      element.remove();
      continue;
    }

    sanitizeElementAttributes(element);

    if (tagName === 'template') {
      sanitizeReportDom((element as HTMLTemplateElement).content, true);
    }
  }
}

function findAnchorTarget(id: string): Element | undefined {
  return (
    document.getElementById(id) ||
    document.getElementsByName(id)[0] ||
    document.getElementsByClassName(id)[0] ||
    Array.from(document.querySelectorAll('section[id]')).find((section) => section.id.includes(id))
  );
}

function setupLinkInterceptors(): void {
  document.addEventListener(
    'click',
    (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const link = target?.closest('a');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href) return;

      event.preventDefault();
      event.stopPropagation();

      if (!href.startsWith('#')) return;

      const id = href.slice(1);
      if (!id) return;

      findAnchorTarget(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    true,
  );
}

function showRenderError(errorTitle: string, errorMessage: string): void {
  const reportRoot = document.getElementById('report-root');
  if (!reportRoot) return;

  const container = document.createElement('div');
  container.style.cssText = 'padding: 2rem; color: red; text-align: center;';

  const heading = document.createElement('h3');
  heading.textContent = errorTitle;

  const message = document.createElement('p');
  message.textContent = errorMessage;

  container.append(heading, message);
  reportRoot.replaceChildren(container);
}

function renderReport(rawHtml: string, errorTitle: string, errorMessage: string): void {
  if (!rawHtml || typeof rawHtml !== 'string') return;

  cleanPreviousReport();

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, 'text/html');
    sanitizeReportDom(doc, true);

    // 1. Extract and inject <style> tags
    const styleTags = Array.from(doc.querySelectorAll('style'));
    styleTags.forEach((styleTag) => {
      const newStyle = document.createElement('style');
      newStyle.setAttribute('data-dynamic-report', 'true');
      newStyle.textContent = styleTag.textContent || '';
      document.head.appendChild(newStyle);
      styleTag.remove();
    });

    // 2. Inject body content into report-root
    const reportRoot = document.getElementById('report-root');
    if (reportRoot) {
      reportRoot.innerHTML = doc.body.innerHTML;
    }
  } catch (error) {
    console.error('[Sandbox] Failed to render report:', error);
    showRenderError(errorTitle, errorMessage);
  }
}

// Setup link click interceptor on page load
setupLinkInterceptors();

// Listen for messages from parent window
window.addEventListener('message', (event: MessageEvent) => {
  if (
    event.source === window.parent &&
    event.data?.type === 'RENDER_REPORT' &&
    typeof event.data.html === 'string'
  ) {
    const { html, locale, errorTitle, errorMessage } = event.data;
    if (typeof locale === 'string') document.documentElement.lang = locale;
    renderReport(
      html,
      typeof errorTitle === 'string' ? errorTitle : 'Report could not be displayed',
      typeof errorMessage === 'string' ? errorMessage : 'Try reopening the report.',
    );
  }
});

// Signal ready to parent
try {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'SANDBOX_READY' }, '*');
  }
} catch {
  // ignore
}
