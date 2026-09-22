/// <reference lib="webworker" />
import { GIFEncoder, applyPalette, quantize } from 'gifenc';

type EncodeMessage = {
  width: number;
  height: number;
  delays: number[];
  loop: number;
  colors: number;
  frames: ArrayBuffer[];
};

self.onmessage = (event: MessageEvent<EncodeMessage>) => {
  try {
    const { width, height, delays, frames, loop, colors } = event.data;
    const gif = GIFEncoder();
    for (const [frameIndex, frame] of frames.entries()) {
      const rgba = new Uint8ClampedArray(frame);
      const palette = quantize(rgba, colors);
      const indexedPixels = applyPalette(rgba, palette);
      gif.writeFrame(indexedPixels, width, height, { palette, delay: delays[frameIndex] ?? 85, repeat: frameIndex === 0 ? loop : undefined });
    }
    gif.finish();
    const bytes = gif.bytes();
    self.postMessage({ ok: true, bytes: bytes.buffer }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'GIF encoding failed' });
  }
};

export {};
