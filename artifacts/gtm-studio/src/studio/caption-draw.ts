import {
  CAPTION_STROKE,
  CAPTION_STROKE_COLOR,
  captionBaselines,
  captionFont,
  fitLayerCaption,
  type MeasureText,
} from './caption-fit';
import { renderMerge } from './merge';
import type { Contact, TextLayer } from './types';

/** The 2D context surface captions need; both a page canvas and an OffscreenCanvas in the batch worker have it. */
export type CaptionContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function highlightWords(value?: string) {
  return (value ?? '').split(/[,]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
}

export function wordMatches(word: string, tokens: string[]) {
  const clean = word.replace(/[^\w'-]/g, '').toLowerCase();
  return Boolean(clean) && tokens.some((token) => token === clean || clean.includes(token) || token.includes(clean));
}

/** Reveal the first share of the fitted lines' characters, so typing never re-wraps mid-animation. */
function typedLines(lines: string[], phase: number) {
  const total = lines.reduce((sum, line) => sum + line.length, 0);
  let left = Math.floor(total * Math.max(0, Math.min(1, phase)));
  return lines.map((line) => {
    const shown = line.slice(0, Math.max(0, left));
    left -= line.length;
    return shown;
  });
}

/**
 * Draw one meme text layer: merge tags filled for the row, auto-fitted to its box (see caption-fit),
 * white-on-thin-black classic stroke when `outline` is on. `nativeWidth/Height` are the channel's
 * export size; `width/height` the canvas being drawn (a scaled preview or GIF frame).
 */
export function drawCaptionLayer(
  context: CaptionContext,
  layer: TextLayer,
  contact: Contact,
  width: number,
  height: number,
  nativeWidth: number,
  nativeHeight: number,
  measure: MeasureText,
  phase = 1,
) {
  const x = layer.x * width;
  const y = layer.y * height;
  const maxWidth = layer.width * width;
  const boxHeight = layer.height * height;
  const scale = width / nativeWidth;
  const animation = layer.animation ?? 'still';
  const pop = animation === 'pop' ? (phase < 0.45 ? 0.55 + phase * 1.2 : 1) : 1;
  const fit = fitLayerCaption(layer, renderMerge(layer.text, contact), nativeWidth, nativeHeight, measure);
  const size = fit.fontSize * scale;
  context.save();
  if (animation === 'still' || animation === 'highlight') context.globalAlpha = phase;
  else context.globalAlpha = 1;
  if (layer.boxFill) {
    context.fillStyle = layer.boxFill;
    context.globalAlpha *= 0.88;
    context.fillRect(x, y, maxWidth, boxHeight);
    context.globalAlpha = 1;
  }
  const cx = x + maxWidth / 2;
  const cy = y + boxHeight / 2;
  context.translate(cx, cy);
  context.scale(pop, pop);
  context.translate(-cx, -cy);
  context.font = captionFont(size);
  context.textAlign = layer.align;
  context.textBaseline = 'alphabetic';
  context.fillStyle = layer.color;
  context.strokeStyle = CAPTION_STROKE_COLOR;
  context.lineJoin = 'round';
  context.miterLimit = 2;
  context.lineWidth = Math.max(1.5, size * CAPTION_STROKE);
  if (animation === 'glow') {
    context.shadowColor = layer.highlightColor || layer.color;
    context.shadowBlur = 10 + 22 * Math.abs(Math.sin(phase * Math.PI * 2));
  }
  // Line boxes follow the CSS model the live preview uses, so both put each baseline in the same place.
  const metrics = context.measureText('Hg');
  const ascent = metrics.fontBoundingBoxAscent || size * 0.9;
  const descent = metrics.fontBoundingBoxDescent || size * 0.25;
  const capHeight = context.measureText('H').actualBoundingBoxAscent || size * 0.72;
  const baselines = captionBaselines({ ...fit, fontSize: size, blockHeight: fit.blockHeight * scale }, y, boxHeight, ascent, descent);
  const lines = animation === 'type' ? typedLines(fit.lines, phase) : fit.lines;
  const tokens = highlightWords(layer.highlight);
  const marker = layer.highlightColor || '#ffe566';
  const anchor = layer.align === 'center' ? x + maxWidth / 2 : layer.align === 'right' ? x + maxWidth : x;
  const paint = (text: string, at: number, baseline: number) => {
    // Stroke first, fill on top: only the outer half of the outline shows, thin and crisp.
    if (layer.outline) context.strokeText(text, at, baseline);
    context.fillText(text, at, baseline);
  };
  lines.forEach((line, index) => {
    const baseline = baselines[index] ?? y;
    if (animation === 'highlight') {
      context.save();
      context.fillStyle = marker;
      context.globalAlpha = 0.72;
      const painted = Math.max(8, context.measureText(line).width * Math.max(0.08, phase));
      const left = layer.align === 'center' ? anchor - painted / 2 : layer.align === 'right' ? anchor - painted : anchor;
      context.fillRect(left - 6 * scale, baseline - capHeight * 0.45, painted + 12 * scale, capHeight * 0.45 + size * 0.08);
      context.restore();
    }
    if (tokens.length) {
      const words = line.split(/(\s+)/);
      const total = context.measureText(line).width;
      let cursor = layer.align === 'center' ? anchor - total / 2 : layer.align === 'right' ? anchor - total : anchor;
      context.textAlign = 'left';
      words.forEach((chunk) => {
        const widthChunk = context.measureText(chunk).width;
        if (wordMatches(chunk, tokens)) {
          context.save();
          context.fillStyle = marker;
          context.globalAlpha = 0.8;
          context.fillRect(cursor - 3 * scale, baseline - capHeight - size * 0.1, widthChunk + 6 * scale, capHeight + size * 0.2);
          context.restore();
        }
        paint(chunk, cursor, baseline);
        cursor += widthChunk;
      });
      context.textAlign = layer.align;
      return;
    }
    paint(line, anchor, baseline);
  });
  context.restore();
}
