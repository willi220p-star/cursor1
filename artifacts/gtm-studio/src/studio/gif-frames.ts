/**
 * Pure pixel helpers for the GIF encoder. No DOM and no imports, so the worker and the unit tests share them.
 * Frames are RGBA buffers; viewed as Uint32Array each pixel is one number, so comparing frames is one test per pixel.
 */

export type FrameRect = { x: number; y: number; width: number; height: number };

/**
 * Collapses runs of identical frames into one frame that stays up for their summed delay.
 * Returns the kept frames and, for each, the index of the source frame it came from.
 */
export function mergeIdenticalFrames<T>(frames: T[], delays: number[], same: (a: T, b: T) => boolean) {
  const kept: T[] = [];
  const keptDelays: number[] = [];
  const sources: number[] = [];
  frames.forEach((frame, index) => {
    const delay = delays[index] ?? 0;
    const last = kept.length - 1;
    if (last >= 0 && same(kept[last], frame)) {
      keptDelays[last] += delay;
      return;
    }
    kept.push(frame);
    keptDelays.push(delay);
    sources.push(index);
  });
  return { frames: kept, delays: keptDelays, sources };
}

export function samePixels(a: ArrayLike<number>, b: ArrayLike<number>) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Smallest rectangle holding every pixel that differs between two frames, or null when they match. */
export function changedRect(prev: ArrayLike<number>, next: ArrayLike<number>, width: number, height: number): FrameRect | null {
  let top = -1;
  for (let y = 0; y < height && top < 0; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (prev[row + x] !== next[row + x]) { top = y; break; }
    }
  }
  if (top < 0) return null;
  let bottom = top;
  for (let y = height - 1; y > top; y--) {
    const row = y * width;
    let differs = false;
    for (let x = 0; x < width; x++) {
      if (prev[row + x] !== next[row + x]) { differs = true; break; }
    }
    if (differs) { bottom = y; break; }
  }
  let left = width;
  let right = -1;
  for (let y = top; y <= bottom; y++) {
    const row = y * width;
    for (let x = 0; x < left; x++) {
      if (prev[row + x] !== next[row + x]) { left = x; break; }
    }
    for (let x = width - 1; x > right; x--) {
      if (prev[row + x] !== next[row + x]) { right = x; break; }
    }
  }
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** Copies one rectangle out of a frame of 32-bit pixels. */
export function cropPixels(pixels: Uint32Array, width: number, rect: FrameRect) {
  const out = new Uint32Array(rect.width * rect.height);
  for (let y = 0; y < rect.height; y++) {
    const start = (rect.y + y) * width + rect.x;
    out.set(pixels.subarray(start, start + rect.width), y * rect.width);
  }
  return out;
}

/**
 * Every `stride`-th pixel of the chosen frames, back to back, for building one palette for the whole GIF.
 * The first frame is always included because it is the one Outlook shows.
 */
export function samplePalettePixels(frames: Uint32Array[], maxFrames = 6, stride = 2) {
  if (!frames.length) return new Uint8ClampedArray(0);
  const picks = new Set<number>([0]);
  const step = Math.max(1, (frames.length - 1) / Math.max(1, maxFrames - 1));
  for (let i = step; picks.size < maxFrames && Math.round(i) < frames.length; i += step) picks.add(Math.round(i));
  picks.add(frames.length - 1);
  const chosen = [...picks].sort((a, b) => a - b).map((index) => frames[index]);
  const total = chosen.reduce((sum, frame) => sum + Math.ceil(frame.length / stride), 0);
  const out = new Uint32Array(total);
  let cursor = 0;
  for (const frame of chosen) {
    for (let i = 0; i < frame.length; i += stride) out[cursor++] = frame[i];
  }
  return new Uint8ClampedArray(out.buffer);
}

/**
 * Maps 32-bit RGBA pixels to the nearest palette colour (alpha ignored). Like gifenc's applyPalette, it looks each
 * colour up once per RGB565 bin, but the lookup table lives across calls, so the frames of one GIF share it.
 */
export function createPaletteMapper(palette: number[][]) {
  const count = palette.length;
  const reds = new Int32Array(count);
  const greens = new Int32Array(count);
  const blues = new Int32Array(count);
  palette.forEach(([r, g, b], i) => { reds[i] = r; greens[i] = g; blues[i] = b; });
  const cache = new Int16Array(65536).fill(-1);
  return (pixels: Uint32Array) => {
    const out = new Uint8Array(pixels.length);
    for (let i = 0; i < pixels.length; i++) {
      const color = pixels[i];
      const r = color & 0xff;
      const g = (color >> 8) & 0xff;
      const b = (color >> 16) & 0xff;
      const key = ((r << 8) & 0xf800) | ((g << 3) & 0x07e0) | (b >> 3);
      let index = cache[key];
      if (index < 0) {
        let best = 0;
        let bestDistance = Infinity;
        for (let k = 0; k < count; k++) {
          const dr = reds[k] - r;
          const dg = greens[k] - g;
          const db = blues[k] - b;
          const distance = dr * dr + dg * dg + db * db;
          if (distance < bestDistance) { bestDistance = distance; best = k; }
        }
        index = best;
        cache[key] = best;
      }
      out[i] = index;
    }
    return out;
  };
}
