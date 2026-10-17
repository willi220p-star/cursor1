import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { campaignRow, collectErrors, fakeSupabase, userId, type ReviewTables } from './fake-supabase';

const SPACE = '10000000-0000-4000-8000-000000000001';
const CAMPAIGN = '20000000-0000-4000-8000-000000000001';
const profile = { user_id: userId, email: 'operator@dgk.internal', display_name: 'Operator', org_role: 'owner' };

function assetRow(id: string, row: number) {
  return {
    id,
    user_id: userId,
    campaign_id: CAMPAIGN,
    filename: `acme-row-${row}.jpg`,
    public_url: `https://e2e-test.supabase.co/storage/v1/object/public/outbound-assets/${userId}/acme-q4/${row}.jpg`,
    bytes: 42_000,
    contact_key: String(row),
    content_type: 'image/jpeg',
    storage_path: `${userId}/acme-q4/2026-10-17/${id}-acme-row-${row}.jpg`,
    metadata: { role: 'generated', mode: 'handwritten', row },
    created_at: `2026-10-17T09:0${row}:00Z`,
  };
}

async function openReview(page: Page, context: BrowserContext, tables: ReviewTables = {}) {
  const campaign = campaignRow(CAMPAIGN, 'Acme Q4', { space_id: SPACE });
  const assets = [assetRow('a-row-2', 2), assetRow('a-row-3', 3), assetRow('a-row-4', 4)];
  const fake = await fakeSupabase(context, { campaigns: [campaign], assets, reviews: { profiles: [profile], ...tables } });
  const saved = {
    id: CAMPAIGN,
    name: 'Acme Q4',
    mode: 'handwritten',
    config: { ...campaign.config, id: CAMPAIGN },
    columns: campaign.source_columns,
    contacts: campaign.source_data,
    updatedAt: campaign.updated_at,
    cloud: true,
  };
  await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [`gtm-studio-load-campaign:${userId}`, JSON.stringify(saved)] as const);
  await page.goto('/handwritten');
  await page.getByRole('group', { name: 'Steps' }).getByRole('button', { name: 'Ship' }).click();
  await page.getByRole('button', { name: /Review all images/ }).click();
  await expect(page.getByRole('dialog')).toContainText('3 generated');
  await expect(page.getByTestId('review-controls')).toHaveCount(3);
  return fake;
}

const tile = (page: Page, row: number) => page.locator('.review-grid > li').filter({ hasText: `acme-row-${row}.jpg` });
const reviewPosts = (fake: Awaited<ReturnType<typeof fakeSupabase>>) => fake.requests.filter((request) => request.method === 'POST' && request.table === 'reviews').map((request) => request.body as Record<string, unknown>);

test('Approve, request changes, sign off with the warning, and comment', async ({ page, context }) => {
  const errors = collectErrors(page);
  const fake = await openReview(page, context);

  // Approve one image with the button.
  const first = tile(page, 2);
  await first.getByRole('button', { name: 'Approve' }).click();
  await expect(first.getByRole('button', { name: 'Approve' })).toHaveAttribute('aria-pressed', 'true');
  await expect(first.getByTestId('review-status')).toHaveText('Approved by Operator');
  await expect.poll(() => reviewPosts(fake)).toEqual([expect.objectContaining({ space_id: SPACE, campaign_id: CAMPAIGN, asset_id: 'a-row-2', status: 'approved', reviewer: userId, note: null })]);

  // Approve another with the keyboard: focus the tile, press A.
  const third = tile(page, 4);
  await third.focus();
  await page.keyboard.press('a');
  await expect(third.getByRole('button', { name: 'Approve' })).toHaveAttribute('aria-pressed', 'true');

  // Request changes needs a note.
  const second = tile(page, 3);
  await second.getByRole('button', { name: 'Request changes' }).click();
  await second.getByRole('button', { name: 'Send' }).click();
  await expect(second.getByRole('alert')).toContainText('Add a note');
  await second.getByLabel('What should change?').fill('Logo is blurry');
  await second.getByRole('button', { name: 'Send' }).click();
  await expect(second.getByRole('button', { name: 'Request changes' })).toHaveAttribute('aria-pressed', 'true');
  await expect(second.getByTestId('review-status')).toContainText('Changes requested by Operator');
  await expect(second.getByTestId('review-status')).toContainText('Logo is blurry');
  await expect.poll(() => reviewPosts(fake).at(-1)).toMatchObject({ asset_id: 'a-row-3', status: 'changes_requested', note: 'Logo is blurry' });

  // Sign-off warns while an image still needs changes.
  const signoff = page.getByTestId('campaign-signoff');
  await expect(signoff.getByTestId('signoff-summary')).toHaveText('2/3 approved');
  await expect(signoff.getByTestId('signoff-state')).toHaveText('Not signed off yet');
  await signoff.getByRole('button', { name: 'Sign off campaign' }).click();
  await expect(signoff.getByRole('alert')).toContainText('1 image still needs changes — sign off anyway?');
  expect(reviewPosts(fake).filter((body) => body.asset_id === null)).toEqual([]);
  await signoff.getByRole('button', { name: 'Sign off anyway' }).click();
  await expect(signoff.getByTestId('signoff-state')).toContainText(/Signed off by Operator on \w{3} \d{1,2}, \d{4}/);
  await expect.poll(() => reviewPosts(fake).at(-1)).toMatchObject({ asset_id: null, status: 'approved', campaign_id: CAMPAIGN });

  // Campaign comment thread: Ctrl+Enter sends.
  await page.getByTestId('campaign-comments').click();
  const sheet = page.getByRole('dialog', { name: 'Comments on Acme Q4' });
  await expect(sheet).toContainText('No comments yet');
  await sheet.getByLabel('Write a comment').fill('Ready for Smartlead once row 3 is fixed.');
  await sheet.getByLabel('Write a comment').press('Control+Enter');
  await expect(sheet.getByTestId('comment')).toHaveCount(1);
  await expect(sheet.getByTestId('comment')).toContainText('Operator');
  await expect(sheet.getByTestId('comment')).toContainText('Ready for Smartlead once row 3 is fixed.');
  await expect(sheet.getByLabel('Write a comment')).toHaveValue('');
  const posted = fake.requests.find((request) => request.method === 'POST' && request.table === 'comments');
  expect(posted?.body).toMatchObject({ space_id: SPACE, campaign_id: CAMPAIGN, asset_id: null, author: userId });

  // Edit own comment: the edited marker shows.
  await sheet.getByRole('button', { name: 'Edit comment' }).click();
  await sheet.getByLabel('Edit comment').fill('Ready once row 3 is fixed.');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet.getByTestId('comment')).toContainText('edited');
  await expect(sheet.getByTestId('comment')).toContainText('Ready once row 3 is fixed.');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('campaign-comments')).toHaveAccessibleName('Campaign comments (1)');

  // Per-image thread is separate from the campaign thread.
  await first.getByTestId('image-comments').click();
  const imageSheet = page.getByRole('dialog', { name: 'Comments on acme-row-2.jpg' });
  await expect(imageSheet).toContainText('No comments yet');
  await imageSheet.getByLabel('Write a comment').fill('Signature sits too low.');
  await imageSheet.getByRole('button', { name: 'Send' }).click();
  await expect(imageSheet.getByTestId('comment')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(first.getByTestId('image-comments')).toHaveAccessibleName('Comments (1)');
  expect(fake.requests.filter((request) => request.method === 'POST' && request.table === 'comments').at(-1)?.body).toMatchObject({ asset_id: 'a-row-2' });

  expect(errors).toEqual([]);
});

test('Existing reviews load as the current state (latest wins)', async ({ page, context }) => {
  await openReview(page, context, {
    reviews: [
      { id: 'r1', space_id: SPACE, campaign_id: CAMPAIGN, asset_id: 'a-row-2', status: 'approved', note: null, reviewer: userId, created_at: '2026-10-16T09:00:00Z' },
      { id: 'r2', space_id: SPACE, campaign_id: CAMPAIGN, asset_id: 'a-row-2', status: 'changes_requested', note: 'Wrong name', reviewer: userId, created_at: '2026-10-16T10:00:00Z' },
      { id: 'r3', space_id: SPACE, campaign_id: CAMPAIGN, asset_id: 'a-row-3', status: 'approved', note: null, reviewer: userId, created_at: '2026-10-16T09:00:00Z' },
    ],
  });
  await expect(tile(page, 2).getByRole('button', { name: 'Request changes' })).toHaveAttribute('aria-pressed', 'true');
  await expect(tile(page, 2).getByRole('button', { name: 'Approve' })).toHaveAttribute('aria-pressed', 'false');
  await expect(tile(page, 3).getByRole('button', { name: 'Approve' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('signoff-summary')).toHaveText('1/3 approved');
});

test('Bell shows unread from a seeded notification and Mark all read clears it', async ({ page, context }) => {
  const fake = await fakeSupabase(context, {
    campaigns: [campaignRow(CAMPAIGN, 'Acme Q4', { space_id: SPACE })],
    reviews: {
      profiles: [profile, { user_id: 'sam', email: 'sam@client.example', display_name: 'Sam', org_role: 'client' }],
      notifications: [
        { id: 'n1', recipient: userId, kind: 'approved', space_id: SPACE, campaign_id: CAMPAIGN, asset_id: 'a-row-2', actor: 'sam', summary: 'Sam approved an image', created_at: '2026-10-17T10:00:00Z', read_at: null },
        { id: 'n2', recipient: userId, kind: 'approved', space_id: SPACE, campaign_id: CAMPAIGN, asset_id: 'a-row-3', actor: 'sam', summary: 'Sam approved an image', created_at: '2026-10-17T10:05:00Z', read_at: null },
      ],
    },
  });
  await page.goto('/');
  const bell = page.getByTestId('notification-bell');
  await expect(bell).toBeVisible();
  await expect(page.getByTestId('notification-count')).toHaveText('2');
  await bell.click();
  await expect(page.getByTestId('notification-item')).toHaveCount(1);
  await expect(page.getByTestId('notification-item')).toContainText('Sam approved 2 images in Acme Q4');
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByTestId('notification-count')).toHaveCount(0);
  await expect(bell).toHaveAccessibleName('Notifications');

  // A notification created by a database trigger arrives over realtime.
  const comment = { id: 'n3', recipient: userId, kind: 'commented', space_id: SPACE, campaign_id: CAMPAIGN, asset_id: null, actor: 'sam', summary: 'Sam commented', created_at: new Date().toISOString(), read_at: null };
  fake.reviewTables!.notifications.push(comment);
  fake.pushRealtime!('notifications', 'INSERT', comment);
  await expect(page.getByTestId('notification-count')).toHaveText('1');
  await expect(page.getByRole('status').filter({ hasText: 'unread notification' })).toHaveText('1 unread notification');

  // Opening it marks it read and hands the campaign to the Desk.
  await page.getByTestId('notification-item').filter({ hasText: 'Sam commented on Acme Q4' }).click();
  await expect(page).toHaveURL(new RegExp(`/review/${CAMPAIGN}$`));
  expect(await page.evaluate(() => localStorage.getItem('gtm-studio-open-review'))).toBe(CAMPAIGN);
  await expect(page.getByTestId('notification-count')).toHaveCount(0);
  await expect.poll(() => fake.reviewTables!.notifications.find((row) => row.id === 'n3')?.read_at).toBeTruthy();
});
