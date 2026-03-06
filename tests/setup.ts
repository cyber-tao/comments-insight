// Fail fast on unhandled rejections so tests don't silently pass with hidden async errors.
process.on('unhandledRejection', (reason) => {
  if (reason instanceof Error) {
    throw reason;
  }
  throw new Error(String(reason));
});
