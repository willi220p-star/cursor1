import { expect, test } from '@playwright/test';
import { collectErrors, fakeSupabase } from './fake-supabase';

test('After an invite link the person chooses a password before entering the app', async ({ page, context }) => {
  const errors = collectErrors(page);
  await fakeSupabase(context);
  await context.addInitScript(() => sessionStorage.setItem('gtm-set-password', '1'));
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Choose a password.' })).toBeVisible();
  await page.getByLabel('New password').fill('correct horse battery');
  await page.getByLabel('Type it again').fill('something else entirely');
  await page.getByRole('button', { name: 'Save password and continue' }).click();
  await expect(page.getByRole('alert')).toContainText('The two passwords are different.');

  await page.getByLabel('Type it again').fill('correct horse battery');
  const saved = page.waitForRequest((request) => request.url().includes('/auth/v1/user') && request.method() === 'PUT');
  await page.getByRole('button', { name: 'Save password and continue' }).click();
  expect(((await saved).postDataJSON() as { password?: string }).password).toBe('correct horse battery');

  await expect(page.getByRole('navigation', { name: 'Studios' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('gtm-set-password'))).toBeNull();
  expect(errors).toEqual([]);
});

test('A short password is refused before anything is sent', async ({ page, context }) => {
  await fakeSupabase(context);
  await context.addInitScript(() => sessionStorage.setItem('gtm-set-password', '1'));
  await page.goto('/');
  await page.getByLabel('New password').fill('short');
  await page.getByLabel('Type it again').fill('short');
  await page.getByRole('button', { name: 'Save password and continue' }).click();
  await expect(page.getByRole('alert')).toContainText('at least 8 characters');
});

test('An expired link explains itself on the sign-in page, and Forgot password asks for an email first', async ({ page, context }) => {
  await fakeSupabase(context, { signedIn: false });
  await context.addInitScript(() => sessionStorage.setItem('gtm-link-error', 'otp_expired'));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('expired or was already used');

  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('alert')).toContainText('Type your work email');

  await page.getByLabel('Work email').fill('maya@example.com');
  const recover = page.waitForRequest((request) => request.url().includes('/auth/v1/recover'));
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await recover;
  await expect(page.getByRole('status').filter({ hasText: 'link to choose a password' })).toBeVisible();
});
