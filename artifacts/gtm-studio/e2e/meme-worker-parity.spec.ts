import { expect, test } from '@playwright/test';
import { fakeSupabase } from './fake-supabase';

/**
 * Still memes are previewed and downloaded through renderStudioCanvas, but batch Generate draws them in
 * batch.worker.ts on an OffscreenCanvas. Both must produce the same picture, or a batch ships memes that
 * do not match the preview. Web fonts are blocked here, so both paths use the same fallback caption face.
 *
 * Each case is drawn through both paths and compared pixel by pixel. To show the comparison can catch a
 * real drift, each case also records how much of the image the captions cover: the allowed difference is
 * a tenth of that (and never above 0.5%), so a caption drawn differently in one path cannot slip through.
 */
test('batch worker draws still memes pixel-identical to the renderer', async ({ page, context }) => {
  test.setTimeout(120_000);
  await fakeSupabase(context);
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const renderer = await import('/src/studio/renderer.ts');
    const defaults = await import('/src/studio/defaults.ts');
    const { memeSamples } = await import('/src/studio/meme-samples.ts');
    const { createBatchRenderer } = await import('/src/studio/batch-renderer.ts');

    const contacts = [
      { row: 2, name: 'Maya Nguyen', company: 'Top End Solar' },
      { row: 3, name: 'Alexandria Montgomery-Whitfield', company: 'Northern Territory Renewable Energy Holdings Pty Ltd' },
    ];
    const base = defaults.defaultConfig('memes');
    // Applied as the gallery does, but kept still: animated memes export as GIFs and never reach the worker.
    const fromSample = (id: string) => {
      const sample = memeSamples.find((entry) => entry.id === id);
      if (!sample) throw new Error(`Missing meme sample ${id}`);
      return {
        ...base,
        template: 'Custom image',
        customImage: sample.src,
        effect: sample.effect ?? 'none',
        layers: sample.layers.map((layer) => ({ ...layer })),
      };
    };
    const configs = [
      { label: 'default', config: base },
      { label: 'pack-room-on-fire', config: fromSample('pack-room-on-fire') },
      { label: 'four-panel', config: fromSample('four-panel') },
      { label: 'pack-my-heart', config: fromSample('pack-my-heart') },
    ];

    const pixels = (canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const differingShare = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
      let differing = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (Math.abs(a[i] - b[i]) > 24 || Math.abs(a[i + 1] - b[i + 1]) > 24 || Math.abs(a[i + 2] - b[i + 2]) > 24) differing++;
      }
      return differing / (a.length / 4);
    };

    const worker = createBatchRenderer();
    const out: Array<{ label: string; width: number; height: number; workerWidth: number; workerHeight: number; diff: number; captions: number; photo: number }> = [];
    try {
      for (const { label, config } of configs) {
        for (const contact of contacts) {
          const name = `${label} / ${contact.company}`;
          const drawn = await renderer.renderStudioCanvas(config, contact);
          const bitmap = await createImageBitmap(await worker.render(config, contact));
          const fromWorker = document.createElement('canvas');
          fromWorker.width = bitmap.width;
          fromWorker.height = bitmap.height;
          fromWorker.getContext('2d')!.drawImage(bitmap, 0, 0);
          bitmap.close();
          const reference = pixels(drawn);
          const sameSize = fromWorker.width === drawn.width && fromWorker.height === drawn.height;
          const noText = await renderer.renderStudioCanvas(config, contact, 1, 1, { omitText: true });
          const noPhoto = await renderer.renderStudioCanvas({ ...config, customImage: undefined }, contact, 1, 1, { omitText: true });
          out.push({
            label: name,
            width: drawn.width,
            height: drawn.height,
            workerWidth: fromWorker.width,
            workerHeight: fromWorker.height,
            diff: sameSize ? differingShare(reference, pixels(fromWorker)) : 1,
            captions: differingShare(reference, pixels(noText)),
            photo: differingShare(pixels(noText), pixels(noPhoto)),
          });
        }
      }
    } finally {
      worker.terminate();
    }
    return out;
  });

  console.log(results.map((r) => `${r.label}: differ ${(r.diff * 100).toFixed(3)}%, captions ${(r.captions * 100).toFixed(1)}%`).join('\n'));
  expect(results).toHaveLength(8);
  for (const result of results) {
    expect({ width: result.workerWidth, height: result.workerHeight }, `${result.label}: worker size`).toEqual({ width: result.width, height: result.height });
    // The photo really loaded and the captions really drew, so the comparison covers both.
    expect(result.photo, `${result.label}: meme photo did not load`).toBeGreaterThan(0.2);
    expect(result.captions, `${result.label}: captions cover too little to compare`).toBeGreaterThan(0.004);
    const allowed = Math.min(0.005, result.captions / 10);
    expect(result.diff, `${result.label}: worker drifted from the renderer (captions cover ${(result.captions * 100).toFixed(1)}%)`).toBeLessThan(allowed);
  }
});
