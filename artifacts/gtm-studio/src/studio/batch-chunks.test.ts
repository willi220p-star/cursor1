import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE,
  MEMORY_WARN_BYTES,
  ZIP_MAX_BYTES,
  ZIP_MAX_FILES,
  canReleaseBlob,
  chunkProgressLabel,
  chunkStatusCounts,
  etaSeconds,
  etaText,
  fetchZipFiles,
  formatMegabytes,
  heldBytes,
  overMemoryBudget,
  planChunks,
  planZipParts,
  projectHeldBytes,
  releaseBlob,
  zipItemsFor,
  zipPartName,
} from './batch-chunks';
import type { GeneratedAsset } from './types';

const blobOf = (bytes: number) => new Blob([new Uint8Array(bytes)]);

function asset(overrides: Partial<GeneratedAsset> = {}): GeneratedAsset {
  return {
    id: 'a',
    row: 2,
    filename: 'row-2.png',
    blob: blobOf(10),
    url: 'blob:local/a',
    bytes: 10,
    selected: true,
    status: 'ready',
    ...overrides,
  };
}

describe('planChunks', () => {
  it('covers every row in chunks of 400', () => {
    const chunks = planChunks(1960);
    expect(chunks).toHaveLength(5);
    expect(chunks[0]).toEqual({ index: 0, start: 0, end: 400 });
    expect(chunks[4]).toEqual({ index: 4, start: 1600, end: 1960 });
    expect(chunks.reduce((sum, chunk) => sum + chunk.end - chunk.start, 0)).toBe(1960);
  });

  it('handles exact multiples, small lists and empty lists', () => {
    expect(planChunks(800)).toHaveLength(2);
    expect(planChunks(900).map((chunk) => chunk.end - chunk.start)).toEqual([400, 400, 100]);
    expect(planChunks(6)).toEqual([{ index: 0, start: 0, end: 6 }]);
    expect(planChunks(0)).toEqual([]);
    expect(planChunks(5, 0)).toHaveLength(5);
    expect(CHUNK_SIZE).toBe(400);
  });
});

describe('progress text and ETA', () => {
  it('names the chunk only when there is more than one', () => {
    expect(chunkProgressLabel({ chunk: 2, chunks: 5, done: 812, total: 1960 })).toBe('Chunk 2 of 5 · 812 of 1,960 rows');
    expect(chunkProgressLabel({ chunk: 1, chunks: 1, done: 3, total: 6 })).toBe('3 of 6 rows');
    expect(chunkProgressLabel({ chunk: 9, chunks: 3, done: 950, total: 900 })).toBe('Chunk 3 of 3 · 900 of 900 rows');
  });

  it('estimates from the pace of this run', () => {
    expect(etaSeconds(10, 0, 100)).toBeNull();
    expect(etaSeconds(10, 100, 800)).toBe(80);
    expect(etaSeconds(10, 100, 0)).toBe(0);
    expect(etaText(null)).toBe('');
    expect(etaText(1)).toBe('Almost done');
    expect(etaText(40)).toBe('About 40 seconds left');
    expect(etaText(360)).toBe('About 6 min left');
  });

  it('counts how the current chunk is going', () => {
    expect(chunkStatusCounts([2, 3, 4, 5], { 2: 'done', 3: 'working', 4: 'failed' })).toEqual({ waiting: 1, working: 1, done: 1, failed: 1 });
  });
});

describe('memory', () => {
  it('adds up file and still bytes', () => {
    expect(heldBytes([asset(), asset({ blob: blobOf(5), still: { blob: blobOf(3), url: 'blob:s', filename: 's.jpg' } })])).toBe(18);
    expect(heldBytes([asset({ blob: new Blob() })])).toBe(0);
  });

  it('projects the whole run from the average so far', () => {
    expect(projectHeldBytes({ held: 100, madeRows: 10, remainingRows: 90 })).toBe(1000);
    expect(projectHeldBytes({ held: 0, madeRows: 0, remainingRows: 90 })).toBe(0);
    expect(overMemoryBudget(MEMORY_WARN_BYTES)).toBe(false);
    expect(overMemoryBudget(MEMORY_WARN_BYTES + 1)).toBe(true);
    // 900 GIFs at ~1 MB each pass the line; 900 notes at ~150 KB do not.
    expect(overMemoryBudget(900 * 1024 * 1024)).toBe(true);
    expect(overMemoryBudget(900 * 150 * 1024)).toBe(false);
  });

  it('releases only files that are safely uploaded', () => {
    expect(canReleaseBlob(asset())).toBe(false);
    expect(canReleaseBlob(asset({ uploadStatus: 'failed', publicUrl: 'https://x/a.png' }))).toBe(false);
    expect(canReleaseBlob(asset({ status: 'failed', uploadStatus: 'uploaded', publicUrl: 'https://x/a.png' }))).toBe(false);
    const uploaded = asset({ uploadStatus: 'uploaded', status: 'uploaded', publicUrl: 'https://x/a.png' });
    expect(canReleaseBlob(uploaded)).toBe(true);
    // A GIF whose still did not upload keeps everything, so the still is not lost.
    expect(canReleaseBlob({ ...uploaded, still: { blob: blobOf(4), url: 'blob:s', filename: 's.jpg' } })).toBe(false);
  });

  it('drops the blob, points review at the public URL and lists URLs to revoke', () => {
    const uploaded = asset({
      uploadStatus: 'uploaded',
      status: 'uploaded',
      publicUrl: 'https://x/a.gif',
      still: { blob: blobOf(4), url: 'blob:s', filename: 's.jpg', publicUrl: 'https://x/s.jpg' },
    });
    const { asset: released, revoke } = releaseBlob(uploaded);
    expect(released.blob.size).toBe(0);
    expect(released.url).toBe('https://x/a.gif');
    expect(released.bytes).toBe(10);
    expect(released.still).toMatchObject({ url: 'https://x/s.jpg', publicUrl: 'https://x/s.jpg', filename: 's.jpg' });
    expect(released.still?.blob.size).toBe(0);
    expect(revoke).toEqual(['blob:local/a', 'blob:s']);
    expect(releaseBlob(asset()).revoke).toEqual([]);
  });
});

describe('ZIP parts', () => {
  it('keeps small exports in one part', () => {
    expect(planZipParts([{ files: 1, bytes: 100 }, { files: 2, bytes: 100 }])).toEqual([[0, 1]]);
    expect(planZipParts([])).toEqual([]);
  });

  it('splits by file count', () => {
    const parts = planZipParts(Array.from({ length: 900 }, () => ({ files: 1, bytes: 150_000 })));
    expect(parts.map((part) => part.length)).toEqual([400, 400, 100]);
    // GIF plus still counts as two files.
    const gifs = planZipParts(Array.from({ length: 450 }, () => ({ files: 2, bytes: 300_000 })));
    expect(gifs.map((part) => part.length)).toEqual([200, 200, 50]);
    expect(ZIP_MAX_FILES).toBe(400);
  });

  it('splits by size, and a huge file gets a part of its own', () => {
    const big = Array.from({ length: 6 }, () => ({ files: 1, bytes: 200 * 1024 * 1024 }));
    expect(planZipParts(big).map((part) => part.length)).toEqual([2, 2, 2]);
    expect(planZipParts([{ files: 1, bytes: ZIP_MAX_BYTES * 2 }, { files: 1, bytes: 10 }])).toEqual([[0], [1]]);
  });

  it('guesses sizes for files known only by URL', () => {
    const items = zipItemsFor([
      asset({ bytes: 100 }),
      asset({ bytes: 300 }),
      asset({ bytes: 0, blob: new Blob(), still: { blob: new Blob(), url: 'https://x/s.jpg', filename: 's.jpg' } }),
    ]);
    expect(items[0]).toEqual({ files: 1, bytes: 100 });
    expect(items[2].files).toBe(2);
    expect(items[2].bytes).toBe(200 + 200);
  });

  it('names parts', () => {
    expect(zipPartName('Spring notes!', 1, 1)).toBe('Spring-notes.zip');
    expect(zipPartName('Spring notes', 2, 3)).toBe('Spring-notes-part-2-of-3.zip');
    expect(zipPartName('', 1, 3)).toBe('campaign-part-1-of-3.zip');
    expect(formatMegabytes(820 * 1024 * 1024)).toBe('820 MB');
    expect(formatMegabytes(1536 * 1024 * 1024)).toBe('1.5 GB');
  });
});

describe('fetchZipFiles', () => {
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('missing')) return new Response('', { status: 404 });
    return new Response(new Uint8Array(url.length));
  }) as typeof fetch;

  it('uses bytes in memory without fetching', async () => {
    const inMemory = asset();
    const result = await fetchZipFiles(inMemory, (() => { throw new Error('no fetch'); }) as typeof fetch);
    expect(result.blob).toBe(inMemory.blob);
    expect(result.error).toBeUndefined();
  });

  it('fetches released files and their stills from the public URL', async () => {
    const result = await fetchZipFiles(asset({
      blob: new Blob(),
      publicUrl: 'https://x/a.gif',
      url: 'https://x/a.gif',
      still: { blob: new Blob(), url: 'https://x/s.jpg', filename: 's.jpg', publicUrl: 'https://x/s.jpg' },
    }), fetcher);
    expect(result.blob?.size).toBe('https://x/a.gif'.length);
    expect(result.still?.size).toBe('https://x/s.jpg'.length);
  });

  it('reports failures instead of throwing', async () => {
    const result = await fetchZipFiles(asset({
      blob: new Blob(),
      publicUrl: 'https://x/missing.gif',
      still: { blob: new Blob(), url: '', filename: 's.jpg' },
    }), fetcher);
    expect(result.blob).toBeUndefined();
    expect(result.error).toBe('HTTP 404');
    expect(result.stillError).toMatch(/no link/i);
    expect((await fetchZipFiles(asset({ blob: new Blob(), url: '' }), fetcher)).error).toMatch(/no link/i);
  });
});
