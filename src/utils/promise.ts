export async function runWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let nextIndex = 0;

  const workerCount = Math.min(Math.max(1, limit), tasks.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= tasks.length) {
        return;
      }
      results[current] = await tasks[current]();
    }
  });

  await Promise.all(workers);
  return results;
}
