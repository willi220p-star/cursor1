import { expect, test } from '@playwright/test';
import { fakeSupabase } from './fake-supabase';

// GitHub's build machines do not have the Inter font, so text there is wider than on a developer machine.
// Forcing a wide fallback font here makes that difference visible locally.
for (const width of [375, 320]) {
  for (const [name, path] of [['Desk', '/'], ['Activity', '/activity'], ['Members', '/members']] as const) {
    test(`${name} has no sideways scroll at ${width}px even with a wide fallback font`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 812 });
      await fakeSupabase(context);
      await page.addInitScript(() => {
        const style = document.createElement('style');
        style.textContent = ":root{--app-font-sans:'DejaVu Sans',sans-serif !important;--app-font-display:'DejaVu Serif',serif !important}";
        document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
      });
      await page.goto(path);
      await expect(page.locator('.nav-actions')).toBeVisible();
      const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scroll).toBeLessThanOrEqual(width);
    });
  }
}
