import { expect, test, type Page } from '@playwright/test';
import { campaignRow, collectErrors, fakeSupabase, sampleContacts, userId, type FakeRequest } from './fake-supabase';

const MB = 1024 * 1024;
const publicUrl = (path: string) => `https://e2e-test.supabase.co/storage/v1/object/public/outbound-assets/${path}`;
const oldDir = `${userId}/spring-notes/2026-10-01`;

// The current list (campaignRow) links to `${userId}/x/{2,3,4}.jpg`.
const current = [2, 3, 4].map((row) => `${userId}/x/${row}.jpg`);
const oldFiles = [`${oldDir}/v1-row-2.jpg`, `${oldDir}/v1-row-3.jpg`];
const oldGif = `${oldDir}/v1-row-4.gif`;
const oldStill = `${oldDir}/v1-row-4-still.jpg`;
const unreferenced = [...oldFiles, oldGif, oldStill];

function generated(id: string, path: string, campaignId = 'c1', meta: Record<string, unknown> = {}) {
  return {
    id,
    user_id: userId,
    campaign_id: campaignId,
    filename: path.split('/').pop()!.replace(/^v\d+-/, ''),
    storage_path: path,
    public_url: publicUrl(path),
    bytes: MB,
    contact_key: '2',
    content_type: 'image/jpeg',
    created_at: '2026-10-01T09:00:00Z',
    metadata: { role: 'generated', mode: 'handwritten', row: 2, ...meta },
    folder_id: null,
  };
}

function assetRows() {
  return [
    ...current.map((path, index) => ({ ...generated(`cur${index}`, path), created_at: '2026-10-09T09:00:00Z' })),
    ...oldFiles.map((path, index) => generated(`old${index}`, path)),
    generated('gif', oldGif, 'c1', { still_url: publicUrl(oldStill) }),
    // Never touched: the imported list, an uploaded paper photo, another campaign's file.
    { ...generated('list', `${userId}/lists/a-prospects.csv`), filename: 'prospects.csv', metadata: { kind: 'list', role: 'upload' } },
    { ...generated('paper', `${userId}/uploads/paper/p.png`), filename: 'paper.png', metadata: { kind: 'paper', role: 'upload' } },
    generated('other', `${userId}/autumn-push/2026-10-01/v1-row-2.jpg`, 'c2'),
  ];
}

function storageObjects() {
  return [...current, ...unreferenced, `${userId}/lists/a-prospects.csv`, `${userId}/uploads/paper/p.png`, `${userId}/autumn-push/2026-10-01/v1-row-2.jpg`]
    .map((path) => ({ path, size: MB }));
}

function campaigns() {
  const neverStamped = campaignRow('c3', 'Fresh list', { source_columns: ['name', 'company'], source_data: sampleContacts(2) });
  return [
    campaignRow('c1', 'Spring notes', { updated_at: '2026-10-09T14:00:00Z', config: { history: [{ at: '2026-10-09T14:02:00Z', kind: 'uploaded', rows: 3 }] } }),
    campaignRow('c2', 'Autumn push', { updated_at: '2026-10-08T10:00:00Z' }),
    neverStamped,
  ];
}

const item = (page: Page, name: string) => page.locator(`li[data-library-kind="campaign"][data-library-name="${name}"]`);
const removes = (requests: FakeRequest[]) => requests.filter((request) => request.table === 'storage:remove');
const assetDeletes = (requests: FakeRequest[]) => requests.filter((request) => request.method === 'DELETE' && request.table === 'outbound_assets');

async function openCleanup(page: Page, name: string) {
  await expect(item(page, name)).toBeVisible();
  await page.getByRole('button', { name: `Actions for ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Clean up old versions…' }).click();
  return page.getByRole('dialog', { name: 'Clean up old versions' });
}

test('Clean up shows the unreferenced count and deletes only those files', async ({ page, context }) => {
  const fake = await fakeSupabase(context, { campaigns: campaigns(), assets: assetRows(), storageObjects: storageObjects() });
  const errors = collectErrors(page);
  await page.goto('/');
  const dialog = await openCleanup(page, 'Spring notes');
  await expect(dialog.locator('[data-cleanup-summary]')).toHaveText('4 old files (4 MB) from earlier runs will be deleted. Files your current list links to are kept.');
  await expect(dialog.locator('[data-cleanup-list] li')).toHaveCount(4);
  await expect(dialog.locator('[data-cleanup-list]')).toContainText('row-4-still.jpg');
  // Planning only reads.
  expect(removes(fake.requests)).toEqual([]);
  expect(assetDeletes(fake.requests)).toEqual([]);

  await dialog.getByRole('button', { name: 'Delete 4 files' }).click();
  await expect(page.getByText('Deleted 4 files, freed 4 MB')).toBeVisible();
  await expect(dialog).toHaveCount(0);

  const removed = removes(fake.requests);
  expect(removed).toHaveLength(1);
  expect([...(removed[0].body as { prefixes: string[] }).prefixes].sort()).toEqual([...unreferenced].sort());
  expect(fake.objects.map((object) => object.path).sort()).toEqual(storageObjects().map((object) => object.path).filter((path) => !unreferenced.includes(path)).sort());

  const rows = assetDeletes(fake.requests);
  expect(rows).toHaveLength(1);
  const params = new URL(rows[0].url).searchParams;
  expect(params.get('campaign_id')).toBe('eq.c1');
  const inList = params.get('storage_path') ?? '';
  for (const path of [...oldFiles, oldGif]) expect(inList).toContain(path);
  expect(inList).not.toContain(oldStill);
  for (const path of current) expect(inList).not.toContain(path);

  // The clean-up is in the history and the status pill is unchanged.
  await expect.poll(() => {
    const row = fake.campaigns.find((campaign) => campaign.id === 'c1') as { config?: { history?: Array<{ kind: string; rows: number }> } };
    return row?.config?.history?.at(-1);
  }).toMatchObject({ kind: 'cleaned', rows: 4 });
  await expect(item(page, 'Spring notes').locator('.status-pill')).toHaveText('Uploaded');
  expect(errors).toEqual([]);
});

test('Cancel sends nothing', async ({ page, context }) => {
  const fake = await fakeSupabase(context, { campaigns: campaigns(), assets: assetRows(), storageObjects: storageObjects() });
  await page.goto('/');
  const dialog = await openCleanup(page, 'Spring notes');
  await expect(dialog.getByRole('button', { name: 'Delete 4 files' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(removes(fake.requests)).toEqual([]);
  expect(assetDeletes(fake.requests)).toEqual([]);
  expect(fake.requests.filter((request) => request.method === 'PATCH')).toEqual([]);
});

test('A list that was never stamped is refused', async ({ page, context }) => {
  const rows = [...assetRows(), generated('fresh', `${userId}/fresh-list/2026-10-01/v1-row-2.jpg`, 'c3')];
  const fake = await fakeSupabase(context, { campaigns: campaigns(), assets: rows, storageObjects: storageObjects() });
  await page.goto('/');
  const dialog = await openCleanup(page, 'Fresh list');
  await expect(dialog.locator('[data-cleanup-summary]')).toContainText('no links to generated files yet');
  await expect(dialog.getByRole('button', { name: /^Delete/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Done' }).click();
  expect(removes(fake.requests)).toEqual([]);
  expect(assetDeletes(fake.requests)).toEqual([]);
});
