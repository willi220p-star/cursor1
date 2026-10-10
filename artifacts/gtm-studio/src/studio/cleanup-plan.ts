import { outputColumnNames } from './writeback';
import type { Contact, StudioMode } from './types';

/**
 * "Clean up old versions": which of one campaign's generated files its current list no longer
 * links to. Pure, so every rule is unit tested; cleanup.ts does the Supabase reads and deletes.
 *
 * Rules, in order of safety:
 * - Only rows of THIS campaign (campaign_id match) that are generated output (metadata.role
 *   'generated') can be removed. Imported lists, uploaded desk/paper/signature/source images,
 *   carousels and anything with another (or no) campaign id are never candidates.
 * - A file stays if any value in the campaign's current list points at it (every column, so
 *   `<prefix>_url`, `<prefix>_still_url`, image_url and smartlead_image_url all count), or if
 *   another campaign's list points at it.
 * - A GIF's still JPG has no asset row; it lives in the parent row's metadata.still_url. It stays
 *   with a kept parent and goes with a removed parent (unless something links to it directly).
 * - A list with no generated links at all (never stamped), or whose links match none of this
 *   campaign's files, is refused: deleting "everything not linked" would delete everything.
 */

export const ASSET_BUCKET = 'outbound-assets';

export type CleanupAssetRow = {
  id?: string | null;
  campaign_id?: string | null;
  storage_path?: string | null;
  public_url?: string | null;
  filename?: string | null;
  bytes?: number | null;
  created_at?: string | null;
  metadata?: unknown;
};

export type CleanupCampaign = {
  id: string;
  mode: StudioMode;
  contacts: Contact[] | null | undefined;
};

export type CleanupFile = {
  /** Normalised path, used for matching. */
  path: string;
  /** The object name exactly as stored (the row's storage_path), used for the delete calls. */
  storagePath: string;
  name: string;
  /** ISO time of the upload, when known. */
  createdAt: string | null;
  /** Bytes, when known (storage object metadata first, then the asset row). */
  bytes: number | null;
  /** The outbound_assets row id; a GIF still has none. */
  assetId: string | null;
  kind: 'generated' | 'still';
  /** For a still, the GIF it belongs to. */
  parentPath?: string;
};

export type CleanupPlan = {
  keep: CleanupFile[];
  remove: CleanupFile[];
  /** Total known bytes of `remove`. */
  bytes: number;
  /** How many files in `remove` have no known size (then show the count only). */
  unknownSizes: number;
  /** Set when the clean-up must not run; `remove` is then empty. */
  refused?: string;
};

export type CleanupOptions = {
  /** Paths must start with `${userId}/` to be removed. */
  userId?: string;
  /** Other campaigns' lists: anything they link to is kept too. */
  otherCampaigns?: Array<{ id: string; contacts: Contact[] | null | undefined }>;
  /** Object sizes from storage.list, keyed by storage path. */
  sizes?: Map<string, number>;
};

const OBJECT_MARKERS = [
  `/storage/v1/object/public/${ASSET_BUCKET}/`,
  `/storage/v1/object/sign/${ASSET_BUCKET}/`,
  `/storage/v1/object/authenticated/${ASSET_BUCKET}/`,
  `/storage/v1/render/image/public/${ASSET_BUCKET}/`,
  `/storage/v1/object/${ASSET_BUCKET}/`,
];

function safeDecode(value: string) {
  let current = value;
  // Decode until stable (twice-encoded links happen when a URL is pasted through a sheet).
  for (let step = 0; step < 3; step++) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next;
    } catch {
      break;
    }
  }
  return current;
}

/** One canonical form of a storage path: decoded, no query or hash, no leading slash, NFC. */
export function normalizeStoragePath(path: string | null | undefined): string | null {
  if (typeof path !== 'string') return null;
  const bare = path.trim().split(/[?#]/)[0].replace(/^\/+/, '');
  if (!bare) return null;
  return safeDecode(bare).normalize('NFC');
}

/** The storage path a link points at in the asset bucket, or null when it is not one of ours. */
export function storagePathFromUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.startsWith('data:')) return null;
  for (const marker of OBJECT_MARKERS) {
    const at = text.indexOf(marker);
    if (at !== -1) return normalizeStoragePath(text.slice(at + marker.length));
  }
  // The same marker, percent-encoded inside a wrapped link (e.g. an image proxy's ?url=).
  const decoded = safeDecode(text);
  if (decoded !== text) return storagePathFromUrl(decoded);
  return null;
}

function metadataOf(row: CleanupAssetRow) {
  return (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as {
    role?: unknown;
    kind?: unknown;
    still_url?: unknown;
  };
}

function rowPath(row: CleanupAssetRow) {
  return normalizeStoragePath(row.storage_path) ?? storagePathFromUrl(row.public_url);
}

/** Every storage path any cell of these rows links to. */
export function referencedPaths(rows: Contact[] | null | undefined, into = new Set<string>()) {
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    for (const value of Object.values(row)) {
      const path = storagePathFromUrl(value);
      if (path) into.add(path);
    }
  }
  return into;
}

/** Storage paths in this campaign's own output columns: proof the list was stamped by a run. */
export function stampedPaths(campaign: CleanupCampaign) {
  const columns = new Set(outputColumnNames(campaign.mode));
  const found = new Set<string>();
  for (const row of Array.isArray(campaign.contacts) ? campaign.contacts : []) {
    if (!row || typeof row !== 'object') continue;
    for (const column of columns) {
      const path = storagePathFromUrl(row[column]);
      if (path) found.add(path);
    }
  }
  return found;
}

/** Reserved first-level folders under the user's folder that only hold non-generated files. */
const RESERVED_FOLDERS = new Set(['lists', 'uploads', 'carousels']);

function isRemovableGenerated(row: CleanupAssetRow, campaignId: string, path: string, userId?: string) {
  if (!campaignId || row.campaign_id !== campaignId) return false;
  const meta = metadataOf(row);
  if (meta.role !== 'generated') return false;
  if (meta.kind === 'list' || meta.kind === 'carousel') return false;
  if (userId && !path.startsWith(`${userId}/`)) return false;
  const segments = path.split('/');
  if (segments.length < 3) return false;
  if (RESERVED_FOLDERS.has(segments[1])) return false;
  return true;
}

const directoryOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** "a1b2…-row-7.png" → "row-7.png": the upload prefixes each file with a version uuid. */
export function displayName(path: string, filename?: string | null) {
  if (filename && filename.trim()) return filename.trim();
  return nameOf(path).replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '');
}

export function planCleanup(campaign: CleanupCampaign, assetRows: CleanupAssetRow[], options: CleanupOptions = {}): CleanupPlan {
  const { userId, otherCampaigns = [], sizes } = options;
  const empty = (refused?: string): CleanupPlan => ({ keep: [], remove: [], bytes: 0, unknownSizes: 0, ...(refused ? { refused } : {}) });
  if (!campaign?.id) return empty('Save this campaign to Supabase before cleaning up its files.');

  const stamped = stampedPaths(campaign);
  if (!stamped.size) {
    return empty('This campaign’s list has no links to generated files yet, so there is no way to tell current files from old ones. Generate and upload once, then clean up.');
  }

  const referenced = referencedPaths(campaign.contacts);
  for (const other of otherCampaigns) {
    if (other && other.id !== campaign.id) referencedPaths(other.contacts, referenced);
  }

  // One entry per path (a path could in theory have two rows); the first row with a size wins.
  type Candidate = { path: string; rows: CleanupAssetRow[] };
  const candidates = new Map<string, Candidate>();
  for (const row of assetRows) {
    const path = rowPath(row);
    if (!path || !isRemovableGenerated(row, campaign.id, path, userId)) continue;
    const entry = candidates.get(path) ?? { path, rows: [] };
    entry.rows.push(row);
    candidates.set(path, entry);
  }

  // The list must link to at least one of this campaign's files, or the links are from somewhere
  // else (another campaign, a re-imported sheet) and "not linked" would mean "everything".
  const matched = [...candidates.keys()].some((path) => stamped.has(path));
  if (candidates.size && !matched) {
    return empty('None of this campaign’s stored files match the links in its current list, so nothing was deleted. Upload once from this campaign, then clean up.');
  }

  const sizeOf = (path: string, row?: CleanupAssetRow) => {
    const fromStorage = sizes?.get(path);
    if (typeof fromStorage === 'number' && Number.isFinite(fromStorage) && fromStorage >= 0) return fromStorage;
    const fromRow = Number(row?.bytes);
    return row && row.bytes != null && Number.isFinite(fromRow) && fromRow > 0 ? fromRow : null;
  };

  const keep: CleanupFile[] = [];
  const remove: CleanupFile[] = [];
  const keptPaths = new Set<string>();
  const stillsOfRemoved: CleanupFile[] = [];

  for (const { path, rows } of candidates.values()) {
    const row = rows.find((item) => item.bytes) ?? rows[0];
    const file: CleanupFile = {
      path,
      storagePath: typeof row.storage_path === 'string' && row.storage_path.trim() ? row.storage_path.trim() : path,
      name: displayName(path, row.filename),
      createdAt: row.created_at ?? null,
      bytes: sizeOf(path, row),
      assetId: row.id ?? null,
      kind: 'generated',
    };
    const isKept = referenced.has(path);
    (isKept ? keep : remove).push(file);
    if (isKept) keptPaths.add(path);
    const stillUrl = rows.map((item) => metadataOf(item).still_url).find((value) => typeof value === 'string');
    const stillPath = storagePathFromUrl(stillUrl);
    // A still is only ever paired when it sits beside its GIF (same user/campaign/date folder).
    if (!stillPath || stillPath === path || directoryOf(stillPath) !== directoryOf(path)) continue;
    const still: CleanupFile = {
      path: stillPath,
      storagePath: stillPath,
      name: displayName(stillPath),
      createdAt: file.createdAt,
      bytes: sizeOf(stillPath),
      assetId: null,
      kind: 'still',
      parentPath: path,
    };
    if (isKept) {
      keptPaths.add(stillPath);
      keep.push(still);
    } else {
      stillsOfRemoved.push(still);
    }
  }

  const removing = new Set(remove.map((file) => file.path));
  for (const still of stillsOfRemoved) {
    // A kept GIF that shares it already keeps it; a row of its own is decided on its own.
    if (keptPaths.has(still.path) || candidates.has(still.path) || removing.has(still.path)) continue;
    if (referenced.has(still.path)) {
      keptPaths.add(still.path);
      keep.push(still);
      continue;
    }
    removing.add(still.path);
    remove.push(still);
  }

  // Oldest first, each still right after its GIF.
  const group = (file: CleanupFile) => file.parentPath ?? file.path;
  remove.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
    || group(a).localeCompare(group(b))
    || Number(a.kind === 'still') - Number(b.kind === 'still'));
  const bytes = remove.reduce((total, file) => total + (file.bytes ?? 0), 0);
  const unknownSizes = remove.filter((file) => file.bytes == null).length;
  return { keep, remove, bytes, unknownSizes };
}

/** "18 MB", "740 KB". */
export function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb >= 10 ? Math.round(mb) : Number(mb.toFixed(1))} MB`;
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** The folders (with trailing slash removed) whose storage listing gives the sizes of these files. */
export function sizeFolders(paths: string[]) {
  return [...new Set(paths.map((path) => directoryOf(path).replace(/\/$/, '')).filter(Boolean))];
}

/** Splits a list into chunks of at most `size` (storage.remove takes up to 100 paths a call). */
export function chunk<T>(items: T[], size = 100) {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += Math.max(1, size)) out.push(items.slice(index, index + Math.max(1, size)));
  return out;
}
