// Fail fast on unhandled rejections so tests don't silently pass with hidden async errors.
const UNHANDLED_REJECTION_INSTALLED = '__commentsInsightUnhandledRejectionInstalled';
const globalFlags = globalThis as unknown as Record<symbol | string, boolean | undefined>;

if (!globalFlags[UNHANDLED_REJECTION_INSTALLED]) {
  globalFlags[UNHANDLED_REJECTION_INSTALLED] = true;
  process.on('unhandledRejection', (reason) => {
    if (reason instanceof Error) {
      throw reason;
    }
    throw new Error(String(reason));
  });
}

if (typeof HTMLDialogElement !== 'undefined') {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement): void {
      if (!this.hasAttribute('open')) {
        this.setAttribute('open', '');
      }
    };
  }

  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(
      this: HTMLDialogElement,
      returnValue?: string,
    ): void {
      if (returnValue !== undefined) {
        this.returnValue = returnValue;
      }
      if (this.hasAttribute('open')) {
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
      }
    };
  }
}
