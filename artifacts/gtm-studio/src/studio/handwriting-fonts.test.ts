import { describe, expect, it } from 'vitest';
import { artefactFontsUrl, handwritingFontsUrl, LATIN_SAMPLE } from './fonts';
import { handwritingFonts, handwritingGroups, handwritingStyleFor, handwritingStyles, legacyHandwritingFonts } from './handwriting-fonts';
import metrics from './handwriting-metrics.json';
import {
  PHONE_STROKE_GOOD,
  PHONE_STROKE_SMALL,
  PHONE_X_HEIGHT_GOOD,
  PHONE_X_HEIGHT_SMALL,
  phoneNumbers,
  phoneScene,
  phoneTag,
} from './handwriting-readability';
import { handwritingScale, pickFrom } from './renderer';
import { isHandwritingFamily } from './types';

const newFonts = [
  'Reenie Beanie', 'Waiting for the Sunrise', 'Nothing You Could Do', 'The Girl Next Door', 'Schoolbell', 'Square Peg',
  'Nanum Brush Script', 'Gamja Flower', 'Homemade Apple', 'Dekko', 'Sue Ellen Francisco', 'Gaegu', 'La Belle Aurore',
  'Swanky and Moo Moo', 'Annie Use Your Telescope', 'Shadows Into Light Two', 'Mansalva', 'Indie Flower', 'Hi Melody', 'Yomogi',
];

// The scales the seven original fonts had before the list grew. Saved looks depend on them.
const legacyScales: Record<string, number> = {
  Caveat: 1.08,
  'Nanum Pen Script': 1.22,
  Handlee: 0.96,
  'Cedarville Cursive': 1.02,
  'Patrick Hand': 1,
  'Shadows Into Light': 1.02,
  'Gloria Hallelujah': 0.84,
};

describe('handwriting font table', () => {
  it('has the seven original fonts and the twenty new ones, once each', () => {
    expect(handwritingFonts).toHaveLength(27);
    expect(new Set(handwritingFonts).size).toBe(27);
    for (const font of [...legacyHandwritingFonts, ...newFonts]) expect(handwritingFonts, font).toContain(font);
    expect(new Set(handwritingStyles.map((style) => style.id)).size).toBe(27);
  });

  it('puts every font in exactly one group, with a plain-English note', () => {
    const groupIds = handwritingGroups.map((group) => group.id);
    for (const style of handwritingStyles) {
      expect(groupIds, style.font).toContain(style.group);
      expect(style.note, style.font).toMatch(/^Best for .+ Watch out: .+\.$/);
      expect(style.label, style.font).toBe(style.font);
    }
    for (const group of handwritingGroups) {
      expect(handwritingStyles.filter((style) => style.group === group.id).length, group.label).toBeGreaterThan(0);
      expect(group.useWhen, group.label).toMatch(/^Use it /);
    }
  });

  it('keeps the original size scales and gives every font a scale in range', () => {
    for (const [font, scale] of Object.entries(legacyScales)) expect(handwritingScale(font), font).toBe(scale);
    for (const style of handwritingStyles) {
      expect(handwritingScale(style.font), style.font).toBe(style.scale);
      expect(style.scale, style.font).toBeGreaterThanOrEqual(0.84);
      expect(style.scale, style.font).toBeLessThanOrEqual(1.6);
    }
  });
});

describe('measured numbers', () => {
  const measured = metrics.fonts as Record<string, { xHeight: number; stroke: number; ascent: number; descent: number }>;
  const legacyXHeights = Object.entries(legacyScales).map(([font, scale]) => measured[font]!.xHeight * scale).sort((a, b) => a - b);
  const target = legacyXHeights[Math.floor(legacyXHeights.length / 2)]!;

  it('are committed for every font and match the table', () => {
    for (const style of handwritingStyles) {
      const item = measured[style.font];
      expect(item, `${style.font} is missing from handwriting-metrics.json`).toBeDefined();
      expect(style.xHeight, style.font).toBe(item!.xHeight);
      expect(style.stroke, style.font).toBe(item!.stroke);
    }
    expect(Object.keys(measured).sort()).toEqual([...handwritingFonts].sort());
  });

  it('set each new font scale so its x-height matches the original fonts, without tall fonts crowding the next line', () => {
    for (const style of handwritingStyles.filter((item) => newFonts.includes(item.font))) {
      const item = measured[style.font]!;
      const expected = Math.max(0.84, Math.min(1.6, Math.round((target / item.xHeight) * 100) / 100, Math.floor((1.55 / (item.ascent + item.descent)) * 100) / 100));
      expect(style.scale, style.font).toBe(expected);
    }
  });

  it('tag every font Good, OK or Small consistently with its numbers at Phone-first on a phone email', () => {
    const scene = phoneScene();
    expect(scene).toMatchObject({ fontSize: 56, shown: 330 });
    for (const style of handwritingStyles) {
      const numbers = phoneNumbers(style);
      expect(phoneTag(numbers), `${style.font}: x-height ${numbers.xHeightPx.toFixed(2)} px, pen ${numbers.strokePx.toFixed(2)} px`).toBe(style.phone);
      if (style.phone === 'good') {
        expect(numbers.xHeightPx).toBeGreaterThanOrEqual(PHONE_X_HEIGHT_GOOD);
        expect(numbers.strokePx).toBeGreaterThanOrEqual(PHONE_STROKE_GOOD);
      } else if (style.phone === 'small') {
        expect(numbers.xHeightPx < PHONE_X_HEIGHT_SMALL || numbers.strokePx < PHONE_STROKE_SMALL).toBe(true);
      } else {
        expect(numbers.xHeightPx).toBeGreaterThanOrEqual(PHONE_X_HEIGHT_SMALL);
        expect(numbers.strokePx).toBeGreaterThanOrEqual(PHONE_STROKE_SMALL);
      }
    }
  });
});

describe('saved looks', () => {
  it('still treat every handwriting font, old and new, as a handwriting family', () => {
    for (const font of [...handwritingFonts, 'Covered By Your Grace', 'Sacramento', 'Dancing Script', 'Kalam', 'Gochi Hand']) expect(isHandwritingFamily(font), font).toBe(true);
    expect(isHandwritingFamily('Space Grotesk')).toBe(false);
    expect(isHandwritingFamily('Manrope')).toBe(false);
    expect(handwritingStyleFor('Gaegu')?.group).toBe('bold-rounded');
  });

  it('mix fonts across rows picks from the original seven, in the original order', () => {
    expect([...legacyHandwritingFonts]).toEqual(['Caveat', 'Nanum Pen Script', 'Handlee', 'Cedarville Cursive', 'Patrick Hand', 'Shadows Into Light', 'Gloria Hallelujah']);
    // The renderer picks with pickFrom(pool, seed + 11). These are what the original array gave for these seeds.
    const expected: Array<[number, string]> = [
      [1, 'Shadows Into Light'], [2, 'Gloria Hallelujah'], [3, 'Caveat'], [7, 'Patrick Hand'], [9, 'Gloria Hallelujah'],
      [10, 'Caveat'], [100, 'Gloria Hallelujah'], [12345, 'Nanum Pen Script'], [9998, 'Gloria Hallelujah'],
    ];
    for (const [seed, font] of expected) expect(pickFrom(legacyHandwritingFonts, seed + 11), `seed ${seed}`).toBe(font);
  });
});

describe('font loading', () => {
  it('keeps the always-loaded artefact stylesheet to the original seven handwriting fonts', () => {
    const url = decodeURIComponent(artefactFontsUrl());
    for (const font of legacyHandwritingFonts) expect(url, font).toContain(`family=${font.replace(/ /g, '+')}`);
    for (const font of newFonts) expect(url, font).not.toContain(`family=${font.replace(/ /g, '+')}`);
  });

  it('loads the new fonts one request at a time, and asks for Latin text so subsetted faces fetch their Latin range', () => {
    expect(handwritingFontsUrl(['Gaegu', 'Hi Melody'])).toBe('https://fonts.googleapis.com/css2?family=Gaegu&family=Hi+Melody&display=swap');
    expect(LATIN_SAMPLE).toMatch(/[A-Za-z]/);
    expect(LATIN_SAMPLE).toMatch(/\d/);
  });
});
