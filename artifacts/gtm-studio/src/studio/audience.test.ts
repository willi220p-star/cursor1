import { describe, expect, it } from 'vitest';
import { applyAudience, audiencePreset, audiencePresets, matchAudience, wordTargetFor } from './audience';
import { defaultConfig, normalizeConfig } from './defaults';
import { LEGIBLE_HANDWRITING_PX, displayWidth, effectiveSize, inboxSurfaces } from './inbox-check';
import { IDEAL_WORDS, noteAdvice } from './note-advice';
import { handwritingScale } from './renderer';
import { canvasSizes, cardZone, finishPaperZone, handwritingFonts } from './types';

const surface = (id: string) => inboxSurfaces.find((item) => item.id === id)!;

describe('Made for presets', () => {
  it('set canvas, writing size and card framing together', () => {
    const base = defaultConfig('handwritten');
    const desktop = applyAudience(base, 'desktop');
    expect(desktop).toMatchObject({ channel: 'Card', fontSize: 50, cardFill: undefined, noteZone: finishPaperZone('photo') });
    const phone = applyAudience(base, 'phone');
    expect(phone).toMatchObject({ channel: 'Portrait', fontSize: 56, cardFill: 0.88 });
    expect(phone.noteZone.x).toBeCloseTo(0.06);
    expect(phone.noteZone.width).toBeCloseTo(0.88);
    const linkedin = applyAudience(base, 'linkedin');
    expect(linkedin).toMatchObject({ channel: 'LinkedIn', fontSize: 60, cardFill: 0.88 });
    // Everything else is left alone.
    expect(linkedin.copy).toBe(base.copy);
    expect(linkedin.finish).toBe(base.finish);
  });

  it('reads back as the preset until size, canvas or framing is changed by hand', () => {
    const base = defaultConfig('handwritten');
    for (const preset of audiencePresets) expect(matchAudience(applyAudience(base, preset.id))).toBe(preset.id);
    const phone = applyAudience(base, 'phone');
    expect(matchAudience({ ...phone, fontSize: 57 })).toBeNull();
    expect(matchAudience({ ...phone, channel: 'LinkedIn' })).toBeNull();
    expect(matchAudience({ ...phone, noteZone: { ...phone.noteZone, x: 0.1 } })).toBeNull();
    // Switching finish re-frames the card with the same zoom, so the preset still holds.
    expect(matchAudience({ ...phone, finish: 'scanned', noteZone: cardZone('scanned', phone.cardFill) })).toBe('phone');
  });

  it('new Notes and Handwriting GIF campaigns start Phone-first', () => {
    expect(matchAudience(defaultConfig('handwritten'))).toBe('phone');
    expect(matchAudience(defaultConfig('handgif'))).toBe('phone');
  });

  it('leaves saved looks as they were', () => {
    // A look saved before presets existed: landscape card, size 50, its own paper zone, no cardFill.
    const old = { ...defaultConfig('handwritten'), channel: 'Card' as const, fontSize: 50, noteZone: finishPaperZone('desk'), cardFill: undefined };
    const loaded = normalizeConfig('handwritten', old);
    expect(loaded.cardFill).toBeUndefined();
    expect(loaded.channel).toBe('Card');
    expect(loaded.noteZone).toEqual(finishPaperZone('desk'));
    expect(matchAudience(loaded)).toBe('desktop');
  });

  it('keep the writing at least 14 px where each preset is read, in every handwriting style', () => {
    // Used sizes measured with the default note (27 words): Desktop and Phone-first draw at the chosen
    // size; LinkedIn DM shrinks one step (60 → 56.4) because 27 words is over its 22-word target.
    const usedSize = { desktop: 50, phone: 56, linkedin: 56.4 };
    for (const preset of audiencePresets) {
      const canvas = canvasSizes[preset.channel];
      const shown = displayWidth(surface(preset.surface), canvas);
      for (const font of handwritingFonts) {
        const effective = effectiveSize(usedSize[preset.id] * handwritingScale(font), canvas.width, shown);
        expect(effective, `${preset.label} in ${font} at ${shown} px`).toBeGreaterThanOrEqual(LEGIBLE_HANDWRITING_PX);
      }
    }
  });

  it('Phone-first and LinkedIn DM fix what the landscape card gets wrong on a phone', () => {
    const phoneEmail = surface('email-phone');
    const card = canvasSizes.Card;
    expect(effectiveSize(50, card.width, displayWidth(phoneEmail, card))).toBeLessThan(LEGIBLE_HANDWRITING_PX);
    for (const id of ['phone', 'linkedin'] as const) {
      const preset = audiencePreset(id);
      const canvas = canvasSizes[preset.channel];
      expect(effectiveSize(preset.fontSize, canvas.width, displayWidth(phoneEmail, canvas))).toBeGreaterThanOrEqual(16);
    }
    // DMs cap the preview height, so the LinkedIn preset is square: it shows the full 330 px wide.
    const dm = surface('dm');
    expect(displayWidth(dm, canvasSizes[audiencePreset('linkedin').channel])).toBe(330);
  });

  it('word targets follow the preset and drive the length advice', () => {
    const phone = applyAudience(defaultConfig('handwritten'), 'phone');
    const target = wordTargetFor(phone);
    expect(target.max).toBeGreaterThanOrEqual(20);
    expect(target.max).toBeLessThanOrEqual(28);
    expect(wordTargetFor({ ...phone, fontSize: 40 })).toEqual(IDEAL_WORDS);
    expect(noteAdvice(32, 56, null, target).text).toContain(`${target.max} or fewer`);
    expect(noteAdvice(32, 50, null).tone).toBe('good');
    expect(wordTargetFor(applyAudience(phone, 'linkedin')).max).toBeLessThan(target.max);
  });
});

describe('zoom to card', () => {
  it('keeps each finish framing when unset, and never zooms clean paper', () => {
    expect(cardZone('photo')).toEqual(finishPaperZone('photo'));
    expect(cardZone('clean', 0.88)).toEqual(finishPaperZone('clean'));
  });

  it('fills more of the frame but leaves desk showing round the card', () => {
    for (const finish of ['photo', 'desk', 'soft-shadow', 'scanned'] as const) {
      const zone = cardZone(finish, 0.88);
      expect(zone.width).toBeGreaterThan(finishPaperZone(finish).width);
      expect(zone.x).toBeGreaterThanOrEqual(0.03);
      expect(zone.y).toBeGreaterThanOrEqual(0.03);
      expect(zone.x + zone.width).toBeLessThanOrEqual(0.97);
      expect(zone.y + zone.height).toBeLessThanOrEqual(0.97);
    }
    // Never smaller than the finish's own card.
    expect(cardZone('scanned', 0.5)).toMatchObject({ width: finishPaperZone('scanned').width });
  });
});
