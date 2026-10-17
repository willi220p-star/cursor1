import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { toast } from 'sonner';
import type { SupabaseClient } from '@supabase/supabase-js';
import { showBulkResult } from '@/components/results-panel';
import { appError, toAppError } from '@/lib/app-error';
import { withRetry } from '@/lib/retry';
import { BULK_CHUNK, type AppError, type BulkFailure, type BulkResult, type BulkTarget } from './contracts';
import { ZIP_FETCH_CONCURRENCY, ZIP_MAX_FILES, planZipParts, zipPartName } from './batch-chunks';
import { chunk, skippedMessage, splitSupported } from './bulk';
import { isoDate } from './rename-pattern';
import { supabase } from './cloud';

/**
 * Library "Download ZIP": a campaign brings its stored files (in a folder named after it), a file
 * brings itself. Public URLs are fetched six at a time with retries, and ZIPs split at 400 files
 * like batch export. Failed files are listed in the results panel.
 */

export interface ZipEntry {
  target: BulkTarget;
  /** Path inside the ZIP, unique (case-insensitive). */
  path: string;
  url: string;
}

export interface ZipSource {
  target: BulkTarget;
  files: Array<{ filename: string; url: string }>;
}

/** A file or folder name safe on Windows, macOS and Linux. */
export function safeSegment(name: string, fallback = 'file') {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 120).trim();
  return cleaned || fallback;
}

/** "photo.png", then "photo (2).png", "photo (3).png"… Adds the chosen path to `taken`. */
export function uniqueZipPath(path: string, taken: Set<string>) {
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const file = path.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : '';
  let candidate = path;
  for (let copy = 2; taken.has(candidate.toLowerCase()); copy += 1) candidate = `${dir}${stem} (${copy})${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** Every file to put in the ZIP, in order: campaign files under "<campaign>/", loose files at the top. */
export function planZipEntries(sources: readonly ZipSource[]): ZipEntry[] {
  const taken = new Set<string>();
  const folders = new Set<string>();
  const entries: ZipEntry[] = [];
  for (const { target, files } of sources) {
    let dir = '';
    if (target.entity === 'campaign') {
      // Two campaigns with the same name get "Name/" and "Name (2)/".
      const base = safeSegment(target.name, 'campaign');
      dir = base;
      for (let copy = 2; folders.has(dir.toLowerCase()); copy += 1) dir = `${base} (${copy})`;
      folders.add(dir.toLowerCase());
      dir += '/';
    }
    for (const file of files) entries.push({ target, url: file.url, path: uniqueZipPath(`${dir}${safeSegment(file.filename)}`, taken) });
  }
  return entries;
}

/** ZIP parts of at most `maxFiles` entries. */
export function splitZipParts<T>(entries: readonly T[], maxFiles = ZIP_MAX_FILES): T[][] {
  return planZipParts(entries.map(() => ({ files: 1, bytes: 0 })), { maxFiles }).map((part) => part.map((index) => entries[index]));
}

/** One campaign or file gives its own name; a mixed selection gives "library-2026-10-17". */
export function zipBaseName(targets: readonly BulkTarget[], date = new Date()) {
  return targets.length === 1 ? targets[0].name.replace(/\.[a-z0-9]{2,5}$/i, '') : `library-${isoDate(date)}`;
}

const keyOf = (target: Pick<BulkTarget, 'entity' | 'id'>) => `${target.entity}:${target.id}`;

/** Per-target outcome: a campaign succeeds only when every one of its files made it into a ZIP. */
export function zipOutcome(sources: readonly ZipSource[], failedPaths: Map<string, { entry: ZipEntry; error: AppError }[]>, sourceErrors = new Map<string, AppError>()): Pick<BulkResult, 'succeeded' | 'failed'> {
  const succeeded: BulkTarget[] = [];
  const failed: BulkFailure[] = [];
  for (const { target, files } of sources) {
    const key = keyOf(target);
    const sourceError = sourceErrors.get(key);
    const fileFailures = failedPaths.get(key) ?? [];
    if (sourceError) failed.push({ target, error: sourceError });
    else if (!files.length) failed.push({ target, error: appError('not_found', target.entity === 'campaign' ? 'This campaign has no stored files yet.' : 'This file has no download link.') });
    else if (fileFailures.length) {
      const names = fileFailures.slice(0, 3).map(({ entry }) => entry.path.slice(entry.path.lastIndexOf('/') + 1)).join(', ');
      const more = fileFailures.length > 3 ? ` and ${fileFailures.length - 3} more` : '';
      const message = files.length === 1
        ? fileFailures[0].error.message
        : `${fileFailures.length} of ${files.length} files could not be downloaded: ${names}${more}. ${fileFailures[0].error.message}`;
      failed.push({ target, error: appError(fileFailures[0].error.code, message) });
    } else succeeded.push(target);
  }
  return { succeeded, failed };
}

async function pool<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

type AssetRow = { id: string; filename: string | null; public_url: string | null; campaign_id?: string | null };

/** Looks up the files behind each target. Query errors fail only the targets they belong to. */
async function resolveSources(targets: readonly BulkTarget[], client: SupabaseClient) {
  const sourceErrors = new Map<string, AppError>();
  const filesByKey = new Map<string, ZipSource['files']>();
  const fileRow = (row: AssetRow) => (row.public_url ? [{ filename: row.filename || row.id, url: row.public_url }] : []);
  const campaigns = targets.filter((target) => target.entity === 'campaign');
  const assets = targets.filter((target) => target.entity === 'asset');
  for (const slice of chunk(campaigns, BULK_CHUNK)) {
    try {
      const rows = await withRetry(async () => {
        const { data, error } = await client
          .from('outbound_assets')
          .select('id,filename,public_url,campaign_id')
          .in('campaign_id', slice.map((target) => target.id))
          .is('deleted_at', null)
          .order('created_at', { ascending: true });
        if (error) throw error;
        return (data ?? []) as AssetRow[];
      });
      for (const target of slice) filesByKey.set(keyOf(target), rows.filter((row) => row.campaign_id === target.id).flatMap(fileRow));
    } catch (error) {
      for (const target of slice) sourceErrors.set(keyOf(target), toAppError(error));
    }
  }
  for (const slice of chunk(assets, BULK_CHUNK)) {
    try {
      const rows = await withRetry(async () => {
        const { data, error } = await client.from('outbound_assets').select('id,filename,public_url').in('id', slice.map((target) => target.id));
        if (error) throw error;
        return (data ?? []) as AssetRow[];
      });
      for (const target of slice) {
        const row = rows.find((candidate) => candidate.id === target.id);
        if (!row) sourceErrors.set(keyOf(target), appError('not_found', 'This file no longer exists.'));
        else filesByKey.set(keyOf(target), fileRow(row));
      }
    } catch (error) {
      for (const target of slice) sourceErrors.set(keyOf(target), toAppError(error));
    }
  }
  const sources: ZipSource[] = [...campaigns, ...assets].map((target) => ({ target, files: filesByKey.get(keyOf(target)) ?? [] }));
  return { sources, sourceErrors };
}

export interface DownloadZipOptions {
  client?: SupabaseClient | null;
  fetcher?: typeof fetch;
  save?: (blob: Blob, filename: string) => void;
  /** false: no toasts or results panel. */
  show?: boolean;
  date?: Date;
}

async function fetchFile(url: string, fetcher: typeof fetch) {
  return withRetry(async () => {
    const response = await fetcher(url);
    if (!response.ok) {
      const code = response.status === 429 ? 'rate_limited' : response.status >= 500 ? 'server' : response.status === 404 ? 'not_found' : 'unknown';
      throw appError(code, code === 'not_found' ? 'The stored file is missing.' : `Download failed (HTTP ${response.status}).`);
    }
    return response.blob();
  });
}

/** Builds and saves the ZIP part(s) for the selected campaigns and files, then reports per item. */
export async function downloadZip(targets: readonly BulkTarget[], opts: DownloadZipOptions = {}): Promise<BulkResult> {
  const show = opts.show !== false;
  const client = opts.client === undefined ? supabase : opts.client;
  const fetcher = opts.fetcher ?? ((input, init) => fetch(input, init));
  const save = opts.save ?? ((blob, filename) => saveAs(blob, filename));
  const { supported, skipped } = splitSupported({ kind: 'download' }, targets);
  const skipText = skippedMessage(skipped);
  if (skipText && show) toast.info(skipText);
  const result: BulkResult = { action: 'download', total: supported.length, succeeded: [], failed: [], queued: [] };
  if (!supported.length) return result;
  if (!client) {
    result.failed = supported.map((target) => ({ target, error: appError('unknown', 'Cloud sync is not set up, so there is nothing stored to download.') }));
  } else {
    const toastId = show ? toast.loading(`Finding files for ${supported.length} ${supported.length === 1 ? 'item' : 'items'}…`) : undefined;
    try {
      const { sources, sourceErrors } = await resolveSources(supported, client);
      const entries = planZipEntries(sources);
      const parts = splitZipParts(entries);
      const failedPaths = new Map<string, { entry: ZipEntry; error: AppError }[]>();
      const fail = (entry: ZipEntry, error: AppError) => {
        const key = keyOf(entry.target);
        failedPaths.set(key, [...(failedPaths.get(key) ?? []), { entry, error }]);
      };
      const base = zipBaseName(supported, opts.date);
      let done = 0;
      for (const [index, part] of parts.entries()) {
        const zip = new JSZip();
        let added = 0;
        await pool(part, ZIP_FETCH_CONCURRENCY, async (entry) => {
          try {
            zip.file(entry.path, await fetchFile(entry.url, fetcher));
            added += 1;
          } catch (error) {
            fail(entry, toAppError(error));
          }
          done += 1;
          if (toastId !== undefined) {
            toast.loading(`Downloading ${done} of ${entries.length} files${parts.length > 1 ? ` · ZIP ${index + 1} of ${parts.length}` : ''}…`, { id: toastId });
          }
        });
        if (!added) continue;
        try {
          save(await zip.generateAsync({ type: 'blob' }), zipPartName(base, index + 1, parts.length));
        } catch (error) {
          const appErr = toAppError(error);
          for (const entry of part) fail(entry, appErr);
        }
      }
      Object.assign(result, zipOutcome(sources, failedPaths, sourceErrors));
    } finally {
      if (toastId !== undefined) toast.dismiss(toastId);
    }
  }
  if (show) showBulkResult(result, { verb: 'downloaded', onRetryFailed: (failed) => { void downloadZip(failed, opts); } });
  return result;
}
