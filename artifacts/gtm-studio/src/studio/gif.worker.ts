/// <reference lib="webworker" />
import { encodeGif, sizeRetryFor, sizeRetryNote } from './gif-encode';

type EncodeMessage = {
  width: number;
  height: number;
  delays: number[];
  loop: number;
  colors: number;
  frames: ArrayBuffer[];
  /** When set and the first encode is bigger, re-encode once with fewer colours or a smaller frame. */
  maxBytes?: number;
};

function downscale(frames: Uint32Array[], width: number, height: number, factor: number) {
  const nextWidth = Math.max(16, Math.round(width * factor));
  const nextHeight = Math.max(16, Math.round(height * factor));
  const full = new OffscreenCanvas(width, height);
  const small = new OffscreenCanvas(nextWidth, nextHeight);
  const fullContext = full.getContext('2d');
  const smallContext = small.getContext('2d');
  if (!fullContext || !smallContext) throw new Error('Canvas is unavailable in the GIF worker.');
  smallContext.imageSmoothingQuality = 'high';
  const out = frames.map((frame) => {
    fullContext.putImageData(new ImageData(new Uint8ClampedArray(frame.buffer as ArrayBuffer, frame.byteOffset, frame.byteLength), width, height), 0, 0);
    smallContext.clearRect(0, 0, nextWidth, nextHeight);
    smallContext.drawImage(full, 0, 0, nextWidth, nextHeight);
    return new Uint32Array(smallContext.getImageData(0, 0, nextWidth, nextHeight).data.buffer);
  });
  return { frames: out, width: nextWidth, height: nextHeight };
}

self.onmessage = (event: MessageEvent<EncodeMessage>) => {
  try {
    const { width, height, delays, frames, loop, colors, maxBytes } = event.data;
    const pixels = frames.map((frame) => new Uint32Array(frame));
    let result = encodeGif(pixels, width, height, delays, loop, colors);
    let note = '';
    const retry = maxBytes ? sizeRetryFor(result.bytes.length, maxBytes, colors) : null;
    if (maxBytes && retry && (retry.kind === 'colors' || typeof OffscreenCanvas !== 'undefined')) {
      const before = result.bytes.length;
      if (retry.kind === 'colors') {
        result = encodeGif(pixels, width, height, delays, loop, retry.colors);
      } else {
        const small = downscale(pixels, width, height, retry.factor);
        result = encodeGif(small.frames, small.width, small.height, delays, loop, retry.colors ?? colors);
      }
      note = sizeRetryNote(retry, before, result.bytes.length, maxBytes);
    }
    const bytes = result.bytes;
    self.postMessage({ ok: true, bytes: bytes.buffer, note, width: result.width, height: result.height, frames: result.frames }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'GIF encoding failed' });
  }
};

export {};
