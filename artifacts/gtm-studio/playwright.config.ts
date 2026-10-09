import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 43190);

// Browser checks run against the dev server with a fake Supabase project, so they never touch real data.
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 960 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 960 } } }],
  webServer: {
    command: 'pnpm run dev',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(port),
      BASE_PATH: '/',
      VITE_SUPABASE_URL: 'https://e2e-test.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'e2e-test-key',
      VITE_SENTRY_DSN: '',
    },
  },
});
