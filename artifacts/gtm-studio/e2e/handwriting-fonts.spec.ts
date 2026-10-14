import { expect, test } from '@playwright/test';
import { fakeSupabase } from './fake-supabase';

/**
 * Every handwriting font really draws on the canvas, and the tall, loopy ones still sit on their lines.
 * These need Google Fonts, so the checks skip (not fail) when the font CDN cannot be reached.
 */
test.describe('handwriting fonts', () => {
  test.beforeEach(async ({ page, context }) => {
    await fakeSupabase(context, { allowFonts: true });
    await page.goto('/');
    const reachable = await page.evaluate(async () => {
      const fonts = await import('/src/studio/fonts.ts');
      await fonts.ensureHandwritingFace('Gaegu');
      return document.fonts.check('30px "Gaegu"', fonts.LATIN_SAMPLE) && [...document.fonts].some((face) => face.family.replace(/"/g, '') === 'Gaegu' && face.status === 'loaded');
    });
    test.skip(!reachable, 'Google Fonts is not reachable from here');
  });

  test('all 27 fonts draw their own letters, including the Korean and Japanese ones', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const fonts = await import('/src/studio/fonts.ts');
      const table = await import('/src/studio/handwriting-fonts.ts');
      const renderer = await import('/src/studio/renderer.ts');
      const defaults = await import('/src/studio/defaults.ts');
      const contact = { row: 2, name: 'Maya Nguyen', company: 'Top End Solar' };
      const ink = (stack: string) => {
        const canvas = document.createElement('canvas');
        canvas.width = 900;
        canvas.height = 120;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#fff';
        context.fillRect(0, 0, 900, 120);
        context.fillStyle = '#000';
        context.font = `60px ${stack}`;
        context.fillText('Hi Maya, quick note', 10, 80);
        return Array.from(context.getImageData(0, 0, 900, 120).data);
      };
      const differs = (a: number[], b: number[]) => {
        let count = 0;
        for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i + 1]! - b[i + 1]!) > 60) count++;
        return count;
      };
      const base = { ...defaults.defaultConfig('handwritten'), finish: 'clean' as const, noteZone: undefined, inkColor: '#ff00ff', signature: '', postscript: '', copy: 'Hi Maya, quick note about Top End Solar.' };
      const missing = await renderer.renderStudioCanvas({ ...base, fontFamily: 'Definitely Not A Font' }, contact);
      const pixels = (canvas: HTMLCanvasElement) => Array.from(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data);
      const fallbackPixels = pixels(missing);
      const out: Array<{ font: string; checked: boolean; direct: number; note: number }> = [];
      for (const font of table.handwritingFonts) {
        await fonts.ensureHandwritingFace(font);
        const checked = document.fonts.check(`30px "${font}"`, fonts.LATIN_SAMPLE);
        const direct = differs(ink(`"${font}", monospace`), ink('"No Such Face", monospace'));
        const canvas = await renderer.renderStudioCanvas({ ...base, fontFamily: font }, contact);
        out.push({ font, checked, direct, note: differs(pixels(canvas), fallbackPixels) });
      }
      return out;
    });
    expect(result).toHaveLength(27);
    for (const item of result) {
      expect(item.checked, `${item.font} Latin glyphs not loaded`).toBe(true);
      expect(item.direct, `${item.font} drew the fallback on a plain canvas`).toBeGreaterThan(1000);
      // Caveat is the fallback's own face, so its note differs from the fallback only by size.
      expect(item.note, `${item.font} note looks like the fallback`).toBeGreaterThan(500);
    }
  });

  test('tall and loopy fonts sit on the rules and stay on the card', async ({ page }) => {
    const results = await page.evaluate(async () => {
      const renderer = await import('/src/studio/renderer.ts');
      const defaults = await import('/src/studio/defaults.ts');
      const types = await import('/src/studio/types.ts');
      const contact = { row: 2, name: 'Maya Nguyen', company: 'Top End Solar' };
      const out: Array<{ font: string; size: number; lines: number; worst: number; overflow: number }> = [];
      for (const font of ['Homemade Apple', 'Sue Ellen Francisco', 'La Belle Aurore', 'Nothing You Could Do', 'Square Peg', 'Reenie Beanie', 'Gaegu', 'Mansalva']) {
        for (const size of [36, 56]) {
          const config = {
            ...defaults.defaultConfig('handwritten'),
            finish: 'clean' as const,
            noteZone: undefined,
            fontFamily: font,
            fontSize: size,
            autoFit: false,
            handwritingKind: 'neat' as const,
            inkColor: '#ff00ff',
            signature: '',
            postscript: '',
            copy: 'Hi Maya, saw the launch at Top End Solar and loved how fast the crew moved. Worth a quick chat?',
          };
          const fit = await renderer.measureNoteFit(config, contact);
          const canvas = await renderer.renderStudioCanvas(config, contact);
          const context = canvas.getContext('2d')!;
          const { data, width } = context.getImageData(0, 0, canvas.width, canvas.height);
          const isInk = (x: number, y: number) => {
            const i = (y * width + x) * 4;
            return data[i]! > 170 && data[i + 2]! > 170 && data[i + 1]! < 120;
          };
          const inkInRows = (from: number, to: number) => {
            let count = 0;
            for (let y = Math.max(0, Math.round(from)); y < Math.min(canvas.height, Math.round(to)); y++) for (let x = 0; x < width; x++) if (isInk(x, y)) count++;
            return count;
          };
          const font1 = fit!.fontSize;
          let lines = 0;
          let worst = Infinity;
          for (let row = 0; row < fit!.needed; row++) {
            const rule = fit!.firstBaseline + row * fit!.step;
            // Cursive and loopy faces carry real descenders, so only the band right under the rule counts as "below".
            const above = inkInRows(rule - font1 * 0.32, rule);
            const below = inkInRows(rule + font1 * 0.06, rule + font1 * 0.3);
            if (above + below < 50) continue;
            lines++;
            worst = Math.min(worst, above / Math.max(1, below));
          }
          // Ink must stay inside the paper: no pixel of writing past its right or bottom edge.
          const zone = types.cardZone('clean', config.cardFill);
          const right = Math.round((zone.x + zone.width) * canvas.width);
          const bottom = Math.round((zone.y + zone.height) * canvas.height);
          let overflow = 0;
          for (let y = 0; y < canvas.height; y += 2) for (let x = 0; x < width; x += 2) if (isInk(x, y) && (x > right || y > bottom)) overflow++;
          out.push({ font, size, lines, worst, overflow });
        }
      }
      return out;
    });
    for (const item of results) {
      expect(item.lines, `${item.font} ${item.size} wrote no lines`).toBeGreaterThan(0);
      expect(item.worst, `${item.font} ${item.size} drifted off its line`).toBeGreaterThan(1.5);
      expect(item.overflow, `${item.font} ${item.size} ran off the card`).toBe(0);
    }
  });
});
