import { GIFEncoder, quantize } from 'gifenc';
import { changedRect, createPaletteMapper, cropPixels, mergeIdenticalFrames, samePixels, samplePalettePixels, type FrameRect } from './gif-frames';

export type EncodedGif = { bytes: Uint8Array; width: number; height: number; frames: number };

/**
 * Encodes RGBA frames (as 32-bit pixels) into a GIF. Runs in gif.worker.ts; kept free of worker globals so the
 * unit tests can encode and decode a GIF in node.
 *
 * One palette for the whole GIF, built from a sample of frames, so colours never shift between frames.
 * Runs of identical frames become one frame with their delays summed. The first frame is written whole; every
 * later frame only covers the rectangle that changed, and inside it the pixels whose colour did not change are
 * transparent, so the frame before shows through and LZW packs them tightly.
 */
export function encodeGif(source: Uint32Array[], width: number, height: number, delays: number[], loop: number, colors: number): EncodedGif {
  const merged = mergeIdenticalFrames<Uint32Array>(source, delays, samePixels);
  const frames = merged.frames;
  // One slot is kept back for the transparent colour.
  const palette = quantize(samplePalettePixels(frames, 6, 3), Math.max(2, Math.min(255, colors - 1)));
  const transparentIndex = palette.length;
  const fullPalette = [...palette, [0, 0, 0]];
  const toIndex = createPaletteMapper(palette);

  const screen = toIndex(frames[0]);
  const parts: Array<{ rect: FrameRect | null; index: Uint8Array; delay: number }> = [
    { rect: null, index: screen.slice(), delay: merged.delays[0] },
  ];
  for (let i = 1; i < frames.length; i++) {
    const rect = changedRect(frames[i - 1], frames[i], width, height);
    if (!rect) {
      parts[parts.length - 1].delay += merged.delays[i];
      continue;
    }
    const index = toIndex(cropPixels(frames[i], width, rect));
    // Keep only the pixels whose colour on screen actually changes, and tighten the box around them.
    let left = rect.width;
    let right = -1;
    let top = rect.height;
    let bottom = -1;
    for (let y = 0; y < rect.height; y++) {
      const row = (rect.y + y) * width + rect.x;
      for (let x = 0; x < rect.width; x++) {
        const at = y * rect.width + x;
        if (index[at] === screen[row + x]) {
          index[at] = transparentIndex;
        } else {
          screen[row + x] = index[at];
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    if (right < 0) {
      // The change was too small to survive the palette: the frame on screen stays up longer instead.
      parts[parts.length - 1].delay += merged.delays[i];
      continue;
    }
    const tight = { x: rect.x + left, y: rect.y + top, width: right - left + 1, height: bottom - top + 1 };
    const cropped = new Uint8Array(tight.width * tight.height);
    for (let y = 0; y < tight.height; y++) {
      const start = (top + y) * rect.width + left;
      cropped.set(index.subarray(start, start + tight.width), y * tight.width);
    }
    parts.push({ rect: tight, index: cropped, delay: merged.delays[i] });
  }

  const gif = GIFEncoder();
  const chunk = GIFEncoder({ auto: false });
  parts.forEach((part, partIndex) => {
    if (!part.rect) {
      gif.writeFrame(part.index, width, height, { palette: fullPalette, delay: part.delay, repeat: partIndex === 0 ? loop : undefined });
      return;
    }
    // gifenc always writes frames at 0,0: encode the patch on its own, then set its position in the image descriptor.
    // Disposal 1 leaves each frame in place, so the next patch draws over it.
    chunk.reset();
    chunk.writeFrame(part.index, part.rect.width, part.rect.height, { transparent: true, transparentIndex, delay: part.delay, dispose: 1 });
    const bytes = chunk.bytesView();
    // The graphic control extension is 8 bytes, then the image descriptor: 0x2c, left, top, width, height.
    if (bytes[8] !== 0x2c) throw new Error('Unexpected GIF frame layout.');
    bytes[9] = part.rect.x & 0xff;
    bytes[10] = (part.rect.x >> 8) & 0xff;
    bytes[11] = part.rect.y & 0xff;
    bytes[12] = (part.rect.y >> 8) & 0xff;
    gif.stream.writeBytesView(bytes);
  });
  gif.finish();
  return { bytes: gif.bytes(), width, height, frames: parts.length };
}

export type SizeRetry = { kind: 'colors'; colors: number } | { kind: 'scale'; factor: number; colors?: number };

/**
 * The one re-encode to try when a GIF is over the size target: a little over, halve the colours (cheap, no new
 * frames); well over, shrink the frame by about the square root of the overshoot (never below half size), and
 * when even half size will not do, halve the colours as well.
 */
export function sizeRetryFor(bytes: number, maxBytes: number, colors: number): SizeRetry | null {
  if (!maxBytes || bytes <= maxBytes) return null;
  const over = bytes / maxBytes;
  if (over <= 1.5 && colors > 48) return { kind: 'colors', colors: Math.max(32, Math.floor(colors / 2)) };
  const wanted = Math.sqrt(1 / over) * 0.92;
  const factor = Math.round(Math.max(0.5, Math.min(0.92, wanted)) * 100) / 100;
  return wanted < 0.5 && colors > 48 ? { kind: 'scale', factor, colors: Math.max(32, Math.floor(colors / 2)) } : { kind: 'scale', factor };
}

export function formatGifBytes(bytes: number) {
  return bytes >= 1_000_000 ? `${Math.round(bytes / 100_000) / 10} MB` : `${Math.round(bytes / 1024)} KB`;
}

/** Row status line for a GIF that was re-encoded to fit the target. */
export function sizeRetryNote(retry: SizeRetry, before: number, after: number, maxBytes: number) {
  const what = retry.kind === 'colors'
    ? `Re-encoded with ${retry.colors} colours`
    : `Scaled to ${Math.round(retry.factor * 100)}%${retry.colors ? ` with ${retry.colors} colours` : ''}`;
  const target = formatGifBytes(maxBytes);
  return after > maxBytes
    ? `${what} to get under ${target} (${formatGifBytes(before)} → ${formatGifBytes(after)}, still over)`
    : `${what} to stay under ${target} (${formatGifBytes(before)} → ${formatGifBytes(after)})`;
}
