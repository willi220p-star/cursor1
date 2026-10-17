import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ table: string; filters: Array<[string, string, unknown]> }> = [];
const tables: Record<string, unknown[]> = {};

// A tiny chainable stand-in for the Supabase query builder: records filters, resolves table rows.
function builder(table: string) {
  const call = { table, filters: [] as Array<[string, string, unknown]> };
  calls.push(call);
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'order', 'range', 'limit']) chain[method] = () => chain;
  for (const method of ['eq', 'in', 'is']) chain[method] = (column: string, value: unknown) => { call.filters.push([method, column, value]); return chain; };
  chain.then = (resolve: (value: unknown) => void) => resolve({ data: tables[table] ?? [], error: null });
  return chain;
}

vi.mock('./cloud', () => ({
  supabase: { from: (table: string) => builder(table), auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) } },
}));

const { getReviewSummary, invalidateReviewSummary } = await import('./reviews');

beforeEach(() => {
  calls.length = 0;
  tables.outbound_assets = [
    { id: 'a1', campaign_id: 'c1', contact_key: '2', public_url: 'x', created_at: '2026-10-01', metadata: { role: 'generated' } },
    { id: 'a2', campaign_id: 'c1', contact_key: '3', public_url: 'y', created_at: '2026-10-01', metadata: { role: 'generated' } },
    { id: 'list', campaign_id: 'c1', contact_key: null, public_url: 'z', created_at: '2026-10-01', metadata: { role: 'upload' } },
    { id: 'b1', campaign_id: 'c2', contact_key: '2', public_url: 'w', created_at: '2026-10-01', metadata: { role: 'generated' } },
  ];
  tables.reviews = [
    { id: 'r1', space_id: 's', campaign_id: 'c1', asset_id: 'a1', status: 'approved', note: null, reviewer: 'u1', created_at: '2026-10-02' },
    { id: 'r2', space_id: 's', campaign_id: 'c2', asset_id: null, status: 'approved', note: null, reviewer: 'u1', created_at: '2026-10-02' },
  ];
});

describe('getReviewSummary', () => {
  it('coalesces badges rendered in the same tick into one aggregated pass, then serves the cache', async () => {
    for (const id of ['c1', 'c2', 'c3']) invalidateReviewSummary(id);
    const [c1, c2, c3, again] = await Promise.all([getReviewSummary('c1'), getReviewSummary('c2'), getReviewSummary('c3'), getReviewSummary('c1')]);
    expect(calls.map((call) => call.table).sort()).toEqual(['outbound_assets', 'reviews']);
    const assetQuery = calls.find((call) => call.table === 'outbound_assets')!;
    expect(assetQuery.filters).toContainEqual(['in', 'campaign_id', ['c1', 'c2', 'c3']]);
    expect(assetQuery.filters).toContainEqual(['is', 'deleted_at', null]);
    expect(c1).toMatchObject({ approved: 1, total: 2, signedOff: null });
    expect(again).toBe(c1);
    expect(c2.signedOff?.id).toBe('r2');
    expect(c3.total).toBe(0);

    calls.length = 0;
    await getReviewSummary('c2');
    expect(calls).toEqual([]);
    invalidateReviewSummary('c2');
    await getReviewSummary('c2');
    expect(calls).toHaveLength(2);
  });
});
