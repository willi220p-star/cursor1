import { canvasSizes, writingSpeedSpec, type StudioConfig } from './types';

/**
 * What a GIF export is made of, worked out from the config alone (no canvas), so the renderer, the size
 * estimate in the UI and the unit tests all agree on frame size and frame count.
 *
 * Outlook desktop only ever shows the first frame of a GIF, so any GIF that builds up (handwriting, typed
 * letters, captions that fade or slide in) opens on its finished frame for a short beat, then plays from the
 * start and ends holding that same finished frame.
 */

/** How long the finished frame shows before the animation starts. */
export const GIF_POSTER_MS = 800;
/** How long the finished frame holds at the end, before the loop comes back round to the poster beat. */
export const GIF_HOLD_MS = 1200;
export const GIF_TARGET_BYTES = 1_000_000;
/** Writing GIFs play at the chosen frame rate, but never with more than this many writing frames. */
export const MAX_WRITING_FRAMES = 48;

/** Caption motions that start from nothing (or from a partial state) and end on the finished caption. */
const ENTRANCE_MOTIONS = new Set(['fade', 'slide', 'flip', 'pop']);

export type GifFrameSpec = {
  /** Animation phase passed to the renderer: 0 is the start, 1 is the finished artwork. */
  phase: number;
  delay: number;
  /** Which uploaded GIF frame sits behind this one, when the GIF plays over a live GIF. */
  source?: number;
  /** The finished artwork, drawn without the writing hand. */
  finished?: boolean;
};

export type GifPlan = {
  scale: number;
  width: number;
  height: number;
  colors: number;
  /** The GIF builds up from nothing, so it opens and ends on the finished frame. */
  entrance: boolean;
  frames: GifFrameSpec[];
};

/** Frames for the writing part of a handwriting GIF: the chosen frame rate, kept to 6–9 fps so a row renders in about half a second, over the writing time. */
export function writingFrameCount(ms: number, fps: number) {
  const rate = Math.max(6, Math.min(9, fps || 9));
  return Math.max(8, Math.min(MAX_WRITING_FRAMES, Math.round((ms / 1000) * rate)));
}

export function gifColorsFor(quality: number) {
  return quality >= 8 ? 256 : quality >= 5 ? 128 : 64;
}

/**
 * Frame list for one GIF. With an entrance: finished poster beat, the build-up from phase 0, then the finished
 * frame held. Without one (looping motion, a live GIF), an even loop where phase 1 would repeat phase 0.
 */
export function gifFrameSchedule(options: {
  frames: number;
  tickMs: number;
  entrance: boolean;
  delays?: number[];
  sources?: boolean;
}): GifFrameSpec[] {
  const count = Math.max(1, options.frames);
  const at = (index: number) => (options.sources ? { source: index } : {});
  const delayAt = (index: number) => options.delays?.[index] ?? options.tickMs;
  if (count === 1) return [{ phase: 1, delay: Math.max(GIF_HOLD_MS, delayAt(0)), finished: true, ...at(0) }];
  if (!options.entrance) {
    return Array.from({ length: count }, (_, index) => ({ phase: index / count, delay: delayAt(index), ...at(index) }));
  }
  const frames: GifFrameSpec[] = [{ phase: 1, delay: GIF_POSTER_MS, finished: true, ...at(0) }];
  for (let index = 0; index < count - 1; index++) {
    frames.push({ phase: index / (count - 1), delay: delayAt(index), ...at(index) });
  }
  frames.push({ phase: 1, delay: Math.max(GIF_HOLD_MS, delayAt(count - 1)), finished: true, ...at(count - 1) });
  return frames;
}

export function gifPlanFor(config: StudioConfig): GifPlan {
  const avatarAnim = config.mode === 'avatar' && (config.textMotion ?? 'still') !== 'still';
  const writing = config.mode === 'handgif'
    || avatarAnim
    || (config.layers ?? []).some((layer) => (layer.animation ?? 'still') !== 'still');
  const paper = config.mode === 'handgif' || config.mode === 'avatar';
  const entrance = writing || (!paper && ENTRANCE_MOTIONS.has(config.animation));
  const speed = writingSpeedSpec(config.writingSpeed);
  const scale = writing && paper
    ? Math.min(0.4, 0.26 + config.gifQuality * 0.018)
    : Math.min(0.68, 0.34 + config.gifQuality * 0.035);
  const { width, height } = canvasSizes[config.channel] ?? canvasSizes.LinkedIn;
  const sourceCount = config.gifFrames?.length ? Math.min(36, config.gifFrames.length) : 0;
  const count = sourceCount || (config.mode === 'handgif'
    ? writingFrameCount(speed.ms, config.gifFps)
    : avatarAnim ? 16 : writing ? 10 : 12);
  const tickMs = config.mode === 'handgif'
    ? Math.round(speed.ms / Math.max(1, count - 1))
    : Math.round(1000 / Math.max(6, config.gifFps));
  return {
    scale,
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    colors: gifColorsFor(config.gifQuality),
    entrance,
    frames: gifFrameSchedule({ frames: count, tickMs, entrance, delays: config.gifDelays, sources: sourceCount > 0 }),
  };
}

/**
 * Rough file size of a GIF from the encoder in gif.worker.ts: the first frame is stored whole, each later frame
 * only as the patch that changed. `detail` is bytes per pixel of a whole frame at 128 colours (busy photos cost
 * more than flat paper or gradients); `changeShare` is how much of the frame a typical later frame repaints.
 * Calibrated against real encodes of the default handwriting GIF, avatar letter GIF and meme GIF.
 */
export function estimateGifKb(input: { width: number; height: number; frames: number; colors: number; detail: number; changeShare: number }) {
  const pixels = input.width * input.height;
  const colourFactor = Math.log2(Math.max(2, input.colors)) / 7;
  const wholeFrame = pixels * input.detail * colourFactor;
  const laterFrames = Math.max(0, input.frames - 1) * wholeFrame * input.changeShare;
  return Math.max(1, Math.round((wholeFrame + laterFrames) / 1024));
}

/** Bytes per pixel of one whole frame, and how much of it each later frame repaints, by what is on it and what moves. */
export function gifContentProfile(config: StudioConfig) {
  if (config.mode === 'handgif') return { detail: 0.16, changeShare: 0.095 };
  if (config.mode === 'avatar') return { detail: 0.16, changeShare: 0.03 };
  const photo = Boolean(config.gifFrames?.length || config.customImage);
  const detail = photo ? 0.6 : 0.07;
  if (config.gifFrames?.length || (config.photoMotion && config.photoMotion !== 'still')) return { detail, changeShare: 0.85 };
  if (config.effect === 'fire') return { detail, changeShare: 0.6 };
  if (['bounce', 'rise', 'wobble', 'shake', 'drift', 'zoom', 'pulse'].includes(config.animation)) return { detail, changeShare: 0.5 };
  return { detail, changeShare: 0.28 };
}

/** Size estimate for this config's GIF, with the frame count it is based on. */
export function gifEstimateFor(config: StudioConfig) {
  const plan = gifPlanFor(config);
  const kb = estimateGifKb({ width: plan.width, height: plan.height, frames: plan.frames.length, colors: plan.colors, ...gifContentProfile(config) });
  return { kb, frames: plan.frames.length, width: plan.width, height: plan.height };
}

export function gifStillFilename(filename: string) {
  return `${filename.replace(/\.gif$/i, '')}-still.jpg`;
}
