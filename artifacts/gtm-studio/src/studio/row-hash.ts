import { renderMerge } from './merge';
import { configForRow } from './variants';
import { AVATAR_SOURCE_FIELD, isCutRoom, type Contact, type GeneratedAsset, type StudioConfig, type StudioMode } from './types';

/**
 * A fingerprint of everything that decides what one row's image looks like, so Generate can skip
 * rows whose inputs are unchanged since their file was made. Two parts:
 *  - the config, minus per-row text (merged separately) and fields that never touch the pixels;
 *  - the row: its merged copy / P.S. / signature / message / layer text (with its own A/B copy via
 *    configForRow) and the few contact values the renderer reads directly.
 */

/** Never part of the image: bookkeeping, naming and list plumbing. */
const VOLATILE_KEYS = new Set([
  'id',
  'templateId',
  'campaignName',
  'client',
  'history',
  'updatedAt',
  'updated_at',
  'fieldMap',
  'listSource',
  'sourceColumns',
  'sourceFileUrl',
  'emailSubject',
  'emailPreview',
  // Decoded from gifSourceDataUrl, which stays in the fingerprint. Cloud saves drop them, and
  // hashing every frame would be slow.
  'gifFrames',
  'gifDelays',
]);

/** Per-row text: merged for each row instead of hashed raw (and B rows read their B copy). */
const ROW_TEXT_KEYS = new Set(['copy', 'postscript', 'signature', 'message', 'copyVariantB', 'openerId']);

/** 53-bit string hash (cyrb53). Fast, well spread, and the same in every browser. */
export function hashString(text: string, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** JSON with sorted keys and no undefined values, so key order never changes the hash. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return value === undefined ? 'null' : JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function fingerprintSource(config: StudioConfig) {
  const record = config as unknown as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (VOLATILE_KEYS.has(key) || ROW_TEXT_KEYS.has(key)) continue;
    picked[key] = record[key];
  }
  // Layer text is merged per row; the rest of each layer (position, size, colour, motion) is look.
  if (Array.isArray(config.layers)) picked.layers = config.layers.map((layer) => ({ ...layer, text: undefined }));
  return picked;
}

const fingerprints = new WeakMap<object, string>();

/** Hash of the image-affecting config. Cached per config object, so a 400-row batch hashes it once. */
export function configFingerprint(config: StudioConfig) {
  const cached = fingerprints.get(config);
  if (cached) return cached;
  const value = hashString(stableStringify(fingerprintSource(config)));
  fingerprints.set(config, value);
  return value;
}

function rowSource(config: StudioConfig, contact: Contact, mode: StudioMode) {
  const row = configForRow(config, contact);
  const merge = (text: string | undefined) => (text ? renderMerge(text, contact, { hookColumn: row.hookColumn }) : '');
  const cell = (column?: string) => (column ? String(contact[column] ?? '') : '');
  return {
    row: contact.row,
    text: isCutRoom(mode)
      ? (row.layers ?? []).map((layer) => merge(layer.text))
      : [merge(row.copy), merge(row.postscript), merge(row.signature), merge(row.message)],
    message: cell(row.messageColumn),
    // The portrait's original link, not its cached pixels (the cache is the same picture).
    avatar: cell(row.avatarColumn) || String(contact[AVATAR_SOURCE_FIELD] ?? ''),
    website: cell(row.websiteColumn),
    // Avatar cards draw initials from these when the portrait cannot load.
    initials: `${contact.first_name ?? ''}|${contact.company ?? ''}`,
  };
}

/** Stable hash of one row's render inputs. Stored as `<prefix>_hash` next to the row's file. */
export function rowRenderHash(config: StudioConfig, contact: Contact, mode: StudioMode = config.mode) {
  return hashString(`${configFingerprint(config)}|${mode}|${stableStringify(rowSource(config, contact, mode))}`);
}

export type RegenerationPlan = {
  /** Rows in this batch. */
  total: number;
  /** Rows whose inputs changed (or never had a file): these render again. */
  changed: number;
  /** Ready-made assets for the unchanged rows, to pass to renderBatch(keep). */
  keep: GeneratedAsset[];
};

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

/**
 * Splits a batch into unchanged rows (same hash as when their file was made, and a file we can
 * still reach) and changed rows. Unchanged rows reuse the asset in memory when it is the same file
 * the row points at, else a stub built from the stored public URL: it shows in review, keeps its
 * link in the CSV, is skipped by the uploader (it already has a publicUrl), and is downloaded
 * again only if it goes into a ZIP (ensureAssetBlob).
 */
export function planRegeneration(
  rows: Contact[],
  assets: GeneratedAsset[],
  config: StudioConfig,
  mode: StudioMode,
  columns: { file: string; url: string; status: string; hash?: string },
): RegenerationPlan {
  if (!columns.hash) return { total: rows.length, changed: rows.length, keep: [] };
  const byRow = new Map<number, GeneratedAsset>();
  for (const asset of assets) {
    if (asset.status === 'failed' || !asset.filename) continue;
    if (!asset.blob?.size && !asset.publicUrl) continue;
    byRow.set(asset.row, asset);
  }
  const keep: GeneratedAsset[] = [];
  for (const contact of rows) {
    const stored = String(contact[columns.hash] ?? '');
    if (!stored || stored !== rowRenderHash(config, contact, mode)) continue;
    const status = String(contact[columns.status] ?? '');
    if (status !== 'uploaded' && status !== 'generated') continue;
    const file = String(contact[columns.file] ?? '');
    const url = String(contact[columns.url] ?? '');
    const inMemory = byRow.get(contact.row);
    if (inMemory && ((url && inMemory.publicUrl === url) || (!inMemory.publicUrl && file && inMemory.filename === file && inMemory.blob?.size))) {
      keep.push(inMemory);
      continue;
    }
    if (!isHttpUrl(url)) continue;
    keep.push({
      id: `kept-${contact.row}-${hashString(url)}`,
      row: contact.row,
      filename: file || url.split('/').pop()?.split('?')[0] || `row-${contact.row}`,
      blob: new Blob(),
      url,
      bytes: 0,
      selected: true,
      status: 'uploaded',
      publicUrl: url,
      uploadStatus: 'uploaded',
      mode,
    });
  }
  return { total: rows.length, changed: rows.length - keep.length, keep };
}
