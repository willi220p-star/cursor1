import { defineConfig, devices } from '@playwright/test';

/**
 * Post-deploy smoke test against the live site (see .github/workflows/pages.yml, job "smoke").
 * No web server: LIVE_URL points at an already deployed build. Only unauthenticated page loads.
 */
const fallback = 'https://willi220p-star.github.io/cursor1/';
const raw = (process.env.LIVE_URL ?? '').trim() || fallback;
const liveUrl = raw.endsWith('/') ? raw : `${raw}/`;

export default defineConfig({
  testDir: './e2e-live',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: liveUrl,
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } }],
});
