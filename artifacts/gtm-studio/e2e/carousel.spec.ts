import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { collectErrors, fakeSupabase } from './fake-supabase';

function mediaBoxes(pdf: string) {
  return [...pdf.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((match) => [Number(match[3]), Number(match[4])]);
}

test('the carousel studio has no vendor branding and exports a 1080 × 1350 PDF', async ({ page, context }) => {
  await fakeSupabase(context);
  const errors = collectErrors(page);
  await page.goto('/carousel');
  await expect(page.getByRole('textbox', { name: 'Carousel name' })).toBeVisible();
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/franmoretti|Built by|Carousel Generator|OpenAI|API key/i);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
  const pdf = (await readFile((await file.path())!)).toString('latin1');
  const boxes = mediaBoxes(pdf);
  expect(boxes.length).toBeGreaterThanOrEqual(5);
  for (const box of boxes) expect(box).toEqual([1080, 1350]);
  expect(pdf).toContain('/DCTDecode');
  expect(errors).toEqual([]);
});

test('starter layouts, saving and personalised exports work', async ({ page, context }) => {
  await fakeSupabase(context);
  const errors = collectErrors(page);
  await page.goto('/carousel');
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('tab', { name: /Starter layouts/ }).click();
  await page.getByRole('listitem').filter({ hasText: 'Myth vs fact' }).getByRole('button', { name: 'Use this layout' }).click();
  await expect(page.getByRole('textbox', { name: 'Carousel name' })).toHaveValue('Myth vs fact');

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Myth vs fact saved')).toBeVisible();

  await page.getByRole('tab', { name: 'Personalise' }).click();
  await page.locator('[data-carousel-personalise] input[type="file"]').setInputFiles({
    name: 'prospects.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('first_name,company\nMaya,Top End Solar\n,Saltbush Studio\n'),
  });
  await expect(page.getByRole('button', { name: 'ZIP of 2 PDFs' })).toBeVisible();
  await expect(page.getByText('Maya, quick reality check').first()).toBeVisible();

  const zip = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ZIP of 2 PDFs' }).click();
  const file = await zip;
  expect(file.suggestedFilename()).toBe('Myth-vs-fact-personalised.zip');
  const bytes = await readFile((await file.path())!);
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  expect(bytes.toString('latin1')).toContain('Maya-Top_End_Solar.pdf');
  expect(errors).toEqual([]);
});
