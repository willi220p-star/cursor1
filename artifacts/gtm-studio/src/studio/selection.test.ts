import { describe, expect, it } from 'vitest';
import {
  clear,
  clickSelect,
  deselectAll,
  emptySelection,
  headerState,
  orderedSelection,
  prune,
  selectAll,
  selectionKey,
  selectionShortcut,
  selectRange,
  toggle,
} from './selection';

const ordered = ['campaign-a', 'campaign-b', 'file-c', 'template-d', 'campaign-e'];
const keys = (selection: { keys: ReadonlySet<string> }) => [...selection.keys].sort();

describe('selection', () => {
  it('builds keys from kind and id', () => {
    expect(selectionKey('file', 'x1')).toBe('file-x1');
  });

  it('toggles one item and sets the anchor', () => {
    const one = toggle(emptySelection, 'file-c');
    expect(keys(one)).toEqual(['file-c']);
    expect(one.anchor).toBe('file-c');
    const none = toggle(one, 'file-c');
    expect(keys(none)).toEqual([]);
  });

  it('shift-click selects the range from the anchor, in either direction', () => {
    const start = toggle(emptySelection, 'campaign-b');
    expect(keys(selectRange(start, 'template-d', ordered))).toEqual(['campaign-b', 'file-c', 'template-d']);
    expect(keys(selectRange(start, 'campaign-a', ordered))).toEqual(['campaign-a', 'campaign-b']);
  });

  it('shift-click keeps the anchor so a second shift-click re-ranges', () => {
    let selection = toggle(emptySelection, 'campaign-a');
    selection = clickSelect(selection, 'file-c', ordered, true);
    expect(selection.anchor).toBe('campaign-a');
    selection = clickSelect(selection, 'campaign-e', ordered, true);
    expect(keys(selection)).toEqual(ordered.slice().sort());
  });

  it('shift-click on a selected item clears the range', () => {
    let selection = selectAll(emptySelection, ordered);
    selection = toggle(selection, 'campaign-b');
    selection = toggle(selection, 'campaign-b');
    selection = selectRange(selection, 'template-d', ordered);
    expect(keys(selection)).toEqual(['campaign-a', 'campaign-e']);
  });

  it('shift-click without an anchor (or anchor not visible) is a toggle', () => {
    expect(keys(selectRange(emptySelection, 'file-c', ordered))).toEqual(['file-c']);
    const hidden = toggle(emptySelection, 'campaign-zzz');
    expect(keys(selectRange(hidden, 'file-c', ordered))).toEqual(['campaign-zzz', 'file-c']);
  });

  it('select all adds to what is already selected; deselect all removes just those', () => {
    const outside = toggle(emptySelection, 'file-outside');
    const all = selectAll(outside, ordered.slice(0, 2));
    expect(keys(all)).toEqual(['campaign-a', 'campaign-b', 'file-outside']);
    expect(keys(deselectAll(all, ordered.slice(0, 2)))).toEqual(['file-outside']);
    expect(deselectAll(selectAll(emptySelection, ['x']), ['x']).anchor).toBeNull();
  });

  it('clear empties everything', () => {
    expect(keys(clear())).toEqual([]);
    expect(clear().anchor).toBeNull();
  });

  it('prune drops keys that are gone and keeps the same object when nothing changed', () => {
    const selection = selectAll(toggle(emptySelection, 'campaign-a'), ['file-c', 'file-gone']);
    const pruned = prune(selection, ordered);
    expect(keys(pruned)).toEqual(['campaign-a', 'file-c']);
    expect(prune(pruned, ordered)).toBe(pruned);
    expect(prune(toggle(emptySelection, 'x'), []).anchor).toBeNull();
  });

  it('header state is none, some (indeterminate) or all for the visible rows', () => {
    const visible = ordered.slice(0, 3);
    expect(headerState(emptySelection, visible)).toBe('none');
    expect(headerState(toggle(emptySelection, 'file-c'), visible)).toBe('some');
    expect(headerState(selectAll(emptySelection, visible), visible)).toBe('all');
    // Selected items in another folder still make the header indeterminate.
    expect(headerState(toggle(emptySelection, 'campaign-e'), visible)).toBe('some');
    expect(headerState(emptySelection, [])).toBe('none');
  });

  it('orders the selection like the list', () => {
    const selection = selectAll(emptySelection, ['campaign-e', 'campaign-a']);
    expect(orderedSelection(selection, ordered)).toEqual(['campaign-a', 'campaign-e']);
  });

  it('keyboard: Esc clears, Cmd/Ctrl+A selects visible, fields keep their keys', () => {
    expect(selectionShortcut({ key: 'Escape' })).toBe('clear');
    expect(selectionShortcut({ key: 'a', metaKey: true })).toBe('select-visible');
    expect(selectionShortcut({ key: 'A', ctrlKey: true })).toBe('select-visible');
    expect(selectionShortcut({ key: 'a' })).toBeNull();
    expect(selectionShortcut({ key: 'a', ctrlKey: true, shiftKey: true })).toBeNull();
    expect(selectionShortcut({ key: 'a', metaKey: true, target: { tagName: 'INPUT', type: 'search' } })).toBeNull();
    expect(selectionShortcut({ key: 'Escape', target: { tagName: 'TEXTAREA' } })).toBeNull();
    expect(selectionShortcut({ key: 'a', ctrlKey: true, target: { tagName: 'INPUT', type: 'checkbox' } })).toBe('select-visible');
  });
});
