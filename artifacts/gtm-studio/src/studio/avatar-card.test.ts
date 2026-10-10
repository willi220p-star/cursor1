import { describe, expect, it } from 'vitest';
import { applyAudience, avatarAudiencePresets, matchAudience, wordTargetFor } from './audience';
import {
  AVATAR_BADGE_COLORS,
  badgeColorFor,
  companyHost,
  faviconUrlFor,
  initialsFor,
  portraitColumnInUse,
  rowPortraitSource,
  rowsMissingPortrait,
} from './avatar-fallback';
import { defaultConfig, normalizeConfig } from './defaults';
import { LEGIBLE_TYPED_PX, MAX_TYPED_SIZE, displayWidth, effectiveSize, inboxSurfaces } from './inbox-check';
import { noteAdvice } from './note-advice';
import { avatarRowWarnings } from './row-checks';
import { fitTypedNote, revealLines, rowsThatFit, typedLength, typedNoteBody, wrapTyped, TYPED_MIN_SCALE } from './typed-fit';
import {
  AVATAR_CACHE_FIELD,
  avatarInNoteLayout,
  avatarLayoutOf,
  canvasSizes,
  cardZone,
  defaultAvatarLayout,
  finishPaperZone,
  stillFormatFor,
  zonesOverlap,
  type CanvasZone,
  type Contact,
} from './types';

const surface = (id: string) => inboxSurfaces.find((item) => item.id === id)!;
const inside = (inner: CanvasZone, outer: CanvasZone) => inner.x >= outer.x - 1e-9
  && inner.y >= outer.y - 1e-9
  && inner.x + inner.width <= outer.x + outer.width + 1e-9
  && inner.y + inner.height <= outer.y + outer.height + 1e-9;
/** A monospace stand-in for canvas measureText. */
const mono = (text: string, fontSize: number) => Array.from(text).length * fontSize * 0.5;

describe('avatar Made for presets', () => {
  it('reach the typed legibility threshold at their own surface, below the slider max', () => {
    for (const preset of avatarAudiencePresets) {
      const canvas = canvasSizes[preset.channel];
      const shown = displayWidth(surface(preset.surface), canvas);
      expect(effectiveSize(preset.fontSize, canvas.width, shown)).toBeGreaterThanOrEqual(LEGIBLE_TYPED_PX + 1);
      expect(preset.fontSize).toBeLessThanOrEqual(MAX_TYPED_SIZE);
    }
  });

  it('even a letter shrunk to fit stays near readable on a phone', () => {
    const phone = avatarAudiencePresets.find((item) => item.id === 'phone')!;
    const canvas = canvasSizes[phone.channel];
    const shown = displayWidth(surface('email-phone'), canvas);
    // The old A4 default: size 28 on a 1240 px sheet.
    expect(effectiveSize(28, canvasSizes.A4.width, shown)).toBeLessThan(8);
    expect(effectiveSize(phone.fontSize, canvas.width, shown)).toBeGreaterThan(13);
  });

  it('set canvas, size, layout and zones together, and read back until changed by hand', () => {
    const base = defaultConfig('avatar');
    for (const preset of avatarAudiencePresets) {
      const applied = applyAudience(base, preset.id);
      expect(applied).toMatchObject({ channel: preset.channel, fontSize: preset.fontSize, avatarLayout: preset.layout });
      expect(matchAudience(applied)).toBe(preset.id);
      expect(inside(applied.avatarZone, applied.noteZone)).toBe(true);
      expect(inside(applied.textZone, applied.noteZone)).toBe(true);
      expect(zonesOverlap(applied.avatarZone, applied.textZone)).toBe(false);
      expect(applied.copy).toBe(base.copy);
    }
    const phone = applyAudience(base, 'phone');
    expect(matchAudience({ ...phone, fontSize: 40 })).toBeNull();
    expect(matchAudience({ ...phone, avatarLayout: 'side' })).toBeNull();
    expect(matchAudience({ ...phone, channel: 'A4' })).toBeNull();
  });

  it('Phone-first is the default for new avatar campaigns', () => {
    const config = defaultConfig('avatar');
    expect(matchAudience(config)).toBe('phone');
    expect(config.channel).toBe('Portrait');
    expect(config.avatarLayout).toBe('stacked');
    expect(wordTargetFor(config).max).toBe(30);
    // The personal line is typed from the message column, so the copy no longer repeats {msg}.
    expect(config.copy).not.toContain('{msg');
  });

  it('a look saved before presets loads unchanged and stays portrait-left', () => {
    const layout = avatarInNoteLayout('A4', 0.24, finishPaperZone('desk'));
    const saved = {
      ...defaultConfig('avatar'),
      channel: 'A4' as const,
      fontSize: 28,
      noteZone: layout.note,
      avatarZone: layout.avatar,
      textZone: layout.text,
      cardFill: undefined,
      avatarLayout: undefined,
    };
    const loaded = normalizeConfig('avatar', saved);
    expect(loaded.channel).toBe('A4');
    expect(loaded.fontSize).toBe(28);
    expect(loaded.noteZone).toEqual(layout.note);
    expect(loaded.avatarZone).toEqual(layout.avatar);
    expect(loaded.textZone).toEqual(layout.text);
    expect(loaded.cardFill).toBeUndefined();
    expect(avatarLayoutOf(loaded)).toBe('side');
    expect(matchAudience(loaded)).toBeNull();
  });

  it('handwriting studios keep their own presets', () => {
    expect(applyAudience(defaultConfig('handwritten'), 'phone').fontSize).toBe(56);
    expect(applyAudience(defaultConfig('handwritten'), 'phone').avatarLayout).toBeUndefined();
  });
});

describe('avatar layout', () => {
  it('stacks the portrait over the letter on tall and square canvases', () => {
    expect(defaultAvatarLayout('Portrait')).toBe('stacked');
    expect(defaultAvatarLayout('LinkedIn')).toBe('stacked');
    expect(defaultAvatarLayout('A4')).toBe('stacked');
    expect(defaultAvatarLayout('Card')).toBe('side');
    expect(defaultAvatarLayout('Email')).toBe('side');
  });

  it('stacked gives the letter the full paper width below a square portrait', () => {
    const note = cardZone('desk', 0.9);
    const { avatar, text } = avatarInNoteLayout('Portrait', 0.26, note, 'stacked');
    const { width, height } = canvasSizes.Portrait;
    expect(avatar.width * width).toBeCloseTo(avatar.height * height, 6);
    expect(text.y).toBeGreaterThan(avatar.y + avatar.height);
    expect(text.x).toBeCloseTo(avatar.x);
    expect(text.width).toBeCloseTo(note.width * 0.9);
    expect(inside(text, note)).toBe(true);
    const side = avatarInNoteLayout('Portrait', 0.26, note, 'side');
    expect(text.width).toBeGreaterThan(side.text.width * 1.4);
  });

  it('side layout is unchanged for older looks', () => {
    const note = finishPaperZone('desk');
    expect(avatarInNoteLayout('A4', 0.24, note)).toEqual(avatarInNoteLayout('A4', 0.24, note, 'side'));
  });

  it('a huge portrait slider still leaves room for the letter when stacked', () => {
    const note = cardZone('desk', 0.92);
    const { text } = avatarInNoteLayout('LinkedIn', 0.6, note, 'stacked');
    expect(text.height).toBeGreaterThan(note.height * 0.4);
  });
});

describe('typed letter fit', () => {
  it('builds the letter in order with blank lines between parts', () => {
    expect(typedNoteBody({ copy: 'Hi Maya,\n', message: 'Loved it.', signature: '– Alex', postscript: '' })).toBe('Hi Maya,\n\nLoved it.\n\n– Alex');
  });

  it('wraps without ever exceeding the width, breaking words that are too long', () => {
    const lines = wrapTyped('Hello there https://averyveryverylongdomainname.example.com/path ok', 200, 20, mono);
    for (const line of lines) expect(mono(line, 20)).toBeLessThanOrEqual(200);
    expect(lines.join('')).toContain('averyveryvery');
  });

  it('keeps the set size when the letter fits', () => {
    const fit = fitTypedNote({ text: 'Hi Maya,\n\nShort note.', width: 600, height: 400, fontSize: 40, measure: mono });
    expect(fit).toMatchObject({ fontSize: 40, fits: true });
    expect(fit.needed).toBe(3);
  });

  it('shrinks in small steps until copy, message, signature and P.S. fit', () => {
    const text = typedNoteBody({
      copy: 'Hi Maya,\n\nLoved what Top End Solar is building. One idea could help a Director in Darwin start more good conversations with the right buyers.',
      message: 'Loved the Darwin launch — more of this, please.',
      signature: '– Alex',
      postscript: 'P.S. Happy to send the one-pager first.',
    });
    const fit = fitTypedNote({ text, width: 600, height: 520, fontSize: 40, measure: mono });
    expect(fit.fits).toBe(true);
    expect(fit.fontSize).toBeLessThan(40);
    expect(fit.fontSize).toBeGreaterThanOrEqual(40 * TYPED_MIN_SCALE);
    expect(fit.chosen.needed).toBeGreaterThan(fit.chosen.available);
    expect(fit.needed).toBeLessThanOrEqual(fit.available);
    for (const line of fit.lines) expect(mono(line, fit.fontSize)).toBeLessThanOrEqual(600);
    // One step smaller than needed would not have been chosen: the largest size that fits wins.
    const bigger = fitTypedNote({ text, width: 600, height: 520, fontSize: fit.fontSize + 0.8, measure: mono, minScale: 1 });
    expect(bigger.fits).toBe(false);
  });

  it('flags a letter that overflows even at the floor', () => {
    const text = Array.from({ length: 80 }, () => 'word').join(' ');
    const fit = fitTypedNote({ text, width: 300, height: 120, fontSize: 40, measure: mono });
    expect(fit.fits).toBe(false);
    expect(fit.fontSize).toBeCloseTo(40 * TYPED_MIN_SCALE);
  });

  it('counts rows like the renderer draws them', () => {
    expect(rowsThatFit(100, 40, 1.5)).toBe(2);
    expect(rowsThatFit(39, 40, 1.5)).toBe(0);
  });

  it('typing reveals the wrapped lines in order, so words never jump lines', () => {
    const lines = ['Hi Maya,', '', 'Loved it.'];
    expect(revealLines(lines, 0)).toEqual(['']);
    expect(revealLines(lines, 4)).toEqual(['Hi M']);
    expect(revealLines(lines, 9)).toEqual(['Hi Maya,', '']);
    expect(revealLines(lines, typedLength(lines))).toEqual(lines);
  });

  it('advice names the letter and warns when it is cut off', () => {
    const cut = noteAdvice(60, 44, { fontSize: 26.4, needed: 14, available: 11, chosen: { needed: 20, available: 11 }, fits: false }, undefined, 'typed');
    expect(cut.tone).toBe('warn');
    expect(cut.text).toContain('cut off');
    const shrunk = noteAdvice(30, 44, { fontSize: 38, needed: 11, available: 11, chosen: { needed: 13, available: 11 }, fits: true }, undefined, 'typed');
    expect(shrunk.text).toContain('type shrinks to 38');
    expect(noteAdvice(20, 44, null, undefined, 'typed').text).toContain('letter');
  });
});

describe('safe portrait fallback', () => {
  const maya: Contact = { row: 2, first_name: 'Maya', last_name: 'Ng', company: 'Top End Solar', image_link: '/avatars/maya.svg' };
  const noah: Contact = { row: 3, first_name: 'Noah', last_name: 'Reid', company: 'Red Centre Logistics', image_link: '' };
  const withColumn = { avatarColumn: 'image_link', avatarUrl: 'https://example.com/me.jpg', avatarImage: 'data:image/png;base64,AAA' };

  it('uses the row portrait when it has one', () => {
    expect(rowPortraitSource(withColumn, maya)).toEqual({ source: '/avatars/maya.svg', from: 'column' });
    expect(rowPortraitSource(withColumn, { ...noah, [AVATAR_CACHE_FIELD]: 'data:image/png;base64,BBB' }).from).toBe('cache');
  });

  it('never puts the global headshot on a row of a list with a portrait column', () => {
    expect(portraitColumnInUse(withColumn)).toBe(true);
    expect(rowPortraitSource(withColumn, noah)).toEqual({ source: '', from: 'none' });
    // Even when the row has no such key at all.
    expect(rowPortraitSource(withColumn, { row: 9, first_name: 'Zoe' }).from).toBe('none');
  });

  it('uses the global headshot only when no portrait column is chosen', () => {
    const single = { ...withColumn, avatarColumn: '' };
    expect(portraitColumnInUse(single)).toBe(false);
    expect(rowPortraitSource(single, noah)).toEqual({ source: 'https://example.com/me.jpg', from: 'global' });
    expect(rowPortraitSource({ avatarColumn: undefined, avatarImage: 'data:image/png;base64,AAA' }, noah).from).toBe('global');
  });

  it('lists rows that will get a badge', () => {
    const rows = [maya, noah, { ...maya, row: 4, image_link: 'n/a' }];
    expect(rowsMissingPortrait(withColumn, rows)).toEqual([{ index: 1, row: 3 }, { index: 2, row: 4 }]);
    expect(rowsMissingPortrait({ ...withColumn, avatarColumn: '' }, rows)).toEqual([]);
    expect(rowsMissingPortrait({ avatarColumn: '' }, [noah])).toEqual([{ index: 0, row: 3 }]);
  });

  it('initials come from first and last name, else the name split, else the company', () => {
    expect(initialsFor(noah)).toBe('NR');
    expect(initialsFor({ row: 1, name: 'Priya van der Berg' })).toBe('PB');
    expect(initialsFor({ row: 1, first_name: 'Ethan' })).toBe('E');
    expect(initialsFor({ row: 1, company: 'Saltbush Studio' })).toBe('SS');
    expect(initialsFor({ row: 1 })).toBe('');
    expect(initialsFor({ row: 1, first_name: 'élodie', last_name: "O'Neil" })).toBe('ÉO');
  });

  it('badge colour is stable per company and from the app palette', () => {
    const a = badgeColorFor({ row: 1, company: 'Top End Solar', first_name: 'Maya' });
    const b = badgeColorFor({ row: 7, company: 'Top End Solar', first_name: 'Sam' });
    expect(a).toBe(b);
    expect(AVATAR_BADGE_COLORS).toContain(a);
    const colours = new Set(['Acme', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Stark', 'Wayne', 'Wonka'].map((company) => badgeColorFor({ row: 1, company })));
    expect(colours.size).toBeGreaterThan(2);
  });

  it('builds a site icon link only from a real host', () => {
    expect(companyHost({ websiteColumn: undefined }, { row: 1, website: 'https://www.topendsolar.com.au/about' })).toBe('topendsolar.com.au');
    expect(companyHost({ websiteColumn: 'site' }, { row: 1, site: 'saltbush.studio' })).toBe('saltbush.studio');
    expect(companyHost({}, { row: 1, website: 'n/a' })).toBe('');
    expect(companyHost({}, { row: 1, website: 'maya@topend.com' })).toBe('');
    expect(faviconUrlFor({}, { row: 1, website: 'topend.com' })).toBe('https://www.google.com/s2/favicons?domain=topend.com&sz=256');
    expect(faviconUrlFor({}, { row: 1 })).toBe('');
  });

  it('merges portrait and fit warnings per row', () => {
    expect(avatarRowWarnings([{ index: 3, row: 5 }, { index: 0, row: 2 }], [{ index: 3, row: 5 }])).toEqual([
      { index: 0, row: 2, problems: ['no portrait'] },
      { index: 3, row: 5, problems: ['no portrait', 'letter cut off'] },
    ]);
  });
});

describe('avatar still export', () => {
  it('defaults to JPG and keeps the user override', () => {
    expect(stillFormatFor({ mode: 'avatar', imageFormat: undefined })).toBe('jpg');
    expect(stillFormatFor({ mode: 'avatar', imageFormat: 'png' })).toBe('png');
    expect(stillFormatFor({ mode: 'memes', imageFormat: undefined })).toBe('png');
  });
});
