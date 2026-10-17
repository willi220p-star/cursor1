// SHIM: replaced by the real module on merge
import { toAppError } from '@/lib/app-error';

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number; maxMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      const appErr = toAppError(error);
      if (!appErr.retryable || opts.signal?.aborted || attempt === attempts - 1) throw appErr;
      const wait = Math.random() * Math.min(opts.maxMs ?? 4000, (opts.baseMs ?? 400) * 2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw toAppError(last);
}

export async function unwrap<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw toAppError(error);
  return data;
}
