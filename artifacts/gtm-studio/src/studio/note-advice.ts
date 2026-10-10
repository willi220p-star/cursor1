/** Plain-English advice on note length and fit, shown under the note copy. */

export type NoteFitInfo = {
  fontSize: number;
  needed: number;
  available: number;
  chosen: { needed: number; available: number };
  /** Drawn size per unit of the size setting for the handwriting font in use. */
  fontScale?: number;
  /** Avatar cards: false when the letter overflows its frame even at the smallest size. */
  fits?: boolean;
};

export type NoteAdvice = { tone: 'good' | 'warn' | 'info'; text: string };

export type WordTarget = { readonly min: number; readonly max: number; readonly long: number };

/** Sweet spot for a handwritten cold note: short enough to read at a glance. */
export const IDEAL_WORDS: WordTarget = { min: 15, max: 40, long: 55 };

export function countWords(text: string) {
  return text.trim() ? text.trim().split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length : 0;
}

/**
 * `ideal` is the word target for the canvas in use (see audience.ts); phone and DM notes want fewer words.
 * `kind` names the piece in the advice: a handwritten note, or an avatar card's typed letter.
 */
export function noteAdvice(words: number, chosenSize: number, fit: NoteFitInfo | null, ideal: WordTarget = IDEAL_WORDS, kind: 'handwritten' | 'typed' = 'handwritten'): NoteAdvice {
  const count = `${words} ${words === 1 ? 'word' : 'words'}`;
  const piece = kind === 'typed' ? 'letter' : 'handwritten note';
  if (fit && fit.fits === false) {
    return {
      tone: 'warn',
      text: `${count}. Too long for the text frame even at size ${Math.round(fit.fontSize)}, so the last lines are cut off. Cut words or make the frame bigger.`,
    };
  }
  if (fit && fit.fontSize < chosenSize * 0.97) {
    const over = Math.max(0, fit.chosen.needed - fit.chosen.available);
    const cut = Math.max(1, Math.ceil((words * over) / Math.max(1, fit.chosen.needed)));
    return {
      tone: 'warn',
      text: `${count}. Too long for the ${kind === 'typed' ? 'text frame' : 'card'} at size ${chosenSize}, so the ${kind === 'typed' ? 'type' : 'writing'} shrinks to ${Math.round(fit.fontSize)}. Cut about ${cut} ${cut === 1 ? 'word' : 'words'} to keep it full size.`,
    };
  }
  if (words > ideal.long) return { tone: 'warn', text: `${count}. Long for a ${piece}; ${ideal.max} or fewer gets read.` };
  if (words > ideal.max) return { tone: 'info', text: `${count}. A little long; ${ideal.max} or fewer reads best.` };
  if (fit && fit.fontSize > chosenSize * 1.03) {
    return { tone: 'good', text: `${count}. Short note, so the writing grows to ${Math.round(fit.fontSize)} to fill the card.` };
  }
  if (words && words < ideal.min) return { tone: 'info', text: `${count}. Very short; a line about them makes it feel personal.` };
  return { tone: 'good', text: `${count}. Good length for a ${piece}.` };
}
