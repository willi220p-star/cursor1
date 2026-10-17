import { describe, expect, it, vi } from 'vitest';
import type { BulkTarget } from './contracts';

vi.mock('@/components/results-panel', () => ({ showBulkResult: () => undefined }));
vi.mock('@/lib/offline-queue', () => ({ isOnline: () => true, enqueue: async () => ({}), registerQueueHandler: () => undefined }));

const { planZipEntries, safeSegment, splitZipParts, uniqueZipPath, zipBaseName, zipOutcome, downloadZip } = await import('./zip-download');
const { appError } = await import('@/lib/app-error');

const campaign = (id: string, name: string): BulkTarget => ({ entity: 'campaign', id, name });
const file = (id: string, name: string): BulkTarget => ({ entity: 'asset', id, name });

describe('zip naming', () => {
  it('makes names unique inside the zip, case-insensitively, keeping the extension', () => {
    const taken = new Set<string>();
    expect(uniqueZipPath('a/photo.png', taken)).toBe('a/photo.png');
    expect(uniqueZipPath('a/Photo.PNG', taken)).toBe('a/Photo (2).PNG');
    expect(uniqueZipPath('a/photo.png', taken)).toBe('a/photo (3).png');
    expect(uniqueZipPath('README', taken)).toBe('README');
    expect(uniqueZipPath('README', taken)).toBe('README (2)');
  });

  it('strips characters that break file systems', () => {
    expect(safeSegment('Q4: north/south?')).toBe('Q4- north-south-');
    expect(safeSegment('...hidden')).toBe('hidden');
    expect(safeSegment('   ', 'campaign')).toBe('campaign');
  });

  it('puts campaign files in a folder per campaign and loose files at the top', () => {
    const entries = planZipEntries([
      { target: campaign('c1', 'Spring'), files: [{ filename: 'row-2.png', url: 'u1' }, { filename: 'row-2.png', url: 'u2' }] },
      { target: campaign('c2', 'Spring'), files: [{ filename: 'row-2.png', url: 'u3' }] },
      { target: file('a1', 'logo.png'), files: [{ filename: 'logo.png', url: 'u4' }] },
    ]);
    expect(entries.map((entry) => entry.path)).toEqual(['Spring/row-2.png', 'Spring/row-2 (2).png', 'Spring (2)/row-2.png', 'logo.png']);
  });

  it('names the zip after one item, or the library and date', () => {
    expect(zipBaseName([file('a', 'logo.png')])).toBe('logo');
    expect(zipBaseName([campaign('a', 'Spring')])).toBe('Spring');
    expect(zipBaseName([campaign('a', 'x'), file('b', 'y')], new Date(2026, 9, 17))).toBe('library-2026-10-17');
  });
});

describe('zip splitting', () => {
  it('splits at 400 files', () => {
    const parts = splitZipParts(Array.from({ length: 901 }, (_, index) => index));
    expect(parts.map((part) => part.length)).toEqual([400, 400, 101]);
    expect(parts[1][0]).toBe(400);
  });
});

describe('zip outcome', () => {
  it('fails campaigns with missing files or no files, and names the missing files', () => {
    const sources = [
      { target: campaign('c1', 'Full'), files: [{ filename: 'a.png', url: 'a' }] },
      { target: campaign('c2', 'Partial'), files: [{ filename: 'b.png', url: 'b' }, { filename: 'c.png', url: 'c' }] },
      { target: campaign('c3', 'Empty'), files: [] },
    ];
    const entries = planZipEntries(sources);
    const failed = new Map([['campaign:c2', [{ entry: entries[2], error: appError('not_found', 'The stored file is missing.') }]]]);
    const outcome = zipOutcome(sources, failed);
    expect(outcome.succeeded.map((target) => target.id)).toEqual(['c1']);
    expect(outcome.failed.map((failure) => [failure.target.id, failure.error.message])).toEqual([
      ['c2', '1 of 2 files could not be downloaded: c.png. The stored file is missing.'],
      ['c3', 'This campaign has no stored files yet.'],
    ]);
  });
});

describe('downloadZip', () => {
  function fakeClient(rows: Array<Record<string, unknown>>) {
    const query = {
      select: () => query,
      in: () => query,
      is: () => query,
      order: () => query,
      then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }),
    };
    return { from: () => query } as never;
  }

  it('fetches every file, saves one zip and reports failures per item', async () => {
    const saved: string[] = [];
    const fetcher = vi.fn(async (url: string) => (url.includes('missing') ? new Response('', { status: 404 }) : new Response('x'))) as unknown as typeof fetch;
    const client = fakeClient([
      { id: 'a1', filename: 'one.png', public_url: 'https://x/one.png', campaign_id: 'c1' },
      { id: 'a2', filename: 'two.png', public_url: 'https://x/missing.png', campaign_id: 'c1' },
      { id: 'f1', filename: 'logo.png', public_url: 'https://x/logo.png', campaign_id: null },
    ]);
    const result = await downloadZip([campaign('c1', 'Spring'), file('f1', 'logo.png'), { entity: 'template', id: 't', name: 'T' }], {
      client, fetcher, save: (_blob, name) => saved.push(name), show: false, date: new Date(2026, 9, 17),
    });
    expect(saved).toEqual(['library-2026-10-17.zip']);
    expect(result.total).toBe(2);
    expect(result.succeeded.map((target) => target.id)).toEqual(['f1']);
    expect(result.failed.map((failure) => failure.target.id)).toEqual(['c1']);
  });
});
