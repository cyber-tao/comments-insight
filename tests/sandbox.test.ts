// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import '@/sandbox/index';

const dynamicStyleSelector = 'style[data-dynamic-report]';

function dispatchSandboxMessage(
  data: unknown,
  source: MessageEventSource | null = window.parent,
): void {
  window.dispatchEvent(new MessageEvent('message', { data, source }));
}

function renderReport(html: string): void {
  dispatchSandboxMessage({ type: 'RENDER_REPORT', html });
}

function getReportRoot(): HTMLElement {
  const reportRoot = document.getElementById('report-root');
  if (!reportRoot) {
    throw new Error('Missing report root');
  }
  return reportRoot;
}

describe('sandbox report renderer', () => {
  beforeEach(() => {
    document.head.querySelectorAll(dynamicStyleSelector).forEach((style) => style.remove());
    document.body.innerHTML = '<main id="report-root"></main>';
  });

  it('accepts only render messages with string HTML from the parent', () => {
    renderReport('<style>.initial { color: red; }</style><p id="initial-report">Initial</p>');

    const reportRoot = getReportRoot();
    const initialMarkup = reportRoot.innerHTML;
    const initialStyle = document.head.querySelector(dynamicStyleSelector);

    expect(reportRoot.querySelector('#initial-report')?.textContent).toBe('Initial');
    expect(initialStyle?.textContent).toContain('.initial');

    const invalidMessages: Array<{ data: unknown; source: MessageEventSource | null }> = [
      {
        data: { type: 'RENDER_REPORT', html: '<p id="replacement">Wrong source</p>' },
        source: null,
      },
      {
        data: { type: 'OTHER', html: '<p id="replacement">Wrong type</p>' },
        source: window.parent,
      },
      {
        data: { type: 'RENDER_REPORT', html: 42 },
        source: window.parent,
      },
    ];

    for (const message of invalidMessages) {
      dispatchSandboxMessage(message.data, message.source);
      expect(reportRoot.innerHTML).toBe(initialMarkup);
      expect(document.head.querySelector(dynamicStyleSelector)).toBe(initialStyle);
    }

    renderReport('<p id="replacement">Accepted</p>');

    expect(reportRoot.querySelector('#initial-report')).toBeNull();
    expect(reportRoot.querySelector('#replacement')?.textContent).toBe('Accepted');
  });

  it('removes dangerous elements, handlers, and remote URL attributes', () => {
    renderReport(`
      <section id="safe-content">
        <meta id="safe-meta" name="description" content="Safe">
        <meta id="refresh-meta" http-equiv=" ReFrEsH " content="0;url=https://evil.test">
        <script id="top-level-script">globalThis.compromised = true;</script>
        <iframe id="remote-frame" src="https://evil.test/frame"></iframe>
        <form id="remote-form" action="https://evil.test/submit"><input name="secret"></form>
        <button id="event-target" onclick="alert('click')" onfocus="alert('focus')">Safe</button>
        <img id="remote-image" src="https://evil.test/image.png" srcset="https://evil.test/2x.png 2x" onerror="alert('error')">
        <a id="remote-link" href="https://evil.test" ping="https://evil.test/ping" target="_blank" onmouseover="alert('hover')">Remote</a>
        <blockquote id="remote-cite" cite="https://evil.test/source">Quote</blockquote>
      </section>
    `);

    const reportRoot = getReportRoot();

    expect(reportRoot.querySelector('#safe-meta')).not.toBeNull();
    expect(reportRoot.querySelector('#refresh-meta')).toBeNull();
    expect(reportRoot.querySelector('script')).toBeNull();
    expect(reportRoot.querySelector('iframe')).toBeNull();
    expect(reportRoot.querySelector('form')).toBeNull();

    const eventTarget = reportRoot.querySelector('#event-target');
    const remoteImage = reportRoot.querySelector('#remote-image');
    const remoteLink = reportRoot.querySelector('#remote-link');
    const remoteCite = reportRoot.querySelector('#remote-cite');

    expect(eventTarget?.hasAttribute('onclick')).toBe(false);
    expect(eventTarget?.hasAttribute('onfocus')).toBe(false);
    expect(remoteImage?.hasAttribute('src')).toBe(false);
    expect(remoteImage?.hasAttribute('srcset')).toBe(false);
    expect(remoteImage?.hasAttribute('onerror')).toBe(false);
    expect(remoteLink?.hasAttribute('href')).toBe(false);
    expect(remoteLink?.hasAttribute('ping')).toBe(false);
    expect(remoteLink?.hasAttribute('target')).toBe(false);
    expect(remoteLink?.hasAttribute('onmouseover')).toBe(false);
    expect(remoteCite?.hasAttribute('cite')).toBe(false);
  });

  it('allows only data or blob image sources and fragment anchor links', () => {
    renderReport(`
      <img id="data-image" src="  DATA:image/png;base64,AAAA  ">
      <img id="blob-image" src="  blob:https://reports.test/image-id  ">
      <img id="remote-image" src="https://reports.test/image.png">
      <img id="relative-image" src="/image.png">
      <a id="fragment-link" href="  #summary  ">Summary</a>
      <a id="remote-link" href="https://reports.test">Remote</a>
      <a id="relative-link" href="/report">Relative</a>
      <a id="script-link" href="javascript:alert('xss')">Script</a>
      <div id="generic-url-target" src="data:image/png;base64,AAAA" href="#summary"></div>
    `);

    const reportRoot = getReportRoot();

    expect(reportRoot.querySelector('#data-image')?.getAttribute('src')).toBe(
      'DATA:image/png;base64,AAAA',
    );
    expect(reportRoot.querySelector('#blob-image')?.getAttribute('src')).toBe(
      'blob:https://reports.test/image-id',
    );
    expect(reportRoot.querySelector('#remote-image')?.hasAttribute('src')).toBe(false);
    expect(reportRoot.querySelector('#relative-image')?.hasAttribute('src')).toBe(false);
    expect(reportRoot.querySelector('#fragment-link')?.getAttribute('href')).toBe('#summary');
    expect(reportRoot.querySelector('#remote-link')?.hasAttribute('href')).toBe(false);
    expect(reportRoot.querySelector('#relative-link')?.hasAttribute('href')).toBe(false);
    expect(reportRoot.querySelector('#script-link')?.hasAttribute('href')).toBe(false);
    expect(reportRoot.querySelector('#generic-url-target')?.hasAttribute('src')).toBe(false);
    expect(reportRoot.querySelector('#generic-url-target')?.hasAttribute('href')).toBe(false);
  });

  it('moves styles to the head and replaces them on the next render', () => {
    renderReport('<style>.first { color: red; }</style><section id="first">First</section>');

    const reportRoot = getReportRoot();
    const firstStyle = document.head.querySelector(dynamicStyleSelector);

    expect(firstStyle?.textContent).toContain('.first');
    expect(reportRoot.querySelector('style')).toBeNull();
    expect(reportRoot.querySelector('#first')).not.toBeNull();

    renderReport('<style>.second { color: blue; }</style><section id="second">Second</section>');

    const currentStyles = document.head.querySelectorAll(dynamicStyleSelector);
    expect(currentStyles).toHaveLength(1);
    expect(firstStyle?.isConnected).toBe(false);
    expect(currentStyles[0].textContent).toContain('.second');
    expect(currentStyles[0].textContent).not.toContain('.first');
    expect(reportRoot.querySelector('#first')).toBeNull();
    expect(reportRoot.querySelector('#second')).not.toBeNull();
  });

  it('removes scripts from template content', () => {
    renderReport(`
      <section>
        <template id="report-template">
          <script id="template-script">globalThis.compromised = true;</script>
          <p id="template-content">Safe template content</p>
        </template>
      </section>
    `);

    const template = getReportRoot().querySelector<HTMLTemplateElement>('#report-template');

    expect(template).not.toBeNull();
    expect(template?.content.querySelector('#template-script')).toBeNull();
    expect(template?.content.querySelector('#template-content')?.textContent).toBe(
      'Safe template content',
    );
  });
});
