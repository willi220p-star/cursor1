import { expect, test, type Page } from '@playwright/test';
import { campaignRow, collectErrors, fakeSupabase } from './fake-supabase';

const spaces = [
  { id: 'int', name: 'Internal (DGK)', kind: 'internal' as const },
  { id: 'acme', name: 'Acme', kind: 'client' as const },
  { id: 'beta', name: 'Beta Co', kind: 'client' as const },
];

function rows() {
  return [
    campaignRow('c-acme', 'Acme spring notes', { space_id: 'acme', updated_at: '2026-10-09T14:00:00Z' }),
    campaignRow('c-int', 'DGK own outreach', { space_id: 'int', updated_at: '2026-10-08T10:00:00Z' }),
    campaignRow('c-beta', 'Beta launch', { space_id: 'beta', updated_at: '2026-10-07T10:00:00Z' }),
  ];
}

const item = (page: Page, name: string) => page.locator(`li[data-library-kind="campaign"][data-library-name="${name}"]`);

async function openAccountMenu(page: Page) {
  await page.getByRole('button', { name: /^Account menu for/ }).click();
}

test('A Client Viewer sees only their space, with no studios', async ({ page, context }) => {
  const fake = await fakeSupabase(context, { role: 'client_viewer', spaces, clientSpaceId: 'acme', campaigns: rows() });
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('space-name')).toHaveText('Acme');
  await expect(page.getByTestId('desk-space')).toHaveText('Acme');
  await expect(item(page, 'Acme spring notes')).toBeVisible();
  await expect(item(page, 'DGK own outreach')).toHaveCount(0);
  await expect(item(page, 'Beta launch')).toHaveCount(0);
  // Only the Desk tab, no studio tiles, no switcher.
  await expect(page.locator('.studio-tabs a.studio-tab')).toHaveCount(1);
  await expect(page.locator('.studio-tabs a[data-studio="handwritten"]')).toHaveCount(0);
  await expect(page.locator('#studios-heading')).toHaveCount(0);
  await expect(page.getByTestId('space-switcher')).toHaveCount(0);
  // accept_invite ran after sign-in.
  expect(fake.requests.some((request) => request.table === 'rpc:accept_invite')).toBe(true);

  await openAccountMenu(page);
  await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Members' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Activity' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // A studio URL sends them back to the Desk with a note.
  await page.goto('/handwritten');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Not available for your role')).toBeVisible();
  expect(errors).toEqual([]);
});

test('A Client Manager gets studios and Activity, but not Members', async ({ page, context }) => {
  await fakeSupabase(context, { role: 'client_manager', spaces, clientSpaceId: 'acme', campaigns: rows() });
  await page.goto('/');
  await expect(page.getByTestId('space-name')).toHaveText('Acme');
  await expect(page.locator('.studio-tabs a[data-studio="handwritten"]')).toBeVisible();
  await openAccountMenu(page);
  await expect(page.getByRole('menuitem', { name: 'Activity' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Members' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.goto('/members');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Only DGK staff manage members and spaces.')).toBeVisible();

  // Saved looks can be used, not saved.
  await page.goto('/handwritten');
  await expect(page.getByRole('button', { name: 'More campaign actions' })).toBeVisible();
  await page.getByRole('button', { name: 'More campaign actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Save this look' })).toHaveCount(0);
});

test('Staff switch spaces and the library follows; the choice is remembered', async ({ page, context }) => {
  const fake = await fakeSupabase(context, { role: 'team', spaces, campaigns: rows() });
  await page.goto('/');
  await expect(page.getByTestId('space-switcher')).toContainText('All spaces');
  await expect(item(page, 'Acme spring notes')).toBeVisible();
  await expect(item(page, 'DGK own outreach')).toBeVisible();
  await expect(item(page, 'Beta launch')).toBeVisible();

  await page.getByTestId('space-switcher').click();
  await page.getByRole('option', { name: /Acme/ }).click();
  await expect(page.getByTestId('space-switcher')).toContainText('Acme');
  await expect(item(page, 'Acme spring notes')).toBeVisible();
  await expect(item(page, 'DGK own outreach')).toHaveCount(0);
  await expect(item(page, 'Beta launch')).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('space-switcher')).toContainText('Acme');
  await expect(item(page, 'Beta launch')).toHaveCount(0);

  // A copy stays in the space of its original.
  await page.getByRole('button', { name: 'Actions for Acme spring notes', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page.getByText('Copied as Acme spring notes copy')).toBeVisible();
  const save = fake.requests.find((request) => request.method === 'POST' && request.table === 'outbound_campaigns');
  expect((save?.body as { space_id?: string }).space_id).toBe('acme');

  // Team members get Members and Activity in the account menu.
  await openAccountMenu(page);
  await expect(page.getByRole('menuitem', { name: 'Members' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Activity' })).toBeVisible();
});

test('Staff on All spaces save new campaigns to Internal', async ({ page, context }) => {
  const fake = await fakeSupabase(context, { role: 'owner', spaces, campaigns: [] });
  await page.goto('/handwritten');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => fake.requests.some((request) => request.method === 'POST' && request.table === 'outbound_campaigns')).toBe(true);
  const save = fake.requests.find((request) => request.method === 'POST' && request.table === 'outbound_campaigns');
  expect((save?.body as { space_id?: string }).space_id).toBe('int');
});

test('The Members page invites a client into a space', async ({ page, context }) => {
  const fake = await fakeSupabase(context, {
    role: 'owner',
    spaces,
    profiles: [{ user_id: 'u-cara', email: 'cara@acme.com', display_name: 'Cara', org_role: 'client' }],
    memberships: [{ space_id: 'acme', user_id: 'u-cara', role: 'client_manager' }],
  });
  const errors = collectErrors(page);
  await page.goto('/');
  await openAccountMenu(page);
  await page.getByRole('menuitem', { name: 'Members' }).click();
  await expect(page).toHaveURL(/\/members$/);
  const people = page.getByRole('table', { name: 'People' });
  await expect(people.locator('tr[data-person="cara@acme.com"]')).toContainText('Client Manager');
  await expect(people.locator('tr[data-person="cara@acme.com"]')).toContainText('Acme');
  // The owner cannot change their own access.
  await expect(page.getByRole('button', { name: 'Actions for operator@dgk.internal' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Invite someone' }).click();
  await page.getByLabel('Email').fill('new.person@beta.co');
  await page.getByLabel('Role').selectOption('client_viewer');
  // A client role needs a space.
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Pick a client space' })).toBeVisible();
  await page.getByLabel('Client space').selectOption('beta');
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText('Invite sent to new.person@beta.co')).toBeVisible();

  const call = fake.functionCalls.find((entry) => entry.name === 'invite-member');
  expect(call?.body).toEqual({ email: 'new.person@beta.co', org_role: 'client', space_id: 'beta', role: 'client_viewer' });
  await expect(people.locator('tr[data-person="new.person@beta.co"]')).toContainText('Invited');
  await expect(people.locator('tr[data-person="new.person@beta.co"]')).toContainText('Beta Co');

  // Spaces tab lists the spaces; Internal cannot be archived.
  await page.getByRole('tab', { name: 'Spaces' }).click();
  await expect(page.locator('li[data-space="Internal (DGK)"]')).toBeVisible();
  await expect(page.locator('li[data-space="Internal (DGK)"]').getByRole('button', { name: 'Archive' })).toHaveCount(0);
  await expect(page.locator('li[data-space="Acme"]').getByRole('button', { name: 'Archive' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('A failed invite shows the reason inline', async ({ page, context }) => {
  await fakeSupabase(context, { role: 'team', spaces, inviteResult: { ok: false, error: 'That person already has access.' } });
  await page.goto('/members');
  await page.getByRole('button', { name: 'Invite someone' }).click();
  // Team members cannot invite Team.
  await expect(page.getByLabel('Role').locator('option[value="team"]')).toHaveCount(0);
  await page.getByLabel('Email').fill('cara@acme.com');
  await page.getByLabel('Client space').selectOption('acme');
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('That person already has access.');
});

test('Activity lists what happened, newest first', async ({ page, context }) => {
  await fakeSupabase(context, {
    role: 'owner',
    spaces,
    profiles: [{ user_id: 'u-sam', email: 'sam@dgk.com', display_name: 'Sam', org_role: 'team' }],
    activity: [
      { id: 2, at: new Date(Date.now() - 120_000).toISOString(), actor: 'u-sam', space_id: 'acme', entity_type: 'campaign', entity_id: null, action: 'moved', details: { count: 12, to_space: 'acme' } },
      { id: 1, at: new Date(Date.now() - 3_600_000).toISOString(), actor: 'u-sam', space_id: 'int', entity_type: 'campaign', entity_id: 'c1', action: 'renamed', details: { old_name: 'A', new_name: 'B' } },
    ],
  });
  await page.goto('/activity');
  const list = page.getByRole('list', { name: 'Activity' });
  await expect(list.locator('li').first()).toContainText('Sam moved 12 campaigns to Acme');
  await expect(list.locator('li').first()).toContainText('2 min ago');
  await page.getByLabel('Filter by action').selectOption('renamed');
  await expect(list.locator('li')).toHaveCount(1);
  await expect(list.locator('li').first()).toContainText('Sam renamed “A” to “B”');
  await page.getByLabel('Filter by action').selectOption('trashed');
  await expect(page.getByText('Nothing matches those filters')).toBeVisible();
});

test('A signed-in account with no profile is told to ask for an invite', async ({ page, context }) => {
  await fakeSupabase(context, { noProfile: true });
  await page.goto('/');
  await expect(page.getByText('Your account has no access yet.')).toBeVisible();
  await expect(page.getByText(/Ask DGK to invite you/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
});
