// SHIM: replaced by the real module on merge
import { toAppError } from './app-error';

export type RetryOptions = {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  signal?: AbortSignal;
  onRetry?: (error: unknown, attempt: number) => void;
};

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { attempts = 3, baseMs = 400, maxMs = 4000, signal, onRetry } = opts;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= attempts || signal?.aborted || !toAppError(error).retryable) throw error;
      onRetry?.(error, attempt);
      await new Promise((resolve) => setTimeout(resolve, Math.random() * Math.min(maxMs, baseMs * 2 ** (attempt - 1))));
    }
  }
}

export async function unwrap<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}
