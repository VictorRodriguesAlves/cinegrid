export async function mapLimit<T, R>(items: readonly T[], concurrency: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item !== undefined) results[index] = await task(item, index);
    }
  }));
  return results;
}

// Applied inside cached callbacks so background revalidation also obeys the cap.
export function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function limited<T>(task: () => Promise<T>): Promise<T> {
    if (active >= concurrency) await new Promise<void>((resolve) => queue.push(resolve));
    else active++;
    try { return await task(); }
    finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  };
}
