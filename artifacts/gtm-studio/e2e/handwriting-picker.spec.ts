import { expect, test } from '@playwright/test';
import { collectErrors, fakeSupabase } from './fake-supabase';

test('the writing style picker groups fonts, shows real names and the row’s own words, and picks by keyboard', async ({ page, context }) => {
  await fakeSupabase(context, { mode: 'handwritten', contacts: [{ row: 2, name: 'Maya Nguyen', company: 'Top End Solar' }] });
  const errors = collectErrors(page);
  await page.goto('/handwritten');
  await page.getByText('Look', { exact: true }).first().click();
  const picker = page.locator('#handwriting-style');
  await expect(picker).toBeVisible();
  await expect(page.getByText('Handwriting 1 to 7')).toHaveCount(0);
  // Five groups, each with a use-when line; the chosen font's group (Casual everyday) starts open.
  for (const name of ['Neat print', 'Casual everyday', 'Cursive', 'Quick scrawl', 'Bold and rounded']) {
    await expect(picker.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await expect(picker.getByText(/^Use it when the note must be easy to read on a phone/)).toBeVisible();
  const casual = picker.getByRole('listbox', { name: 'Casual everyday' });
  await expect(casual.getByRole('option')).toHaveCount(7);
  await expect(casual.getByRole('option', { name: /Caveat/ })).toHaveAttribute('aria-selected', 'true');
  await expect(casual.getByRole('option', { name: /Caveat/ })).toContainText('Hi Maya, quick note about Top End Solar.');
  await expect(casual.getByRole('option', { name: /Caveat/ })).not.toContainText('{');

  // Keyboard: one tab stop, arrows move, Enter picks.
  await casual.getByRole('option', { name: /Caveat/ }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(casual.getByRole('option', { name: /Shadows Into Light/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(casual.getByRole('option', { name: /Shadows Into Light/ })).toHaveAttribute('aria-selected', 'true');
  await expect(casual.getByRole('option', { name: /Caveat/ })).toHaveAttribute('aria-selected', 'false');

  // Collapsed groups open on demand; the phone filter keeps only Good fonts.
  await picker.getByRole('button', { name: /^Cursive/ }).click();
  await expect(picker.getByRole('listbox', { name: 'Cursive' }).getByRole('option', { name: /Homemade Apple/ })).toBeVisible();
  await picker.getByRole('button', { name: 'Good on phones' }).click();
  await expect(picker.getByRole('button', { name: 'Good on phones' })).toHaveAttribute('aria-pressed', 'true');
  await expect(picker.getByText('Small', { exact: true })).toHaveCount(0);

  await page.getByText('More settings', { exact: true }).first().click();
  // Mixing fonts says which fonts it mixes and why it is off by default.
  await expect(page.getByText('Mix fonts across rows')).toBeVisible();
  await expect(page.getByText(/Real people write in one hand/)).toContainText('Caveat, Nanum Pen Script, Handlee, Cedarville Cursive, Patrick Hand, Shadows Into Light and Gloria Hallelujah');
  await expect(page.getByText('Shuffle handwriting')).toHaveCount(0);
  expect(errors).toEqual([]);
});
