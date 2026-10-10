import { expect, test } from '@playwright/test';
import { collectErrors, fakeSupabase, sampleContacts } from './fake-supabase';

test('signed-out visitors see the sign-in screen', async ({ page, context }) => {
  await fakeSupabase(context, { signedIn: false });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('the desk loads, and search opens with Ctrl+K', async ({ page, context }) => {
  await fakeSupabase(context);
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Good');
  await expect(page.getByRole('heading', { name: 'Studios' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('gif');
  await expect(page.getByRole('option', { name: /Handwriting GIF/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a failed library load says so and offers Retry', async ({ page, context }) => {
  await fakeSupabase(context, { failLists: true });
  await page.goto('/');
  await expect(page.getByText(/Could not load your/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Retry' }).first()).toBeVisible();
});

for (const mode of ['handwritten', 'handgif', 'avatar', 'memes', 'gif']) {
  test(`the ${mode} studio draws a preview`, async ({ page, context }) => {
    await fakeSupabase(context, { mode, contacts: sampleContacts(3) });
    const errors = collectErrors(page);
    await page.goto(`/${mode}`);
    const canvas = page.locator('canvas[role="img"]');
    await expect(canvas).toBeVisible();
    await expect.poll(async () => canvas.evaluate((element: HTMLCanvasElement) => {
      const context2d = element.getContext('2d');
      if (!context2d || !element.width) return 0;
      const pixels = context2d.getImageData(0, 0, element.width, element.height).data;
      let inked = 0;
      for (let index = 0; index < pixels.length; index += 4 * 97) if (pixels[index + 3] > 0) inked += 1;
      return inked;
    }), { timeout: 20_000 }).toBeGreaterThan(100);
    expect(errors).toEqual([]);
  });
}

test('Generate makes every row and marks each one ready', async ({ page, context }) => {
  await fakeSupabase(context, { mode: 'memes', contacts: sampleContacts(6) });
  const errors = collectErrors(page);
  await page.goto('/memes');
  // Wait for the imported list to be in place before generating.
  await expect(page.getByRole('radio', { name: /^Row 6:/ })).toBeVisible();
  await page.locator('.toolbar-actions .btn-primary').click();
  await expect(page.locator('.batch-progress')).toBeVisible();
  await expect(page.locator('.batch-progress')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('.row-dot.is-done')).toHaveCount(6);
  await expect(page.locator('.row-dot.is-failed')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Generate again offers to redo only the rows that changed', async ({ page, context }) => {
  await fakeSupabase(context, { mode: 'memes', contacts: sampleContacts(6) });
  const errors = collectErrors(page);
  const uploads: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/storage/v1/object/outbound-assets/')) uploads.push(request.url());
  });
  await page.goto('/memes');
  await expect(page.getByRole('radio', { name: /^Row 6:/ })).toBeVisible();
  await page.locator('.toolbar-actions .btn-primary').click();
  await expect(page.locator('.batch-progress')).toBeHidden({ timeout: 60_000 });
  await expect.poll(() => uploads.length).toBe(6);
  await page.keyboard.press('Escape');

  await page.locator('.toolbar-actions .btn-primary').click();
  const dialog = page.getByTestId('regenerate-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Regenerate all' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Regenerate changed rows only (0 of 6)' }).click();
  await expect(page.locator('.row-dot.is-done')).toHaveCount(6);
  // Nothing changed, so nothing was drawn or uploaded again.
  await page.waitForTimeout(500);
  expect(uploads).toHaveLength(6);
  expect(errors).toEqual([]);
});
