import { describe, expect, it } from 'vitest';
import { applyRenamePattern, isoDate, patternChangesNames, RENAME_MAX, renderPattern } from './rename-pattern';

const date = new Date(2026, 9, 17, 9, 30);

describe('rename pattern', () => {
  it('fills every token', () => {
    expect(renderPattern('{client} – {name} #{n} ({date})', { name: 'Spring notes', client: 'Northwind' }, 3, date))
      .toBe('Northwind – Spring notes #3 (2026-10-17)');
  });

  it('tokens are case-insensitive and unknown tokens stay as typed', () => {
    expect(renderPattern('{NAME} {unknown}', { name: 'A' }, 1, date)).toBe('A {unknown}');
  });

  it('drops separators left by an empty client', () => {
    expect(renderPattern('{client} – {name}', { name: 'Spring notes' }, 1, date)).toBe('Spring notes');
    expect(renderPattern('{name} - {client}', { name: 'Spring notes', client: '  ' }, 1, date)).toBe('Spring notes');
    expect(renderPattern('{date} – {client} – {name}', { name: 'X' }, 1, date)).toBe('2026-10-17 – X');
  });

  it('falls back to the current name when the result is empty', () => {
    expect(renderPattern('{client}', { name: 'Keep me' }, 1, date)).toBe('Keep me');
    expect(renderPattern('   ', { name: 'Keep me' }, 1, date)).toBe('Keep me');
  });

  it('numbers in order from start', () => {
    const inputs = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
    expect(applyRenamePattern('Batch {n}', inputs, { date })).toEqual(['Batch 1', 'Batch 2', 'Batch 3']);
    expect(applyRenamePattern('Batch {n}', inputs, { date, start: 10 })).toEqual(['Batch 10', 'Batch 11', 'Batch 12']);
  });

  it('de-duplicates collisions inside the batch and with taken names', () => {
    const inputs = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
    expect(applyRenamePattern('Northwind', inputs, { date })).toEqual(['Northwind', 'Northwind (2)', 'Northwind (3)']);
    expect(applyRenamePattern('Northwind', inputs.slice(0, 2), { date, taken: ['northwind', 'Northwind (2)'] }))
      .toEqual(['Northwind (3)', 'Northwind (4)']);
  });

  it('keeps names within the limit, suffix included', () => {
    const long = 'x'.repeat(200);
    const [first, second] = applyRenamePattern('{name}', [{ name: long }, { name: long }], { date });
    expect(first).toHaveLength(RENAME_MAX);
    expect(second.length).toBeLessThanOrEqual(RENAME_MAX);
    expect(second.endsWith(' (2)')).toBe(true);
  });

  it('formats the local date', () => {
    expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('knows when a pattern changes nothing', () => {
    expect(patternChangesNames('{name}', [{ name: 'a' }], { date })).toBe(false);
    expect(patternChangesNames('', [{ name: 'a' }], { date })).toBe(false);
    expect(patternChangesNames('{name} v2', [{ name: 'a' }], { date })).toBe(true);
  });
});
