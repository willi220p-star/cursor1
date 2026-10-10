/**
 * Typed letter fitting for avatar cards, shared by the renderer, the length advice and the row checks.
 * Pure: the caller supplies `measure(text, fontSize)` (a canvas 2D context in practice). The letter is
 * wrapped to the text frame's width and, when it does not fit, the type shrinks in small steps down to a
 * floor. Lines are never squeezed sideways: a word wider than the frame breaks across lines instead.
 */

export type MeasureWidth = (text: string, fontSize: number) => number;

/** Smallest size the letter shrinks to, as a share of the size set in the Look tab. */
export const TYPED_MIN_SCALE = 0.6;
/** Each shrink step, as a share of the set size. */
const SHRINK_STEP = 0.02;

export type TypedFitInput = {
  text: string;
  /** Text frame size, in the same pixel space as `fontSize`. */
  width: number;
  height: number;
  fontSize: number;
  lineSpacing?: number;
  measure: MeasureWidth;
  minScale?: number;
};

export type TypedFit = {
  lines: string[];
  /** Size the letter is drawn at. */
  fontSize: number;
  /** Rows the letter needs and rows the frame holds, at the drawn size. */
  needed: number;
  available: number;
  /** The same at the size set in the Look tab (before shrinking). */
  chosen: { needed: number; available: number };
  /** False when the letter still overflows the frame at the floor size. */
  fits: boolean;
};

/** The letter's parts in drawing order, a blank line between each: copy, personal line, signature, P.S. */
export function typedNoteBody(parts: { copy?: string; message?: string; signature?: string; postscript?: string }) {
  return [parts.copy, parts.message, parts.signature, parts.postscript]
    .map((part) => (part ?? '').replace(/\s+$/, ''))
    .filter(Boolean)
    .join('\n\n');
}

/** Split a word wider than the frame into pieces that each fit. */
function breakWord(word: string, width: number, fontSize: number, measure: MeasureWidth) {
  const pieces: string[] = [];
  let piece = '';
  for (const char of Array.from(word)) {
    if (piece && measure(piece + char, fontSize) > width) {
      pieces.push(piece);
      piece = char;
    } else piece += char;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/** Greedy word wrap. Explicit newlines always break; blank lines are kept as empty rows. */
export function wrapTyped(text: string, width: number, fontSize: number, measure: MeasureWidth) {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next, fontSize) <= width) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      if (measure(word, fontSize) <= width) {
        line = word;
      } else {
        const pieces = breakWord(word, width, fontSize, measure);
        lines.push(...pieces.slice(0, -1));
        line = pieces[pieces.length - 1] ?? '';
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Rows that fit in a frame: the first row needs one font size of height, each next row one line height. */
export function rowsThatFit(height: number, fontSize: number, lineSpacing = 1.45) {
  if (height + 1e-6 < fontSize) return 0;
  return Math.floor((height - fontSize + 1e-6) / (fontSize * lineSpacing)) + 1;
}

export function fitTypedNote({
  text,
  width,
  height,
  fontSize,
  lineSpacing = 1.45,
  measure,
  minScale = TYPED_MIN_SCALE,
}: TypedFitInput): TypedFit {
  const spacing = lineSpacing > 0 ? lineSpacing : 1.45;
  const at = (size: number) => {
    const lines = wrapTyped(text, width, size, measure);
    return { lines, needed: lines.length, available: rowsThatFit(height, size, spacing) };
  };
  const first = at(fontSize);
  const chosen = { needed: first.needed, available: first.available };
  if (first.needed <= first.available) return { ...first, fontSize, chosen, fits: true };
  const floor = fontSize * minScale;
  const step = Math.max(0.25, fontSize * SHRINK_STEP);
  let last = first;
  let lastSize = fontSize;
  for (let size = fontSize - step; size >= floor - 1e-6; size -= step) {
    last = at(size);
    lastSize = size;
    if (last.needed <= last.available) return { ...last, fontSize: size, chosen, fits: true };
  }
  if (lastSize - floor > 1e-6) {
    last = at(floor);
    lastSize = floor;
  }
  return { ...last, fontSize: lastSize, chosen, fits: last.needed <= last.available };
}

/** How many characters of the wrapped letter a typing frame shows (line breaks count as one). */
export function typedLength(lines: string[]) {
  return lines.reduce((total, line) => total + Array.from(line).length, 0) + Math.max(0, lines.length - 1);
}

/** The visible part of each line once `count` characters have been typed. */
export function revealLines(lines: string[], count: number) {
  const shown: string[] = [];
  let left = Math.max(0, Math.floor(count));
  for (const line of lines) {
    if (left < 0) break;
    const chars = Array.from(line);
    shown.push(chars.slice(0, left).join(''));
    left -= chars.length + 1;
  }
  return shown;
}
