import { readFile } from 'node:fs/promises';
import { expect, test, type Download } from '@playwright/test';
import JSZip from 'jszip';
import { collectErrors, fakeSupabase, sampleContacts, userId } from './fake-supabase';

// 900 rows run as three chunks of 400 / 400 / 100. Uploads are counted at the fake storage
// endpoint: every finished row uploads exactly once, so a resume that redid rows would show up
// as more than 900 uploads.
test('Generate runs a 900-row list in chunks, and Stop + Resume never redoes finished rows', async ({ page, context }) => {
  test.setTimeout(150_000);
  await fakeSupabase(context, { mode: 'memes', contacts: sampleContacts(900) });
  // The smallest canvas (800 × 600) keeps 900 renders and uploads quick.
  await context.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({ id: 'e2e-chunks', name: 'Chunk test', mode: 'memes', config: { mode: 'memes', channel: 'Classic' } }));
  }, `gtm-studio-load-template:${userId}`);
  const errors = collectErrors(page);
  const uploads: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/storage/v1/object/outbound-assets/')) uploads.push(request.url());
  });
  await page.goto('/memes');
  await expect(page.getByRole('radio', { name: /^Row 6:/ })).toBeVisible();
  const generate = page.locator('.toolbar-actions .btn-primary');
  await expect(generate).toContainText('Generate 900');

  const started = Date.now();
  await generate.click();
  const chunkText = page.getByTestId('chunk-progress');
  await expect(chunkText).toContainText(/Chunk 1 of 3 · [\d,]+ of 900 rows/);
  await expect(page.getByTestId('chunk-status')).toBeVisible();

  // Stop part-way through the second chunk.
  await expect(chunkText).toContainText(/Chunk 2 of 3 · (4[5-9]\d|5\d\d) of 900 rows/, { timeout: 60_000 });
  // The first chunk uploaded before the second one started.
  expect(uploads.length).toBeGreaterThanOrEqual(400);
  await generate.click();
  await expect(page.getByTestId('batch-progress')).toBeHidden({ timeout: 60_000 });
  const resume = page.getByTestId('batch-resume');
  await expect(resume).toBeVisible();
  const finishedText = (await resume.locator('strong').textContent()) ?? '';
  const finished = Number(finishedText.match(/^([\d,]+) of 900/)?.[1]?.replace(/,/g, ''));
  expect(finished).toBeGreaterThan(400);
  expect(finished).toBeLessThan(900);
  // Every finished row is uploaded, once.
  await expect.poll(() => uploads.length).toBe(finished);

  // Resume picks up where it stopped: only the rest is drawn and uploaded.
  await resume.getByRole('button', { name: 'Resume' }).click();
  await expect(chunkText).toContainText(/Chunk [23] of 3/);
  await expect(page.getByTestId('batch-progress')).toBeHidden({ timeout: 90_000 });
  const elapsed = Date.now() - started;
  await expect.poll(() => uploads.length).toBe(900);
  expect(new Set(uploads.map((url) => url.split('/').pop()?.replace(/^[0-9a-f-]{36}-/, ''))).size).toBe(900);

  // All rows finished and the review grid opens on page 1 of 9.
  await expect(page.getByRole('dialog')).toContainText('900 generated');
  await expect(page.locator('.review-grid > li')).toHaveCount(100);
  await expect(page.locator('.review-pager').first()).toContainText('1–100 of 900');
  await page.getByRole('button', { name: 'Next page' }).first().click();
  await expect(page.locator('.review-pager').first()).toContainText('101–200 of 900');
  await expect(page.locator('.row-dot.is-done')).toHaveCount(16);
  await expect(page.locator('.row-dot.is-failed')).toHaveCount(0);
  // Uploaded files left memory: review shows them from their public link, not a blob: URL.
  await expect(page.locator('.review-grid img').first()).toHaveAttribute('src', /^https:\/\/e2e-test\.supabase\.co\/storage\//);

  // 900 files download as three ZIP parts, fetched back from their public links.
  const downloads: Download[] = [];
  page.on('download', (download) => downloads.push(download));
  await expect(page.getByTestId('zip-parts-note')).toContainText('3 ZIP parts');
  await page.getByRole('button', { name: 'Download selected (900)' }).click();
  await expect.poll(() => downloads.length, { timeout: 60_000 }).toBe(3);
  expect(downloads.map((download) => download.suggestedFilename())).toEqual(['Chunk-test-part-1-of-3.zip', 'Chunk-test-part-2-of-3.zip', 'Chunk-test-part-3-of-3.zip']);
  const open = async (download: Download) => JSZip.loadAsync(await readFile(await download.path()));
  const first = await open(downloads[0]);
  expect(JSON.parse(await first.file('manifest.json')!.async('string'))).toHaveLength(400);
  expect(first.file('prospects-part-1-of-3.csv')).toBeTruthy();
  expect(first.file('prospects.csv')).toBeNull();
  expect(first.file('missing-files.csv')).toBeNull();
  const last = await open(downloads[2]);
  expect(JSON.parse(await last.file('manifest.json')!.async('string'))).toHaveLength(100);
  // The last part carries the full list: a header plus all 900 rows.
  expect((await last.file('prospects.csv')!.async('string')).trim().split('\n')).toHaveLength(901);
  expect(Object.keys(last.files).filter((name) => /\.png$/.test(name))).toHaveLength(100);
  // eslint-disable-next-line no-console
  console.log(`900 rows (with a stop and resume) took ${(elapsed / 1000).toFixed(1)} s`);
  expect(errors).toEqual([]);
});
