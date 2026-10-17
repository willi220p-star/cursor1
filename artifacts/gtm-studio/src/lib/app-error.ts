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
  const raw = (error ?? {}) as { code?: string; status?: number; message?: string };
  const message = typeof raw.message === 'string' && raw.message ? raw.message : 'Something went wrong.';
  if (error instanceof TypeError && /fetch|network/i.test(message)) return appError('network', 'Could not reach the server.', error);
  if (raw.code === '42501') return appError('permission', 'You do not have permission to do that.', error);
  if (raw.code === 'PGRST116') return appError('not_found', 'That item no longer exists.', error);
  if (raw.status === 429) return appError('rate_limited', 'Too many requests. Try again shortly.', error);
  if (typeof raw.status === 'number' && raw.status >= 500) return appError('server', message, error);
  return appError('unknown', message, error);
}

export function errorMessage(error: unknown): string {
  return toAppError(error).message;
}

export function conflictError(editor?: string, at?: string): AppError {
  const who = editor ? `Changed by ${editor}` : 'Changed by someone else';
  return appError('conflict', `${who}${at ? ` at ${at}` : ''}. Reload to see their version.`);
}
