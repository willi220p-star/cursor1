// SHIM: replaced by the real module on merge
import type { AppError, AppErrorCode } from '@/studio/contracts';

const RETRYABLE: AppErrorCode[] = ['network', 'timeout', 'rate_limited', 'server'];

export function appError(code: AppErrorCode, message: string, cause?: unknown): AppError {
  return { code, message, retryable: RETRYABLE.includes(code), cause };
}

export function isAppError(value: unknown): value is AppError {
  return Boolean(value && typeof value === 'object' && 'code' in value && 'message' in value && 'retryable' in value);
}

export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  const record = (error && typeof error === 'object' ? error : {}) as { code?: string; message?: string; status?: number };
  const message = record.message || (typeof error === 'string' ? error : 'Something went wrong.');
  if (record.code === '42501') return appError('permission', 'You do not have permission to do that.', error);
  if (record.code === 'PGRST116') return appError('not_found', 'That item no longer exists.', error);
  if (record.code === '23505' || record.code === '23514' || record.code?.startsWith('22')) return appError('validation', message, error);
  if (record.status === 429) return appError('rate_limited', 'Too many requests. Try again in a moment.', error);
  if (record.status && record.status >= 500) return appError('server', 'The server had a problem. Try again.', error);
  if (/failed to fetch|network/i.test(message)) return appError('network', 'Could not reach the server. Check your connection.', error);
  return appError('unknown', message, error);
}

export function errorMessage(error: unknown): string {
  return toAppError(error).message;
}

export function conflictError(editor?: string, at?: string): AppError {
  const who = editor ? `Changed by ${editor}` : 'Changed by someone else';
  const when = at ? ` at ${new Date(at).toLocaleString()}` : '';
  return appError('conflict', `${who}${when}. Reload to see their version.`);
}
