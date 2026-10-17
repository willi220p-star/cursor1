import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appError } from './app-error';
import { backoffDelay, unwrap, withRetry } from './retry';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('backoffDelay', () => {
  it('uses full jitter capped at maxMs', () => {
    expect(backoffDelay(1, 400, 4000, () => 0.999)).toBe(399);
    expect(backoffDelay(2, 400, 4000, () => 0.5)).toBe(400);
    expect(backoffDelay(10, 400, 4000, () => 0.5)).toBe(2000);
    expect(backoffDelay(3, 400, 4000, () => 0)).toBe(0);
  });
});

describe('withRetry', () => {
  it('retries retryable errors and returns the result', async () => {
    const fn = vi.fn(async (attempt: number) => {
      if (attempt < 3) throw new TypeError('Failed to fetch');
      return 'ok';
    });
    const onRetry = vi.fn();
    const promise = withRetry(fn, { onRetry });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0].code).toBe('network');
    expect(onRetry.mock.calls.map((call) => call[1])).toEqual([1, 2]);
  });

  it('waits the jittered backoff between tries', async () => {
    const fn = vi.fn(async () => {
      throw { status: 503, message: 'down' };
    });
    const promise = withRetry(fn, { attempts: 3, baseMs: 400, maxMs: 4000 });
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(199); // 0.5 * 400
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(400); // 0.5 * 800
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('stops on a non-retryable error', async () => {
    const fn = vi.fn(async () => {
      throw { code: '42501', message: 'rls' };
    });
    await expect(withRetry(fn)).rejects.toMatchObject({ code: 'permission', retryable: false });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not spin while offline', async () => {
    const fn = vi.fn(async () => {
      throw appError('offline', 'offline');
    });
    await expect(withRetry(fn)).rejects.toMatchObject({ code: 'offline' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respects attempts and throws the final AppError', async () => {
    const fn = vi.fn(async () => {
      throw { status: 500, message: 'boom' };
    });
    const promise = withRetry(fn, { attempts: 4 });
    const settled = promise.catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await settled).toMatchObject({ code: 'server', retryable: true });
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('stops when the signal aborts during backoff', async () => {
    const controller = new AbortController();
    const fn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const promise = withRetry(fn, { signal: controller.signal, attempts: 5 });
    const settled = promise.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.runAllTimersAsync();
    expect(await settled).toMatchObject({ code: 'timeout' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not start when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn(async () => 'ok');
    await expect(withRetry(fn, { signal: controller.signal })).rejects.toMatchObject({ code: 'timeout' });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('unwrap', () => {
  it('returns data or throws an AppError', async () => {
    await expect(unwrap(Promise.resolve({ data: [1, 2], error: null }))).resolves.toEqual([1, 2]);
    await expect(unwrap(Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'no rows' } }))).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(unwrap(Promise.reject(new TypeError('Failed to fetch')))).rejects.toMatchObject({ code: 'network' });
  });

  it('composes with withRetry', async () => {
    let calls = 0;
    const promise = withRetry(() => {
      calls += 1;
      return unwrap(Promise.resolve(calls < 2 ? { data: null, error: { status: 503, message: 'x' } } : { data: 'done', error: null }));
    });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('done');
    expect(calls).toBe(2);
  });
});
