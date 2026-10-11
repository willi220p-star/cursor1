/**
 * The handwriting fonts Notes and Handwriting GIF can write in, with what each is good for.
 * Self-contained on purpose (no imports): the measuring script reads the font names from here.
 * The numbers come from scripts/measure-handwriting-fonts.mjs (see handwriting-metrics.json) and are
 * checked against it by handwriting-fonts.test.ts.
 */

export type HandwritingGroupId = 'neat-print' | 'casual' | 'cursive' | 'quick-scrawl' | 'bold-rounded';

/** How readable the writing is on a phone: Good, OK or Small (rule in handwriting-readability.ts). */
export type PhoneReadability = 'good' | 'ok' | 'small';

export type HandwritingGroup = { id: HandwritingGroupId; label: string; useWhen: string };

export const handwritingGroups: HandwritingGroup[] = [
  { id: 'neat-print', label: 'Neat print', useWhen: 'Use it when the note must be easy to read on a phone: formal industries, first contact with senior people.' },
  { id: 'casual', label: 'Casual everyday', useWhen: 'Use it for a friendly, quick note from a real person: the safe default for most cold outreach.' },
  { id: 'cursive', label: 'Cursive', useWhen: 'Use it for warm, personal notes such as thank-yous and referrals. Keep the note short and the size up.' },
  { id: 'quick-scrawl', label: 'Quick scrawl', useWhen: 'Use it when the note should look jotted down in a hurry. Casual and human, but harder to read at small sizes.' },
  { id: 'bold-rounded', label: 'Bold and rounded', useWhen: 'Use it when the writing must stay clear on a small screen or a busy photo. Thick pen, friendly shapes.' },
];

export type HandwritingStyle = {
  id: string;
  /** The font family name, as Google Fonts and the canvas know it. */
  font: string;
  /** The font's real name, shown in the picker. */
  label: string;
  group: HandwritingGroupId;
  /** One plain-English line: best for, and what to watch out for. */
  note: string;
  /** Phone readability at the Phone-first preset in a phone email, derived from the measured numbers. */
  phone: PhoneReadability;
  /** Looks like the same person's hand next to the other mix-safe fonts (print or light slant, medium pen, no loops). */
  mixSafe: boolean;
  /** Drawn size per unit of the Font size setting, so one size looks the same height in every font. */
  scale: number;
  /** Measured x-height as a share of the font size (before scale). */
  xHeight: number;
  /** Measured pen width as a share of the font size (before scale). */
  stroke: number;
};

export const handwritingStyles: HandwritingStyle[] = [
  { id: 'patrick-hand', font: 'Patrick Hand', label: 'Patrick Hand', group: 'neat-print', note: 'Best for the clearest everyday print. Watch out: looks a little typed.', phone: 'good', mixSafe: true, scale: 1, xHeight: 0.47, stroke: 0.085 },
  { id: 'handlee', font: 'Handlee', label: 'Handlee', group: 'neat-print', note: 'Best for a tidy, friendly hand. Watch out: wide letters, so fewer words per line.', phone: 'good', mixSafe: true, scale: 0.96, xHeight: 0.5, stroke: 0.065 },
  { id: 'dekko', font: 'Dekko', label: 'Dekko', group: 'neat-print', note: 'Best for rounded, careful print with a personal feel. Watch out: capitals lean slightly.', phone: 'good', mixSafe: true, scale: 1.06, xHeight: 0.45, stroke: 0.085 },
  { id: 'annie-use-your-telescope', font: 'Annie Use Your Telescope', label: 'Annie Use Your Telescope', group: 'neat-print', note: 'Best for a light, neat school-notebook look. Watch out: thin pen.', phone: 'ok', mixSafe: true, scale: 1.02, xHeight: 0.47, stroke: 0.05 },
  { id: 'shadows-into-light-two', font: 'Shadows Into Light Two', label: 'Shadows Into Light Two', group: 'neat-print', note: 'Best for tall, tidy print that reads fast. Watch out: thin pen.', phone: 'ok', mixSafe: true, scale: 0.84, xHeight: 0.6, stroke: 0.06 },
  { id: 'yomogi', font: 'Yomogi', label: 'Yomogi', group: 'neat-print', note: 'Best for very even, spaced-out print. Watch out: wide spacing makes notes run long.', phone: 'ok', mixSafe: false, scale: 0.98, xHeight: 0.49, stroke: 0.05 },

  { id: 'caveat', font: 'Caveat', label: 'Caveat', group: 'casual', note: 'Best for an all-round quick, natural hand that is easy to read. Watch out: very common.', phone: 'ok', mixSafe: true, scale: 1.08, xHeight: 0.36, stroke: 0.065 },
  { id: 'shadows-into-light', font: 'Shadows Into Light', label: 'Shadows Into Light', group: 'casual', note: 'Best for a relaxed pen-on-paper note. Watch out: thin pen.', phone: 'ok', mixSafe: true, scale: 1.02, xHeight: 0.515, stroke: 0.055 },
  { id: 'indie-flower', font: 'Indie Flower', label: 'Indie Flower', group: 'casual', note: 'Best for a cheerful, rounded note. Watch out: can feel playful for formal buyers.', phone: 'good', mixSafe: true, scale: 1.13, xHeight: 0.425, stroke: 0.06 },
  { id: 'the-girl-next-door', font: 'The Girl Next Door', label: 'The Girl Next Door', group: 'casual', note: 'Best for a loose, youthful hand. Watch out: wide gaps between words.', phone: 'ok', mixSafe: true, scale: 0.97, xHeight: 0.495, stroke: 0.05 },
  { id: 'waiting-for-the-sunrise', font: 'Waiting for the Sunrise', label: 'Waiting for the Sunrise', group: 'casual', note: 'Best for a calm, thoughtful hand. Watch out: the thinnest pen here, so keep it for desktop email.', phone: 'small', mixSafe: true, scale: 0.96, xHeight: 0.5, stroke: 0.04 },
  { id: 'hi-melody', font: 'Hi Melody', label: 'Hi Melody', group: 'casual', note: 'Best for a small, quirky note. Watch out: small letters.', phone: 'good', mixSafe: true, scale: 1.47, xHeight: 0.325, stroke: 0.06 },
  { id: 'square-peg', font: 'Square Peg', label: 'Square Peg', group: 'casual', note: 'Best for a slim, upright pen note. Watch out: small letters and a light pen.', phone: 'ok', mixSafe: true, scale: 1.42, xHeight: 0.26, stroke: 0.04 },

  { id: 'cedarville-cursive', font: 'Cedarville Cursive', label: 'Cedarville Cursive', group: 'cursive', note: 'Best for a warm, joined-up letter. Watch out: joined letters read slower than print.', phone: 'good', mixSafe: false, scale: 1.02, xHeight: 0.41, stroke: 0.06 },
  { id: 'homemade-apple', font: 'Homemade Apple', label: 'Homemade Apple', group: 'cursive', note: 'Best for a flowing, expressive feel. Watch out: big loops, so it draws smaller and wide.', phone: 'good', mixSafe: false, scale: 0.9, xHeight: 0.475, stroke: 0.085 },
  { id: 'la-belle-aurore', font: 'La Belle Aurore', label: 'La Belle Aurore', group: 'cursive', note: 'Best for an elegant, slanted hand. Watch out: tall loops, so keep notes short.', phone: 'good', mixSafe: false, scale: 1.08, xHeight: 0.395, stroke: 0.07 },
  { id: 'nothing-you-could-do', font: 'Nothing You Could Do', label: 'Nothing You Could Do', group: 'cursive', note: 'Best for a relaxed, slanted cursive. Watch out: wide, so keep notes short.', phone: 'good', mixSafe: false, scale: 1.1, xHeight: 0.435, stroke: 0.06 },

  { id: 'nanum-pen-script', font: 'Nanum Pen Script', label: 'Nanum Pen Script', group: 'quick-scrawl', note: 'Best for a fast felt-tip scribble. Watch out: small and light at low sizes.', phone: 'good', mixSafe: true, scale: 1.22, xHeight: 0.485, stroke: 0.07 },
  { id: 'reenie-beanie', font: 'Reenie Beanie', label: 'Reenie Beanie', group: 'quick-scrawl', note: 'Best for a hurried marker note. Watch out: tiny letters and a thin pen.', phone: 'good', mixSafe: true, scale: 1.26, xHeight: 0.38, stroke: 0.05 },
  { id: 'nanum-brush-script', font: 'Nanum Brush Script', label: 'Nanum Brush Script', group: 'quick-scrawl', note: 'Best for a confident brush-pen jot. Watch out: letters can run together.', phone: 'good', mixSafe: false, scale: 1.5, xHeight: 0.32, stroke: 0.06 },
  { id: 'sue-ellen-francisco', font: 'Sue Ellen Francisco', label: 'Sue Ellen Francisco', group: 'quick-scrawl', note: 'Best for tall, narrow jotting that fits many words. Watch out: tall letters, so it draws a little smaller.', phone: 'ok', mixSafe: false, scale: 0.99, xHeight: 0.375, stroke: 0.06 },
  { id: 'swanky-and-moo-moo', font: 'Swanky and Moo Moo', label: 'Swanky and Moo Moo', group: 'quick-scrawl', note: 'Best for a loose, wobbly note. Watch out: uneven baseline looks messy if overused.', phone: 'good', mixSafe: false, scale: 1.42, xHeight: 0.335, stroke: 0.06 },

  { id: 'gloria-hallelujah', font: 'Gloria Hallelujah', label: 'Gloria Hallelujah', group: 'bold-rounded', note: 'Best for writing that must stay clear on a small screen. Watch out: big and wide, fewer words fit.', phone: 'good', mixSafe: true, scale: 0.84, xHeight: 0.57, stroke: 0.1 },
  { id: 'mansalva', font: 'Mansalva', label: 'Mansalva', group: 'bold-rounded', note: 'Best for a thick marker note that pops. Watch out: very heavy, can feel shouty.', phone: 'good', mixSafe: false, scale: 1.21, xHeight: 0.395, stroke: 0.11 },
  { id: 'gamja-flower', font: 'Gamja Flower', label: 'Gamja Flower', group: 'bold-rounded', note: 'Best for chunky, friendly print. Watch out: dense; looks like a marker, not a pen.', phone: 'good', mixSafe: true, scale: 1.31, xHeight: 0.365, stroke: 0.075 },
  { id: 'schoolbell', font: 'Schoolbell', label: 'Schoolbell', group: 'bold-rounded', note: 'Best for a firm, round classroom hand. Watch out: very upright and regular.', phone: 'good', mixSafe: true, scale: 1.1, xHeight: 0.435, stroke: 0.08 },
  { id: 'gaegu', font: 'Gaegu', label: 'Gaegu', group: 'bold-rounded', note: 'Best for round, spaced-out marker print. Watch out: wide spacing makes notes run long.', phone: 'good', mixSafe: true, scale: 1.24, xHeight: 0.385, stroke: 0.07 },
];

/** Every handwriting font family, in picker order. */
export const handwritingFonts: string[] = handwritingStyles.map((style) => style.font);

/**
 * The seven fonts Notes offered before this list grew, in their original order. "Mix fonts across rows"
 * picks from exactly these (so saved looks that mix render the same as before).
 */
export const legacyHandwritingFonts = [
  'Caveat',
  'Nanum Pen Script',
  'Handlee',
  'Cedarville Cursive',
  'Patrick Hand',
  'Shadows Into Light',
  'Gloria Hallelujah',
] as const;

export function handwritingStyleFor(font: string | undefined) {
  return handwritingStyles.find((style) => style.font === font);
}
