/**
 * Measures every handwriting font on a canvas and writes src/studio/handwriting-metrics.json.
 * Run from artifacts/gtm-studio with network access to Google Fonts:
 *   CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node scripts/measure-handwriting-fonts.mjs
 *
 * Per font, at 200 px:
 *  - xHeight: median ascent of x v w z u, as a share of the font size.
 *  - stroke: median pen width, as a share of the font size. For every ink pixel of a sample line we take the
 *    shorter of its horizontal and vertical ink run (a pen stroke is as wide as its shorter run) and take the median.
 * The Latin sample is requested explicitly: Korean and Japanese faces ship unicode-range subsets, and the default
 * text would not fetch their Latin range.
 * Which fonts exist is read from the font table in src/studio/handwriting-fonts.ts (names only).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const table = readFileSync(`${root}src/studio/handwriting-fonts.ts`, 'utf8');
const fonts = [...table.matchAll(/font: '([^']+)'/g)].map((match) => match[1]);
const SAMPLE = 'Hi Maya, quick note about Top End Solar. 0123456789';
const SIZE = 200;

const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage();
const url = 'https://fonts.googleapis.com/css2?' + fonts.map((font) => `family=${font.replace(/ /g, '+')}${font === 'Caveat' ? ':wght@400..700' : ''}`).join('&') + '&display=swap';
await page.setContent(`<link rel="stylesheet" href="${url}"><body></body>`);
await page.waitForLoadState('load');

const metrics = await page.evaluate(async ({ fonts, SAMPLE, SIZE }) => {
  const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const out = {};
  for (const font of fonts) {
    await document.fonts.load(`${SIZE}px "${font}"`, SAMPLE);
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = `${SIZE}px "${font}", monospace`;
    const width = Math.ceil(probe.measureText(SAMPLE).width) + 80;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = SIZE * 2;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000';
    context.font = `${SIZE}px "${font}", monospace`;
    context.textBaseline = 'alphabetic';
    context.fillText(SAMPLE, 40, SIZE * 1.3);
    const heights = [...'xvwzu'].map((letter) => context.measureText(letter).actualBoundingBoxAscent);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const w = canvas.width;
    const h = canvas.height;
    const ink = (x, y) => data[(y * w + x) * 4] < 128;
    const hrun = new Uint16Array(w * h);
    const vrun = new Uint16Array(w * h);
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        if (!ink(x, y)) { x++; continue; }
        let end = x;
        while (end < w && ink(end, y)) end++;
        for (let k = x; k < end; k++) hrun[y * w + k] = end - x;
        x = end;
      }
    }
    for (let x = 0; x < w; x++) {
      let y = 0;
      while (y < h) {
        if (!ink(x, y)) { y++; continue; }
        let end = y;
        while (end < h && ink(x, end)) end++;
        for (let k = y; k < end; k++) vrun[k * w + x] = end - y;
        y = end;
      }
    }
    const widths = [];
    for (let i = 0; i < w * h; i++) if (hrun[i]) widths.push(Math.min(hrun[i], vrun[i]));
    // Ink bounds: how far the writing reaches above and below the baseline (em share), for line-collision checks.
    let top = h;
    let bottom = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink(x, y)) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
    out[font] = {
      xHeight: median(heights) / SIZE,
      stroke: median(widths) / SIZE,
      ascent: (SIZE * 1.3 - top) / SIZE,
      descent: (bottom - SIZE * 1.3) / SIZE,
    };
  }
  return out;
}, { fonts, SAMPLE, SIZE });
await browser.close();

const round = (value) => Math.round(value * 1000) / 1000;
const result = {};
for (const font of fonts) {
  const item = metrics[font];
  result[font] = { xHeight: round(item.xHeight), stroke: round(item.stroke), ascent: round(item.ascent), descent: round(item.descent) };
}
writeFileSync(`${root}src/studio/handwriting-metrics.json`, JSON.stringify({ sample: SAMPLE, size: SIZE, fonts: result }, null, 2) + '\n');
console.table(result);
