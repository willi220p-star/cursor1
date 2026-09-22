import { decompressFrames, parseGIF } from 'gifuct-js';

type GifFrame = {
  dims: { left: number; top: number; width: number; height: number };
  delay: number;
  disposalType: number;
  patch: Uint8ClampedArray;
};

export async function decodeGifFile(file: File) {
  if (file.size > 5 * 1024 * 1024) throw new Error('GIF templates must be 5 MB or smaller.');
  const parsed = parseGIF(await file.arrayBuffer());
  if (parsed.lsd.width * parsed.lsd.height > 2_000_000) throw new Error('GIF templates must be under 2 megapixels.');
  if (parsed.frames.length > 48) throw new Error('GIF templates can contain up to 48 frames.');
  const frames = decompressFrames(parsed, true) as GifFrame[];
  if (!frames.length) throw new Error('No GIF frames were found.');
  const width = parsed.lsd.width;
  const height = parsed.lsd.height;
  const composite = document.createElement('canvas');
  composite.width = width;
  composite.height = height;
  const context = composite.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable.');
  const output: string[] = [];
  const delays: number[] = [];
  let previous: ImageData | undefined;

  for (const frame of frames.slice(0, 48)) {
    if (frame.disposalType === 3) previous = context.getImageData(0, 0, width, height);
    const patchCanvas = document.createElement('canvas');
    patchCanvas.width = frame.dims.width;
    patchCanvas.height = frame.dims.height;
    const patchContext = patchCanvas.getContext('2d');
    if (!patchContext) continue;
    const pixelCopy = new Uint8ClampedArray(frame.patch.length);
    pixelCopy.set(frame.patch);
    patchContext.putImageData(new ImageData(pixelCopy, frame.dims.width, frame.dims.height), 0, 0);
    context.drawImage(patchCanvas, frame.dims.left, frame.dims.top);
    output.push(composite.toDataURL('image/png'));
    delays.push(Math.max(30, frame.delay || 100));
    if (frame.disposalType === 2) context.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
    if (frame.disposalType === 3 && previous) context.putImageData(previous, 0, 0);
  }
  return { frames: output, delays };
}
