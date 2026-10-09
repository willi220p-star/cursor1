/** Plain-English advice on note length and fit, shown under the note copy. */

export type NoteFitInfo = {
  fontSize: number;
  needed: number;
  available: number;
  chosen: { needed: number; available: number };
};

export type NoteAdvice = { tone: 'good' | 'warn' | 'info'; text: string };

/** Sweet spot for a handwritten cold note: short enough to read at a glance. */
export const IDEAL_WORDS = { min: 15, max: 40, long: 55 } as const;

export function countWords(text: string) {
  return text.trim() ? text.trim().split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length : 0;
}

export function noteAdvice(words: number, chosenSize: number, fit: NoteFitInfo | null): NoteAdvice {
  const count = `${words} ${words === 1 ? 'word' : 'words'}`;
  if (fit && fit.fontSize < chosenSize * 0.97) {
    const over = Math.max(0, fit.chosen.needed - fit.chosen.available);
    const cut = Math.max(1, Math.ceil((words * over) / Math.max(1, fit.chosen.needed)));
    return {
      tone: 'warn',
      text: `${count}. Too long for the card at size ${chosenSize}, so the writing shrinks to ${Math.round(fit.fontSize)}. Cut about ${cut} ${cut === 1 ? 'word' : 'words'} to keep it full size.`,
    };
  }
  if (words > IDEAL_WORDS.long) return { tone: 'warn', text: `${count}. Long for a handwritten note; ${IDEAL_WORDS.max} or fewer gets read.` };
  if (words > IDEAL_WORDS.max) return { tone: 'info', text: `${count}. A little long; ${IDEAL_WORDS.max} or fewer reads best.` };
  if (fit && fit.fontSize > chosenSize * 1.03) {
    return { tone: 'good', text: `${count}. Short note, so the writing grows to ${Math.round(fit.fontSize)} to fill the card.` };
  }
  if (words && words < IDEAL_WORDS.min) return { tone: 'info', text: `${count}. Very short; a line about them makes it feel personal.` };
  return { tone: 'good', text: `${count}. Good length for a handwritten note.` };
}
