/**
 * Retry with exponential backoff and full jitter. Only retryable AppErrors are retried
 * (network, timeout, rate_limited, server). `offline` is thrown straight away so the caller can
 * hand the work to the offline queue instead of spinning.
 */
import type { AppError } from '@/studio/contracts';
import { toAppError } from '@/lib/app-error';

export interface RetryOptions {
  /** Total tries including the first. Default 3. */
  attempts?: number;
  /** First backoff cap in ms. Default 400. */
  baseMs?: number;
  /** Largest backoff cap in ms. Default 4000. */
  maxMs?: number;
  signal?: AbortSignal;
  /** Called after a retryable failure, before waiting. `attempt` is the try that failed (1-based). */
  onRetry?: (error: AppError, attempt: number) => void;
}

/** Full jitter: a random wait between 0 and min(maxMs, baseMs * 2^(attempt-1)). */
export function backoffDelay(attempt: number, baseMs = 400, maxMs = 4000, random: () => number = Math.random): number {
  const cap = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * cap);
}

function abortError(signal: AbortSignal): AppError {
  const reason: unknown = signal.reason;
  if (reason !== undefined) return toAppError(reason);
  const fallback = new Error('Aborted');
  fallback.name = 'AbortError';
  return toAppError(fallback);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, Math.floor(opts.attempts ?? 3));
  const baseMs = opts.baseMs ?? 400;
  const maxMs = opts.maxMs ?? 4000;
  const { signal, onRetry } = opts;

  for (let attempt = 1; ; attempt += 1) {
    if (signal?.aborted) throw abortError(signal);
    try {
      return await fn(attempt);
    } catch (caught) {
      if (signal?.aborted) throw abortError(signal);
      const error = toAppError(caught);
      if (!error.retryable || error.code === 'offline' || attempt >= attempts) throw error;
      onRetry?.(error, attempt);
      await sleep(backoffDelay(attempt, baseMs, maxMs), signal);
    }
  }
}

/**
 * Supabase calls resolve to `{ data, error }` instead of throwing. This returns `data` or throws the
 * error as an AppError, so it composes with withRetry: `withRetry(() => unwrap(supabase.from(…)))`.
 */
export async function unwrap<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  let response: { data: T; error: unknown };
  try {
    response = await p;
  } catch (caught) {
    throw toAppError(caught);
  }
  if (response.error) throw toAppError(response.error);
  return response.data;
}
