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
