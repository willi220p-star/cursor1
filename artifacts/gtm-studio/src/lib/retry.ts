// SHIM: replaced by the real module on merge
import { toAppError } from './app-error';

export type RetryOptions = { attempts?: number; baseMs?: number; maxMs?: number; signal?: AbortSignal };

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { attempts = 3, baseMs = 400, maxMs = 4000 } = opts;
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      const app = toAppError(error);
      if (!app.retryable || attempt === attempts - 1 || opts.signal?.aborted) throw app;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * Math.min(maxMs, baseMs * 2 ** attempt)));
    }
  }
  throw toAppError(last);
}

/** Resolves a Supabase `{ data, error }` result to its data, or throws an AppError. */
export async function unwrap<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw toAppError(error);
  return data as T;
}
