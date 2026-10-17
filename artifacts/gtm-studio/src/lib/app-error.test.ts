import { afterEach, describe, expect, it, vi } from 'vitest';
import { appError, conflictError, errorMessage, isAppError, relativeTime, reportIfUnexpected, toAppError } from './app-error';
import { setErrorReporter } from './report';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setErrorReporter(null);
  vi.restoreAllMocks();
});

function named(name: string, message = name): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe('appError / isAppError', () => {
  it('sets retryable from the code', () => {
    expect(appError('network', 'x').retryable).toBe(true);
    expect(appError('server', 'x').retryable).toBe(true);
    expect(appError('timeout', 'x').retryable).toBe(true);
    expect(appError('rate_limited', 'x').retryable).toBe(true);
    expect(appError('offline', 'x').retryable).toBe(true);
    for (const code of ['permission', 'conflict', 'not_found', 'validation', 'unknown'] as const) {
      expect(appError(code, 'x').retryable).toBe(false);
    }
  });

  it('keeps the cause and recognises AppErrors', () => {
    const cause = new Error('raw');
    const error = appError('validation', 'Bad', cause);
    expect(error.cause).toBe(cause);
    expect(isAppError(error)).toBe(true);
    expect(isAppError({ code: 'nope', message: 'x', retryable: true })).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(toAppError(error)).toBe(error);
  });
});

describe('toAppError mapping', () => {
  const table: Array<[string, unknown, string, boolean]> = [
    ['fetch TypeError', new TypeError('Failed to fetch'), 'network', true],
    ['Safari fetch', new TypeError('Load failed'), 'network', true],
    ['supabase wrapped fetch failure', { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' }, 'network', true],
    ['AbortError', named('AbortError'), 'timeout', true],
    ['TimeoutError', named('TimeoutError'), 'timeout', true],
    ['42501 RLS', { code: '42501', message: 'new row violates row-level security policy for table "campaigns"', details: null, hint: null }, 'permission', false],
    ['401', { status: 401, message: 'JWT expired' }, 'permission', false],
    ['403', { status: 403, message: 'Forbidden' }, 'permission', false],
    ['PGRST116', { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows' }, 'not_found', false],
    ['404', { status: 404, message: 'Not Found' }, 'not_found', false],
    ['23505', { code: '23505', message: 'duplicate key value violates unique constraint "folders_name_key"' }, 'validation', false],
    ['23514', { code: '23514', message: 'new row for relation "x" violates check constraint' }, 'validation', false],
    ['23502', { code: '23502', message: 'null value in column "name" violates not-null constraint' }, 'validation', false],
    ['22P02', { code: '22P02', message: 'invalid input syntax for type uuid: "abc"' }, 'validation', false],
    ['40001', { code: '40001', message: 'could not serialize access' }, 'server', true],
    ['40P01', { code: '40P01', message: 'deadlock detected' }, 'server', true],
    ['429', { status: 429, message: 'Too Many Requests' }, 'rate_limited', true],
    ['500', { status: 500, message: 'Internal Server Error' }, 'server', true],
    ['503', { status: 503, message: 'Service Unavailable' }, 'server', true],
    ['storage 404 string statusCode', { statusCode: '404', error: 'not_found', message: 'Object not found' }, 'not_found', false],
    ['storage 403', { statusCode: '403', message: 'new row violates row-level security policy' }, 'permission', false],
    ['storage 409 duplicate', { statusCode: '409', message: 'The resource already exists' }, 'validation', false],
    ['storage 413', { statusCode: '413', message: 'Payload too large' }, 'validation', false],
    ['409 conflict', { status: 409, message: 'Conflict' }, 'conflict', false],
    ['functions context status', { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status: 502 } }, 'server', true],
    ['bulk row', { id: '1', ok: false, error_code: 'conflict', message: 'version mismatch' }, 'conflict', false],
    ['plain Error', new Error('select * from x where'), 'unknown', false],
    ['string', 'boom', 'unknown', false],
    ['undefined', undefined, 'unknown', false],
  ];

  it.each(table)('%s', (_label, input, code, retryable) => {
    const error = toAppError(input);
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
    expect(error.cause).toBe(input);
  });

  it('never shows raw SQL text', () => {
    for (const [, input] of table) {
      const { message } = toAppError(input);
      expect(message).not.toMatch(/violates|constraint|relation|syntax|select|row-level|JWT|PGRST/i);
      expect(message.length).toBeGreaterThan(5);
    }
  });

  it('says a duplicate name is already used', () => {
    expect(toAppError({ code: '23505', message: 'duplicate key' }).message).toBe('That name is already used.');
  });

  it('maps to offline when the browser is offline and no server answered', () => {
    vi.stubGlobal('navigator', { onLine: false });
    const error = toAppError(new TypeError('Failed to fetch'));
    expect(error.code).toBe('offline');
    expect(error.retryable).toBe(true);
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe(error.message);
  });
});

describe('conflictError', () => {
  it('names the editor and time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
    const error = conflictError('Sam', '2026-10-17T11:58:00Z');
    expect(error.code).toBe('conflict');
    expect(error.retryable).toBe(false);
    expect(error.message).toBe('Changed by Sam 2 minutes ago. Reload to see their version.');
  });

  it('falls back without editor or time', () => {
    expect(conflictError().message).toBe('Someone else changed this. Reload to see their version.');
    expect(conflictError('Sam').message).toBe('Changed by Sam. Reload to see their version.');
    expect(conflictError(null, 'not a date').message).toBe('Someone else changed this. Reload to see their version.');
  });

  it('formats relative times', () => {
    const now = Date.parse('2026-10-17T12:00:00Z');
    expect(relativeTime('2026-10-17T11:59:50Z', now)).toBe('just now');
    expect(relativeTime('2026-10-17T11:59:00Z', now)).toBe('1 minute ago');
    expect(relativeTime('2026-10-17T09:00:00Z', now)).toBe('3 hours ago');
    expect(relativeTime('2026-10-16T12:00:00Z', now)).toBe('yesterday');
    expect(relativeTime('2026-10-12T12:00:00Z', now)).toBe('5 days ago');
  });
});

describe('reportIfUnexpected', () => {
  it('reports unknown and server errors only', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reporter = vi.fn();
    setErrorReporter(reporter);
    expect(reportIfUnexpected(appError('validation', 'x'))).toBe(false);
    expect(reportIfUnexpected(appError('offline', 'x'))).toBe(false);
    expect(reportIfUnexpected(appError('permission', 'x'))).toBe(false);
    expect(reporter).not.toHaveBeenCalled();
    const cause = new Error('raw');
    expect(reportIfUnexpected(appError('server', 'x', cause), { area: 'test' })).toBe(true);
    expect(reporter).toHaveBeenCalledWith(cause, expect.objectContaining({ area: 'test', appErrorCode: 'server' }));
    expect(reportIfUnexpected(toAppError('boom'))).toBe(true);
  });
});
