import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appError, conflictError } from './app-error';

// No IndexedDB in the node test environment, so these exercise the in-memory fallback.
type Queue = typeof import('./offline-queue');

const nav = { onLine: true };
let win: EventTarget;
let q: Queue;

function goOnline() {
  nav.onLine = true;
  win.dispatchEvent(new Event('online'));
}

beforeEach(async () => {
  nav.onLine = true;
  win = new EventTarget();
  vi.stubGlobal('navigator', nav);
  vi.stubGlobal('window', win);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.resetModules();
  q = await import('./offline-queue');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('offline queue (memory fallback)', () => {
  it('runs ops FIFO, one at a time', async () => {
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    q.registerQueueHandler('bulk', async (payload) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      order.push(payload as string);
      active -= 1;
    });
    nav.onLine = false;
    await q.enqueue({ kind: 'bulk', payload: 'a', label: 'A' });
    await q.enqueue({ kind: 'bulk', payload: 'b', label: 'B' });
    await q.enqueue({ kind: 'bulk', payload: 'c', label: 'C' });
    expect(q.getSyncStatus().pending).toBe(3);
    expect(q.listQueued().map((op) => op.label)).toEqual(['A', 'B', 'C']);
    expect(order).toEqual([]);

    nav.onLine = true;
    await q.flushQueue();
    expect(order).toEqual(['a', 'b', 'c']);
    expect(maxActive).toBe(1);
    expect(q.getSyncStatus()).toEqual({ pending: 0, running: false, lastError: null });
  });

  it('replays on the window online event after init', async () => {
    const seen: unknown[] = [];
    q.registerQueueHandler('bulk', async (payload) => {
      seen.push(payload);
    });
    nav.onLine = false;
    await q.initOfflineQueue();
    await q.enqueue({ kind: 'bulk', payload: 1, label: 'one' });
    expect(seen).toEqual([]);
    goOnline();
    await q.flushQueue();
    expect(seen).toEqual([1]);
    expect(q.listQueued()).toEqual([]);
  });

  it('runs straight away after enqueue when online', async () => {
    const handler = vi.fn(async () => {});
    q.registerQueueHandler('bulk', handler);
    await q.enqueue({ kind: 'bulk', payload: { ids: ['x'] }, label: 'Move 1 item' });
    await q.flushQueue();
    expect(handler).toHaveBeenCalledWith({ ids: ['x'] });
    expect(q.getSyncStatus().pending).toBe(0);
  });

  it('keeps retryable failures, counts attempts, and backs off', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let fail = true;
    const handler = vi.fn(async () => {
      if (fail) throw new TypeError('Failed to fetch');
    });
    q.registerQueueHandler('bulk', handler);
    await q.enqueue({ kind: 'bulk', payload: 1, label: 'one' });
    await q.flushQueue();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(q.listQueued()[0].attempts).toBe(1);
    expect(q.getSyncStatus().lastError?.code).toBe('network');
    expect(q.listQueueFailures()).toEqual([]);

    fail = false;
    await vi.advanceTimersByTimeAsync(600); // backoff 0 jitter + 500ms floor
    await q.flushQueue();
    expect(handler).toHaveBeenCalledTimes(2);
    expect(q.getSyncStatus()).toEqual({ pending: 0, running: false, lastError: null });
  });

  it('later ops wait behind a retrying op', async () => {
    vi.useFakeTimers();
    const ran: string[] = [];
    q.registerQueueHandler('bulk', async (payload) => {
      if (payload === 'a') throw { status: 503, message: 'down' };
      ran.push(payload as string);
    });
    nav.onLine = false;
    await q.enqueue({ kind: 'bulk', payload: 'a', label: 'A' });
    await q.enqueue({ kind: 'bulk', payload: 'b', label: 'B' });
    nav.onLine = true;
    await q.flushQueue();
    expect(ran).toEqual([]);
    expect(q.listQueued().map((op) => op.label)).toEqual(['A', 'B']);
  });

  it('drops conflicts to the failure list and carries on', async () => {
    const ran: string[] = [];
    q.registerQueueHandler('bulk', async (payload) => {
      if (payload === 'a') throw conflictError('Sam');
      ran.push(payload as string);
    });
    nav.onLine = false;
    await q.enqueue({ kind: 'bulk', payload: 'a', label: 'Rename A' });
    await q.enqueue({ kind: 'bulk', payload: 'b', label: 'Rename B' });
    nav.onLine = true;
    await q.flushQueue();
    expect(ran).toEqual(['b']);
    expect(q.listQueued()).toEqual([]);
    const failures = q.listQueueFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0].op.label).toBe('Rename A');
    expect(failures[0].error.code).toBe('conflict');
    expect(failures[0].error.message).toContain('Changed by Sam');

    q.clearQueueFailures();
    expect(q.listQueueFailures()).toEqual([]);
  });

  it('drops permission, validation and not_found errors too', async () => {
    const errors = [appError('permission', 'no'), { code: '23505', message: 'dup' }, { code: 'PGRST116', message: 'gone' }];
    q.registerQueueHandler('bulk', async (payload) => {
      throw errors[payload as number];
    });
    nav.onLine = false;
    for (let i = 0; i < errors.length; i += 1) await q.enqueue({ kind: 'bulk', payload: i, label: `op ${i}` });
    nav.onLine = true;
    await q.flushQueue();
    expect(q.listQueued()).toEqual([]);
    expect(q.listQueueFailures().map((f) => f.error.code).sort()).toEqual(['not_found', 'permission', 'validation']);
    q.clearQueueFailures(q.listQueueFailures()[0].id);
    expect(q.listQueueFailures()).toHaveLength(2);
  });

  it('ops for an unregistered kind wait until their handler registers', async () => {
    const reviewed: unknown[] = [];
    const bulk = vi.fn(async () => {});
    q.registerQueueHandler('bulk', bulk);
    nav.onLine = false;
    await q.enqueue({ kind: 'review', payload: 'r1', label: 'Approve' });
    await q.enqueue({ kind: 'bulk', payload: 'b1', label: 'Move' });
    nav.onLine = true;
    await q.flushQueue();
    expect(bulk).toHaveBeenCalledTimes(1);
    expect(q.listQueued().map((op) => op.kind)).toEqual(['review']);

    q.registerQueueHandler('review', async (payload) => {
      reviewed.push(payload);
    });
    await q.flushQueue();
    expect(reviewed).toEqual(['r1']);
    expect(q.listQueued()).toEqual([]);
  });

  it('discards a queued op', async () => {
    nav.onLine = false;
    const op = await q.enqueue({ kind: 'bulk', payload: 1, label: 'one' });
    await q.enqueue({ kind: 'bulk', payload: 2, label: 'two' });
    await q.discardQueued(op.id);
    expect(q.listQueued().map((o) => o.label)).toEqual(['two']);
    expect(q.getSyncStatus().pending).toBe(1);
  });

  it('notifies subscribers with stable snapshots', async () => {
    const listener = vi.fn();
    q.subscribeQueue(listener);
    nav.onLine = false;
    const before = q.getSyncStatus();
    expect(q.getSyncStatus()).toBe(before);
    await q.enqueue({ kind: 'bulk', payload: 1, label: 'one' });
    expect(listener).toHaveBeenCalled();
    expect(q.getSyncStatus()).not.toBe(before);
    expect(q.getSyncStatus().pending).toBe(1);
  });

  it('reports isOnline from navigator', () => {
    expect(q.isOnline()).toBe(true);
    nav.onLine = false;
    expect(q.isOnline()).toBe(false);
  });
});
