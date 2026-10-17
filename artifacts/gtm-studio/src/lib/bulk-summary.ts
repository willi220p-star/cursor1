/**
 * Wording for bulk results ("Moved 47 items", "47 moved, 3 failed"). Kept free of React so it can be
 * unit tested and reused by the results panel, toasts and the activity log.
 */
import type { AppErrorCode, BulkFailure, BulkResult } from '@/studio/contracts';

/** Past-tense phrase per action. The first word is the verb; the rest trails the count. */
const DEFAULT_VERBS: Record<BulkResult['action'], string> = {
  trash: 'moved to Trash',
  restore: 'restored',
  purge: 'deleted forever',
  move: 'moved',
  update: 'updated',
  rename: 'renamed',
  download: 'downloaded',
};

export function defaultVerb(action: BulkResult['action']): string {
  return DEFAULT_VERBS[action] ?? 'done';
}

export function countNoun(count: number, action: BulkResult['action']): string {
  const noun = action === 'download' ? 'file' : 'item';
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function changes(count: number): string {
  return `${count} change${count === 1 ? '' : 's'}`;
}

export interface BulkSummary {
  kind: 'success' | 'partial' | 'queued' | 'empty';
  title: string;
  description?: string;
}

/** Short label per error code, used as group headings in the results panel. */
export const ERROR_GROUP_LABELS: Record<AppErrorCode, string> = {
  permission: 'Not allowed',
  conflict: 'Changed by someone else',
  not_found: 'No longer exists',
  validation: 'Needs a fix',
  network: 'Connection problem',
  offline: 'Offline',
  timeout: 'Took too long',
  rate_limited: 'Too many requests',
  server: 'Server problem',
  unknown: 'Something went wrong',
};

export interface FailureGroup {
  code: AppErrorCode;
  label: string;
  /** The reason shared by the group (the first item's message). */
  message: string;
  failures: BulkFailure[];
}

/** Groups failures by error code, largest group first, keeping input order inside each group. */
export function groupFailures(failed: BulkFailure[]): FailureGroup[] {
  const groups = new Map<AppErrorCode, FailureGroup>();
  for (const failure of failed) {
    const code = failure.error.code;
    let group = groups.get(code);
    if (!group) {
      group = { code, label: ERROR_GROUP_LABELS[code] ?? ERROR_GROUP_LABELS.unknown, message: failure.error.message, failures: [] };
      groups.set(code, group);
    }
    group.failures.push(failure);
  }
  return [...groups.values()].sort((a, b) => b.failures.length - a.failures.length);
}

export function summarizeBulkResult(result: BulkResult, verb: string = defaultVerb(result.action)): BulkSummary {
  const ok = result.succeeded.length;
  const failed = result.failed.length;
  const queued = result.queued.length;
  const [first, ...rest] = verb.trim().split(/\s+/);
  const trailing = rest.length ? ` ${rest.join(' ')}` : '';
  const queuedNote = `${changes(queued)} will sync when you're back online`;

  if (failed > 0) {
    const parts = [`${ok === 0 ? 'None' : ok} ${verb}`, `${failed} failed`];
    if (queued > 0) parts.push(`${queued} waiting to sync`);
    const groups = groupFailures(result.failed);
    return { kind: 'partial', title: parts.join(', '), description: groups.length === 1 ? groups[0].message : 'Open Details to see what went wrong.' };
  }
  if (queued > 0) {
    if (ok === 0) return { kind: 'queued', title: capitalise(queuedNote) };
    return { kind: 'queued', title: `${capitalise(first)} ${countNoun(ok, result.action)}${trailing}`, description: capitalise(queuedNote) + '.' };
  }
  if (ok === 0) return { kind: 'empty', title: 'Nothing changed' };
  return { kind: 'success', title: `${capitalise(first)} ${countNoun(ok, result.action)}${trailing}` };
}

/** Plain text for "Copy details". */
export function bulkResultText(result: BulkResult, verb: string = defaultVerb(result.action)): string {
  const lines = [summarizeBulkResult(result, verb).title];
  for (const group of groupFailures(result.failed)) {
    lines.push('', `${group.label} (${group.failures.length}): ${group.message}`);
    for (const failure of group.failures) {
      const reason = failure.error.message !== group.message ? ` - ${failure.error.message}` : '';
      lines.push(`- ${failure.target.name}${reason}`);
    }
  }
  if (result.queued.length) {
    lines.push('', `Waiting to sync (${result.queued.length}):`);
    for (const target of result.queued) lines.push(`- ${target.name}`);
  }
  return lines.join('\n');
}
