import { expect, test, type Locator, type Page } from '@playwright/test';
import { campaignRow, collectErrors, fakeSupabase, userId } from './fake-supabase';

// Layout checks for the screens a person uses on a phone first: no sideways scrolling, and every
// primary control big enough to hit with a thumb. Phone is 375x812; desktop is 1440x900.

const SPACE = '10000000-0000-4000-8000-000000000001';
const CAMPAIGN = '20000000-0000-4000-8000-000000000001';
const spaces = [
  { id: 'int', name: 'Internal (DGK)', kind: 'internal' as const },
  { id: SPACE, name: 'Acme Corporation Australia Pty Ltd With A Very Long Name', kind: 'client' as const },
];
const viewports = [
  { name: 'phone', width: 375, height: 812, phone: true },
  { name: 'desktop', width: 1440, height: 900, phone: false },
] as const;

const MIN_TAP = 40;

function campaigns() {
  return Array.from({ length: 25 }, (_, index) => campaignRow(
    index === 0 ? CAMPAIGN : `c${index}`,
    index % 4 === 0 ? `A very long campaign name number ${index} for Northwind Traders International Holdings` : `Campaign ${index}`,
    { space_id: index % 3 === 0 ? SPACE : 'int', folder_id: index % 7 === 0 ? 'f1' : null, updated_at: `2026-10-${String(10 + (index % 8)).padStart(2, '0')}T12:00:00Z` },
  ));
}

function assetRow(row: number) {
  return {
    id: `a-row-${row}`,
    user_id: userId,
    campaign_id: CAMPAIGN,
    filename: `acme-row-${row}-with-a-really-long-filename-here.jpg`,
    public_url: `https://e2e-test.supabase.co/storage/v1/object/public/outbound-assets/${userId}/acme-q4/${row}.jpg`,
    bytes: 42_000,
    contact_key: String(row),
    content_type: 'image/jpeg',
    storage_path: `${userId}/acme-q4/2026-10-17/a-row-${row}.jpg`,
    metadata: { role: 'generated', mode: 'handwritten', row },
    created_at: `2026-10-17T09:0${row}:00Z`,
  };
}

const options = {
  role: 'owner' as const,
  spaces,
  campaigns: campaigns(),
  folders: [{ id: 'f1', name: 'Northwind Q4 outreach folder with a long name', created_at: '2026-10-01T00:00:00Z', space_id: 'int' }],
  assets: [2, 3, 4].map(assetRow),
  profiles: [
    { user_id: 'u-cara', email: 'cara.with.a.very.long.email.address@acme-corporation.example.com', display_name: 'Cara Longname-Smithington', org_role: 'client' },
    { user_id: 'u-sam', email: 'sam@dgk.com', display_name: 'Sam', org_role: 'team' },
  ],
  memberships: [{ space_id: SPACE, user_id: 'u-cara', role: 'client_manager' as const }],
  activity: Array.from({ length: 12 }, (_, index) => ({
    id: 100 - index,
    at: new Date(Date.now() - index * 3_600_000).toISOString(),
    actor: 'u-sam',
    space_id: SPACE,
    entity_type: 'campaign',
    entity_id: 'c1',
    action: index % 2 ? 'renamed' : 'moved',
    details: index % 2 ? { old_name: 'Old long campaign name here', new_name: 'New long campaign name here for Northwind' } : { count: 12, to_space: SPACE },
  })),
  reviews: {
    // With review tables on, this list answers every profile read.
    profiles: [
      { user_id: userId, email: 'operator@dgk.internal', display_name: 'Operator', org_role: 'owner' },
      { user_id: 'u-cara', email: 'cara.with.a.very.long.email.address@acme-corporation.example.com', display_name: 'Cara Longname-Smithington', org_role: 'client' },
      { user_id: 'u-sam', email: 'sam@dgk.com', display_name: 'Sam', org_role: 'team' },
    ],
    reviews: [{ id: 'r1', space_id: SPACE, campaign_id: CAMPAIGN, asset_id: 'a-row-2', status: 'changes_requested', note: 'The signature sits too low and the logo is blurry, please redo this image', reviewer: userId, created_at: '2026-10-16T10:00:00Z' }],
  },
};

/** Waits for a sheet or popover to stop sliding in. */
async function settle(locator: Locator) {
  let last = '';
  await expect.poll(async () => {
    const now = JSON.stringify(await locator.boundingBox());
    const stable = now === last;
    last = now;
    return stable;
  }, { intervals: [120, 120, 200, 200] }).toBe(true);
}

async function expectNoSideScroll(page: Page) {
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(widths.scroll, `page is ${widths.scroll}px wide in a ${widths.inner}px window`).toBeLessThanOrEqual(widths.inner);
}

/** The element's own box, or its label's when it is a small native checkbox inside a bigger label. */
async function tapBox(locator: Locator) {
  const target = locator.locator('xpath=ancestor-or-self::*[self::label or self::button or self::a or self::select or self::input][last()]');
  const box = await ((await locator.evaluate((node) => node.matches('input[type=checkbox]'))) ? locator.locator('xpath=ancestor::label[1]') : target).boundingBox();
  if (!box) throw new Error('control has no box');
  return box;
}

async function expectTappable(page: Page, locators: Locator[], phone: boolean) {
  const { width } = page.viewportSize()!;
  for (const locator of locators) {
    await expect(locator.first()).toBeVisible();
    const box = await tapBox(locator.first());
    const label = await locator.first().evaluate((node) => node.getAttribute('aria-label') ?? (node as HTMLElement).innerText ?? node.tagName);
    if (phone) expect(box.height, `${label.trim()} is ${Math.round(box.height)}px high`).toBeGreaterThanOrEqual(MIN_TAP - 0.5); // half a pixel of slack for sub-pixel layout
    expect(box.x, `${label.trim()} starts off screen`).toBeGreaterThanOrEqual(-1);
    // Rows inside a scrolling strip are allowed past the edge; everything else must fit.
    const strip = await locator.first().evaluate((node) => Boolean(node.closest('[data-bulk-bar], .segmented')));
    if (!strip) expect(box.x + box.width, `${label.trim()} runs off the right edge`).toBeLessThanOrEqual(width + 1);
  }
}

for (const viewport of viewports) {
  test.describe(`${viewport.name} layout`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
    });

    test('Desk with a bulk selection fits and its controls are tappable', async ({ page, context }) => {
      await fakeSupabase(context, options);
      const errors = collectErrors(page);
      await page.goto('/');
      await expect(page.locator('li[data-library-kind="campaign"]').first()).toBeVisible();
      await expectNoSideScroll(page);

      // Nav: menu (phone), search, bell, avatar.
      const nav = [page.getByRole('button', { name: 'Search, shortcut Command K' }), page.getByTestId('notification-bell'), page.getByRole('button', { name: /^Account menu/ })];
      if (viewport.phone) nav.unshift(page.getByRole('button', { name: 'Open navigation' }));
      await expectTappable(page, nav, viewport.phone);

      await page.getByRole('checkbox', { name: 'Select Campaign 1', exact: true }).check();
      await page.getByRole('checkbox', { name: 'Select Campaign 2', exact: true }).check();
      const bar = page.getByRole('toolbar', { name: 'Bulk actions' });
      await expect(bar).toBeVisible();
      await expectNoSideScroll(page);

      const buttons = ['Clear', 'Move', 'Status', 'Tags', 'Rename…', 'Download ZIP', 'Delete'].map((name) => bar.getByRole('button', { name: new RegExp(`^${name}`) }));
      await expectTappable(page, buttons, viewport.phone);
      await expectTappable(page, [page.getByRole('checkbox', { name: 'Select Campaign 1', exact: true }), page.getByRole('checkbox', { name: 'Select all visible' })], viewport.phone);

      // The bar stays on screen, above the bottom edge, and is a centred floating bar on wide screens.
      const box = (await bar.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      if (!viewport.phone) {
        expect(box.width).toBeLessThanOrEqual(721);
        expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(40);
      }
      // It pads for the iPhone home indicator.
      expect(await bar.evaluate((node) => getComputedStyle(node).bottom)).not.toBe('auto');

      // Scrolling the phone strip reaches Delete.
      if (viewport.phone) {
        await bar.getByRole('button', { name: /^Delete/ }).scrollIntoViewIfNeeded();
        await expect(bar.getByRole('button', { name: /^Delete/ })).toBeInViewport();
        await expectNoSideScroll(page);
      }
      expect(errors).toEqual([]);
    });

    test('/review/:id fits and its controls are tappable', async ({ page, context }) => {
      await fakeSupabase(context, options);
      await page.goto(`/review/${CAMPAIGN}`);
      const tiles = page.getByRole('list', { name: 'Images to review' }).getByRole('listitem');
      await expect(tiles).toHaveCount(3);
      await expectNoSideScroll(page);
      await expectTappable(page, [
        page.getByTestId('campaign-comments'),
        page.getByRole('button', { name: 'Sign off campaign' }),
        tiles.first().getByRole('button', { name: 'Approve' }),
        tiles.first().getByRole('button', { name: 'Request changes' }),
        tiles.first().getByTestId('image-comments'),
      ], viewport.phone);
      // Every tile stays inside the window.
      for (const tile of await tiles.all()) {
        const box = (await tile.boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      }
      // One column on a phone, three on a wide screen.
      const columns = await tiles.evaluateAll((nodes) => new Set(nodes.map((node) => Math.round(node.getBoundingClientRect().left))).size);
      expect(columns).toBe(viewport.phone ? 1 : 3);

      // The comment sheet fits the window and scrolls inside itself.
      await page.getByTestId('campaign-comments').click();
      const sheet = page.getByRole('dialog', { name: /Comments on/ });
      await settle(sheet);
      const sheetBox = (await sheet.boundingBox())!;
      expect(sheetBox.x + sheetBox.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(sheetBox.height).toBeLessThanOrEqual(viewport.height + 1);
      await expectNoSideScroll(page);
    });

    test('/members fits, with cards on a phone and a table on desktop', async ({ page, context }) => {
      await fakeSupabase(context, options);
      await page.goto('/members');
      await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
      await expect(page.getByText('cara.with.a.very.long.email.address@acme-corporation.example.com').first()).toBeAttached();
      await expectNoSideScroll(page);
      if (viewport.phone) {
        await expect(page.getByRole('table', { name: 'People' })).toBeHidden();
        await expect(page.getByRole('list', { name: 'People list' })).toBeVisible();
      } else {
        await expect(page.getByRole('table', { name: 'People' })).toBeVisible();
        await expect(page.getByRole('list', { name: 'People list' })).toBeHidden();
      }
      await expectTappable(page, [
        page.getByRole('button', { name: 'Invite someone' }),
        page.getByRole('tab', { name: 'People' }),
        page.getByRole('tab', { name: 'Spaces' }),
        page.getByRole('button', { name: 'Actions for sam@dgk.com' }).locator('visible=true'),
      ], viewport.phone);

      await page.getByRole('button', { name: 'Invite someone' }).click();
      const dialog = page.getByRole('dialog');
      await settle(dialog);
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.height).toBeLessThanOrEqual(viewport.height);
      await expectTappable(page, [dialog.getByLabel('Email'), dialog.getByRole('button', { name: 'Send invite' }), dialog.getByRole('button', { name: 'Close' })], viewport.phone);
      await page.keyboard.press('Escape');

      await page.getByRole('tab', { name: 'Spaces' }).click();
      await expect(page.getByRole('list', { name: 'Spaces' })).toBeVisible();
      await expectNoSideScroll(page);
    });

    test('/activity fits and its filters are tappable', async ({ page, context }) => {
      await fakeSupabase(context, options);
      await page.goto('/activity');
      const list = page.getByRole('list', { name: 'Activity' });
      await expect(list.locator('li').first()).toBeVisible();
      await expectNoSideScroll(page);
      await expectTappable(page, [page.getByLabel('Filter by space'), page.getByLabel('Filter by action')], viewport.phone);
      for (const row of await list.locator('li').all()) {
        const box = (await row.boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      }
    });

    test('The menu sheet and bell stay inside the window', async ({ page, context }) => {
      await fakeSupabase(context, {
        ...options,
        reviews: {
          ...options.reviews,
          notifications: [{ id: 'n1', recipient: userId, kind: 'approved', space_id: SPACE, campaign_id: CAMPAIGN, asset_id: 'a-row-2', actor: 'u-sam', summary: 'Sam approved an image', created_at: '2026-10-17T10:00:00Z', read_at: null }],
        },
      });
      await page.goto('/');
      await expect(page.getByTestId('notification-bell')).toBeVisible();
      await page.getByTestId('notification-bell').click();
      const popover = page.getByTestId('notification-item').first();
      await expect(popover).toBeVisible();
      await settle(popover);
      const box = (await popover.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      await page.keyboard.press('Escape');

      if (viewport.phone) {
        // Space switcher, Members and Activity live in the menu sheet on phones.
        await page.getByRole('button', { name: 'Open navigation' }).click();
        const sheet = page.getByRole('dialog', { name: 'Navigation' });
        await settle(sheet);
        await expect(sheet.getByTestId('space-switcher')).toBeVisible();
        await expect(sheet.getByRole('link', { name: 'Members' })).toBeVisible();
        await expect(sheet.getByRole('link', { name: 'Activity' })).toBeVisible();
        await expectTappable(page, [sheet.getByRole('link', { name: 'Members' }), sheet.getByTestId('space-switcher')], true);
      }
    });
  });
}
