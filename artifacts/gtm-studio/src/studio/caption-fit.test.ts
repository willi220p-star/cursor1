import { describe, expect, it } from 'vitest';
import { CAPTION_LINE_HEIGHT, CAPTION_MIN_SCALE, captionBaselines, fitCaption, wrapCaption } from './caption-fit';
import { defaultConfig } from './defaults';
import { memeSamples } from './meme-samples';
import { zonesOverlap } from './types';

/** Every character is 0.5em wide. */
const mono = (text: string, fontSize: number) => text.length * fontSize * 0.5;
const box = { width: 600, height: 240, fontSize: 60, measure: mono };

describe('caption fit', () => {
  it('keeps the set size when short text fits', () => {
    const fit = fitCaption({ ...box, text: 'HEY AL' });
    expect(fit.fontSize).toBe(60);
    expect(fit.lines).toEqual(['HEY AL']);
    expect(fit.truncated).toBe(false);
    expect(fit.blockHeight).toBeCloseTo(60 * CAPTION_LINE_HEIGHT);
  });

  it('wraps before it shrinks', () => {
    // 30px per character at 60px: 20 characters per line.
    const fit = fitCaption({ ...box, text: 'ACME STILL SENDING THE SAME COLD EMAIL' });
    expect(fit.fontSize).toBe(60);
    expect(fit.lines.length).toBe(2);
    for (const line of fit.lines) expect(mono(line, fit.fontSize)).toBeLessThanOrEqual(box.width);
  });

  it('shrinks long text until it fits the width and height', () => {
    const text = 'Northern Territory Renewable Energy Holdings Pty Ltd still sending the same cold email.';
    const fit = fitCaption({ ...box, text });
    expect(fit.fontSize).toBeLessThan(60);
    expect(fit.fontSize).toBeGreaterThanOrEqual(60 * CAPTION_MIN_SCALE);
    expect(fit.truncated).toBe(false);
    expect(fit.lines.join(' ')).toBe(text);
    expect(fit.blockHeight).toBeLessThanOrEqual(box.height);
    for (const line of fit.lines) expect(mono(line, fit.fontSize)).toBeLessThanOrEqual(box.width);
  });

  it('never uses more than three lines, even in a tall box', () => {
    const text = Array.from({ length: 30 }, () => 'WORD').join(' ');
    const fit = fitCaption({ ...box, height: 2000, text });
    expect(fit.lines.length).toBeLessThanOrEqual(3);
    for (const line of fit.lines) expect(mono(line, fit.fontSize)).toBeLessThanOrEqual(box.width);
  });

  it('stops at the floor and ellipsizes only then', () => {
    const text = Array.from({ length: 80 }, (_, index) => `word${index}`).join(' ');
    const fit = fitCaption({ ...box, text });
    expect(fit.fontSize).toBeCloseTo(60 * CAPTION_MIN_SCALE);
    expect(fit.truncated).toBe(true);
    expect(fit.lines.length).toBe(3);
    expect(fit.lines[2]?.endsWith('…')).toBe(true);
    for (const line of fit.lines) expect(mono(line, fit.fontSize)).toBeLessThanOrEqual(box.width);
  });

  it('respects the box height at the floor', () => {
    const fit = fitCaption({ ...box, height: 60, text: 'one two three four five six seven eight nine ten '.repeat(4) });
    expect(fit.lines.length).toBe(2);
    expect(fit.blockHeight).toBeLessThanOrEqual(60);
    expect(fit.truncated).toBe(true);
  });

  it('shrinks a single very long word, then cuts it with an ellipsis', () => {
    // Fits after shrinking: 26 characters × 0.5em ≤ 600 → about 46px.
    const shrunk = fitCaption({ ...box, text: 'Featherstonehaughsonsworth' });
    expect(shrunk.fontSize).toBeLessThan(60);
    expect(shrunk.lines).toEqual(['Featherstonehaughsonsworth']);
    expect(shrunk.truncated).toBe(false);

    const word = 'X'.repeat(200);
    const cut = fitCaption({ ...box, text: word });
    expect(cut.lines.length).toBe(1);
    expect(cut.truncated).toBe(true);
    expect(cut.lines[0]?.endsWith('…')).toBe(true);
    expect(mono(cut.lines[0] ?? '', cut.fontSize)).toBeLessThanOrEqual(box.width);
  });

  it('keeps explicit line breaks', () => {
    expect(wrapCaption('TOP\nBOTTOM', 600, 60, mono)).toEqual(['TOP', 'BOTTOM']);
  });

  it('returns nothing to draw for empty text', () => {
    expect(fitCaption({ ...box, text: '   ' }).lines).toEqual([]);
  });

  it('centres the block in its box', () => {
    const fit = fitCaption({ ...box, text: 'HEY AL' });
    const [baseline] = captionBaselines(fit, 100, 240, 60 * 0.8, 60 * 0.2);
    const lineBox = 60 * CAPTION_LINE_HEIGHT;
    expect(baseline).toBeCloseTo(100 + (240 - lineBox) / 2 + (lineBox - 60) / 2 + 48);
  });
});

describe('meme templates', () => {
  it('start new memes on a real photo', () => {
    const config = defaultConfig('memes');
    expect(config.customImage).toMatch(/\/samples\//);
    expect(config.layers.length).toBeGreaterThan(0);
  });

  it('never stack caption boxes on top of each other', () => {
    const templates = [
      { id: 'memes default', layers: defaultConfig('memes').layers },
      { id: 'gif default', layers: defaultConfig('gif').layers },
      ...memeSamples,
    ];
    for (const template of templates) {
      template.layers.forEach((layer, index) => {
        expect(layer.x + layer.width, `${template.id} ${layer.id}`).toBeLessThanOrEqual(1.0001);
        expect(layer.y + layer.height, `${template.id} ${layer.id}`).toBeLessThanOrEqual(1.0001);
        for (const other of template.layers.slice(index + 1)) {
          expect(zonesOverlap(layer, other), `${template.id}: ${layer.id} overlaps ${other.id}`).toBe(false);
        }
      });
    }
  });
});
