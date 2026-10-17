import { expect, test, type Page } from '@playwright/test';
import { campaignRow, collectErrors, fakeSupabase, type FakeRequest } from './fake-supabase';

const archive = { id: 'f1', name: 'Archive', created_at: '2026-10-01T00:00:00Z' };

/** Four loose campaigns, newest first: Alpha, Bravo, Charlie, Delta. */
function rows() {
  return ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((name, index) =>
    campaignRow(`c${index + 1}`, name, { updated_at: `2026-10-0${9 - index}T12:00:00Z` }));
}

const item = (page: Page, name: string) => page.locator(`li[data-library-kind="campaign"][data-library-name="${name}"]`);
const box = (page: Page, name: string) => page.getByRole('checkbox', { name: `Select ${name}`, exact: true });
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Bulk actions' });
const rpcCalls = (requests: FakeRequest[], fn: string) => requests.filter((request) => request.table === 'rpc' && request.url.endsWith(`/rpc/${fn}`));

test('Shift-click selects a range; bulk move reports a forced failure and keeps the failed item selected', async ({ page, context }) => {
  const fake = await fakeSupabase(context, {
    campaigns: rows(),
    folders: [archive],
    bulkFailures: { c2: { code: 'permission', message: 'You cannot move Bravo.' } },
  });
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(item(page, 'Delta')).toBeVisible();
  await expect(bar(page)).toHaveCount(0);

  await box(page, 'Alpha').click();
  await box(page, 'Charlie').click({ modifiers: ['Shift'] });
  await expect(bar(page).locator('[data-bulk-count]')).toHaveText('3 selected');
  await expect(box(page, 'Bravo')).toBeChecked();
  await expect(box(page, 'Delta')).not.toBeChecked();

  await bar(page).getByRole('button', { name: 'Move' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();

  // The results panel names the failure (the exact wording belongs to the results panel).
  await expect(page.getByText(/failed/).first()).toBeVisible();
  expect(rpcCalls(fake.requests, 'bulk_move').map((request) => request.body)).toEqual([
    { entity: 'campaign', ids: ['c1', 'c2', 'c3'], target_folder: 'f1', target_space: null },
  ]);
  await expect(item(page, 'Alpha')).toHaveCount(0);
  await expect(item(page, 'Charlie')).toHaveCount(0);
  await expect(item(page, 'Bravo')).toBeVisible();
  await expect(item(page, 'Delta')).toBeVisible();
  await expect(bar(page).locator('[data-bulk-count]')).toHaveText('1 selected');
  await expect(box(page, 'Bravo')).toBeChecked();

  await page.getByRole('button', { name: /Archive/ }).click();
  await expect(item(page, 'Alpha')).toBeVisible();
  await expect(item(page, 'Charlie')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Ctrl+A selects the visible rows and Esc clears them', async ({ page, context }) => {
  await fakeSupabase(context, { campaigns: rows(), folders: [archive] });
  await page.goto('/');
  await box(page, 'Bravo').click();
  await page.keyboard.press('ControlOrMeta+A');
  await expect(bar(page).locator('[data-bulk-count]')).toHaveText('4 selected');
  await page.keyboard.press('Escape');
  await expect(bar(page)).toHaveCount(0);
});

test('Bulk delete goes to Trash, and Restore brings it back', async ({ page, context }) => {
  const fake = await fakeSupabase(context, { campaigns: rows(), folders: [archive] });
  await page.goto('/');
  await box(page, 'Charlie').click();
  await box(page, 'Delta').click();
  await bar(page).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Moved to Trash')).toBeVisible();
  await expect(item(page, 'Charlie')).toHaveCount(0);
  await expect(item(page, 'Delta')).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);
  expect(rpcCalls(fake.requests, 'bulk_trash').map((request) => request.body)).toEqual([{ entity: 'campaign', ids: ['c3', 'c4'] }]);

  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Trash' }).click();
  const trashed = page.locator('li[data-trash-name="Delta"]');
  await expect(trashed).toBeVisible();
  await expect(trashed.locator('[data-trash-meta]')).toContainText('Deleted by you');
  await expect(trashed.locator('[data-trash-meta]')).toContainText('30 days left');

  await page.getByRole('checkbox', { name: 'Select Delta', exact: true }).check();
  await page.getByRole('toolbar', { name: 'Trash actions' }).getByRole('button', { name: 'Restore' }).click();
  await expect(trashed).toHaveCount(0);
  await expect(page.locator('li[data-trash-name="Charlie"]')).toBeVisible();
  expect(rpcCalls(fake.requests, 'bulk_restore').map((request) => request.body)).toEqual([{ entity: 'campaign', ids: ['c4'] }]);

  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'All' }).click();
  await expect(item(page, 'Delta')).toBeVisible();
  await expect(item(page, 'Charlie')).toHaveCount(0);
});
