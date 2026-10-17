/**
 * One error shape for the whole app. Anything caught (fetch failures, Supabase/PostgREST/Postgres
 * errors, storage errors, aborts) becomes an AppError with a plain-English message that is safe to
 * show to a non-technical user. The raw error is kept in `cause` for logs and crash reports.
 * See docs/superpowers/specs/2026-10-17-team-spaces-bulk-files-errors-design.md ("Error foundation").
 */
import type { AppError, AppErrorCode } from '@/studio/contracts';
import { reportError } from '@/lib/report';

export type { AppError, AppErrorCode } from '@/studio/contracts';

const CODES: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>([
  'network',
  'offline',
  'timeout',
  'permission',
  'conflict',
  'not_found',
  'validation',
  'rate_limited',
  'server',
  'unknown',
]);

/** Default plain-English message per code. */
export const DEFAULT_MESSAGES: Readonly<Record<AppErrorCode, string>> = {
  network: "Couldn't reach the server. Check your connection and try again.",
  offline: "You're offline. Your change will be tried again when you're back online.",
  timeout: 'That took too long. Please try again.',
  permission: "You don't have permission to do that.",
  conflict: 'Someone else changed this. Reload to see their version.',
  not_found: "That item no longer exists. It may have been deleted.",
  validation: "Some of the details aren't valid. Check them and try again.",
  rate_limited: 'Too many requests right now. Wait a moment and try again.',
  server: 'The server had a problem. Please try again in a moment.',
  unknown: 'Something went wrong. Please try again.',
};

/**
 * True when trying again later could succeed. `offline` counts: the offline queue keeps those ops
 * and replays them once the browser is back online (withRetry does not spin on it, see retry.ts).
 */
export function isRetryableCode(code: AppErrorCode): boolean {
  return code === 'network' || code === 'offline' || code === 'timeout' || code === 'rate_limited' || code === 'server';
}

export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === 'string' && CODES.has(value as AppErrorCode);
}

export function appError(code: AppErrorCode, message: string, cause?: unknown): AppError {
  const error: AppError = { code, message: message || DEFAULT_MESSAGES[code], retryable: isRetryableCode(code) };
  if (cause !== undefined) error.cause = cause;
  return error;
}

export function isAppError(value: unknown): value is AppError {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return isAppErrorCode(v.code) && typeof v.message === 'string' && typeof v.retryable === 'boolean';
}

// ── Mapping ────────────────────────────────────────────────────────────

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** HTTP status from `status`, a storage-style `statusCode` string, or a FunctionsHttpError's `context`. */
function httpStatus(error: unknown): number | null {
  for (const candidate of [field(error, 'status'), field(error, 'statusCode'), field(field(error, 'context'), 'status')]) {
    const n = typeof candidate === 'number' ? candidate : typeof candidate === 'string' ? Number(candidate) : NaN;
    if (Number.isInteger(n) && n >= 100 && n <= 599) return n;
  }
  return null;
}

function rawMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  return text(field(error, 'message')) || text(field(error, 'error_description')) || text(field(error, 'error'));
}

const NAME_USED = 'That name is already used.';

/** Postgres SQLSTATE and PostgREST (PGRST…) codes. Returns null for codes we don't recognise. */
function fromDatabaseCode(code: string, cause: unknown): AppError | null {
  switch (code) {
    case '42501':
      return appError('permission', DEFAULT_MESSAGES.permission, cause);
    case 'PGRST116':
      return appError('not_found', DEFAULT_MESSAGES.not_found, cause);
    case 'PGRST301':
    case 'PGRST302':
    case 'PGRST303':
      return appError('permission', 'Your sign-in has expired. Sign in again and retry.', cause);
    case '23505':
      return appError('validation', NAME_USED, cause);
    case '23514':
      return appError('validation', "That value isn't allowed here.", cause);
    case '23502':
      return appError('validation', 'Something required is missing. Fill it in and try again.', cause);
    case '23503':
      return appError('validation', 'This refers to something that no longer exists. Reload and try again.', cause);
    case '40001':
    case '40P01':
      return appError('server', 'The server was busy. Please try again.', cause);
    case '57014':
      return appError('timeout', DEFAULT_MESSAGES.timeout, cause);
    case 'P0001':
      return appError('validation', "That change isn't allowed.", cause);
    case 'PGRST204':
    case 'PGRST202':
      return appError('server', "The app and the server are out of step. Reload the page and try again.", cause);
  }
  if (/^22[0-9A-Z]{3}$/.test(code)) {
    return appError('validation', "Some of the details aren't in the right format.", cause);
  }
  if (/^(53|08)[0-9A-Z]{3}$/.test(code)) {
    return appError('server', 'The server was busy. Please try again.', cause);
  }
  return null;
}

function fromStatus(status: number, message: string, cause: unknown): AppError | null {
  if (status === 401) return appError('permission', 'Your sign-in has expired. Sign in again and retry.', cause);
  if (status === 403) return appError('permission', DEFAULT_MESSAGES.permission, cause);
  if (status === 404) return appError('not_found', DEFAULT_MESSAGES.not_found, cause);
  if (status === 408) return appError('timeout', DEFAULT_MESSAGES.timeout, cause);
  if (status === 409) {
    // Storage and PostgREST use 409 for duplicates; anything else is a real edit conflict.
    return /already exists|duplicate/i.test(message)
      ? appError('validation', NAME_USED, cause)
      : appError('conflict', DEFAULT_MESSAGES.conflict, cause);
  }
  if (status === 413) return appError('validation', 'That file is too large.', cause);
  if (status === 429) return appError('rate_limited', DEFAULT_MESSAGES.rate_limited, cause);
  if (status >= 500) return appError('server', DEFAULT_MESSAGES.server, cause);
  if (status === 400 || status === 422) return appError('validation', DEFAULT_MESSAGES.validation, cause);
  return null;
}

const NETWORK_PATTERN = /failed to fetch|fetch failed|networkerror|network request failed|load failed|network error|err_network|err_internet_disconnected|econnrefused|econnreset|enotfound/i;

function browserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Turns anything thrown or returned as an error into an AppError. Never throws. */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;

  const name = text(field(error, 'name'));
  const message = rawMessage(error);
  const code = text(field(error, 'code'));
  const status = httpStatus(error);

  // Rows from bulk_* RPCs carry our own codes: { error_code, message }.
  const rowCode = field(error, 'error_code');
  if (isAppErrorCode(rowCode)) return appError(rowCode, DEFAULT_MESSAGES[rowCode], error);
  if (isAppErrorCode(code)) return appError(code, DEFAULT_MESSAGES[code], error);

  if (name === 'TimeoutError') return appError('timeout', DEFAULT_MESSAGES.timeout, error);
  if (name === 'AbortError') return appError('timeout', 'That was stopped before it finished. Please try again.', error);

  // A server answered: trust its code over the browser's online flag.
  if (code) {
    const mapped = fromDatabaseCode(code, error);
    if (mapped) return mapped;
  }
  if (status !== null) {
    const mapped = fromStatus(status, message, error);
    if (mapped) return mapped;
  }

  if (browserOffline()) return appError('offline', DEFAULT_MESSAGES.offline, error);
  if (NETWORK_PATTERN.test(message) || (name === 'TypeError' && /fetch|network/i.test(message))) {
    return appError('network', DEFAULT_MESSAGES.network, error);
  }
  if (/timed? ?out|timeout/i.test(message) || code === 'ETIMEDOUT') {
    return appError('timeout', DEFAULT_MESSAGES.timeout, error);
  }
  return appError('unknown', DEFAULT_MESSAGES.unknown, error);
}

export function errorMessage(error: unknown): string {
  return toAppError(error).message;
}

// ── Conflicts ──────────────────────────────────────────────────────────

/** "2 minutes ago", "just now", "yesterday"… Exported for tests and the activity log. */
export function relativeTime(at: string | number | Date, now: number = Date.now()): string | null {
  const then = at instanceof Date ? at.getTime() : typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(then)) return null;
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return `on ${new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

/** "Changed by Sam 2 minutes ago. Reload to see their version." */
export function conflictError(editor?: string | null, at?: string | null): AppError {
  const who = editor?.trim();
  const when = at ? relativeTime(at) : null;
  let lead: string;
  if (who && when) lead = `Changed by ${who} ${when}.`;
  else if (who) lead = `Changed by ${who}.`;
  else if (when) lead = `Changed by someone else ${when}.`;
  else lead = 'Someone else changed this.';
  return appError('conflict', `${lead} Reload to see their version.`, { editor: editor ?? null, at: at ?? null });
}

// ── Reporting ──────────────────────────────────────────────────────────

/** Codes that point at a bug or an outage. Offline, validation, permission etc. are expected noise. */
const UNEXPECTED: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>(['unknown', 'server']);

/** Sends unknown and server errors to crash reporting (Sentry). Returns true when it reported. */
export function reportIfUnexpected(error: AppError, context?: Record<string, unknown>): boolean {
  if (!UNEXPECTED.has(error.code)) return false;
  reportError(error.cause ?? error, { ...context, appErrorCode: error.code, appErrorMessage: error.message });
  return true;
}
