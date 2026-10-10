import { describe, expect, it } from 'vitest';
import { campaignAssetRows } from './asset-scope';
import {
  HISTORY_LIMIT,
  campaignSearchText,
  campaignStatus,
  formatHistoryEntry,
  knownClients,
  pushHistory,
  recentHistory,
} from './campaign-status';
import { stripOutputColumns, uniqueCopyName } from './cloud';
import { defaultConfig } from './defaults';
import { configFingerprint, planRegeneration, rowRenderHash, stableStringify } from './row-hash';
import type { Contact, GeneratedAsset, SavedCampaign, StudioConfig } from './types';
import { outputColumnsFor, stampStudioOutputs } from './writeback';

describe('Review all images scoping', () => {
  const rows = [
    { id: 'a', campaign_id: 'c1', storage_path: 'u/spring-notes/2026-10-09/a.png', metadata: { role: 'generated', mode: 'handwritten' } },
    { id: 'b', campaign_id: 'c2', storage_path: 'u/other-client/2026-10-09/b.png', metadata: { role: 'generated', mode: 'handwritten' } },
    { id: 'c', campaign_id: null, storage_path: 'u/spring-notes/2026-10-01/c.png', metadata: { role: 'generated', mode: 'handwritten' } },
    { id: 'd', campaign_id: 'c1', storage_path: 'u/uploads/desk/d.png', metadata: { role: 'upload', kind: 'desk' } },
  ];

  it('matches a saved campaign by id only, never by studio mode', () => {
    expect(campaignAssetRows(rows, { campaignId: 'c1', slug: 'spring-notes' }).map((row) => row.id)).toEqual(['a']);
    expect(campaignAssetRows(rows, { campaignId: 'c2', slug: 'other-client' }).map((row) => row.id)).toEqual(['b']);
  });

  it('falls back to the name slug in the path only when the campaign has no id', () => {
    expect(campaignAssetRows(rows, { slug: 'spring-notes' }).map((row) => row.id)).toEqual(['a', 'c']);
    expect(campaignAssetRows(rows, { slug: 'nobody' })).toEqual([]);
  });

  it('never lists uploads such as desk photos', () => {
    expect(campaignAssetRows(rows, { campaignId: 'c1', slug: 'x' }).some((row) => row.id === 'd')).toBe(false);
  });
});

describe('campaign history and status', () => {
  it('is Draft with no history and the latest event wins', () => {
    expect(campaignStatus({})).toBe('draft');
    expect(campaignStatus({ history: [] })).toBe('draft');
    let history = pushHistory(undefined, { kind: 'generated', rows: 24, at: '2026-10-09T14:02:00Z' });
    expect(campaignStatus({ history })).toBe('generated');
    history = pushHistory(history, { kind: 'exported', rows: 24, at: '2026-10-09T15:00:00Z' });
    history = pushHistory(history, { kind: 'uploaded', rows: 3, at: '2026-10-09T16:00:00Z' });
    expect(campaignStatus({ history })).toBe('uploaded');
  });

  it('caps the history, keeps the newest, and does not mutate', () => {
    let history = pushHistory(undefined, { kind: 'generated', rows: 1, at: '2026-01-01T00:00:00Z' });
    const first = history;
    for (let index = 0; index < HISTORY_LIMIT + 10; index++) {
      history = pushHistory(history, { kind: 'uploaded', rows: index, at: new Date(Date.UTC(2026, 1, 1, 0, index)).toISOString() });
    }
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history.at(-1)?.rows).toBe(HISTORY_LIMIT + 9);
    expect(first).toHaveLength(1);
  });

  it('ignores malformed entries from old saves', () => {
    const config = { history: [{ at: 'x' }, null, { at: '2026-10-09T14:02:00Z', kind: 'exported', rows: 5 }] } as unknown as StudioConfig;
    expect(campaignStatus(config)).toBe('exported');
    expect(recentHistory(config)).toHaveLength(1);
  });

  it('formats an entry for the menu', () => {
    const text = formatHistoryEntry({ at: new Date(2026, 9, 9, 14, 2).toISOString(), kind: 'generated', rows: 24 });
    expect(text).toBe('Generated 24 rows · 9 Oct 14:02');
    expect(formatHistoryEntry({ at: new Date(2026, 9, 9, 9, 5).toISOString(), kind: 'exported', rows: 1 })).toBe('Exported 1 row · 9 Oct 09:05');
  });
});

describe('clients and search', () => {
  const campaign = (name: string, client?: string, contacts: Contact[] = []) => ({
    name,
    config: { ...defaultConfig('handwritten'), client },
    contacts,
  }) as Pick<SavedCampaign, 'name' | 'config' | 'contacts'>;

  it('lists each client once, sorted', () => {
    expect(knownClients([campaign('a', 'Northwind'), campaign('b', ' northwind '), campaign('c', 'Acme'), campaign('d')])).toEqual(['Acme', 'Northwind']);
  });

  it('searches the client and company values with a row cap', () => {
    const contacts = Array.from({ length: 1000 }, (_, index) => ({ row: index + 2, name: `P${index}`, Company: `Firm ${index}` }));
    const text = campaignSearchText(campaign('Spring push', 'Northwind', contacts), { maxRows: 50 });
    expect(text).toContain('northwind');
    expect(text).toContain('firm 3');
    expect(text).not.toContain('firm 500');
  });
});

describe('duplicate campaign helpers', () => {
  it('picks a unique copy name', () => {
    expect(uniqueCopyName('Spring', ['Spring'])).toBe('Spring copy');
    expect(uniqueCopyName('Spring', ['Spring', 'spring copy'])).toBe('Spring copy 2');
    expect(uniqueCopyName('Spring copy', ['Spring copy', 'Spring copy 2'])).toBe('Spring copy 3');
  });

  it('strips the studio output columns from the list', () => {
    const cols = outputColumnsFor('handwritten');
    const config = { ...defaultConfig('handwritten'), sourceColumns: ['name', cols.url], fieldMap: [{ column: 'name', use: 'name' }, { column: cols.url, use: 'custom', customTag: cols.url }] };
    const stripped = stripOutputColumns({
      mode: 'handwritten',
      columns: ['name', 'company', cols.file, cols.url, cols.hash, 'image_url'],
      contacts: [{ row: 2, name: 'Maya', company: 'Top End', [cols.url]: 'https://x/a.png', [cols.hash]: 'abc', image_url: 'https://x/a.png' }],
      config,
    });
    expect(stripped.columns).toEqual(['name', 'company']);
    expect(stripped.contacts[0]).toEqual({ row: 2, name: 'Maya', company: 'Top End' });
    expect(stripped.config.sourceColumns).toEqual(['name']);
    expect(stripped.config.fieldMap).toEqual([{ column: 'name', use: 'name' }]);
  });
});

describe('row render hash', () => {
  const base = (): StudioConfig => ({ ...defaultConfig('handwritten'), copy: 'Hi {first_name}, saw {company}.', postscript: 'Coffee?', signature: 'Dilip' });
  const maya: Contact = { row: 2, first_name: 'Maya', company: 'Top End Solar' };
  const ethan: Contact = { row: 3, first_name: 'Ethan', company: 'Saltbush' };

  it('ignores key order', () => {
    const config = base();
    const reversed = Object.fromEntries(Object.entries(config).reverse()) as StudioConfig;
    expect(stableStringify({ a: 1, b: [1, { d: 2, c: 3 }] })).toBe(stableStringify({ b: [1, { c: 3, d: 2 }], a: 1 }));
    expect(rowRenderHash(reversed, maya)).toBe(rowRenderHash(config, maya));
    expect(rowRenderHash(config, { company: 'Top End Solar', first_name: 'Maya', row: 2 })).toBe(rowRenderHash(config, maya));
  });

  it('changes when the copy, the row values or an image setting changes', () => {
    const config = base();
    const hash = rowRenderHash(config, maya);
    expect(rowRenderHash({ ...config, copy: 'Hello {first_name}.' }, maya)).not.toBe(hash);
    expect(rowRenderHash({ ...config, postscript: 'Tea?' }, maya)).not.toBe(hash);
    expect(rowRenderHash(config, { ...maya, company: 'New Co' })).not.toBe(hash);
    expect(rowRenderHash({ ...config, inkColor: '#ff0000' }, maya)).not.toBe(hash);
    expect(rowRenderHash({ ...config, fontSize: config.fontSize + 2 }, maya)).not.toBe(hash);
    expect(rowRenderHash(config, ethan)).not.toBe(hash);
  });

  it('ignores volatile fields: history, ids, names, client, timestamps, field map', () => {
    const config = base();
    const hash = rowRenderHash(config, maya);
    const noisy = {
      ...config,
      id: 'abc',
      templateId: 'tpl',
      campaignName: 'Renamed',
      client: 'Northwind',
      history: [{ at: '2026-10-09T14:02:00Z', kind: 'generated' as const, rows: 4 }],
      updatedAt: '2026-10-10T00:00:00Z',
      fieldMap: [{ column: 'x', use: 'custom' }],
      sourceColumns: ['x'],
    } as StudioConfig;
    expect(rowRenderHash(noisy, maya)).toBe(hash);
    // Output columns stamped on the row do not count either.
    expect(rowRenderHash(config, { ...maya, handwritten_url: 'https://x/a.png', handwritten_status: 'uploaded' })).toBe(hash);
  });

  it('hashes B rows with their B copy only', () => {
    const config = base();
    const withB = { ...config, copyVariantB: { copy: 'Variant B for {first_name}' } };
    // Row 2 is even, so it is a B row; row 3 stays A.
    expect(rowRenderHash(withB, maya)).not.toBe(rowRenderHash(config, maya));
    expect(rowRenderHash(withB, ethan)).toBe(rowRenderHash(config, ethan));
    const otherB = { ...config, copyVariantB: { copy: 'Another B for {first_name}' } };
    expect(rowRenderHash(otherB, ethan)).toBe(rowRenderHash(withB, ethan));
    expect(rowRenderHash(otherB, maya)).not.toBe(rowRenderHash(withB, maya));
  });

  it('caches the config fingerprint per config object', () => {
    const config = base();
    expect(configFingerprint(config)).toBe(configFingerprint({ ...config }));
  });
});

describe('regeneration plan', () => {
  const config: StudioConfig = { ...defaultConfig('memes'), layers: defaultConfig('memes').layers.map((layer) => ({ ...layer, text: 'Hey {first_name}' })) };
  const cols = outputColumnsFor('memes');
  const people: Contact[] = [2, 3, 4].map((row) => ({ row, first_name: `P${row}` }));
  const asset = (row: number, publicUrl?: string): GeneratedAsset => ({
    id: `a${row}`,
    row,
    filename: `row-${row}.png`,
    blob: new Blob(['x']),
    url: `blob:${row}`,
    bytes: 1,
    selected: true,
    status: publicUrl ? 'uploaded' : 'ready',
    publicUrl,
    uploadStatus: publicUrl ? 'uploaded' : undefined,
  });

  it('keeps unchanged rows that still have a file and renders the rest', () => {
    const generated = people.map((person) => asset(person.row, `https://cdn.test/row-${person.row}.png`));
    const stamped = stampStudioOutputs(people, generated, 'memes', config);
    expect(stamped.every((row) => String(row[cols.hash]).length === 16)).toBe(true);
    // Row 3's name changes, so only it renders again.
    const edited = stamped.map((row) => (row.row === 3 ? { ...row, first_name: 'Changed' } : row));
    const inMemory = planRegeneration(edited, generated, config, 'memes', cols);
    expect(inMemory.total).toBe(3);
    expect(inMemory.changed).toBe(1);
    expect(inMemory.keep.map((item) => item.id)).toEqual(['a2', 'a4']);
    // After a reload nothing is in memory: kept rows reuse the stored public link.
    const fromCloud = planRegeneration(edited, [], config, 'memes', cols);
    expect(fromCloud.changed).toBe(1);
    expect(fromCloud.keep.map((item) => [item.row, item.publicUrl, item.blob.size])).toEqual([
      [2, 'https://cdn.test/row-2.png', 0],
      [4, 'https://cdn.test/row-4.png', 0],
    ]);
  });

  it('keeps a GIF row\'s still link when the row is reused after a reload', () => {
    const gifConfig = defaultConfig('gif');
    const gifCols = outputColumnsFor('gif');
    expect(gifCols.still).toBeTruthy();
    const gifAssets = people.map((person) => ({
      ...asset(person.row, `https://cdn.test/row-${person.row}.gif`),
      filename: `row-${person.row}.gif`,
      still: { blob: new Blob(['s']), url: `blob:s${person.row}`, filename: `row-${person.row}-still.jpg`, publicUrl: `https://cdn.test/row-${person.row}-still.jpg` },
    }));
    const stamped = stampStudioOutputs(people, gifAssets, 'gif', gifConfig);
    const plan = planRegeneration(stamped, [], gifConfig, 'gif', gifCols);
    expect(plan.changed).toBe(0);
    const restamped = stampStudioOutputs(stamped, plan.keep, 'gif', gifConfig);
    expect(restamped.map((row) => row[gifCols.still!])).toEqual(people.map((person) => `https://cdn.test/row-${person.row}-still.jpg`));
  });

  it('renders everything when the look changes, and local-only files need the blob', () => {
    const generated = people.map((person) => asset(person.row));
    const stamped = stampStudioOutputs(people, generated, 'memes', config);
    expect(planRegeneration(stamped, generated, config, 'memes', cols).changed).toBe(0);
    expect(planRegeneration(stamped, [], config, 'memes', cols).changed).toBe(3);
    const restyled: StudioConfig = { ...config, effect: config.effect === 'none' ? 'fire' : 'none' };
    expect(planRegeneration(stamped, generated, restyled, 'memes', cols).changed).toBe(3);
  });

  it('never keeps failed rows', () => {
    const generated = [asset(2, 'https://cdn.test/2.png'), { ...asset(3), status: 'failed' as const, error: 'boom' }];
    const stamped = stampStudioOutputs(people.slice(0, 2), generated, 'memes', config);
    const plan = planRegeneration(stamped, generated, config, 'memes', cols);
    expect(plan.keep.map((item) => item.row)).toEqual([2]);
    expect(plan.changed).toBe(1);
  });
});
