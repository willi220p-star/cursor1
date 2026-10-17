import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Folder, RotateCcw, Trash2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { reportError } from '@/lib/report';
import { useAccess } from '@/studio/access-context';
import { entityLabel, kindForEntity, listTrash, runBulk, trashDaysLeft, type TrashItem } from '@/studio/bulk';
import type { BulkTarget } from '@/studio/contracts';
import { clear, clickSelect, deselectAll, emptySelection, headerState, prune, selectAll, selectionKey, selectionShortcut, type Selection } from '@/studio/selection';

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const keyOf = (item: Pick<TrashItem, 'entity' | 'id'>) => selectionKey(kindForEntity(item.entity), item.id);
const kindLabel = (entity: TrashItem['entity']) => {
  const label = entityLabel(entity, 1);
  return label.charAt(0).toUpperCase() + label.slice(1);
};
const target = (item: TrashItem): BulkTarget => ({ entity: item.entity, id: item.id, name: item.name });

/** Library "Trash": items deleted in the last TRASH_DAYS days, with Restore and (staff) Delete forever. */
export function TrashView({ userId, revision, needle }: { userId?: string; revision: number; needle: string }) {
  const { can } = useAccess();
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reload, setReload] = useState(0);
  const headerBox = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    listTrash(userId)
      .then((result) => {
        if (!live) return;
        setItems(result.items);
        setFailed(result.failed);
      })
      .catch((error) => {
        reportError(error, { area: 'library', list: 'trash' });
        if (live) {
          setItems([]);
          setFailed(['trash']);
        }
      });
    return () => { live = false; };
  }, [userId, revision, reload]);

  const visible = useMemo(
    () => (items ?? []).filter((item) => !needle || `${item.name} ${entityLabel(item.entity, 1)}`.toLowerCase().includes(needle)),
    [items, needle],
  );
  const visibleKeys = useMemo(() => visible.map(keyOf), [visible]);
  useEffect(() => setSelection((current) => prune(current, (items ?? []).map(keyOf))), [items]);

  const selected = visible.filter((item) => selection.keys.has(keyOf(item)));
  const header = headerState(selection, visibleKeys);
  useEffect(() => {
    if (headerBox.current) headerBox.current.indeterminate = header === 'some';
  }, [header]);

  const canRestore = selected.every((item) => can('item.edit', item.spaceId));
  const canPurge = selected.every((item) => can('item.purge', item.spaceId));
  const purgeAllowedAnywhere = can('item.purge', null);

  // The Library refreshes itself (and bumps `revision`) after any bulk action that lands.
  const done = () => setSelection(clear());

  const restore = async () => {
    if (!selected.length || busy) return;
    setBusy(true);
    try {
      await runBulk({ kind: 'restore' }, selected.map(target), { onDone: done });
    } finally {
      setBusy(false);
    }
  };

  const purge = async () => {
    if (!selected.length || busy) return;
    setConfirming(false);
    setBusy(true);
    try {
      await runBulk({ kind: 'purge' }, selected.map(target), { onDone: done });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-3"
      data-trash-view
      onKeyDown={(event) => {
        const shortcut = selectionShortcut(event);
        if (shortcut === 'clear' && selection.keys.size) {
          event.preventDefault();
          setSelection(clear());
        } else if (shortcut === 'select-visible') {
          event.preventDefault();
          setSelection((current) => selectAll(current, visibleKeys));
        }
      }}
    >
      {failed.length > 0 && (
        <div className="load-error" role="alert">
          <span>Could not load trashed {failed.join(', ')}. Nothing has been deleted.</span>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setReload((value) => value + 1)}>Retry</button>
        </div>
      )}
      {items === null ? (
        <div className="group-list space-y-3 p-4" aria-busy="true" aria-label="Loading Trash">
          {[0, 1, 2].map((row) => <div key={row} className="h-11 animate-pulse rounded-[12px] bg-surface-2" />)}
        </div>
      ) : visible.length ? (
        <>
          <div className="flex min-h-11 items-center gap-2 px-1 text-sm">
            <label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2">
              <input
                ref={headerBox}
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={header === 'all'}
                aria-label="Select all in Trash"
                onChange={() => setSelection((current) => (header === 'all' ? deselectAll(current, visibleKeys) : selectAll(current, visibleKeys)))}
              />
              <span className="font-medium">Select</span>
            </label>
            <span className="text-muted-foreground">Items are deleted forever 30 days after they were moved here.</span>
          </div>
          <ul className="group-list max-h-[640px] overflow-y-auto">
            {visible.map((item) => {
              const key = keyOf(item);
              const checked = selection.keys.has(key);
              const days = trashDaysLeft(item.deletedAt);
              return (
                <li
                  key={key}
                  className="group-row"
                  data-trash-kind={item.entity}
                  data-trash-name={item.name}
                  data-selected={checked || undefined}
                  onClick={(event) => setSelection((current) => clickSelect(current, key, visibleKeys, event.shiftKey))}
                >
                  <label className="-ml-2 inline-flex size-11 flex-none cursor-pointer items-center justify-center" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={checked}
                      aria-label={`Select ${item.name}`}
                      onChange={(event) => {
                        // React fires a checkbox's change from the native click, which carries Shift.
                        const shift = (event.nativeEvent as MouseEvent).shiftKey === true;
                        setSelection((current) => clickSelect(current, key, visibleKeys, shift));
                      }}
                    />
                  </label>
                  <span className="item-mark" data-studio="file" aria-hidden>
                    {item.entity === 'folder' ? <Folder size={18} /> : <FileText size={18} />}
                  </span>
                  <span className="item-text">
                    <span className="item-title"><strong title={item.name}>{item.name}</strong></span>
                    <small data-trash-meta>
                      {kindLabel(item.entity)} · Deleted by {item.deletedByName ?? 'someone'} · {days === 0 ? 'deleted forever today' : `${plural(days, 'day')} left`}
                    </small>
                  </span>
                  <span className="item-when" title={new Date(item.deletedAt).toLocaleString()}>{new Date(item.deletedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div className="group-list empty-state">
          <Trash2 size={24} className="text-muted-foreground" aria-hidden />
          <h3>{needle ? 'Nothing in Trash matches that' : 'Trash is empty'}</h3>
          <p>Deleted campaigns, templates, files and folders stay here for 30 days, so you can restore them.</p>
        </div>
      )}

      {selected.length > 0 && (
        <div role="toolbar" aria-label="Trash actions" data-bulk-bar className="sticky bottom-3 z-30 flex flex-wrap items-center gap-2 rounded-[18px] border border-border bg-popover px-3 py-2 shadow-[var(--shadow-overlay)]">
          <span className="mr-1 text-sm font-semibold" aria-live="polite" data-bulk-count>{selected.length} selected</span>
          <button type="button" className="btn btn-ghost btn-sm min-h-11 sm:min-h-9" onClick={() => setSelection(clear())} aria-label="Clear selection">
            <X size={15} aria-hidden /> Clear
          </button>
          <span className="inline-flex" title={canRestore ? undefined : 'You can only view some of these items.'}>
            <button type="button" className="btn btn-quiet btn-sm min-h-11 sm:min-h-9" disabled={busy || !canRestore} onClick={() => void restore()}>
              <RotateCcw size={15} aria-hidden /> Restore
            </button>
          </span>
          {purgeAllowedAnywhere && (
            <span className="inline-flex" title={canPurge ? undefined : 'Only the DGK team can delete items forever.'}>
              <button type="button" className="btn btn-quiet btn-sm min-h-11 text-destructive sm:min-h-9" disabled={busy || !canPurge} onClick={() => setConfirming(true)}>
                <Trash2 size={15} aria-hidden /> Delete forever
              </button>
            </span>
          )}
        </div>
      )}

      <Dialog open={confirming} onOpenChange={(open) => { if (!open) setConfirming(false); }}>
        <DialogContent className="rounded-[12px] border-border bg-card" data-purge-dialog>
          <DialogHeader>
            <DialogTitle className="display pr-8 text-2xl font-semibold">Delete {plural(selected.length, 'item')} forever?</DialogTitle>
            <DialogDescription>
              {plural(selected.length, 'item')} and {selected.length === 1 ? 'its' : 'their'} stored files will be removed for good. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)}>Cancel</button>
            <button type="button" className="btn btn-danger" onClick={() => void purge()}>
              <Trash2 size={16} aria-hidden /> Delete {plural(selected.length, 'item')} forever
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
