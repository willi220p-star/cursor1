/**
 * "Made for" presets for Notes, Handwriting GIF and Avatar cards: one click sets the canvas, how much of
 * the frame the card fills, the writing size and the word target (and for avatar cards, where the portrait
 * sits), so the writing stays readable where the note is actually opened. Pure logic, no DOM.
 */
import { IDEAL_WORDS, type WordTarget } from './note-advice';
import type { InboxSurfaceId } from './inbox-check';
import { avatarInNoteLayout, avatarLayoutOf, canvasSizes, cardZone, type AvatarLayout, type CanvasSize, type CanvasZone, type StudioConfig, type StudioMode } from './types';

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

export type AvatarAudiencePreset = AudiencePreset & {
  /** Portrait left of the letter, or on top of it. */
  layout: AvatarLayout;
  /** Portrait width as a share of the canvas width. */
  avatarWidth: number;
};

/**
 * Avatar cards use typed text, readable down to 12 px on screen (LEGIBLE_TYPED_PX). Each preset clears
 * that at its target surface with room to spare, so a letter that shrinks a little to fit stays readable:
 *  - Desktop email: 1500 px card shown 600 px wide, size 34 → 13.6 px. Portrait left of the letter.
 *  - Phone-first: 1080 px portrait shown 330 px wide, size 44 → 13.4 px. Portrait on top, letter full width.
 *  - LinkedIn DM: 1080 px square shown 330 px wide, size 46 → 14.1 px. Small portrait on top.
 * The old A4 default (size 28 on 1240 px) showed the letter at about 7.5 px on a phone.
 */
export const avatarAudiencePresets: AvatarAudiencePreset[] = [
  {
    id: 'desktop',
    label: 'Desktop email',
    hint: 'Desktop email: wide card, portrait beside the letter, room for about 45 words. Small on phones.',
    channel: 'Card',
    fontSize: 34,
    layout: 'side',
    avatarWidth: 0.22,
    words: { min: 15, max: 45, long: 60 },
    surface: 'email-desktop',
  },
  {
    id: 'phone',
    label: 'Phone-first',
    hint: 'Phone-first: portrait on top, bigger type across the full width, about 30 words.',
    channel: 'Portrait',
    cardFill: 0.9,
    fontSize: 44,
    layout: 'stacked',
    avatarWidth: 0.26,
    words: { min: 12, max: 30, long: 42 },
    surface: 'email-phone',
  },
  {
    id: 'linkedin',
    label: 'LinkedIn DM',
    hint: 'LinkedIn DM: square card, small portrait on top, biggest type, about 22 words.',
    channel: 'LinkedIn',
    cardFill: 0.92,
    fontSize: 46,
    layout: 'stacked',
    avatarWidth: 0.18,
    words: { min: 10, max: 22, long: 32 },
    surface: 'dm',
  },
];

type AudienceConfig = Pick<StudioConfig, 'channel' | 'fontSize' | 'noteZone' | 'finish'> & Partial<Pick<StudioConfig, 'mode' | 'avatarLayout'>>;

/** The presets for a studio: avatar cards have their own typed sizes and portrait layouts. */
export function audiencePresetsFor(mode?: StudioMode): AudiencePreset[] {
  return mode === 'avatar' ? avatarAudiencePresets : audiencePresets;
}

export function audiencePreset(id: AudienceId, mode?: StudioMode) {
  const presets = audiencePresetsFor(mode);
  return presets.find((preset) => preset.id === id) ?? presets[0];
}

export function avatarAudiencePreset(id: AudienceId) {
  return avatarAudiencePresets.find((preset) => preset.id === id) ?? avatarAudiencePresets[0];
}

/** The config values an avatar preset sets: canvas, size, card framing, layout and the three zones. */
export function avatarAudienceValues(id: AudienceId, finish: StudioConfig['finish']): Pick<StudioConfig, 'channel' | 'cardFill' | 'fontSize' | 'noteZone' | 'avatarZone' | 'textZone' | 'avatarLayout'> {
  const preset = avatarAudiencePreset(id);
  const layout = avatarInNoteLayout(preset.channel, preset.avatarWidth, cardZone(finish, preset.cardFill), preset.layout);
  return {
    channel: preset.channel,
    cardFill: preset.cardFill,
    fontSize: preset.fontSize,
    avatarLayout: preset.layout,
    noteZone: layout.note,
    avatarZone: layout.avatar,
    textZone: layout.text,
  };
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
  if (config.mode === 'avatar') return { ...config, ...avatarAudienceValues(id, config.finish) };
  return { ...config, ...audienceValues(id, config.finish) };
}

function sameZone(a: CanvasZone | undefined, b: CanvasZone) {
  if (!a) return false;
  const near = (x: number, y: number) => Math.abs(x - y) < 0.002;
  return near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height);
}

/** The preset this config still matches, or null once size, canvas or framing was changed by hand ("Custom"). */
export function matchAudience(config: AudienceConfig): AudienceId | null {
  if (config.mode === 'avatar') {
    const layout = avatarLayoutOf(config);
    const match = avatarAudiencePresets.find((item) => item.channel === config.channel
      && item.fontSize === config.fontSize
      && item.layout === layout
      && sameZone(config.noteZone, cardZone(config.finish, item.cardFill)));
    return match?.id ?? null;
  }
  const preset = audiencePresets.find((item) => item.channel === config.channel
    && item.fontSize === config.fontSize
    && sameZone(config.noteZone, cardZone(config.finish, item.cardFill)));
  return preset?.id ?? null;
}

/** Word target for the length advice: the matched preset's, else the general one. */
export function wordTargetFor(config: AudienceConfig): WordTarget {
  const id = matchAudience(config);
  return id ? audiencePreset(id, config.mode).words : IDEAL_WORDS;
}

export function presetCanvas(id: AudienceId, mode?: StudioMode) {
  return canvasSizes[audiencePreset(id, mode).channel];
}
