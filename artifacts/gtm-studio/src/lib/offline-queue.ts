// SHIM: replaced by the real module on merge
import type { QueuedOp } from '@/studio/contracts';

type Handler = (payload: unknown) => Promise<void>;
const handlers = new Map<string, Handler>();
const queue: QueuedOp[] = [];

export function registerQueueHandler(kind: string, handler: Handler) {
  handlers.set(kind, handler);
}

export function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

async function replay() {
  while (queue.length && isOnline()) {
    const op = queue[0];
    const handler = handlers.get(op.kind);
    if (!handler) return;
    try {
      await handler(op.payload);
      queue.shift();
    } catch {
      op.attempts += 1;
      return;
    }
  }
}

if (typeof window !== 'undefined') window.addEventListener('online', () => void replay());

export async function enqueue(op: { kind: string; payload: unknown; label: string }): Promise<QueuedOp> {
  const queued: QueuedOp = { id: crypto.randomUUID(), ...op, createdAt: Date.now(), attempts: 0 };
  queue.push(queued);
  return queued;
}
