/**
 * Library multi-select, kept pure so it can be tested without React. Keys are `${kind}-${id}`.
 * The anchor is the last item clicked without Shift; Shift-click selects everything between the
 * anchor and the clicked item in the visible order.
 */

export type SelectionKey = string;

export interface Selection {
  readonly keys: ReadonlySet<SelectionKey>;
  readonly anchor: SelectionKey | null;
}

export const emptySelection: Selection = { keys: new Set(), anchor: null };

export const selectionKey = (kind: string, id: string): SelectionKey => `${kind}-${id}`;

export function isSelected(selection: Selection, key: SelectionKey) {
  return selection.keys.has(key);
}

/** Flips one item and makes it the anchor for the next Shift-click. */
export function toggle(selection: Selection, key: SelectionKey): Selection {
  const keys = new Set(selection.keys);
  if (keys.has(key)) keys.delete(key);
  else keys.add(key);
  return { keys, anchor: key };
}

/**
 * Shift-click: every item between the anchor and `key` (inclusive, in `ordered`) takes the state the
 * clicked item is about to get. Without a usable anchor it behaves like a plain toggle.
 */
export function selectRange(selection: Selection, key: SelectionKey, ordered: readonly SelectionKey[]): Selection {
  const from = selection.anchor ? ordered.indexOf(selection.anchor) : -1;
  const to = ordered.indexOf(key);
  if (from < 0 || to < 0) return toggle(selection, key);
  const select = !selection.keys.has(key);
  const keys = new Set(selection.keys);
  const [start, end] = from <= to ? [from, to] : [to, from];
  for (let index = start; index <= end; index += 1) {
    if (select) keys.add(ordered[index]);
    else keys.delete(ordered[index]);
  }
  // The anchor stays put so a second Shift-click re-ranges from the same start.
  return { keys, anchor: selection.anchor };
}

/** One click on a row checkbox, with or without Shift. */
export function clickSelect(selection: Selection, key: SelectionKey, ordered: readonly SelectionKey[], shift = false): Selection {
  return shift ? selectRange(selection, key, ordered) : toggle(selection, key);
}

/** Adds every given key (the visible rows, or every row matching the filter). */
export function selectAll(selection: Selection, keys: Iterable<SelectionKey>): Selection {
  const next = new Set(selection.keys);
  for (const key of keys) next.add(key);
  return { keys: next, anchor: selection.anchor };
}

/** Removes the given keys (used by the header checkbox when everything visible is selected). */
export function deselectAll(selection: Selection, keys: Iterable<SelectionKey>): Selection {
  const next = new Set(selection.keys);
  for (const key of keys) next.delete(key);
  return { keys: next, anchor: next.size ? selection.anchor : null };
}

export function clear(): Selection {
  return emptySelection;
}

/** Drops keys for items that no longer exist (deleted, moved to Trash, gone after reload). */
export function prune(selection: Selection, present: Iterable<SelectionKey>): Selection {
  const live = new Set(present);
  let changed = false;
  const keys = new Set<SelectionKey>();
  for (const key of selection.keys) {
    if (live.has(key)) keys.add(key);
    else changed = true;
  }
  const anchor = selection.anchor && live.has(selection.anchor) ? selection.anchor : null;
  if (!changed && anchor === selection.anchor) return selection;
  return { keys, anchor };
}

export type HeaderState = 'none' | 'some' | 'all';

/** The header checkbox: all visible selected, some (indeterminate) or none. */
export function headerState(selection: Selection, visible: readonly SelectionKey[]): HeaderState {
  if (!visible.length) return 'none';
  let count = 0;
  for (const key of visible) if (selection.keys.has(key)) count += 1;
  if (count === 0) return selection.keys.size ? 'some' : 'none';
  return count === visible.length ? 'all' : 'some';
}

/** The selected keys in the given order (for stable bulk targets and previews). */
export function orderedSelection(selection: Selection, ordered: readonly SelectionKey[]): SelectionKey[] {
  return ordered.filter((key) => selection.keys.has(key));
}

type KeyLike = { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; target?: unknown };

/** Typing in a field keeps its own Esc and ⌘A. */
function inField(target: unknown) {
  const element = target as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = element?.tagName?.toUpperCase();
  return Boolean(element?.isContentEditable || (tag === 'INPUT' && (target as HTMLInputElement).type !== 'checkbox') || tag === 'TEXTAREA' || tag === 'SELECT');
}

export type SelectionShortcut = 'select-visible' | 'clear' | null;

/** Esc clears; ⌘A / Ctrl+A selects the visible rows. Ignored while typing in a field. */
export function selectionShortcut(event: KeyLike): SelectionShortcut {
  if (inField(event.target)) return null;
  if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey) return 'clear';
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') return 'select-visible';
  return null;
}
