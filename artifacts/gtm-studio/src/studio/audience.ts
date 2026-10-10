/**
 * "Made for" presets for Notes and Handwriting GIF: one click sets the canvas, how much of the frame
 * the card fills, the writing size and the word target, so the writing stays readable where the note
 * is actually opened. Pure logic, no DOM.
 */
import { IDEAL_WORDS, type WordTarget } from './note-advice';
import type { InboxSurfaceId } from './inbox-check';
import { canvasSizes, cardZone, type CanvasSize, type CanvasZone, type StudioConfig } from './types';

export type AudienceId = 'desktop' | 'phone' | 'linkedin';

export type AudiencePreset = {
  id: AudienceId;
  label: string;
  /** One line under the control: the trade-off this preset makes. */
  hint: string;
  channel: CanvasSize;
  /** Share of the frame the card fills in desk and photo scenes. Unset: the finish's own framing. */
  cardFill?: number;
  fontSize: number;
  words: WordTarget;
  /** The inbox the numbers are picked for (see inbox-check). */
  surface: InboxSurfaceId;
};

/**
 * Numbers chosen so the writing reaches at least 14 px on screen at the target surface for every
 * handwriting style (the smallest-drawing style draws at 0.84 of the size setting):
 *  - Desktop email: 1500 px card shown 600 px wide, size 50 → 20 px (Caveat 21.6 px).
 *  - Phone-first: 1080 px portrait shown 330 px wide, size 56 → 17.1 px (Caveat 18.5 px).
 *  - LinkedIn DM: 1080 px square shown 330 px wide (DMs cap height, so square beats portrait), size 60 → 18.3 px.
 */
export const audiencePresets: AudiencePreset[] = [
  {
    id: 'desktop',
    label: 'Desktop email',
    hint: 'Desktop email: wide card with desk around it, room for about 40 words. Small on phones.',
    channel: 'Card',
    fontSize: 50,
    words: IDEAL_WORDS,
    surface: 'email-desktop',
  },
  {
    id: 'phone',
    label: 'Phone-first',
    hint: 'Phone-first: bigger writing, about 25 words, card fills the frame.',
    channel: 'Portrait',
    cardFill: 0.88,
    fontSize: 56,
    words: { min: 12, max: 28, long: 40 },
    surface: 'email-phone',
  },
  {
    id: 'linkedin',
    label: 'LinkedIn DM',
    hint: 'LinkedIn DM: square card, biggest writing, about 20 words.',
    channel: 'LinkedIn',
    cardFill: 0.88,
    fontSize: 60,
    words: { min: 10, max: 22, long: 32 },
    surface: 'dm',
  },
];

export const RECOMMENDED_AUDIENCE: AudienceId = 'phone';

export function audiencePreset(id: AudienceId) {
  return audiencePresets.find((preset) => preset.id === id) ?? audiencePresets[0];
}

/** The config values a preset sets. The card framing follows the current finish. */
export function audienceValues(id: AudienceId, finish: StudioConfig['finish']): Pick<StudioConfig, 'channel' | 'cardFill' | 'fontSize' | 'noteZone'> {
  const preset = audiencePreset(id);
  return {
    channel: preset.channel,
    cardFill: preset.cardFill,
    fontSize: preset.fontSize,
    noteZone: cardZone(finish, preset.cardFill),
  };
}

export function applyAudience<T extends StudioConfig>(config: T, id: AudienceId): T {
  return { ...config, ...audienceValues(id, config.finish) };
}

function sameZone(a: CanvasZone | undefined, b: CanvasZone) {
  if (!a) return false;
  const near = (x: number, y: number) => Math.abs(x - y) < 0.002;
  return near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height);
}

/** The preset this config still matches, or null once size, canvas or framing was changed by hand ("Custom"). */
export function matchAudience(config: Pick<StudioConfig, 'channel' | 'fontSize' | 'noteZone' | 'finish'>): AudienceId | null {
  const preset = audiencePresets.find((item) => item.channel === config.channel
    && item.fontSize === config.fontSize
    && sameZone(config.noteZone, cardZone(config.finish, item.cardFill)));
  return preset?.id ?? null;
}

/** Word target for the length advice: the matched preset's, else the general one. */
export function wordTargetFor(config: Pick<StudioConfig, 'channel' | 'fontSize' | 'noteZone' | 'finish'>): WordTarget {
  const id = matchAudience(config);
  return id ? audiencePreset(id).words : IDEAL_WORDS;
}

export function presetCanvas(id: AudienceId) {
  return canvasSizes[audiencePreset(id).channel];
}
