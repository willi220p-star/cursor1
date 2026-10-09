/**
 * Runs `task` over `items` with at most `concurrency` in flight. Each task gets a lane number
 * (0..concurrency-1) so callers can pin it to a worker. Results keep the input order.
 * When `shouldStop` turns true, no new items start; items already running finish.
 */
export async function runQueue<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T, lane: number, index: number) => Promise<R>,
  options: { shouldStop?: () => boolean } = {},
): Promise<Array<R | undefined>> {
  const results: Array<R | undefined> = new Array(items.length);
  let next = 0;
  const lanes = Math.max(1, Math.min(concurrency, items.length));
  const runLane = async (lane: number) => {
    while (next < items.length) {
      if (options.shouldStop?.()) return;
      const index = next++;
      results[index] = await task(items[index], lane, index);
    }
  };
  await Promise.all(Array.from({ length: lanes }, (_, lane) => runLane(lane)));
  return results;
}

/** How many rows to render at once for each kind of work, sized to this computer. */
export function batchConcurrency(kind: 'worker' | 'main' | 'gif') {
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  if (kind === 'worker') return Math.max(1, Math.min(6, cores - 1));
  // Main-thread drawing overlaps image loading and PNG encoding; past 3 it only adds memory.
  if (kind === 'main') return Math.max(1, Math.min(3, cores - 1));
  // GIFs hold every frame in memory until encoded, so keep fewer in flight.
  return Math.max(1, Math.min(4, cores - 1));
}
