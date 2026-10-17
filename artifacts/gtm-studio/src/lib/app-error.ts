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
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return appError('offline', 'You are offline. Changes will sync when you reconnect.', error);
  const record = (error && typeof error === 'object' ? error : {}) as { code?: string; status?: number; message?: string };
  const code = String(record.code ?? '');
  if (code === '42501') return appError('permission', 'You do not have permission to do that.', error);
  if (code === 'PGRST116') return appError('not_found', 'That item no longer exists.', error);
  if (code === '23505' || code === '23514' || code.startsWith('22')) return appError('validation', record.message || 'That value is not allowed.', error);
  if (record.status === 429) return appError('rate_limited', 'Too many requests. Try again in a moment.', error);
  if (record.status && record.status >= 500) return appError('server', 'The server had a problem. Try again.', error);
  if (error instanceof TypeError) return appError('network', 'Could not reach the server. Check your connection.', error);
  return appError('unknown', record.message || 'Something went wrong.', error);
}

export function errorMessage(error: unknown): string {
  return toAppError(error).message;
}

export function conflictError(editor?: string, at?: string): AppError {
  return appError('conflict', `Changed by ${editor ?? 'someone else'}${at ? ` at ${at}` : ''}. Reload to see their version.`);
}
