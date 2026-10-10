import { describe, expect, it } from 'vitest';
import { defaultConfig } from './defaults';
import { HOOK_OPEN, wrapHook } from './hook-mark';
import { configForRow, openerFor, rowVariant, variantFor } from './variants';
import { ALT_TEXT_MAX, altTextFor, cleanAltText, ensureOutputFields, exportListCsv, outputColumnNames, outputColumnsFor, stampStudioOutputs } from './writeback';
import type { Contact, GeneratedAsset, StudioConfig } from './types';

const rows = (count: number): Contact[] => Array.from({ length: count }, (_, index) => ({ row: index + 1, name: `Person ${index + 1}`, company: `Co ${index + 1}` }));

const withB = (extra: Partial<StudioConfig> = {}): StudioConfig => ({
  ...defaultConfig('handwritten'),
  copy: 'Hi {first_name}, loved {company}.',
  postscript: 'A quick idea for you.',
  signature: '— Dilip',
  openerId: 'trigger-hiring',
  copyVariantB: { copy: 'Hey {first_name}, quick one about {company}.', openerId: 'compliment-craft' },
  ...extra,
});

describe('A/B variant split', () => {
  it('splits a list 50/50 and alternates row by row', () => {
    const list = rows(200);
    const variants = list.map((row) => variantFor(row));
    expect(variants.filter((item) => item === 'B')).toHaveLength(100);
    expect(variants.slice(0, 4)).toEqual(['A', 'B', 'A', 'B']);
  });

  it('is stable for a row however the list is ordered or filtered', () => {
    const list = rows(50);
    const before = new Map(list.map((row) => [row.row, variantFor(row)]));
    const shuffled = [...list].reverse().filter((row) => row.row % 3 !== 0);
    for (const row of shuffled) expect(variantFor(row)).toBe(before.get(row.row));
    expect(variantFor({ row: 7 })).toBe(variantFor({ row: 7 }));
  });

  it('keeps every row on A until variant B has copy', () => {
    const plain = defaultConfig('handwritten');
    expect(rowVariant(plain, { row: 2 })).toBe('A');
    expect(rowVariant({ ...plain, copyVariantB: { copy: '   ' } }, { row: 2 })).toBe('A');
    expect(configForRow(plain, { row: 2 })).toBe(plain);
  });

  it('swaps the copy for B rows and keeps A rows untouched', () => {
    const config = withB();
    expect(configForRow(config, { row: 1 })).toBe(config);
    const b = configForRow(config, { row: 2 });
    expect(b.copy).toBe(config.copyVariantB?.copy);
    expect(b.postscript).toBe('A quick idea for you.');
    expect(configForRow(withB({ copyVariantB: { copy: 'B copy', postscript: 'B P.S.' } }), { row: 4 }).postscript).toBe('B P.S.');
  });

  it('names the opener per row, or custom', () => {
    const config = withB();
    expect(openerFor(config, { row: 1 })).toBe('trigger-hiring');
    expect(openerFor(config, { row: 2 })).toBe('compliment-craft');
    expect(openerFor({ ...config, openerId: undefined, copyVariantB: { copy: 'B' } }, { row: 1 })).toBe('custom');
    expect(openerFor({ ...config, openerId: undefined, copyVariantB: { copy: 'B' } }, { row: 2 })).toBe('custom');
  });
});

describe('alt text', () => {
  const maya: Contact = { row: 1, name: 'Maya Nguyen', company: 'Top End Solar', hook: 'your Darwin rooftop rollout' };

  it('reads the merged note, sign-off and P.S. as one clean line', () => {
    const config = withB({ copy: 'Hi {first_name},\n\n  loved {hook}.\n', copyVariantB: undefined });
    expect(altTextFor(config, maya)).toBe('Hi Maya, loved your Darwin rooftop rollout. — Dilip P.S. A quick idea for you.');
  });

  it('uses the B copy on B rows', () => {
    expect(altTextFor(withB(), { ...maya, row: 2 })).toMatch(/^Hey Maya, quick one about Top End Solar\./);
  });

  it('never leaks braces or hook sentinels', () => {
    const config = withB({ copy: `Hi {first_name}, {unknown_tag} about {company}. ${wrapHook('x')}`, copyVariantB: undefined });
    const alt = altTextFor(config, maya);
    expect(alt).not.toMatch(/[{}]/);
    expect(alt).not.toContain(HOOK_OPEN);
  });

  it('joins merged caption layers for memes', () => {
    const config = defaultConfig('memes');
    config.layers = [
      { ...config.layers[0], text: 'When {company}' },
      { ...config.layers[0], id: 'b', text: 'replies   first' },
    ];
    expect(altTextFor(config, maya, 'memes')).toBe('When Top End Solar replies first');
  });

  it('reads the avatar letter with its list message', () => {
    const config = { ...defaultConfig('avatar'), copy: 'Hi {first_name}.', message: '{msg|}', messageColumn: 'note', signature: 'Dilip', postscript: '' };
    expect(altTextFor(config, { ...maya, note: 'Saw the launch.' }, 'avatar')).toBe('Hi Maya. Saw the launch. Dilip');
  });

  it('stays under the limit and cuts on a word', () => {
    const long = cleanAltText('word '.repeat(200));
    expect(long.length).toBeLessThanOrEqual(ALT_TEXT_MAX);
    expect(long.endsWith('word…')).toBe(true);
  });
});

describe('alt, variant and opener columns', () => {
  const asset = (row: number): GeneratedAsset => ({ id: `a${row}`, row, filename: `note_${row}.jpg`, blob: new Blob(), url: '', bytes: 10, selected: true, status: 'ready' });

  it('names one column set per studio', () => {
    expect(outputColumnsFor('handwritten')).toMatchObject({ alt: 'handwritten_alt', variant: 'handwritten_variant', opener: 'handwritten_opener' });
    expect(outputColumnsFor('memes').alt).toBe('meme_alt');
    expect(outputColumnsFor('memes').variant).toBeUndefined();
    expect(outputColumnNames('handgif')).toContain('handwriting_gif_alt');
  });

  it('stamps them per row and exports them in the CSV', () => {
    const list = rows(4);
    const stamped = stampStudioOutputs(list, list.map((row) => asset(row.row)), 'handwritten', withB());
    expect(stamped.map((row) => row.handwritten_variant)).toEqual(['A', 'B', 'A', 'B']);
    expect(stamped.map((row) => row.handwritten_opener)).toEqual(['trigger-hiring', 'compliment-craft', 'trigger-hiring', 'compliment-craft']);
    expect(stamped[1].handwritten_alt).toMatch(/^Hey Person, quick one about Co 2\./);
    const { csv } = exportListCsv(stamped, { campaignName: 'Test', sourceColumns: ['name', 'company'] }, 'handwritten');
    const header = csv.split('\n')[0];
    for (const column of ['handwritten_alt', 'handwritten_variant', 'handwritten_opener']) expect(header).toContain(column);
  });

  it('adds them to the field map outputs', () => {
    const map = ensureOutputFields([], 'handwritten').map((item) => item.column);
    expect(map).toEqual(expect.arrayContaining(['handwritten_alt', 'handwritten_variant', 'handwritten_opener']));
  });
});
