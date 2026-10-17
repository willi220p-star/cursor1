/**
 * Offline queue: changes made while offline (or that failed with a retryable error) wait here and
 * replay in order, one at a time, when the browser is back online, when the app starts, and right
 * after enqueue when online.
 *
 * - Persisted in IndexedDB (db 'gtm-studio-sync', store 'ops'). Every IndexedDB access is guarded;
 *   if it is missing or broken the queue keeps working in memory for this tab.
 * - Retryable failures keep the op (attempts + 1) and back off. Permission, conflict, validation,
 *   not_found and unknown errors remove the op and record it in the failure list so the UI can say
 *   so. The queue never retries those, so it never overwrites someone else's change.
 * - Ops whose kind has no registered handler wait (they don't block other kinds) and run as soon as
 *   their handler registers.
 */
import { useSyncExternalStore } from 'react';
import type { AppError, QueuedOp, SyncStatus } from '@/studio/contracts';
import { reportIfUnexpected, toAppError } from '@/lib/app-error';
import { backoffDelay } from '@/lib/retry';

export type QueueHandler = (payload: unknown) => Promise<void>;

export interface QueueFailure {
  /** Unique per failure (the op id). */
  id: string;
  op: QueuedOp;
  error: AppError;
  at: number;
}

const DB_NAME = 'gtm-studio-sync';
const STORE = 'ops';
const MAX_FAILURES = 20;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 60_000;

// ── State ──────────────────────────────────────────────────────────────

const handlers = new Map<string, QueueHandler>();
let ops: QueuedOp[] = [];
let failures: QueueFailure[] = [];
let running = false;
let lastError: AppError | null = null;
let flushing: Promise<void> | null = null;
let flushAgain = false;
let loading: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let initialised = false;
let seq = 0;

const listeners = new Set<() => void>();
let statusSnapshot: SyncStatus = { pending: 0, running: false, lastError: null };
let opsSnapshot: QueuedOp[] = [];
let failuresSnapshot: QueueFailure[] = [];

function emit() {
  statusSnapshot = { pending: ops.length, running, lastError };
  opsSnapshot = ops.slice();
  failuresSnapshot = failures.slice();
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A broken subscriber must not stop the queue.
    }
  }
}

export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSyncStatus(): SyncStatus {
  return statusSnapshot;
}

export function listQueued(): QueuedOp[] {
  return opsSnapshot;
}

export function listQueueFailures(): QueueFailure[] {
  return failuresSnapshot;
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

// ── IndexedDB (best effort) ────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        try {
          if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
        } catch {
          // Falls through to onerror/onsuccess.
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function idbRun<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  try {
    const db = await openDb();
    if (!db) return undefined;
    return await new Promise<T | undefined>((resolve) => {
      try {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(request ? request.result : undefined);
        tx.onerror = () => resolve(undefined);
        tx.onabort = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  } catch {
    return undefined;
  }
}

function persistPut(op: QueuedOp): Promise<unknown> {
  return idbRun('readwrite', (store) => store.put(op));
}

function persistDelete(id: string): Promise<unknown> {
  return idbRun('readwrite', (store) => store.delete(id));
}

async function persistedOps(): Promise<QueuedOp[]> {
  const rows = await idbRun<unknown[]>('readonly', (store) => store.getAll());
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is QueuedOp => {
    const r = row as Partial<QueuedOp> | null;
    return !!r && typeof r.id === 'string' && typeof r.kind === 'string' && typeof r.createdAt === 'number';
  });
}

// ── Public API ─────────────────────────────────────────────────────────

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Fall through.
  }
  seq += 1;
  return `op-${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

function onOnline() {
  clearRetryTimer();
  emit();
  void flushQueue();
}

function onOffline() {
  emit();
}

/** Loads persisted ops, listens for 'online', and replays. Safe to call more than once. */
export function initOfflineQueue(): Promise<void> {
  if (!initialised) {
    initialised = true;
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
    }
    loading = (async () => {
      const stored = await persistedOps();
      if (stored.length) {
        const known = new Set(ops.map((op) => op.id));
        ops = [...ops, ...stored.filter((op) => !known.has(op.id))].sort((a, b) => a.createdAt - b.createdAt);
        emit();
      }
    })();
  }
  const ready = loading ?? Promise.resolve();
  return ready.then(() => (isOnline() ? flushQueue() : undefined));
}

export function registerQueueHandler(kind: string, handler: (payload: unknown) => Promise<void>): void {
  handlers.set(kind, handler);
  if (isOnline() && ops.some((op) => op.kind === kind)) void flushQueue();
}

export async function enqueue(input: { kind: string; payload: unknown; label: string }): Promise<QueuedOp> {
  const op: QueuedOp = { id: newId(), kind: input.kind, payload: input.payload, label: input.label, createdAt: Date.now(), attempts: 0 };
  ops = [...ops, op];
  emit();
  await persistPut(op);
  if (isOnline()) void flushQueue();
  return op;
}

export async function discardQueued(id: string): Promise<void> {
  const before = ops.length;
  ops = ops.filter((op) => op.id !== id);
  if (ops.length !== before) emit();
  await persistDelete(id);
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeQueue, getSyncStatus, getSyncStatus);
}

export function useQueuedOps(): QueuedOp[] {
  return useSyncExternalStore(subscribeQueue, listQueued, listQueued);
}

export function useQueueFailures(): QueueFailure[] {
  return useSyncExternalStore(subscribeQueue, listQueueFailures, listQueueFailures);
}

/** Clears one failure by id, or all of them. */
export function clearQueueFailures(id?: string): void {
  failures = id === undefined ? [] : failures.filter((failure) => failure.id !== id);
  if (!failures.length && !ops.length) lastError = null;
  emit();
}

function subscribeOnline(listener: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

/** Reactive `navigator.onLine`. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, isOnline, () => true);
}

// ── Replay ─────────────────────────────────────────────────────────────

function clearRetryTimer() {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleRetry(attempts: number) {
  clearRetryTimer();
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushQueue();
  }, backoffDelay(attempts, RETRY_BASE_MS, RETRY_MAX_MS) + RETRY_BASE_MS / 2);
}

function nextRunnable(): QueuedOp | undefined {
  return ops.find((op) => handlers.has(op.kind));
}

function replaceOp(updated: QueuedOp) {
  ops = ops.map((op) => (op.id === updated.id ? updated : op));
}

async function drain(): Promise<void> {
  if (loading) await loading;
  while (isOnline()) {
    const op = nextRunnable();
    if (!op) break;
    const handler = handlers.get(op.kind)!;
    running = true;
    emit();
    let failure: AppError | null = null;
    try {
      await handler(op.payload);
    } catch (caught) {
      failure = toAppError(caught);
    }
    running = false;

    if (!failure) {
      ops = ops.filter((o) => o.id !== op.id);
      lastError = null;
      emit();
      await persistDelete(op.id);
      continue;
    }

    lastError = failure;
    if (failure.retryable) {
      // Keep it (unless it was discarded while running) and stop: later ops wait behind it.
      const stillQueued = ops.some((o) => o.id === op.id);
      const updated: QueuedOp = { ...op, attempts: op.attempts + 1 };
      if (stillQueued) {
        replaceOp(updated);
        await persistPut(updated);
      }
      emit();
      if (failure.code !== 'offline' && isOnline()) scheduleRetry(updated.attempts);
      return;
    }

    // Not retryable: drop it and tell the user. Never retried, so never overwrites anything.
    reportIfUnexpected(failure, { area: 'offline-queue', kind: op.kind });
    ops = ops.filter((o) => o.id !== op.id);
    failures = [{ id: op.id, op, error: failure, at: Date.now() }, ...failures].slice(0, MAX_FAILURES);
    emit();
    await persistDelete(op.id);
  }
}

/** Replays queued ops in order. Resolves when this pass is done; concurrent calls share one pass. */
export function flushQueue(): Promise<void> {
  if (flushing) {
    // A handler registered or an op arrived mid-pass: run one more pass when this one ends.
    flushAgain = true;
    return flushing;
  }
  flushAgain = false;
  clearRetryTimer();
  flushing = drain()
    .catch((caught) => {
      running = false;
      lastError = toAppError(caught);
      reportIfUnexpected(lastError, { area: 'offline-queue' });
    })
    .finally(() => {
      flushing = null;
      emit();
    })
    .then((): Promise<void> | undefined => {
      if (flushAgain && retryTimer === null) return flushQueue();
      flushAgain = false;
      return undefined;
    });
  return flushing;
}
