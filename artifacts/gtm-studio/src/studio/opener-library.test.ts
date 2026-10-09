import { describe, expect, it } from 'vitest';
import { missingTags, normalizeHeader, renderMerge } from './merge';
import { countWords } from './note-advice';
import { openerCategories, openerLibrary, postscriptCategories, postscriptLibrary } from './opener-library';
import type { Contact } from './types';

const knownTags = ['first_name', 'name', 'company', 'city', 'role'];
const banned = [
  'i hope this finds you well',
  'hope this email finds you',
  'synergy',
  'synergies',
  'leverage',
  'revolutionary',
  'game-changer',
  'game changer',
  'circle back',
  'touch base',
  'low-hanging fruit',
  'cutting-edge',
  'best-in-class',
  'world-class',
  'disrupt',
  'just following up',
];

const emptyContact: Contact = { row: 2 };
const fullContacts: Contact[] = [
  { row: 2, name: 'Maya Nguyen', company: 'Top End Solar', city: 'Darwin', role: 'Director' },
  { row: 3, first_name: 'Sam', company: 'Harbour Freight Co', city: 'Hobart', role: 'Operations Manager' },
  { row: 7, name: 'Priya', company: 'Northside Dental', city: 'Brisbane', role: 'Practice Owner' },
];
const allEntries = [...openerLibrary, ...postscriptLibrary];

function tagsIn(text: string) {
  return [...text.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
}

describe('opener library content', () => {
  it('has about 25 openers across every category and about 12 P.S. lines', () => {
    expect(openerLibrary.length).toBeGreaterThanOrEqual(22);
    expect(postscriptLibrary.length).toBeGreaterThanOrEqual(10);
    for (const category of openerCategories) expect(openerLibrary.some((item) => item.category === category)).toBe(true);
    for (const category of postscriptCategories) expect(postscriptLibrary.some((item) => item.category === category)).toBe(true);
  });

  it('uses unique ids', () => {
    const ids = allEntries.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every opener between 15 and 40 words, even when rendered', () => {
    for (const item of openerLibrary) {
      for (const contact of [emptyContact, ...fullContacts]) {
        const words = countWords(renderMerge(item.body, contact));
        expect(words, `${item.id} for row ${contact.row}`).toBeGreaterThanOrEqual(15);
        expect(words, `${item.id} for row ${contact.row}`).toBeLessThanOrEqual(40);
      }
    }
  });

  it('keeps P.S. lines short and starting with P.S.', () => {
    for (const item of postscriptLibrary) {
      expect(item.body.startsWith('P.S. '), item.id).toBe(true);
      expect(countWords(item.body), item.id).toBeLessThanOrEqual(25);
    }
  });

  it('reads like a person: no buzzwords, exclamation marks or emojis, and contractions in openers', () => {
    for (const item of allEntries) {
      const text = `${item.title} ${item.body} ${item.why}`.toLowerCase();
      for (const phrase of banned) expect(text.includes(phrase), `${item.id} uses "${phrase}"`).toBe(false);
      expect(text.includes('!'), `${item.id} uses an exclamation mark`).toBe(false);
      expect(/\p{Extended_Pictographic}/u.test(text), `${item.id} uses an emoji`).toBe(false);
    }
    for (const item of openerLibrary) {
      expect(/\b\w+'(s|t|ll|ve|re|d|m)\b/i.test(item.body), `${item.id} has no contraction`).toBe(true);
    }
  });

  it('makes a single soft ask per opener', () => {
    for (const item of openerLibrary) {
      expect((item.body.match(/\?/g) ?? []).length, item.id).toBeLessThanOrEqual(1);
    }
  });

  it('gives every tag a fallback, or uses it as a greeting variation', () => {
    for (const item of allEntries) {
      for (const expression of tagsIn(item.body)) {
        const parts = expression.split('|').map((part) => part.trim());
        expect(parts.length, `${item.id}: {${expression}} needs a fallback`).toBeGreaterThanOrEqual(2);
        expect(parts.every(Boolean), `${item.id}: {${expression}} has an empty option`).toBe(true);
        const key = normalizeHeader(parts[0]);
        if (knownTags.includes(key)) continue;
        // A variation needs three or more options; two would be read as tag|fallback.
        expect(parts.length, `${item.id}: {${expression}} is not a known tag or a variation`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('uses greeting variations in several openers', () => {
    const varied = openerLibrary.filter((item) => tagsIn(item.body).some((expression) => expression.split('|').length >= 3));
    expect(varied.length).toBeGreaterThanOrEqual(5);
  });

  it('renders cleanly for an empty row and full rows', () => {
    for (const item of allEntries) {
      for (const contact of [emptyContact, ...fullContacts]) {
        const rendered = renderMerge(item.body, contact);
        expect(rendered, `${item.id} row ${contact.row}`).not.toMatch(/[{}]/);
        expect(rendered, `${item.id} row ${contact.row}`).not.toMatch(/ {2}/);
        expect(rendered, `${item.id} row ${contact.row}`).not.toMatch(/ [,.?]/);
        expect(missingTags(item.body, contact), `${item.id} row ${contact.row}`).toEqual([]);
      }
    }
  });

  it('fills the real values for a full row', () => {
    const opener = openerLibrary.find((item) => item.id === 'trigger-growth');
    expect(opener).toBeDefined();
    const rendered = renderMerge(opener!.body, fullContacts[0]);
    expect(rendered).toContain('Maya');
    expect(rendered).toContain('Top End Solar');
    expect(rendered).toContain('Darwin');
    expect(renderMerge(opener!.body, emptyContact)).toContain('your business');
  });

  it('writes a one-sentence why for every entry', () => {
    for (const item of allEntries) {
      expect(item.why.trim().endsWith('.'), item.id).toBe(true);
      expect(item.why.split(/[.?]\s/).length, item.id).toBe(1);
    }
  });
});
