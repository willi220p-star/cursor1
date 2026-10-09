/**
 * Inbox preview check: how big a row's image really shows in common inboxes,
 * and whether the writing on it is still readable at that size. Pure logic, no DOM.
 */

export type InboxSurfaceId = 'email-desktop' | 'email-phone' | 'outlook' | 'dm';

export type InboxSurface = {
  id: InboxSurfaceId;
  label: string;
  /** Short name for summaries ("too small on phone email"). */
  short: string;
  /** Widest the image is shown, in CSS px. */
  maxWidth: number;
  /** Tallest the image is shown, in CSS px (chat previews cap height too). */
  maxHeight?: number;
};

/**
 * Typical display sizes. Desktop mail clients lay messages out in a ~600 px column; a phone
 * mail app on a 360 px wide screen leaves ~330 px for the image; chat apps show an image
 * preview roughly 330 px wide and cap tall images at about 360 px high.
 */
export const inboxSurfaces: InboxSurface[] = [
  { id: 'email-desktop', label: 'Email · desktop', short: 'desktop email', maxWidth: 600 },
  { id: 'email-phone', label: 'Email · phone', short: 'phone email', maxWidth: 330 },
  { id: 'outlook', label: 'Outlook-style', short: 'Outlook-style reading pane', maxWidth: 560 },
  { id: 'dm', label: 'LinkedIn-style DM', short: 'LinkedIn-style DM', maxWidth: 330, maxHeight: 360 },
];

/**
 * Smallest readable on-screen size, in CSS px of font size.
 * Handwriting has a small x-height (about 0.45 of the font size), so 14 px gives letters
 * roughly 6.3 px tall: about the x-height of 12 px body text, the smallest size mail clients
 * use for fine print. Below that, joined script turns to texture on a phone screen.
 * Typed sans text (x-height about 0.52) stays readable down to 12 px.
 */
export const LEGIBLE_HANDWRITING_PX = 14;
export const LEGIBLE_TYPED_PX = 12;
export const HANDWRITING_X_HEIGHT = 0.45;
export const TYPED_X_HEIGHT = 0.52;

/** Largest size the Look tab's sliders allow. */
export const MAX_HANDWRITING_SIZE = 72;
export const MAX_TYPED_SIZE = 48;

export type CanvasBox = { width: number; height: number };

/** The width, in CSS px, an image of this canvas size shows at on a surface. Never upscales. */
export function displayWidth(surface: Pick<InboxSurface, 'maxWidth' | 'maxHeight'>, canvas: CanvasBox) {
  let width = Math.min(surface.maxWidth, canvas.width);
  if (surface.maxHeight && canvas.height > 0) width = Math.min(width, (surface.maxHeight * canvas.width) / canvas.height);
  return Math.max(1, Math.round(width));
}

/** On-screen font size once the canvas is scaled down to the display width. */
export function effectiveSize(fontSize: number, canvasWidth: number, shownWidth: number) {
  if (!canvasWidth) return fontSize;
  return fontSize * (shownWidth / canvasWidth);
}

/** The font size (canvas units) needed to reach `threshold` px on screen at this display width. */
export function sizeNeeded(threshold: number, canvasWidth: number, shownWidth: number) {
  return Math.ceil((threshold * canvasWidth) / Math.max(1, shownWidth));
}

export type Verdict = 'ok' | 'hard';

export function verdictFor(effective: number, threshold: number): Verdict {
  return effective + 1e-6 >= threshold ? 'ok' : 'hard';
}

export type TextKind = 'handwriting' | 'typed';

export type FixAction = { key: 'fontSize'; value: number };
export type Fix = { text: string; action?: FixAction };

export type FitFacts = {
  /** Size the writing was actually drawn at, after fitting to the paper. */
  usedSize: number;
  /** Size chosen in the Look tab. */
  chosenSize: number;
  /** Rows the note needs and rows the paper has, at the used size. */
  needed?: number;
  available?: number;
  /** Words in the note for this row. */
  words?: number;
};

function roundWordsDown(words: number) {
  if (words <= 10) return Math.max(5, Math.floor(words));
  return Math.max(10, Math.floor(words / 5) * 5);
}

/**
 * One concrete fix for a surface where the writing is too small.
 * Bigger writing needs more rows: lines wrap sooner (about ×r) and each row is taller (×r),
 * so the note needs about r² as much paper. When that no longer fits, also cut words.
 */
export function suggestFix(
  kind: TextKind,
  facts: FitFacts,
  canvas: CanvasBox,
  shownWidth: number,
  surfaceShort: string,
): Fix {
  const threshold = kind === 'handwriting' ? LEGIBLE_HANDWRITING_PX : LEGIBLE_TYPED_PX;
  const maxSize = kind === 'handwriting' ? MAX_HANDWRITING_SIZE : MAX_TYPED_SIZE;
  const target = sizeNeeded(threshold, canvas.width, shownWidth);
  if (target > maxSize) {
    return { text: `Even size ${maxSize} is too small at ${shownWidth} px wide. Pick a smaller canvas, or don't send this image in a ${surfaceShort}.` };
  }
  const raiseTo = Math.max(target, facts.chosenSize);
  if (kind === 'typed' || !facts.needed || !facts.available || !facts.words) {
    return { text: `Raise size to ${raiseTo}.`, action: { key: 'fontSize', value: raiseTo } };
  }
  const ratio = target / Math.max(1, facts.usedSize);
  const rowsAtTarget = facts.needed * ratio * ratio;
  const estimate = (facts.words * facts.available) / Math.max(rowsAtTarget, facts.needed);
  const keep = roundWordsDown(Math.min(estimate, facts.words * 0.85));
  // The chosen size is already big enough: the note is too long, so the writing shrank to fit.
  if (facts.chosenSize >= target) {
    return { text: `Cut to about ${keep} words so the writing stops shrinking.` };
  }
  if (rowsAtTarget <= facts.available) {
    return { text: `Raise size to ${raiseTo}.`, action: { key: 'fontSize', value: raiseTo } };
  }
  return { text: `Cut to about ${keep} words and raise size to ${raiseTo}.`, action: { key: 'fontSize', value: raiseTo } };
}

export type SurfaceCheck = {
  surface: InboxSurface;
  shownWidth: number;
  /** Null when there is no text size to check (memes, GIFs). */
  effective: number | null;
  xHeight: number | null;
  verdict: Verdict | null;
  fix?: Fix;
};

export function checkSurfaces(
  kind: TextKind | null,
  facts: FitFacts | null,
  canvas: CanvasBox,
  surfaces: InboxSurface[] = inboxSurfaces,
): SurfaceCheck[] {
  return surfaces.map((surface) => {
    const shownWidth = displayWidth(surface, canvas);
    if (!kind || !facts) return { surface, shownWidth, effective: null, xHeight: null, verdict: null };
    const threshold = kind === 'handwriting' ? LEGIBLE_HANDWRITING_PX : LEGIBLE_TYPED_PX;
    const effective = effectiveSize(facts.usedSize, canvas.width, shownWidth);
    const xHeight = effective * (kind === 'handwriting' ? HANDWRITING_X_HEIGHT : TYPED_X_HEIGHT);
    const verdict = verdictFor(effective, threshold);
    const fix = verdict === 'hard' ? suggestFix(kind, facts, canvas, shownWidth, surface.short) : undefined;
    return { surface, shownWidth, effective, xHeight, verdict, fix };
  });
}

/** One line for the Ship tab, e.g. "Readable in 2 of 4 inboxes. Too small in phone email and LinkedIn-style DM." */
export function summarizeChecks(checks: SurfaceCheck[]) {
  const rated = checks.filter((check) => check.verdict);
  if (!rated.length) return null;
  const readable = rated.filter((check) => check.verdict === 'ok').length;
  const hard = rated.filter((check) => check.verdict === 'hard').map((check) => check.surface.short);
  const head = readable === rated.length ? `Readable in all ${rated.length} inboxes.` : `Readable in ${readable} of ${rated.length} inboxes.`;
  const tail = hard.length ? ` Too small in ${joinWords(hard)}.` : '';
  return { readable, total: rated.length, text: head + tail };
}

function joinWords(items: string[]) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Sender name for the mockups: the sign-off without its leading dash, or "You". */
export function senderFromSignature(signature: string | undefined) {
  const line = (signature ?? '').split('\n').map((part) => part.trim()).find(Boolean) ?? '';
  const name = line.replace(/^[\s\-–—~]+/, '').trim();
  return name || 'You';
}

export const DEFAULT_EMAIL_SUBJECT = 'Quick one, {first_name|there}';
export const DEFAULT_EMAIL_PREVIEW = 'Hi {first_name|there}, short note below.';
