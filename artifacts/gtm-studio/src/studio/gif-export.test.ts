import { decompressFrames, parseGIF } from 'gifuct-js';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from './defaults';
import { encodeGif, sizeRetryFor, sizeRetryNote } from './gif-encode';
import { changedRect, createPaletteMapper, mergeIdenticalFrames, samePixels, samplePalettePixels } from './gif-frames';
import { outputColumnNames, stampStudioOutputs } from './writeback';
import { GIF_HOLD_MS, GIF_POSTER_MS, MAX_WRITING_FRAMES, estimateGifKb, gifEstimateFor, gifFrameSchedule, gifPlanFor, gifStillFilename, writingFrameCount } from './gif-plan';

const RED = 0xff0000ff;
const BLUE = 0xffff0000;
const WHITE = 0xffffffff;

function frame(width: number, height: number, fill: number, paint: Array<[number, number, number]> = []) {
  const pixels = new Uint32Array(width * height).fill(fill);
  for (const [x, y, color] of paint) pixels[y * width + x] = color;
  return pixels;
}

/** Decodes a GIF and composites each frame the way a mail client does, honouring offsets and transparency. */
function playGif(bytes: Uint8Array) {
  const parsed = parseGIF(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const { width, height } = parsed.lsd;
  const screen = new Uint8ClampedArray(width * height * 4);
  const frames = decompressFrames(parsed, true);
  const shown = frames.map((item) => {
    const { left, top, width: w, height: h } = item.dims;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const from = (y * w + x) * 4;
        if (item.patch[from + 3] === 0) continue;
        const to = ((top + y) * width + left + x) * 4;
        screen.set(item.patch.subarray(from, from + 4), to);
      }
    }
    return { pixels: new Uint32Array(screen.slice().buffer), delay: item.delay, dims: item.dims, transparent: item.transparentIndex !== undefined && item.disposalType === 1 };
  });
  return { width, height, frames: shown };
}

describe('GIF frame schedule', () => {
  it('opens on the finished frame, plays from the start, then holds the finished frame', () => {
    const frames = gifFrameSchedule({ frames: 5, tickMs: 100, entrance: true });
    expect(frames.map((item) => item.phase)).toEqual([1, 0, 0.25, 0.5, 0.75, 1]);
    expect(frames[0]).toMatchObject({ finished: true, delay: GIF_POSTER_MS });
    expect(frames.at(-1)).toMatchObject({ finished: true, delay: GIF_HOLD_MS });
    expect(frames.slice(1, -1).every((item) => !item.finished && item.delay === 100)).toBe(true);
  });

  it('loops evenly without a poster when nothing builds up', () => {
    const frames = gifFrameSchedule({ frames: 4, tickMs: 80, entrance: false });
    expect(frames.map((item) => item.phase)).toEqual([0, 0.25, 0.5, 0.75]);
    expect(frames.some((item) => item.finished)).toBe(false);
  });

  it('keeps uploaded GIF frames and their own delays in order', () => {
    const frames = gifFrameSchedule({ frames: 3, tickMs: 80, entrance: true, delays: [40, 50, 60], sources: true });
    expect(frames.map((item) => item.source)).toEqual([0, 0, 1, 2]);
    expect(frames.map((item) => item.delay)).toEqual([GIF_POSTER_MS, 40, 50, GIF_HOLD_MS]);
  });

  it('writes handwriting at about 9 fps, capped for long notes', () => {
    expect(writingFrameCount(4400, 10)).toBe(40);
    expect(writingFrameCount(2400, 10)).toBe(22);
    expect(writingFrameCount(7600, 10)).toBe(MAX_WRITING_FRAMES);
    expect(writingFrameCount(4400, 8)).toBe(35);
    expect(writingFrameCount(1000, 8)).toBe(8);
  });

  it('plans the default handwriting GIF at ~9 fps with a finished first frame', () => {
    const plan = gifPlanFor(defaultConfig('handgif'));
    expect(plan.entrance).toBe(true);
    expect(plan.frames[0]).toMatchObject({ phase: 1, finished: true });
    const writing = plan.frames.slice(1, -1);
    const fps = 1000 / writing[0].delay;
    expect(fps).toBeGreaterThanOrEqual(8);
    expect(fps).toBeLessThanOrEqual(10);
    // The writing itself still takes the chosen writing time (medium: 4.4 s).
    expect(writing.reduce((sum, item) => sum + item.delay, 0)).toBeGreaterThan(4000);
    expect(writing.reduce((sum, item) => sum + item.delay, 0)).toBeLessThan(4800);
  });

  it('gives fade-in memes a finished poster frame but leaves looping motion alone', () => {
    const fade = gifPlanFor({ ...defaultConfig('gif'), animation: 'fade' });
    expect(fade.frames[0]).toMatchObject({ phase: 1, finished: true });
    const bounce = gifPlanFor({ ...defaultConfig('gif'), animation: 'bounce' });
    expect(bounce.entrance).toBe(false);
    expect(bounce.frames[0].phase).toBe(0);
  });
});

describe('GIF size estimate', () => {
  it('uses the scaled frame size and the real frame count', () => {
    const config = defaultConfig('handgif');
    const estimate = gifEstimateFor(config);
    const plan = gifPlanFor(config);
    expect(estimate.frames).toBe(plan.frames.length);
    expect(estimate.width).toBe(plan.width);
    expect(estimate.width).toBeLessThan(1080);
    // Real encode of this config was about 160 KB.
    expect(estimate.kb).toBeGreaterThan(100);
    expect(estimate.kb).toBeLessThan(260);
  });

  it('grows with frames, colours and motion', () => {
    const base = { width: 400, height: 400, frames: 20, colors: 128, detail: 0.16, changeShare: 0.1 };
    const kb = estimateGifKb(base);
    expect(estimateGifKb({ ...base, frames: 40 })).toBeGreaterThan(kb);
    expect(estimateGifKb({ ...base, colors: 256 })).toBeGreaterThan(kb);
    expect(estimateGifKb({ ...base, changeShare: 0.5 })).toBeGreaterThan(kb);
    expect(estimateGifKb({ ...base, frames: 1 })).toBe(Math.round((400 * 400 * 0.16) / 1024));
  });
});

describe('GIF frame helpers', () => {
  it('merges runs of identical frames by summing their delays', () => {
    const a = frame(2, 2, RED);
    const b = frame(2, 2, BLUE);
    const merged = mergeIdenticalFrames([a, a.slice(), b, b.slice(), b.slice(), a], [100, 200, 50, 50, 50, 10], samePixels);
    expect(merged.frames).toHaveLength(3);
    expect(merged.delays).toEqual([300, 150, 10]);
    expect(merged.sources).toEqual([0, 2, 5]);
  });

  it('finds the smallest changed rectangle', () => {
    const before = frame(10, 8, WHITE);
    expect(changedRect(before, before.slice(), 10, 8)).toBeNull();
    const after = frame(10, 8, WHITE, [[3, 2, RED], [6, 5, BLUE]]);
    expect(changedRect(before, after, 10, 8)).toEqual({ x: 3, y: 2, width: 4, height: 4 });
    const corner = frame(10, 8, WHITE, [[9, 7, RED]]);
    expect(changedRect(before, corner, 10, 8)).toEqual({ x: 9, y: 7, width: 1, height: 1 });
  });

  it('samples the first and last frame for the shared palette', () => {
    const frames = [frame(2, 1, RED), frame(2, 1, WHITE), frame(2, 1, BLUE)];
    const sample = new Uint32Array(samplePalettePixels(frames, 2, 1).buffer);
    expect([...sample]).toEqual([RED, RED, BLUE, BLUE]);
  });

  it('maps pixels to the nearest palette colour', () => {
    const toIndex = createPaletteMapper([[0, 0, 0], [255, 0, 0], [255, 255, 255]]);
    expect([...toIndex(new Uint32Array([0xff0000f0, 0xfff0f0f0, 0xff101010]))]).toEqual([1, 2, 0]);
  });
});

describe('GIF encoder', () => {
  const width = 24;
  const height = 16;
  const finished = frame(width, height, WHITE, [[2, 2, RED], [3, 2, RED], [4, 2, RED], [20, 12, BLUE], [21, 12, BLUE], [22, 12, BLUE]]);
  const frames = [
    finished,
    frame(width, height, WHITE),
    frame(width, height, WHITE),
    frame(width, height, WHITE, [[2, 2, RED]]),
    frame(width, height, WHITE, [[2, 2, RED], [3, 2, RED], [4, 2, RED]]),
    finished.slice(),
  ];
  const delays = [800, 100, 100, 100, 100, 1200];

  it('plays back exactly the frames it was given, with identical frames merged', () => {
    const { bytes } = encodeGif(frames.map((item) => item.slice()), width, height, delays, 0, 64);
    const played = playGif(bytes);
    expect(played.width).toBe(width);
    expect(played.frames.map((item) => item.delay)).toEqual([800, 200, 100, 100, 1200]);
    const expected = [frames[0], frames[1], frames[3], frames[4], frames[5]];
    played.frames.forEach((item, index) => {
      const want = expected[index];
      for (let i = 0; i < want.length; i++) {
        const got = item.pixels[i];
        for (const shift of [0, 8, 16]) {
          expect(Math.abs(((got >> shift) & 0xff) - ((want[i] >> shift) & 0xff))).toBeLessThanOrEqual(8);
        }
      }
    });
  });

  it('writes later frames as small transparent patches at their own position', () => {
    const { bytes } = encodeGif(frames.map((item) => item.slice()), width, height, delays, 0, 64);
    const played = playGif(bytes);
    expect(played.frames[0].dims).toMatchObject({ left: 0, top: 0, width, height });
    expect(played.frames[2].dims).toMatchObject({ left: 2, top: 2, width: 1, height: 1 });
    expect(played.frames[3].dims).toMatchObject({ left: 3, top: 2, width: 2, height: 1 });
    expect(played.frames.slice(1).every((item) => item.transparent)).toBe(true);
  });

  it('is smaller than writing every frame whole', () => {
    const big = 160;
    const scene = (step: number) => {
      const pixels = new Uint32Array(big * big);
      for (let i = 0; i < pixels.length; i++) pixels[i] = 0xff000000 | ((i * 2654435761) & 0x00ffffff);
      for (let x = 0; x < step * 8; x++) pixels[80 * big + x] = RED;
      return pixels;
    };
    const many = Array.from({ length: 12 }, (_, step) => scene(step));
    const { bytes } = encodeGif(many, big, big, many.map(() => 100), 0, 128);
    const single = encodeGif([scene(0)], big, big, [100], 0, 128).bytes.length;
    expect(bytes.length).toBeLessThan(single * 1.5);
  });
});

describe('GIF size target', () => {
  it('halves the colours when a little over, shrinks the frame when well over', () => {
    expect(sizeRetryFor(900_000, 1_000_000, 128)).toBeNull();
    expect(sizeRetryFor(1_200_000, 1_000_000, 128)).toEqual({ kind: 'colors', colors: 64 });
    expect(sizeRetryFor(1_200_000, 1_000_000, 48)).toEqual({ kind: 'scale', factor: 0.84 });
    expect(sizeRetryFor(2_000_000, 1_000_000, 256)).toEqual({ kind: 'scale', factor: 0.65 });
    expect(sizeRetryFor(6_000_000, 1_000_000, 256)).toEqual({ kind: 'scale', factor: 0.5, colors: 128 });
    expect(sizeRetryNote({ kind: 'colors', colors: 64 }, 1_200_000, 800_000, 1_000_000)).toBe('Re-encoded with 64 colours to stay under 1 MB (1.2 MB → 781 KB)');
  });

  it('names the JPG poster after the GIF', () => {
    expect(gifStillFilename('maya-nguyen.gif')).toBe('maya-nguyen-still.jpg');
  });
});

describe('GIF still column', () => {
  it('stamps <prefix>_still_url next to the unchanged GIF columns', () => {
    expect(outputColumnNames('handgif')).toContain('handwriting_gif_still_url');
    expect(outputColumnNames('gif')).toContain('gif_still_url');
    expect(outputColumnNames('handwritten')).not.toContain('handwritten_still_url');
    const blob = new Blob(['x']);
    const [row] = stampStudioOutputs([{ row: 2, name: 'Maya' }], [{
      id: 'a', row: 2, filename: 'maya.gif', blob, url: '', bytes: 1, selected: true, status: 'uploaded',
      publicUrl: 'https://cdn.test/maya.gif',
      still: { blob, url: '', filename: 'maya-still.jpg', publicUrl: 'https://cdn.test/maya-still.jpg' },
    }], 'handgif');
    expect(row.handwriting_gif_url).toBe('https://cdn.test/maya.gif');
    expect(row.handwriting_gif_still_url).toBe('https://cdn.test/maya-still.jpg');
    expect(row.image_url).toBe('https://cdn.test/maya.gif');
  });
});
