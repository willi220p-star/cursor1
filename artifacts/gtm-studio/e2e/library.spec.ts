import { expect, test, type Page } from '@playwright/test';
import { campaignRow, collectErrors, fakeSupabase, type FakeRequest } from './fake-supabase';

const folder = { id: 'f1', name: 'Northwind Q4', created_at: '2026-10-01T00:00:00Z' };

function rows() {
  return [
    campaignRow('c1', 'Spring notes', {
      updated_at: '2026-10-09T14:00:00Z',
      config: { client: 'Northwind', history: [{ at: '2026-10-09T14:02:00Z', kind: 'generated', rows: 3 }] },
    }),
    campaignRow('c2', 'Autumn push', { folder_id: 'f1', updated_at: '2026-10-08T10:00:00Z' }),
  ];
}

const item = (page: Page, name: string) => page.locator(`li[data-library-kind="campaign"][data-library-name="${name}"]`);

async function openMenu(page: Page, name: string) {
  await page.getByRole('button', { name: `Actions for ${name}`, exact: true }).click();
}

const campaignDeletes = (requests: FakeRequest[]) => requests.filter((request) => request.method === 'DELETE' && request.table === 'outbound_campaigns');

test('Duplicate saves a fresh copy in the same folder, without generated columns', async ({ page, context }) => {
  const fake = await fakeSupabase(context, { campaigns: rows(), folders: [folder] });
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Northwind Q4/ }).click();
  await expect(item(page, 'Autumn push')).toBeVisible();
  await openMenu(page, 'Autumn push');
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page.getByText('Copied as Autumn push copy')).toBeVisible();

  const save = fake.requests.find((request) => request.method === 'POST' && request.table === 'outbound_campaigns');
  expect(save).toBeTruthy();
  const body = save!.body as Record<string, unknown>;
  expect(body.name).toBe('Autumn push copy');
  expect(body.id).not.toBe('c2');
  expect(body).not.toHaveProperty('folder_id');
  expect(body.source_columns).toEqual(['name', 'company', 'role']);
  const sourceRows = body.source_data as Record<string, unknown>[];
  expect(sourceRows).toHaveLength(3);
  expect(sourceRows.every((row) => !('handwritten_url' in row) && !('handwritten_status' in row))).toBe(true);
  expect((body.config as { history?: unknown[] }).history).toEqual([]);

  await expect.poll(() => fake.requests.some((request) => request.method === 'PATCH' && (request.body as { folder_id?: string })?.folder_id === 'f1' && request.url.includes(`id=eq.${body.id}`))).toBe(true);
  await expect(item(page, 'Autumn push copy')).toBeVisible();
  await expect(item(page, 'Autumn push copy').locator('.status-pill')).toHaveText('Draft');
  expect(errors).toEqual([]);
});

test('Delete waits for Undo, and still happens when you leave the page', async ({ page, context }) => {
  const fake = await fakeSupabase(context, { campaigns: rows(), folders: [folder] });
  await page.goto('/');
  await expect(item(page, 'Spring notes')).toBeVisible();
  await expect(item(page, 'Spring notes').locator('.status-pill')).toHaveText('Generated');

  await openMenu(page, 'Spring notes');
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(item(page, 'Spring notes')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(item(page, 'Spring notes')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(campaignDeletes(fake.requests)).toEqual([]);

  // Delete again and leave the desk before the toast runs out: the delete runs on the way out.
  await openMenu(page, 'Spring notes');
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(item(page, 'Spring notes')).toHaveCount(0);
  expect(campaignDeletes(fake.requests)).toEqual([]);
  await page.locator('a.studio-tile[data-studio="memes"]').click();
  await expect(page).toHaveURL(/\/memes$/);
  await expect.poll(() => campaignDeletes(fake.requests).map((request) => new URL(request.url).searchParams.get('id'))).toEqual(['eq.c1']);
});

test('Delete runs by itself once the undo window closes', async ({ page, context }) => {
  const fake = await fakeSupabase(context, { campaigns: rows(), folders: [folder] });
  await page.goto('/');
  await openMenu(page, 'Spring notes');
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.waitForTimeout(5000);
  expect(campaignDeletes(fake.requests)).toEqual([]);
  await expect.poll(() => campaignDeletes(fake.requests).length, { timeout: 15_000 }).toBe(1);
  await expect(item(page, 'Spring notes')).toHaveCount(0);
});

test('Library filters by client and searches client and company names', async ({ page, context }) => {
  await fakeSupabase(context, { campaigns: rows(), folders: [folder] });
  await page.goto('/');
  await expect(item(page, 'Spring notes')).toBeVisible();
  await page.getByLabel('Filter by client').selectOption('Northwind');
  await expect(item(page, 'Spring notes')).toBeVisible();
  await expect(item(page, 'Autumn push')).toHaveCount(0);
  await page.getByLabel('Filter by client').selectOption('__none');
  await expect(item(page, 'Autumn push')).toBeVisible();
  await expect(item(page, 'Spring notes')).toHaveCount(0);
  await page.getByLabel('Filter by client').selectOption('__all');

  const search = page.getByPlaceholder('Search campaigns, templates and files');
  await search.fill('northwind');
  await expect(item(page, 'Spring notes')).toBeVisible();
  await expect(item(page, 'Autumn push')).toHaveCount(0);
  // A company from the list finds both campaigns, including the one inside a folder.
  await search.fill('saltbush');
  await expect(item(page, 'Spring notes')).toBeVisible();
  await expect(item(page, 'Autumn push')).toBeVisible();
});
