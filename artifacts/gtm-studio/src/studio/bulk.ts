import { toast } from 'sonner';
import type { SupabaseClient } from '@supabase/supabase-js';
import { showBulkResult } from '@/components/results-panel';
import { appError, toAppError } from '@/lib/app-error';
import { enqueue, isOnline, registerQueueHandler } from '@/lib/offline-queue';
import { unwrap, withRetry } from '@/lib/retry';
import { supabase } from './cloud';
import {
  BULK_CHUNK,
  TRASH_DAYS,
  type AppError,
  type AppErrorCode,
  type BulkAction,
  type BulkFailure,
  type BulkResult,
  type BulkRowResult,
  type BulkTarget,
  type LibraryEntity,
} from './contracts';
import { applyRenamePattern } from './rename-pattern';

/**
 * Bulk Library actions: one bulk_* RPC per chunk of BULK_CHUNK ids, each chunk retried on temporary
 * errors, per-item results merged into one BulkResult. Offline, the whole action is queued instead.
 * See docs/superpowers/specs/2026-10-17-team-spaces-bulk-files-errors-design.md ("Bulk files").
 */

type Response = PromiseLike<{ data: unknown; error: unknown }>;

/** The slice of the Supabase client bulk actions need (tests pass a fake). */
export interface BulkClient {
  rpc(fn: string, args?: Record<string, unknown>): Response;
  storage: { from(bucket: string): { remove(paths: string[]): Response } };
}

export const ASSET_BUCKET = 'outbound-assets';
/** Storage objects removed per call after a purge. */
export const STORAGE_REMOVE_CHUNK = 100;

const defaultClient = () => supabase as unknown as BulkClient | null;

// ── Kinds ──────────────────────────────────────────────────────────────

/** Library rows say 'file'; the database calls them assets. */
export type LibraryKind = 'campaign' | 'template' | 'file' | 'folder';

export function entityForKind(kind: LibraryKind): LibraryEntity {
  return kind === 'file' ? 'asset' : kind;
}

export function kindForEntity(entity: LibraryEntity): LibraryKind {
  return entity === 'asset' ? 'file' : entity;
}

const entityNames: Record<LibraryEntity, [string, string]> = {
  campaign: ['campaign', 'campaigns'],
  template: ['template', 'templates'],
  asset: ['file', 'files'],
  folder: ['folder', 'folders'],
};

export function entityLabel(entity: LibraryEntity, count = 2) {
  return entityNames[entity][count === 1 ? 0 : 1];
}

export type ActionKind = BulkAction['kind'] | 'download';

/** Which kinds an action applies to. Templates are team-wide, so they never change space. */
export function supports(action: BulkAction | { kind: 'download' }, entity: LibraryEntity): boolean {
  switch (action.kind) {
    case 'update':
      return entity === 'campaign';
    case 'download':
      return entity === 'campaign' || entity === 'asset';
    case 'move':
      // Folders do not nest, but a folder can change client space with what is in it.
      return action.spaceId != null ? entity !== 'template' : entity !== 'folder';
    default:
      return true;
  }
}

export type Skipped = Partial<Record<LibraryEntity, number>>;

export function splitSupported(action: BulkAction | { kind: 'download' }, targets: readonly BulkTarget[]) {
  const supported: BulkTarget[] = [];
  const skipped: Skipped = {};
  for (const target of targets) {
    if (supports(action, target.entity)) supported.push(target);
    else skipped[target.entity] = (skipped[target.entity] ?? 0) + 1;
  }
  return { supported, skipped };
}

/** "3 templates skipped: not supported for templates" (one clause per kind). */
export function skippedMessage(skipped: Skipped): string {
  return (Object.entries(skipped) as Array<[LibraryEntity, number]>)
    .filter(([, count]) => count > 0)
    .map(([entity, count]) => `${count} ${entityLabel(entity, count)} skipped: not supported for ${entityLabel(entity)}`)
    .join('. ');
}

export const actionVerbs: Record<ActionKind, string> = {
  trash: 'moved to Trash',
  restore: 'restored',
  purge: 'deleted forever',
  move: 'moved',
  update: 'updated',
  rename: 'renamed',
  download: 'downloaded',
};

// ── Chunking and merging (pure) ────────────────────────────────────────

export function chunk<T>(items: readonly T[], size = BULK_CHUNK): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

/** Targets grouped by entity, in first-seen order; duplicate ids are dropped. */
export function groupByEntity(targets: readonly BulkTarget[]): Map<LibraryEntity, BulkTarget[]> {
  const groups = new Map<LibraryEntity, BulkTarget[]>();
  const seen = new Set<string>();
  for (const target of targets) {
    const key = `${target.entity}:${target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const group = groups.get(target.entity) ?? [];
    group.push(target);
    groups.set(target.entity, group);
  }
  return groups;
}

const ERROR_CODES: AppErrorCode[] = ['network', 'offline', 'timeout', 'permission', 'conflict', 'not_found', 'validation', 'rate_limited', 'server', 'unknown'];

const defaultMessages: Record<AppErrorCode, string> = {
  network: 'Could not reach the server.',
  offline: 'You are offline.',
  timeout: 'The server took too long to answer.',
  permission: 'You do not have permission to change this item.',
  conflict: 'Someone else changed this item. Reload to see their version.',
  not_found: 'This item no longer exists.',
  validation: 'The server did not accept this change.',
  rate_limited: 'Too many requests. Try again shortly.',
  server: 'The server had a problem.',
  unknown: 'Something went wrong.',
};

/** The AppError for one failed RPC row. */
export function rowError(row: Pick<BulkRowResult, 'error_code' | 'message'>): AppError {
  const code = ERROR_CODES.includes(row.error_code as AppErrorCode) ? (row.error_code as AppErrorCode) : 'unknown';
  return appError(code, row.message?.trim() || defaultMessages[code]);
}

const missingRow = () => appError('unknown', 'The server did not report a result for this item.');

/** Splits one chunk's targets by its RPC rows. A target without a row counts as failed. */
export function mergeRows(targets: readonly BulkTarget[], rows: readonly BulkRowResult[] | null | undefined) {
  const byId = new Map((rows ?? []).map((row) => [row.id, row]));
  const succeeded: BulkTarget[] = [];
  const failed: BulkFailure[] = [];
  const okRows: BulkRowResult[] = [];
  for (const target of targets) {
    const row = byId.get(target.id);
    if (row?.ok) {
      succeeded.push(target);
      okRows.push(row);
    } else failed.push({ target, error: row ? rowError(row) : missingRow() });
  }
  return { succeeded, failed, okRows };
}

/** The RPC name and arguments for one chunk. */
export function rpcCall(action: BulkAction, entity: LibraryEntity, targets: readonly BulkTarget[], names: Record<string, string> = {}) {
  const ids = targets.map((target) => target.id);
  switch (action.kind) {
    case 'trash':
      return { fn: 'bulk_trash', args: { entity, ids } };
    case 'restore':
      return { fn: 'bulk_restore', args: { entity, ids } };
    case 'purge':
      return { fn: 'bulk_purge', args: { entity, ids } };
    case 'move':
      return { fn: 'bulk_move', args: { entity, ids, target_folder: action.folderId, target_space: action.spaceId ?? null } };
    case 'update':
      return { fn: 'bulk_update_campaigns', args: { ids, patch: action.patch } };
    case 'rename':
      return {
        fn: 'bulk_rename',
        args: { entity, items: targets.map((target) => ({ id: target.id, name: names[target.id] ?? target.name, version: target.version })) },
      };
  }
}

/** Storage paths a purge row returns in `message`: a JSON array, or one per line (commas also accepted). */
export function parsePaths(message: string | null | undefined): string[] {
  const text = message?.trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.filter((path): path is string => typeof path === 'string' && Boolean(path.trim()));
    } catch {
      // Not JSON; fall through to splitting.
    }
  }
  return text.split(/[\n,]/).map((path) => path.trim()).filter(Boolean);
}

export function emptyResult(action: ActionKind): BulkResult {
  return { action, total: 0, succeeded: [], failed: [], queued: [] };
}

// ── Running ────────────────────────────────────────────────────────────

export interface RenameContext {
  /** {client} per target id. */
  clients?: Record<string, string | null | undefined>;
  /** Names other items of each kind already use; new names avoid them. */
  taken?: Partial<Record<LibraryEntity, string[]>>;
  date?: Date;
}

export interface RunBulkOptions {
  client?: BulkClient | null;
  rename?: RenameContext;
  /** Fixed new names per id (retries reuse the names computed the first time). */
  names?: Record<string, string>;
  /** false: no results panel or skip message; the caller reports. */
  show?: boolean;
  /** After every run, including "Retry failed" runs. Use it to refresh the Library. */
  onDone?: (result: BulkResult) => void;
}

/** New names for a rename, computed per kind so " (2)" de-duplication matches each table's names. */
export function renameNames(pattern: string, targets: readonly BulkTarget[], context: RenameContext = {}): Record<string, string> {
  const names: Record<string, string> = {};
  for (const [entity, group] of groupByEntity(targets)) {
    const selected = new Set(group.map((target) => target.name.toLowerCase()));
    const taken = (context.taken?.[entity] ?? []).filter((name) => !selected.has(name.toLowerCase()));
    const next = applyRenamePattern(pattern, group.map((target) => ({ name: target.name, client: context.clients?.[target.id] })), { taken, date: context.date });
    group.forEach((target, index) => { names[target.id] = next[index]; });
  }
  return names;
}

type Executed = { result: BulkResult; storageFailures: string[] };

async function removeStorage(client: BulkClient, paths: string[]): Promise<string[]> {
  const failures: string[] = [];
  for (const slice of chunk(paths, STORAGE_REMOVE_CHUNK)) {
    try {
      await withRetry(() => unwrap(client.storage.from(ASSET_BUCKET).remove(slice)));
    } catch (error) {
      failures.push(`${slice.length} stored ${slice.length === 1 ? 'file' : 'files'}: ${toAppError(error).message}`);
    }
  }
  return failures;
}

/** Runs the RPCs now. Never throws: every target ends up succeeded or failed. */
export async function executeBulk(action: BulkAction, targets: readonly BulkTarget[], options: { client?: BulkClient | null; names?: Record<string, string> } = {}): Promise<Executed> {
  const client = options.client === undefined ? defaultClient() : options.client;
  const result: BulkResult = { ...emptyResult(action.kind), total: targets.length };
  if (!client) {
    const error = appError('unknown', 'Cloud sync is not set up, so this could not run.');
    result.failed = targets.map((target) => ({ target, error }));
    return { result, storageFailures: [] };
  }
  const paths: string[] = [];
  for (const [entity, group] of groupByEntity(targets)) {
    for (const slice of chunk(group)) {
      const { fn, args } = rpcCall(action, entity, slice, options.names);
      try {
        const rows = await withRetry(() => unwrap(client.rpc(fn, args))) as BulkRowResult[] | null;
        const merged = mergeRows(slice, rows);
        result.succeeded.push(...merged.succeeded);
        result.failed.push(...merged.failed);
        if (action.kind === 'purge') for (const row of merged.okRows) paths.push(...parsePaths(row.message));
      } catch (error) {
        const appErr = toAppError(error);
        result.failed.push(...slice.map((target) => ({ target, error: appErr })));
      }
    }
  }
  const storageFailures = paths.length ? await removeStorage(client, [...new Set(paths)]) : [];
  return { result, storageFailures };
}

function reportStorage(failures: string[]) {
  if (!failures.length) return;
  toast.error('Removed from the library, but some stored files could not be deleted', {
    description: `${failures.join('\n')}\nThey stay in storage; nothing links to them any more.`,
    duration: 12_000,
  });
}

const applied = new Set<(result: BulkResult) => void>();

/** Called after any bulk action lands, including ones replayed from the offline queue. */
export function onBulkApplied(listener: (result: BulkResult) => void) {
  applied.add(listener);
  return () => { applied.delete(listener); };
}

function notifyApplied(result: BulkResult) {
  for (const listener of applied) {
    try {
      listener(result);
    } catch {
      // A listener must not break the others.
    }
  }
}

export function queueLabel(action: BulkAction, count: number) {
  const items = `${count} ${count === 1 ? 'item' : 'items'}`;
  switch (action.kind) {
    case 'trash': return `Move ${items} to Trash`;
    case 'restore': return `Restore ${items}`;
    case 'purge': return `Delete ${items} forever`;
    case 'move': return `Move ${items}`;
    case 'update': return `Update ${items}`;
    case 'rename': return `Rename ${items}`;
  }
}

type QueuedBulk = { action: BulkAction; targets: BulkTarget[]; names?: Record<string, string> };

/**
 * Runs a bulk action on every supported target and reports the result (unless `show: false`).
 * Kinds an action does not apply to are skipped with a message, not failed.
 */
export async function runBulk(action: BulkAction, targets: readonly BulkTarget[], opts: RunBulkOptions = {}): Promise<BulkResult> {
  const show = opts.show !== false;
  const { supported, skipped } = splitSupported(action, targets);
  const skipText = skippedMessage(skipped);
  if (skipText && show) toast.info(skipText);
  if (!supported.length) return emptyResult(action.kind);

  const names = action.kind === 'rename' ? opts.names ?? renameNames(action.pattern, supported, opts.rename) : undefined;
  let result: BulkResult;
  let storageFailures: string[] = [];
  if (!isOnline()) {
    const payload: QueuedBulk = { action, targets: supported, names };
    await enqueue({ kind: 'bulk', payload, label: queueLabel(action, supported.length) });
    result = { ...emptyResult(action.kind), total: supported.length, queued: supported };
  } else {
    ({ result, storageFailures } = await executeBulk(action, supported, { client: opts.client, names }));
  }

  if (show) {
    showBulkResult(result, {
      verb: actionVerbs[action.kind],
      onRetryFailed: (failed) => { void runBulk(action, failed, { ...opts, names }); },
    });
    reportStorage(storageFailures);
  }
  if (result.succeeded.length) notifyApplied(result);
  opts.onDone?.(result);
  return result;
}

registerQueueHandler('bulk', async (payload) => {
  const { action, targets, names } = payload as QueuedBulk;
  const { result, storageFailures } = await executeBulk(action, targets, { names });
  reportStorage(storageFailures);
  // Nothing landed: hand the error back so the queue can retry or stop and report.
  if (!result.succeeded.length && result.failed.length) throw result.failed[0].error;
  showBulkResult(result, {
    verb: actionVerbs[action.kind],
    onRetryFailed: (failed) => { void runBulk(action, failed, { names }); },
  });
  notifyApplied(result);
});

/**
 * Moves items to Trash with an Undo toast ("Moved to Trash · Undo"). Partial failures and queued
 * runs go to the results panel instead.
 */
export async function trashWithUndo(targets: readonly BulkTarget[], opts: Omit<RunBulkOptions, 'show' | 'names' | 'rename'> = {}): Promise<BulkResult> {
  const result = await runBulk({ kind: 'trash' }, targets, { ...opts, show: false });
  if (result.failed.length || result.queued.length) {
    showBulkResult(result, {
      verb: actionVerbs.trash,
      onRetryFailed: (failed) => { void trashWithUndo(failed, opts); },
    });
    return result;
  }
  if (!result.succeeded.length) return result;
  const moved = result.succeeded;
  toast('Moved to Trash', {
    description: moved.length === 1 ? `${moved[0].name} · restore it any time in the next ${TRASH_DAYS} days` : `${moved.length} items · restore them any time in the next ${TRASH_DAYS} days`,
    duration: 10_000,
    action: { label: 'Undo', onClick: () => { void runBulk({ kind: 'restore' }, moved, { client: opts.client, onDone: opts.onDone }); } },
  });
  return result;
}

// ── Trash listing ──────────────────────────────────────────────────────

export interface TrashItem {
  entity: LibraryEntity;
  id: string;
  name: string;
  deletedAt: string;
  deletedBy: string | null;
  /** "you", a teammate's name, or null when unknown. */
  deletedByName: string | null;
  spaceId: string | null;
  storagePath?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days until the daily purge removes it: 30 right after deleting, 0 when it is due. */
export function trashDaysLeft(deletedAt: string, now = Date.now()) {
  const at = Date.parse(deletedAt);
  if (!Number.isFinite(at)) return TRASH_DAYS;
  return Math.max(0, Math.min(TRASH_DAYS, Math.ceil((at + TRASH_DAYS * DAY_MS - now) / DAY_MS)));
}

const trashTables: Array<{ entity: LibraryEntity; table: string; name: string; extra: string }> = [
  { entity: 'campaign', table: 'outbound_campaigns', name: 'name', extra: ',space_id' },
  { entity: 'template', table: 'outbound_templates', name: 'name', extra: '' },
  { entity: 'asset', table: 'outbound_assets', name: 'filename', extra: ',space_id,storage_path' },
  { entity: 'folder', table: 'outbound_folders', name: 'name', extra: ',space_id' },
];

/** Most trashed rows read per table. */
export const TRASH_LIST_LIMIT = 500;

/**
 * Everything in Trash, newest first. Each table loads on its own, so one failure still shows the
 * rest; failed tables are named in `failed`.
 */
export async function listTrash(userId?: string, client: SupabaseClient | null = supabase): Promise<{ items: TrashItem[]; failed: string[] }> {
  if (!client) return { items: [], failed: [] };
  const failed: string[] = [];
  const lists = await Promise.all(trashTables.map(async ({ entity, table, name, extra }) => {
    const { data, error } = await client
      .from(table)
      .select(`id,${name},deleted_at,deleted_by${extra}`)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
      .limit(TRASH_LIST_LIMIT);
    if (error) {
      failed.push(entityLabel(entity));
      return [];
    }
    return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row): TrashItem => ({
      entity,
      id: String(row.id),
      name: String(row[name] ?? 'Untitled'),
      deletedAt: String(row.deleted_at),
      deletedBy: (row.deleted_by as string | null) ?? null,
      deletedByName: null,
      spaceId: (row.space_id as string | null | undefined) ?? null,
      storagePath: (row.storage_path as string | undefined) ?? undefined,
    }));
  }));
  const items = lists.flat().sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  const others = [...new Set(items.map((item) => item.deletedBy).filter((id): id is string => Boolean(id) && id !== userId))];
  const names = new Map<string, string>();
  if (others.length) {
    // Profiles may not be readable (or exist yet); the list still shows without names.
    const { data } = await client.from('profiles').select('user_id,display_name,email').in('user_id', others);
    for (const row of (data ?? []) as Array<{ user_id: string; display_name: string | null; email: string | null }>) {
      names.set(row.user_id, row.display_name || row.email || 'a teammate');
    }
  }
  for (const item of items) {
    item.deletedByName = !item.deletedBy ? null : item.deletedBy === userId ? 'you' : names.get(item.deletedBy) ?? 'a teammate';
  }
  return { items, failed };
}
