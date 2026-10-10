import { expect, test, type Page } from '@playwright/test';

/**
 * Smoke test for the deployed site. Runs after the Pages deploy with:
 *   LIVE_URL      the deployed page URL (e.g. https://willi220p-star.github.io/cursor1/)
 *   EXPECTED_SHA  the commit that was just built; index.html carries it as <meta name="build">
 * It never signs in and blocks every write to Supabase, so it only ever loads public pages.
 */
const expectedSha = (process.env.EXPECTED_SHA ?? '').trim();
const pollTimeoutMs = Number(process.env.LIVE_POLL_TIMEOUT_MS ?? 180_000);
const pollIntervalMs = Number(process.env.LIVE_POLL_INTERVAL_MS ?? 10_000);

test.describe.configure({ mode: 'serial' });

function buildMeta(html: string) {
  return /<meta\s+name="build"\s+content="([^"]*)"/i.exec(html)?.[1] ?? '';
}

/** Records page errors and failed same-site asset loads, and refuses any Supabase write. */
async function watch(page: Page, baseURL: string) {
  const problems: string[] = [];
  const base = new URL(baseURL);
  page.on('pageerror', (error) => problems.push(`Page error: ${error.message}`));
  page.on('response', (response) => {
    const url = new URL(response.url());
    const type = response.request().resourceType();
    const isAsset = ['script', 'stylesheet', 'image', 'font'].includes(type);
    if (isAsset && url.origin === base.origin && url.pathname.startsWith(base.pathname) && response.status() >= 400) {
      problems.push(`${response.status()} for ${url.pathname}`);
    }
  });
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (url.origin === base.origin && request.failure()?.errorText !== 'net::ERR_ABORTED') {
      problems.push(`Request failed: ${url.pathname} (${request.failure()?.errorText})`);
    }
  });
  await page.route(/supabase\.co/, (route) => {
    const method = route.request().method();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue();
    problems.push(`Blocked a ${method} to Supabase: ${route.request().url()}`);
    return route.abort();
  });
  return problems;
}

test('the new build is being served', async ({ request, baseURL }) => {
  test.skip(!expectedSha, 'EXPECTED_SHA not set, so there is no build to wait for.');
  test.setTimeout(pollTimeoutMs + 60_000);
  const deadline = Date.now() + pollTimeoutMs;
  let served = '';
  let status = 0;
  for (;;) {
    try {
      const response = await request.get(`${baseURL}?build-check=${Date.now()}`, {
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        timeout: 20_000,
      });
      status = response.status();
      served = buildMeta(await response.text());
    } catch (error) {
      served = `request failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (served === expectedSha) break;
    if (Date.now() + pollIntervalMs > deadline) break;
    console.log(`Live site serves build "${served || 'none'}" (HTTP ${status}); waiting for ${expectedSha}…`);
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  expect(served, `After ${Math.round(pollTimeoutMs / 1000)} s the live site still serves build "${served}" instead of ${expectedSha}`).toBe(expectedSha);
});

test('the sign-in screen renders', async ({ page, baseURL }) => {
  const problems = await watch(page, baseURL!);
  const response = await page.goto('./', { waitUntil: 'load' });
  expect(response?.status(), 'status of the home page').toBe(200);
  if (expectedSha) await expect(page.locator('meta[name="build"]')).toHaveAttribute('content', expectedSha);
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page).toHaveTitle(/DGK Outbound Studio/);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  expect(problems).toEqual([]);
});

test('a deep link serves the app through the 404 fallback', async ({ page, baseURL }) => {
  const problems = await watch(page, baseURL!);
  const response = await page.goto('memes', { waitUntil: 'load' });
  // GitHub Pages answers unknown paths with 404.html (a copy of index.html) and status 404.
  expect([200, 404], 'status of /memes').toContain(response?.status());
  if (expectedSha) await expect(page.locator('meta[name="build"]')).toHaveAttribute('content', expectedSha);
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  expect(problems).toEqual([]);
});
