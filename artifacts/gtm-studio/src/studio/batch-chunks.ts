import type { GeneratedAsset } from './types';

/**
 * Planning for big batches. Generate works through the list in chunks so each chunk can be
 * uploaded (and its file memory let go) before the next one starts, and ZIPs split into parts
 * the browser can build without holding the whole campaign twice.
 */

/** Rows rendered per chunk. Each chunk uploads before the next one starts. */
export const CHUNK_SIZE = 400;
/** Uploads in flight at once after a chunk, each lane sending a group of files in order. */
export const UPLOAD_LANES = 4;
export const UPLOAD_GROUP_SIZE = 10;
/** Past this much file data held in the tab, warn and suggest uploading or zipping in parts. */
export const MEMORY_WARN_BYTES = 800 * 1024 * 1024;
/** A ZIP part holds at most this many files (assets plus GIF stills)... */
export const ZIP_MAX_FILES = 400;
/** ...and at most about this many bytes. */
export const ZIP_MAX_BYTES = 500 * 1024 * 1024;
/** Used for files whose size is not known yet (kept rows whose file lives only in the cloud). */
export const FALLBACK_ASSET_BYTES = 200 * 1024;

export type ChunkPlan = { index: number; start: number; end: number };

/** Splits `total` rows into consecutive [start, end) chunks of at most `size` rows. */
export function planChunks(total: number, size = CHUNK_SIZE): ChunkPlan[] {
  const count = Math.max(0, Math.floor(total));
  const step = Math.max(1, Math.floor(size));
  const chunks: ChunkPlan[] = [];
  for (let start = 0, index = 0; start < count; start += step, index++) {
    chunks.push({ index, start, end: Math.min(count, start + step) });
  }
  return chunks;
}

const numberFormat = new Intl.NumberFormat('en-US');
export const formatCount = (value: number) => numberFormat.format(Math.max(0, Math.round(value)));

/** "Chunk 2 of 5 · 812 of 1,960 rows" (or just "812 of 1,960 rows" for a single chunk). */
export function chunkProgressLabel({ chunk, chunks, done, total }: { chunk: number; chunks: number; done: number; total: number }) {
  const rows = `${formatCount(Math.min(done, total))} of ${formatCount(total)} rows`;
  return chunks > 1 ? `Chunk ${Math.min(Math.max(1, chunk), chunks)} of ${chunks} · ${rows}` : rows;
}

/** Seconds left for the whole run, from the pace of rows finished in this run (uploads included). */
export function etaSeconds(elapsedSeconds: number, finishedThisRun: number, remaining: number): number | null {
  if (finishedThisRun <= 0 || elapsedSeconds <= 0) return null;
  return Math.max(0, Math.round((elapsedSeconds / finishedThisRun) * Math.max(0, remaining)));
}

/** "About 40 seconds left", "About 6 min left", "Almost done". */
export function etaText(seconds: number | null) {
  if (seconds === null) return '';
  if (seconds < 2) return 'Almost done';
  if (seconds < 90) return `About ${seconds} seconds left`;
  return `About ${Math.round(seconds / 60)} min left`;
}

/** File bytes an asset holds in memory right now (its file plus a GIF's JPG still). */
export function assetHeldBytes(asset: Pick<GeneratedAsset, 'blob' | 'still'>) {
  return (asset.blob?.size ?? 0) + (asset.still?.blob?.size ?? 0);
}

export function heldBytes(assets: Array<Pick<GeneratedAsset, 'blob' | 'still'>>) {
  let sum = 0;
  for (const asset of assets) sum += assetHeldBytes(asset);
  return sum;
}

/**
 * What the tab will hold once every remaining row is made, if nothing is released:
 * what it holds now plus the average file so far for each row still to come.
 */
export function projectHeldBytes({ held, madeRows, remainingRows }: { held: number; madeRows: number; remainingRows: number }) {
  if (madeRows <= 0) return held;
  return held + (held / madeRows) * Math.max(0, remainingRows);
}

/** True once held (or projected) memory passes the warning line. */
export function overMemoryBudget(bytes: number, limit = MEMORY_WARN_BYTES) {
  return bytes > limit;
}

/**
 * An asset's file can leave memory once it is safely in the cloud: uploaded with a public URL,
 * and its GIF still (if any) uploaded too. Anything not uploaded keeps its blob.
 */
export function canReleaseBlob(asset: GeneratedAsset) {
  if (asset.status === 'failed' || !asset.blob?.size) return false;
  if (asset.uploadStatus !== 'uploaded' || !asset.publicUrl) return false;
  return !asset.still?.blob?.size || Boolean(asset.still.publicUrl);
}

/**
 * The same asset without its file bytes: review shows it from its public URL, the CSV keeps the
 * link, and a ZIP downloads it again. Returns the object URLs the caller should revoke.
 */
export function releaseBlob(asset: GeneratedAsset): { asset: GeneratedAsset; revoke: string[] } {
  if (!canReleaseBlob(asset)) return { asset, revoke: [] };
  const revoke: string[] = [];
  if (asset.url.startsWith('blob:')) revoke.push(asset.url);
  let still = asset.still;
  if (still?.blob.size && still.publicUrl) {
    if (still.url.startsWith('blob:')) revoke.push(still.url);
    still = { ...still, blob: new Blob(), url: still.publicUrl };
  }
  return {
    asset: { ...asset, blob: new Blob(), url: asset.publicUrl ?? asset.url, ...(still ? { still } : {}) },
    revoke,
  };
}

export type ZipItem = { files: number; bytes: number };

/**
 * Groups items (in order) into ZIP parts of at most `maxFiles` files and about `maxBytes` bytes.
 * An item never splits across parts; one item bigger than a whole part gets a part of its own.
 * Returns the item indices for each part.
 */
export function planZipParts(items: ZipItem[], { maxFiles = ZIP_MAX_FILES, maxBytes = ZIP_MAX_BYTES } = {}): number[][] {
  const parts: number[][] = [];
  let current: number[] = [];
  let files = 0;
  let bytes = 0;
  items.forEach((item, index) => {
    const itemFiles = Math.max(1, item.files);
    const itemBytes = Math.max(0, item.bytes);
    if (current.length && (files + itemFiles > maxFiles || bytes + itemBytes > maxBytes)) {
      parts.push(current);
      current = [];
      files = 0;
      bytes = 0;
    }
    current.push(index);
    files += itemFiles;
    bytes += itemBytes;
  });
  if (current.length) parts.push(current);
  return parts;
}

/** ZIP items for assets: a GIF's still counts as a second file; unknown sizes use the average known size. */
export function zipItemsFor(assets: Array<Pick<GeneratedAsset, 'bytes' | 'blob' | 'still'>>): ZipItem[] {
  const known = assets.map((asset) => asset.bytes || asset.blob?.size || 0).filter((bytes) => bytes > 0);
  const average = known.length ? known.reduce((sum, bytes) => sum + bytes, 0) / known.length : FALLBACK_ASSET_BYTES;
  return assets.map((asset) => {
    const main = asset.bytes || asset.blob?.size || average;
    const still = asset.still ? (asset.still.blob?.size || Math.min(main, FALLBACK_ASSET_BYTES)) : 0;
    return { files: asset.still ? 2 : 1, bytes: main + still };
  });
}

/** "campaign.zip" for one part, "campaign-part-2-of-3.zip" for several. */
export function zipPartName(base: string, part: number, parts: number, extension = 'zip') {
  const clean = base.replace(/\W+/g, '-').replace(/^-+|-+$/g, '') || 'campaign';
  return parts > 1 ? `${clean}-part-${part}-of-${parts}.${extension}` : `${clean}.${extension}`;
}

export function formatMegabytes(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/** How many of the given rows are waiting, being made, done or failed (rows with no state count as waiting). */
export function chunkStatusCounts(rows: number[], status: Record<number, string>) {
  const counts = { waiting: 0, working: 0, done: 0, failed: 0 };
  for (const row of rows) {
    const state = status[row] as keyof typeof counts | undefined;
    if (state && state in counts) counts[state] += 1;
    else counts.waiting += 1;
  }
  return counts;
}

/** Files fetched at once when a ZIP needs files that are only in the cloud. */
export const ZIP_FETCH_CONCURRENCY = 6;

export type ZipFiles = { blob?: Blob; still?: Blob; error?: string; stillError?: string };

async function fetchBlob(url: string, fetcher: typeof fetch) {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.blob();
}

/**
 * The bytes a ZIP needs for one asset: from memory when it still has them, otherwise from its
 * public URL. No object URLs are made, so nothing outlives the ZIP part. Errors are returned,
 * not thrown, so the caller can list them.
 */
export async function fetchZipFiles(
  asset: Pick<GeneratedAsset, 'blob' | 'publicUrl' | 'url' | 'still'>,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): Promise<ZipFiles> {
  const result: ZipFiles = {};
  if (asset.blob?.size) result.blob = asset.blob;
  else {
    const src = asset.publicUrl || (/^https?:/i.test(asset.url) ? asset.url : '');
    if (!src) result.error = 'No file in memory and no link to download it from';
    else {
      try {
        result.blob = await fetchBlob(src, fetcher);
      } catch (reason) {
        result.error = reason instanceof Error ? reason.message : 'Download failed';
      }
    }
  }
  if (asset.still) {
    if (asset.still.blob?.size) result.still = asset.still.blob;
    else if (asset.still.publicUrl) {
      try {
        result.still = await fetchBlob(asset.still.publicUrl, fetcher);
      } catch (reason) {
        result.stillError = reason instanceof Error ? reason.message : 'Download failed';
      }
    } else result.stillError = 'No still in memory and no link to download it from';
  }
  return result;
}
