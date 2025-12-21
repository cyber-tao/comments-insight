// Suppress unhandled rejection warnings in tests
// These are intentional test cases that verify error handling
process.on('unhandledRejection', () => {
  // Intentionally empty - we're testing error handling
});
