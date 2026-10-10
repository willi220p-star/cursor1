import { expect, test } from '@playwright/test';
import { collectErrors, fakeSupabase, sampleContacts } from './fake-supabase';

test('the Notes guide opens from the toolbar and clears the new-features dot', async ({ page, context }) => {
  await fakeSupabase(context, { mode: 'handwritten', contacts: sampleContacts(2) });
  const errors = collectErrors(page);
  await page.goto('/handwritten');
  const button = page.locator('.studio-toolbar').getByTestId('guide-button');
  await expect(button).toBeVisible();
  await expect(button.getByTestId('guide-dot')).toBeVisible();
  await button.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByTestId('guide-sheet');
  await expect(sheet.getByRole('heading', { name: 'How Notes works' })).toBeVisible();
  await expect(sheet.getByText('Import your list')).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Outbound tips' })).toBeVisible();
  await expect(sheet.getByText('Big lists run in 400-row chunks')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(button).toBeFocused();
  await expect(button.getByTestId('guide-dot')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.studio-toolbar').getByTestId('guide-button')).toBeVisible();
  await expect(page.getByTestId('guide-dot')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the Desk guide opens and fits a phone screen', async ({ page, context }) => {
  await fakeSupabase(context);
  await page.setViewportSize({ width: 375, height: 812 });
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: /How it works/ }).click();
  const sheet = page.getByTestId('guide-sheet');
  await expect(sheet.getByRole('heading', { name: 'How the Desk works' })).toBeVisible();
  await expect(sheet.getByText('Clean up old versions from a campaign’s menu')).toBeVisible();
  const box = await sheet.boundingBox();
  expect(Math.round(box?.width ?? 999)).toBeLessThanOrEqual(375);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();
  expect(errors).toEqual([]);
});
