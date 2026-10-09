import type { TextLayer } from './types';

/**
 * Classic meme caption fitting, shared by the export renderer, the batch worker and the live DOM preview.
 * Pure: the caller supplies `measure(text, fontSize)` (a canvas 2D context in practice), so every surface
 * gets the same line breaks and the same size for a row.
 */

/** Caption face: a heavy condensed sans, drawn at its regular weight so it is never faux-bolded. */
export const CAPTION_FONT_FAMILY = 'Anton, Impact, "Arial Narrow", sans-serif';
export const CAPTION_LINE_HEIGHT = 1.04;
/** Outline width as a share of the font size: a thin, crisp classic stroke, drawn under the fill. */
export const CAPTION_STROKE = 0.07;
export const CAPTION_STROKE_COLOR = '#000000';
export const CAPTION_MAX_LINES = 3;
/** Smallest size a caption shrinks to, as a share of its set size. */
export const CAPTION_MIN_SCALE = 0.45;
const SHRINK_STEP = 0.04;
const ELLIPSIS = '…';

export type MeasureText = (text: string, fontSize: number) => number;

export type CaptionFitInput = {
  text: string;
  /** Box size, in the same pixel space as `fontSize`. */
  width: number;
  height: number;
  fontSize: number;
  measure: MeasureText;
  maxLines?: number;
  minScale?: number;
  lineHeight?: number;
};

export type CaptionFit = {
  lines: string[];
  fontSize: number;
  /** Height of the wrapped block (lines × line height × size). */
  blockHeight: number;
  /** True when the text did not fit at the floor size and was cut with an ellipsis. */
  truncated: boolean;
};

export function captionFont(fontSize: number) {
  return `400 ${fontSize}px ${CAPTION_FONT_FAMILY}`;
}

/** Greedy word wrap; explicit newlines always break. A single word wider than the box stays on its own line. */
export function wrapCaption(text: string, width: number, fontSize: number, measure: MeasureText) {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next, fontSize) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function linesAllowed(height: number, fontSize: number, lineHeight: number, maxLines: number) {
  return Math.max(1, Math.min(maxLines, Math.floor((height + 0.001) / (fontSize * lineHeight))));
}

/** Cut a line until it fits with a trailing ellipsis. */
function withEllipsis(line: string, width: number, fontSize: number, measure: MeasureText) {
  let cut = line.trimEnd();
  while (cut.length > 0 && measure(`${cut}${ELLIPSIS}`, fontSize) > width) cut = cut.slice(0, -1).trimEnd();
  return `${cut}${ELLIPSIS}`;
}

export function fitCaption({
  text,
  width,
  height,
  fontSize,
  measure,
  maxLines = CAPTION_MAX_LINES,
  minScale = CAPTION_MIN_SCALE,
  lineHeight = CAPTION_LINE_HEIGHT,
}: CaptionFitInput): CaptionFit {
  const clean = text.replace(/[ \t]+/g, ' ').trim();
  const floor = fontSize * minScale;
  const step = fontSize * SHRINK_STEP;
  const result = (lines: string[], size: number, truncated: boolean): CaptionFit => ({
    lines,
    fontSize: size,
    blockHeight: lines.length * size * lineHeight,
    truncated,
  });
  if (!clean) return result([], fontSize, false);

  for (let size = fontSize; size > floor + 1e-6; size -= step) {
    const lines = wrapCaption(clean, width, size, measure);
    const fits = lines.length <= linesAllowed(height, size, lineHeight, maxLines)
      && lines.every((line) => measure(line, size) <= width);
    if (fits) return result(lines, size, false);
  }

  // Last resort at the floor: keep the lines that fit and cut the rest with an ellipsis.
  const wrapped = wrapCaption(clean, width, floor, measure);
  const allowed = linesAllowed(height, floor, lineHeight, maxLines);
  const overflow = wrapped.length > allowed;
  let truncated = overflow;
  const fitted = wrapped.slice(0, allowed).map((line, index) => {
    if (overflow && index === allowed - 1) return withEllipsis(line, width, floor, measure);
    if (measure(line, floor) <= width) return line;
    truncated = true;
    return withEllipsis(line, width, floor, measure);
  });
  return result(fitted, floor, truncated);
}

/**
 * Vertical position of each line's alphabetic baseline, in the CSS line-box model the live preview uses:
 * the block is centred in its box and each glyph sits mid-line using the font's ascent and descent.
 */
export function captionBaselines(fit: CaptionFit, boxTop: number, boxHeight: number, ascent: number, descent: number) {
  const lineBox = fit.fontSize * CAPTION_LINE_HEIGHT;
  const top = boxTop + (boxHeight - fit.blockHeight) / 2;
  const halfLeading = (lineBox - (ascent + descent)) / 2;
  return fit.lines.map((_, index) => top + index * lineBox + halfLeading + ascent);
}

/** A layer's set size in pixels for a canvas of this native width (sizes are authored for 1080 wide). */
export function layerFontSize(fontSize: number, canvasWidth: number) {
  return Math.max(18, fontSize * (canvasWidth / 1080));
}

/**
 * Fit one text layer, with merge tags already filled, on a canvas of its channel's native size.
 * Every surface fits at native size and scales the result, so a 0.64× preview breaks lines exactly like the export.
 */
export function fitLayerCaption(
  layer: Pick<TextLayer, 'width' | 'height' | 'fontSize'>,
  text: string,
  canvasWidth: number,
  canvasHeight: number,
  measure: MeasureText,
) {
  return fitCaption({
    text,
    width: layer.width * canvasWidth,
    height: layer.height * canvasHeight,
    fontSize: layerFontSize(layer.fontSize, canvasWidth),
    measure,
  });
}

type MeasuringContext = { font: string; measureText(text: string): { width: number } };

/** A `measure` callback backed by a canvas 2D context (DOM or OffscreenCanvas), cached per font size. */
export function canvasCaptionMeasure(context: MeasuringContext): MeasureText {
  const cache = new Map<string, number>();
  return (text, fontSize) => {
    const key = `${fontSize}|${text}`;
    const known = cache.get(key);
    if (known !== undefined) return known;
    context.font = captionFont(fontSize);
    const width = context.measureText(text).width;
    if (cache.size > 4000) cache.clear();
    cache.set(key, width);
    return width;
  };
}
