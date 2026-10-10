import { describe, expect, it } from 'vitest';
import { campaignHistory, campaignStatus, formatHistoryEntry, pushHistory } from './campaign-status';
import {
  chunk,
  displayName,
  formatBytes,
  normalizeStoragePath,
  planCleanup,
  sizeFolders,
  storagePathFromUrl,
  type CleanupAssetRow,
  type CleanupCampaign,
} from './cleanup-plan';
import type { StudioConfig } from './types';

const uid = '00000000-0000-4000-8000-000000000001';
const base = `https://abc.supabase.co/storage/v1/object/public/outbound-assets/`;
const url = (path: string) => `${base}${path}`;
const dir = `${uid}/spring/2026-10-09`;
const old = `${uid}/spring/2026-10-01`;

function gen(id: string, path: string, extra: Partial<CleanupAssetRow> & { meta?: Record<string, unknown> } = {}): CleanupAssetRow {
  const { meta, ...rest } = extra;
  return {
    id,
    campaign_id: 'c1',
    storage_path: path,
    public_url: url(path),
    filename: path.split('/').pop()!.replace(/^v\d+-/, ''),
    bytes: 1000,
    created_at: '2026-10-09T10:00:00Z',
    metadata: { role: 'generated', mode: 'handwritten', row: 2, ...meta },
    ...rest,
  };
}

function campaign(rows: Array<Record<string, unknown>>, mode: CleanupCampaign['mode'] = 'handwritten'): CleanupCampaign {
  return { id: 'c1', mode, contacts: rows.map((row, index) => ({ row: index + 2, name: `P${index}`, ...row })) };
}

describe('URL normalisation', () => {
  it('strips the query string, hash and encoding', () => {
    expect(storagePathFromUrl(`${url(`${dir}/v1-row%202.png`)}?t=123#x`)).toBe(`${dir}/v1-row 2.png`);
    expect(storagePathFromUrl(`${url(`${dir}/v1-%C3%A9t%C3%A9.png`)}`)).toBe(`${dir}/v1-été.png`);
    expect(normalizeStoragePath(`/${dir}/v1-row%202.png?download`)).toBe(`${dir}/v1-row 2.png`);
  });

  it('reads render and signed links, and links wrapped in another URL', () => {
    expect(storagePathFromUrl(`https://abc.supabase.co/storage/v1/render/image/public/outbound-assets/${dir}/a.png?width=600`)).toBe(`${dir}/a.png`);
    expect(storagePathFromUrl(`https://abc.supabase.co/storage/v1/object/sign/outbound-assets/${dir}/a.png?token=x`)).toBe(`${dir}/a.png`);
    expect(storagePathFromUrl(`https://proxy.example/img?url=${encodeURIComponent(url(`${dir}/a.png`))}`)).toBe(`${dir}/a.png`);
  });

  it('ignores files, data URLs and other hosts', () => {
    expect(storagePathFromUrl('row-2.png')).toBeNull();
    expect(storagePathFromUrl('data:image/png;base64,xx')).toBeNull();
    expect(storagePathFromUrl('https://example.com/a.png')).toBeNull();
    expect(storagePathFromUrl(42)).toBeNull();
  });
});

describe('planCleanup', () => {
  it('keeps files the current list links to and removes the rest of this campaign', () => {
    const current = `${dir}/v2-row-2.png`;
    const stale = `${old}/v1-row-2.png`;
    const plan = planCleanup(
      campaign([{ handwritten_url: url(current), image_url: url(current), smartlead_image_url: url(current) }]),
      [gen('a', current), gen('b', stale, { bytes: 4000, created_at: '2026-10-01T10:00:00Z' })],
      { userId: uid },
    );
    expect(plan.refused).toBeUndefined();
    expect(plan.keep.map((file) => file.path)).toEqual([current]);
    expect(plan.remove.map((file) => file.path)).toEqual([stale]);
    expect(plan.remove[0]).toMatchObject({ assetId: 'b', kind: 'generated', name: 'row-2.png', createdAt: '2026-10-01T10:00:00Z' });
    expect(plan.bytes).toBe(4000);
    expect(plan.unknownSizes).toBe(0);
  });

  it('matches links with query strings and encoded characters to stored paths', () => {
    const current = `${dir}/v2-Ma ya é.png`;
    const plan = planCleanup(
      campaign([{ handwritten_url: `${base}${encodeURI(current)}?v=3` }]),
      [gen('a', current), gen('b', `${old}/v1-Ma ya é.png`)],
    );
    expect(plan.keep.map((file) => file.path)).toEqual([current]);
    expect(plan.remove).toHaveLength(1);
  });

  it('counts a link in any column, including image_url or smartlead_image_url alone', () => {
    const a = `${dir}/v2-row-2.png`;
    const b = `${dir}/v2-row-3.png`;
    const c = `${dir}/v2-row-4.png`;
    const plan = planCleanup(
      campaign([{ handwritten_url: url(a) }, { image_url: url(b) }, { my_custom_column: url(c) }]),
      [gen('a', a), gen('b', b), gen('c', c), gen('d', `${old}/v1-x.png`)],
    );
    expect(plan.keep.map((file) => file.path).sort()).toEqual([a, b, c].sort());
    expect(plan.remove.map((file) => file.path)).toEqual([`${old}/v1-x.png`]);
  });

  it('never removes imported lists, uploads, carousels, rows without a role, or other campaigns', () => {
    const current = `${dir}/v2-row-2.png`;
    const rows: CleanupAssetRow[] = [
      gen('a', current),
      { id: 'list', campaign_id: 'c1', storage_path: `${uid}/lists/x-prospects.csv`, metadata: { kind: 'list', role: 'upload' } },
      { id: 'desk', campaign_id: 'c1', storage_path: `${uid}/uploads/desk/d.png`, metadata: { kind: 'desk', role: 'upload' } },
      { id: 'sig', campaign_id: 'c1', storage_path: `${uid}/uploads/signature/s.png`, metadata: { kind: 'signature', role: 'upload' } },
      { id: 'car', campaign_id: 'c1', storage_path: `${uid}/carousels/k.json`, metadata: { kind: 'carousel', role: 'carousel' } },
      { id: 'car2', campaign_id: 'c1', storage_path: `${uid}/spring/2026-10-01/k.json`, metadata: { kind: 'carousel', role: 'generated' } },
      { id: 'list2', campaign_id: 'c1', storage_path: `${uid}/spring/2026-10-01/l.csv`, metadata: { kind: 'list', role: 'generated' } },
      { id: 'norole', campaign_id: 'c1', storage_path: `${old}/v0-legacy.png`, metadata: {} },
      { ...gen('other', `${uid}/autumn/2026-10-01/v1-row-2.png`), campaign_id: 'c2' },
      { ...gen('loose', `${uid}/spring/2026-10-01/v1-row-9.png`), campaign_id: null },
      gen('foreign', `someone-else/spring/2026-10-01/v1-row-2.png`),
      gen('reserved', `${uid}/uploads/2026-10-01/v1-row-2.png`),
    ];
    const plan = planCleanup(campaign([{ handwritten_url: url(current) }]), rows, { userId: uid });
    expect(plan.refused).toBeUndefined();
    expect(plan.remove).toEqual([]);
  });

  it('keeps files another campaign links to', () => {
    const current = `${dir}/v2-row-2.png`;
    const shared = `${old}/v1-row-2.png`;
    const plan = planCleanup(campaign([{ handwritten_url: url(current) }]), [gen('a', current), gen('b', shared)], {
      otherCampaigns: [{ id: 'c2', contacts: [{ row: 2, handwritten_url: url(shared) }] }],
    });
    expect(plan.remove).toEqual([]);
    expect(plan.keep.map((file) => file.path).sort()).toEqual([current, shared].sort());
  });

  it('refuses a campaign that was never stamped', () => {
    const plan = planCleanup(campaign([{ name: 'Maya' }, { handwritten_url: '' }, { handwritten_url: 'row-3.png' }]), [gen('a', `${old}/v1-row-2.png`)]);
    expect(plan.refused).toMatch(/no links to generated files/);
    expect(plan.remove).toEqual([]);
    expect(plan.bytes).toBe(0);
  });

  it('refuses when only non-output columns hold links (not proof of a run)', () => {
    const file = `${old}/v1-row-2.png`;
    const plan = planCleanup(campaign([{ image_link: url(file) }]), [gen('a', file), gen('b', `${old}/v1-row-3.png`)]);
    expect(plan.refused).toBeTruthy();
    expect(plan.remove).toEqual([]);
  });

  it('refuses when the list links match none of this campaign’s files', () => {
    const plan = planCleanup(
      campaign([{ handwritten_url: url(`${uid}/elsewhere/2026-10-09/v9-row-2.png`) }]),
      [gen('a', `${old}/v1-row-2.png`), gen('b', `${old}/v1-row-3.png`)],
    );
    expect(plan.refused).toMatch(/match/);
    expect(plan.remove).toEqual([]);
  });

  it('refuses an unsaved campaign', () => {
    expect(planCleanup({ id: '', mode: 'handwritten', contacts: [] }, []).refused).toBeTruthy();
  });

  it('keeps a kept GIF’s still and removes the still of a removed GIF', () => {
    const gif = `${dir}/v2-row-2.gif`;
    const still = `${dir}/v2-row-2-still.jpg`;
    const oldGif = `${old}/v1-row-2.gif`;
    const oldStill = `${old}/v1-row-2-still.jpg`;
    const rows = [
      gen('a', gif, { meta: { mode: 'gif', still_url: url(still) } }),
      gen('b', oldGif, { meta: { mode: 'gif', still_url: `${url(oldStill)}?t=1` }, created_at: '2026-10-01T09:00:00Z' }),
    ];
    // The list carries the GIF link only; its still comes from the asset row's metadata.
    const plan = planCleanup(campaign([{ gif_url: url(gif) }], 'gif'), rows, { userId: uid, sizes: new Map([[oldStill, 300], [oldGif, 9000]]) });
    expect(plan.keep.map((file) => file.path).sort()).toEqual([gif, still].sort());
    expect(plan.remove.map((file) => [file.path, file.kind])).toEqual([[oldGif, 'generated'], [oldStill, 'still']]);
    expect(plan.remove[1]).toMatchObject({ assetId: null, parentPath: oldGif, bytes: 300 });
    expect(plan.bytes).toBe(9300);
  });

  it('keeps a removed GIF’s still when the list links the still itself', () => {
    const gif = `${dir}/v2-row-2.gif`;
    const oldGif = `${old}/v1-row-2.gif`;
    const oldStill = `${old}/v1-row-2-still.jpg`;
    const plan = planCleanup(
      campaign([{ gif_url: url(gif), gif_still_url: url(oldStill) }], 'gif'),
      [gen('a', gif), gen('b', oldGif, { meta: { still_url: url(oldStill) } })],
    );
    expect(plan.remove.map((file) => file.path)).toEqual([oldGif]);
    expect(plan.keep.map((file) => file.path)).toContain(oldStill);
  });

  it('never pairs a still that is outside its GIF’s folder', () => {
    const gif = `${dir}/v2-row-2.gif`;
    const oldGif = `${old}/v1-row-2.gif`;
    const plan = planCleanup(
      campaign([{ gif_url: url(gif) }], 'gif'),
      [gen('a', gif), gen('b', oldGif, { meta: { still_url: url(`${uid}/uploads/desk/d.jpg`) } })],
    );
    expect(plan.remove.map((file) => file.path)).toEqual([oldGif]);
  });

  it('reports unknown sizes instead of guessing', () => {
    const current = `${dir}/v2-row-2.png`;
    const plan = planCleanup(campaign([{ handwritten_url: url(current) }]), [gen('a', current), gen('b', `${old}/v1-row-2.png`, { bytes: null })]);
    expect(plan.remove).toHaveLength(1);
    expect(plan.remove[0].bytes).toBeNull();
    expect(plan.unknownSizes).toBe(1);
    expect(plan.bytes).toBe(0);
  });

  it('prefers storage sizes over the asset row and keeps the stored object name for deletes', () => {
    const current = `${dir}/v2-row-2.png`;
    const stale = `${old}/v1-row%202.png`;
    const plan = planCleanup(campaign([{ handwritten_url: url(current) }]), [gen('a', current), gen('b', stale, { bytes: 10 })], {
      sizes: new Map([[`${old}/v1-row 2.png`, 2048]]),
    });
    expect(plan.remove[0]).toMatchObject({ path: `${old}/v1-row 2.png`, storagePath: stale, bytes: 2048 });
  });

  it('treats duplicate rows for one path as one file', () => {
    const current = `${dir}/v2-row-2.png`;
    const stale = `${old}/v1-row-2.png`;
    const plan = planCleanup(campaign([{ handwritten_url: url(current) }]), [gen('a', current), gen('b', stale), gen('b2', stale)]);
    expect(plan.remove).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('formats sizes, names, folders and batches', () => {
    expect(formatBytes(18 * 1024 * 1024)).toBe('18 MB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatBytes(740 * 1024)).toBe('740 KB');
    expect(displayName(`${dir}/0b6e3c2a-1111-4222-8333-444455556666-row-7.png`)).toBe('row-7.png');
    expect(sizeFolders([`${dir}/a.png`, `${dir}/b.png`, `${old}/c.png`])).toEqual([dir, old]);
    expect(chunk(Array.from({ length: 250 }, (_, index) => index), 100).map((part) => part.length)).toEqual([100, 100, 50]);
  });
});

describe('cleaned history events', () => {
  it('records a clean-up without changing the status', () => {
    let history = pushHistory(undefined, { kind: 'uploaded', rows: 24, at: '2026-10-09T14:02:00Z' });
    history = pushHistory(history, { kind: 'cleaned', rows: 37, at: '2026-10-09T15:00:00Z' });
    const config = { history } as StudioConfig;
    expect(campaignHistory(config)).toHaveLength(2);
    expect(campaignStatus(config)).toBe('uploaded');
    expect(campaignStatus({ history: [history[1]] } as StudioConfig)).toBe('draft');
    expect(formatHistoryEntry({ at: new Date(2026, 9, 9, 15, 0).toISOString(), kind: 'cleaned', rows: 37 })).toBe('Cleaned up 37 old files · 9 Oct 15:00');
    expect(formatHistoryEntry({ at: 'bad', kind: 'cleaned', rows: 1 })).toBe('Cleaned up 1 old file');
  });
});
