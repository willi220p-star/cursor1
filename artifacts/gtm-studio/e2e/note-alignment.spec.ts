import { expect, test } from '@playwright/test';
import { fakeSupabase } from './fake-supabase';

/**
 * Locks in the Notes promise: at any size, each line of writing sits on a ruled line.
 * Ink is drawn in pure magenta so it can be told apart from the paper and the blue rules,
 * then for every written line the band just above its rule must hold far more ink than the band below.
 */
test('handwriting sits on the ruled lines at every size', async ({ page, context }) => {
  await fakeSupabase(context);
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const renderer = await import('/src/studio/renderer.ts');
    const defaults = await import('/src/studio/defaults.ts');
    const contact = { row: 2, name: 'Maya Nguyen', company: 'Top End Solar' };
    const out: Array<{ size: number; lines: number; worst: number }> = [];
    for (const size of [24, 36, 50, 64]) {
      const config = {
        ...defaults.defaultConfig('handwritten'),
        finish: 'clean' as const,
        noteZone: undefined,
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
      const inkInRows = (from: number, to: number) => {
        let count = 0;
        for (let y = Math.max(0, Math.round(from)); y < Math.min(canvas.height, Math.round(to)); y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (data[i] > 170 && data[i + 2] > 170 && data[i + 1] < 120) count++;
          }
        }
        return count;
      };
      const font = fit!.fontSize;
      let lines = 0;
      let worst = Infinity;
      for (let row = 0; row < fit!.needed; row++) {
        const rule = fit!.firstBaseline + row * fit!.step;
        const above = inkInRows(rule - font * 0.32, rule);
        const below = inkInRows(rule + font * 0.06, rule + font * 0.38);
        if (above + below < 50) continue;
        lines++;
        worst = Math.min(worst, above / Math.max(1, below));
      }
      out.push({ size, lines, worst });
    }
    return out;
  });
  for (const result of results) {
    expect(result.lines, `size ${result.size} wrote no lines`).toBeGreaterThan(0);
    expect(result.worst, `size ${result.size} drifted off its line`).toBeGreaterThan(2);
  }
});
