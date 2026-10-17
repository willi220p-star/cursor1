// SHIM: replaced by the real module on merge
import type { QueuedOp } from '@/studio/contracts';

type Handler = (payload: unknown) => Promise<void>;
const handlers = new Map<string, Handler>();
const queue: QueuedOp[] = [];

export function registerQueueHandler(kind: string, handler: Handler) {
  handlers.set(kind, handler);
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export async function enqueue(op: { kind: string; payload: unknown; label: string }): Promise<QueuedOp> {
  const queued: QueuedOp = { ...op, id: crypto.randomUUID(), createdAt: Date.now(), attempts: 0 };
  queue.push(queued);
  return queued;
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', async () => {
    while (queue.length) {
      const op = queue.shift()!;
      await handlers.get(op.kind)?.(op.payload).catch(() => undefined);
    }
  });
}
