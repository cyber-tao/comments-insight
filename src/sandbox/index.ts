// Manifest V3 Sandboxed Dynamic Report Renderer

function cleanPreviousReport(): void {
  const previousStyles = document.head.querySelectorAll('style[data-dynamic-report]');
  previousStyles.forEach((s) => s.remove());
  const reportRoot = document.getElementById('report-root');
  if (reportRoot) {
    reportRoot.innerHTML = '';
  }
}

function setupLinkInterceptors(): void {
  document.addEventListener(
    'click',
    (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const link = target?.closest('a');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href) return;

      // 1. In-page anchor links (e.g. #overview, #comments)
      if (href.startsWith('#')) {
        e.preventDefault();
        e.stopPropagation();
        const id = href.slice(1);
        if (!id) return;
        const targetEl =
          document.getElementById(id) ||
          document.querySelector(`[name="${id}"]`) ||
          document.querySelector(`.${id}`) ||
          document.querySelector(`section[id*="${id}"]`);

        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
      }

      // 2. External links (http:// or https://)
      if (href.startsWith('http://') || href.startsWith('https://')) {
        e.preventDefault();
        e.stopPropagation();
        window.open(href, '_blank', 'noopener,noreferrer');
        return;
      }

      // 3. Prevent any broken extension or blob navigations that trigger Chrome blocked screens
      if (
        href.startsWith('chrome-extension://') ||
        href.startsWith('blob:') ||
        href.startsWith('about:')
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
}

function renderReport(rawHtml: string): void {
  if (!rawHtml || typeof rawHtml !== 'string') return;

  cleanPreviousReport();

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, 'text/html');

    // 1. Extract and inject <style> tags
    const styleTags = doc.querySelectorAll('style');
    styleTags.forEach((styleTag) => {
      const newStyle = document.createElement('style');
      newStyle.setAttribute('data-dynamic-report', 'true');
      newStyle.textContent = styleTag.textContent || '';
      document.head.appendChild(newStyle);
    });

    // 2. Extract scripts before injecting body
    const scriptElements = Array.from(doc.querySelectorAll('script'));
    const scriptContents: string[] = [];
    scriptElements.forEach((script) => {
      if (script.textContent) {
        scriptContents.push(script.textContent);
      }
      script.remove();
    });

    // 3. Inject body content into report-root
    const reportRoot = document.getElementById('report-root');
    if (reportRoot) {
      reportRoot.innerHTML = doc.body.innerHTML;
    }

    // 4. Execute scripts in sandboxed context (eval and inline scripts are permitted in manifest sandbox)
    scriptContents.forEach((code) => {
      try {
        // Run in local function scope
        eval(code);
      } catch (err) {
        console.warn('[Sandbox] Script execution warning:', err);
      }
    });

    // 5. Trigger DOMContentLoaded event simulation if scripts registered listeners
    document.dispatchEvent(new Event('DOMContentLoaded'));
    window.dispatchEvent(new Event('load'));
  } catch (error) {
    console.error('[Sandbox] Failed to render report:', error);
    const reportRoot = document.getElementById('report-root');
    if (reportRoot) {
      reportRoot.innerHTML = `<div style="padding: 2rem; color: red; text-align: center;"><h3>Render Error</h3><p>${error instanceof Error ? error.message : 'Unknown error'}</p></div>`;
    }
  }
}

// Setup link click interceptor on page load
setupLinkInterceptors();

// Listen for messages from parent window
window.addEventListener('message', (event: MessageEvent) => {
  if (event.data?.type === 'RENDER_REPORT' && typeof event.data.html === 'string') {
    renderReport(event.data.html);
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
