/**
 * One line grid shared by the ruled paper and the handwriting, so writing always sits on a line.
 * The ruling is re-spaced to the writing (wider-ruled paper for bigger handwriting), and the
 * first rule is placed where the first line of writing starts.
 */
export type RuleGrid = {
  /** Distance between rules, in canvas pixels. */
  step: number;
  /** Baseline of the first written line, in canvas pixels. */
  firstBaseline: number;
  /** Every rule drawn on the paper, top to bottom. */
  rules: number[];
};

/** Where the baseline sits below the top of the writing area, as a share of the font size. */
export const BASELINE_DROP = 0.82;

export function ruleStep(fontSize: number, lineSpacing: number | undefined, scale: number) {
  const spacing = lineSpacing && lineSpacing > 0 ? lineSpacing : 1.35;
  return Math.max(22, Math.round(fontSize * spacing)) * scale;
}

export function buildRuleGrid(options: {
  paperY: number;
  paperH: number;
  noteY: number;
  fontSize: number;
  lineSpacing?: number;
  scale: number;
}): RuleGrid {
  const { paperY, paperH, noteY, fontSize, lineSpacing, scale } = options;
  const step = ruleStep(fontSize, lineSpacing, scale);
  const firstBaseline = paperY + noteY * paperH + fontSize * scale * BASELINE_DROP;
  // Real notebooks leave a header band and a foot without rules.
  const top = paperY + Math.max(52 * scale, step * 0.9);
  const bottom = paperY + paperH - 22 * scale;
  const rules: number[] = [];
  let y = firstBaseline - Math.max(0, Math.floor((firstBaseline - top) / step)) * step;
  for (; y <= bottom; y += step) rules.push(y);
  return { step, firstBaseline, rules };
}

/** Baseline of the given written row (0 is the first line of the note). */
export function baselineAt(grid: RuleGrid, row: number) {
  return grid.firstBaseline + row * grid.step;
}

/** How many written rows fit from the first baseline down to the last rule on the paper. */
export function rowsAvailable(grid: RuleGrid) {
  return grid.rules.filter((y) => y >= grid.firstBaseline - 0.5).length;
}

/** Rows a note takes: the message, a blank line and the sign-off (two if text and image), then the P.S. */
export function rowsNeeded(parts: { copyLines: number; signatureText: boolean; signatureImage: boolean; postscriptLines: number }) {
  const { copyLines, signatureText, signatureImage, postscriptLines } = parts;
  let rows = Math.max(1, copyLines);
  if (signatureText || signatureImage) rows += signatureText && signatureImage ? 3 : 2;
  return rows + postscriptLines;
}
