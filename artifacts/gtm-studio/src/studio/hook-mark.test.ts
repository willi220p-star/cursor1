import { describe, expect, it } from 'vitest';
import { HOOK_CLOSE, HOOK_OPEN, hookWords, stripHookMarks } from './hook-mark';
import { missingTags, renderMerge, resolveHookColumn, safeFilename } from './merge';
import { countWords } from './note-advice';
import { checkRows } from './row-checks';
import type { Contact } from './types';

const hookLine = 'loved your post about the Darwin solar farm launch.';
const maya: Contact = { row: 2, name: 'Maya Nguyen', company: 'Top End Solar', hook: hookLine };
const copy = 'Hi {first_name}, {hook} Worth a chat?';
const sentinel = /[]/;

describe('{hook} merge tag', () => {
  it('reads a column named hook, or guesses icebreaker / personalization / first_line', () => {
    expect(renderMerge(copy, maya)).toBe(`Hi Maya, ${hookLine} Worth a chat?`);
    expect(renderMerge('{hook}', { row: 1, Icebreaker: 'saw the new depot' })).toBe('saw the new depot');
    expect(renderMerge('{hook}', { row: 1, personalization: 'congrats on the raise' })).toBe('congrats on the raise');
    expect(renderMerge('{hook}', { row: 1, first_name: 'Ana', first_line: 'love the rebrand' })).toBe('love the rebrand');
  });

  it('never guesses a link column or a first-name column', () => {
    expect(resolveHookColumn({ row: 1, webhook_url: 'https://x.test', first: 'Ana' })).toBe('');
  });

  it('uses the chosen column over any guess', () => {
    const row: Contact = { row: 1, hook: 'from hook', 'Personal note': 'from the chosen column' };
    expect(renderMerge('{hook}', row, { hookColumn: 'Personal note' })).toBe('from the chosen column');
    expect(renderMerge('{hook}', row)).toBe('from hook');
    // A chosen column this list does not have falls back to guessing.
    expect(renderMerge('{hook}', row, { hookColumn: 'missing' })).toBe('from hook');
  });

  it('uses the fallback when the hook cell is blank', () => {
    expect(renderMerge('{hook|loved what you are building.}', { row: 1, hook: '  ' })).toBe('loved what you are building.');
    expect(renderMerge('{hook|loved what you are building.}', { row: 1 })).toBe('loved what you are building.');
  });

  it('reports a blank hook with no fallback, and a missing hook column', () => {
    expect(missingTags(copy, { ...maya, hook: '' })).toEqual(['hook']);
    expect(missingTags(copy, { row: 3, name: 'Noah' })).toEqual(['hook']);
    expect(missingTags('{hook|a line}', { row: 3, hook: '' })).toEqual([]);
    expect(missingTags(copy, maya)).toEqual([]);
    expect(missingTags('{hook}', { row: 1, hook: '', notes: 'x' }, { hookColumn: 'notes' })).toEqual([]);
    expect(checkRows([{ ...maya, hook: '' }], copy)[0]?.problems).toEqual(['no hook']);
  });
});

describe('hook sentinels', () => {
  it('wraps the hook only when the renderer asks', () => {
    const marked = renderMerge(copy, maya, { markHook: true });
    expect(marked).toBe(`Hi Maya, ${HOOK_OPEN}${hookLine}${HOOK_CLOSE} Worth a chat?`);
    expect(stripHookMarks(marked)).toBe(renderMerge(copy, maya));
    // Blank hooks leave nothing to mark.
    expect(renderMerge('{hook}', { row: 1, hook: '' }, { markHook: true })).toBe('');
  });

  it('never shows up in text a person sees', () => {
    expect(renderMerge(copy, maya)).not.toMatch(sentinel);
    expect(safeFilename('{company}_{hook}', maya, 'png')).not.toMatch(sentinel);
    expect(countWords(renderMerge(copy, maya))).toBe(14);
    // Sentinels typed into a cell are dropped, so they cannot fake a hook.
    expect(renderMerge('{hook}', { row: 1, hook: `a${HOOK_OPEN}b` }, { markHook: true })).toBe(`${HOOK_OPEN}ab${HOOK_CLOSE}`);
  });

  it('finds the hook words mid-sentence and leaves edge punctuation out of the mark', () => {
    const { text, words } = hookWords(renderMerge('Hi {first_name}, I {hook} Worth a chat?', maya, { markHook: true }));
    expect(text).toBe(`Hi Maya, I ${hookLine} Worth a chat?`);
    const hooked = words.filter((word) => word.span === 0);
    expect(hooked.map((word) => word.text)).toEqual(hookLine.split(' '));
    const last = hooked[hooked.length - 1];
    expect(last.text.slice(last.from, last.to)).toBe('launch');
    expect(words.find((word) => word.text === 'Maya,')?.span).toBe(-1);
  });

  it('marks only the hook part of a word glued to punctuation', () => {
    const { words } = hookWords(renderMerge('Saw "{hook}", nice.', { row: 1, hook: 'the depot' }, { markHook: true }));
    expect(words.map((word) => [word.text, word.span, word.text.slice(word.from, word.to)])).toEqual([
      ['Saw', -1, ''],
      ['"the', 0, 'the'],
      ['depot",', 0, 'depot'],
      ['nice.', -1, ''],
    ]);
  });

  it('numbers each {hook} on its own', () => {
    const { words } = hookWords(renderMerge('{hook} and again {hook}', { row: 1, hook: 'solar' }, { markHook: true }));
    expect(words.map((word) => word.span)).toEqual([0, -1, -1, 1]);
  });
});
