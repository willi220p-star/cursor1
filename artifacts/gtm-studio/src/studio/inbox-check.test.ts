import { describe, expect, it } from 'vitest';
import {
  LEGIBLE_HANDWRITING_PX,
  checkSurfaces,
  displayWidth,
  effectiveSize,
  inboxSurfaces,
  senderFromSignature,
  sizeNeeded,
  suggestFix,
  summarizeChecks,
  verdictFor,
} from './inbox-check';
import { canvasSizes } from './types';

const card = canvasSizes.Card; // 1500 × 1000
const surface = (id: string) => inboxSurfaces.find((item) => item.id === id)!;

describe('inbox display width', () => {
  it('caps at the surface width and never upscales', () => {
    expect(displayWidth(surface('email-desktop'), card)).toBe(600);
    expect(displayWidth(surface('email-phone'), card)).toBe(330);
    expect(displayWidth(surface('email-desktop'), canvasSizes.Classic)).toBe(600);
    expect(displayWidth({ maxWidth: 600 }, { width: 400, height: 300 })).toBe(400);
  });

  it('caps tall images by height in chat previews', () => {
    // A4 is 1240 × 1754: 360 px high leaves about 255 px wide.
    expect(displayWidth(surface('dm'), canvasSizes.A4)).toBe(255);
    expect(displayWidth(surface('dm'), card)).toBe(330);
  });
});

describe('effective writing size', () => {
  it('scales the font size by display width over canvas width', () => {
    expect(effectiveSize(50, 1500, 600)).toBeCloseTo(20);
    expect(effectiveSize(50, 1500, 330)).toBeCloseTo(11);
  });

  it('gives the size needed to clear the threshold', () => {
    expect(sizeNeeded(14, 1500, 330)).toBe(64);
    expect(effectiveSize(64, 1500, 330)).toBeGreaterThanOrEqual(14);
  });

  it('rates at the threshold as OK and below as hard to read', () => {
    expect(verdictFor(LEGIBLE_HANDWRITING_PX, LEGIBLE_HANDWRITING_PX)).toBe('ok');
    expect(verdictFor(13.9, LEGIBLE_HANDWRITING_PX)).toBe('hard');
  });
});

describe('fix suggestions', () => {
  it('suggests raising the size when the note has room', () => {
    const fix = suggestFix('handwriting', { usedSize: 50, chosenSize: 50, needed: 4, available: 12, words: 20 }, card, 330, 'phone email');
    expect(fix.text).toBe('Raise size to 64.');
    expect(fix.action).toEqual({ key: 'fontSize', value: 64 });
  });

  it('suggests cutting words when bigger writing would not fit', () => {
    const fix = suggestFix('handwriting', { usedSize: 50, chosenSize: 50, needed: 10, available: 12, words: 60 }, card, 330, 'phone email');
    expect(fix.text).toMatch(/^Cut to about \d+ words and raise size to 64\.$/);
    const words = Number(fix.text.match(/about (\d+)/)![1]);
    expect(words).toBeLessThan(60);
    expect(words % 5).toBe(0);
  });

  it('only suggests cutting when the chosen size is big enough but the note shrank', () => {
    const fix = suggestFix('handwriting', { usedSize: 40, chosenSize: 70, needed: 12, available: 12, words: 70 }, card, 330, 'phone email');
    expect(fix.text).toMatch(/^Cut to about \d+ words so the writing stops shrinking\.$/);
    expect(fix.action).toBeUndefined();
  });

  it('says when no slider size is big enough', () => {
    const fix = suggestFix('handwriting', { usedSize: 50, chosenSize: 50 }, { width: 3000, height: 1000 }, 330, 'phone email');
    expect(fix.text).toMatch(/Even size 72 is too small/);
    expect(fix.action).toBeUndefined();
  });

  it('suggests a typed size for avatar text', () => {
    const fix = suggestFix('typed', { usedSize: 28, chosenSize: 28 }, canvasSizes.LinkedIn, 330, 'phone email');
    expect(fix.text).toBe('Raise size to 40.');
    expect(suggestFix('typed', { usedSize: 28, chosenSize: 28 }, card, 330, 'phone email').text).toMatch(/Even size 48/);
  });
});

describe('surface checks and summary', () => {
  it('rates every surface for a default note card', () => {
    const checks = checkSurfaces('handwriting', { usedSize: 50, chosenSize: 50, needed: 4, available: 12, words: 20 }, card);
    expect(checks.map((check) => check.verdict)).toEqual(['ok', 'hard', 'ok', 'hard']);
    expect(checks[0].xHeight).toBeCloseTo(9);
    const summary = summarizeChecks(checks)!;
    expect(summary.readable).toBe(2);
    expect(summary.text).toBe('Readable in 2 of 4 inboxes. Too small in phone email and LinkedIn-style DM.');
  });

  it('says all inboxes when every surface is readable', () => {
    const checks = checkSurfaces('handwriting', { usedSize: 70, chosenSize: 70 }, card);
    expect(summarizeChecks(checks)!.text).toBe('Readable in all 4 inboxes.');
  });

  it('skips the rating for studios without a text size', () => {
    const checks = checkSurfaces(null, null, card);
    expect(checks.every((check) => check.verdict === null)).toBe(true);
    expect(summarizeChecks(checks)).toBeNull();
  });
});

describe('sender name', () => {
  it('strips the leading dash from the sign-off', () => {
    expect(senderFromSignature('- Dilip')).toBe('Dilip');
    expect(senderFromSignature('— Sam Lee\nDGK')).toBe('Sam Lee');
    expect(senderFromSignature('')).toBe('You');
    expect(senderFromSignature(undefined)).toBe('You');
  });
});
