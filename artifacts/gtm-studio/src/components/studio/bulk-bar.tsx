import { useMemo, useState, type ReactNode } from 'react';
import { Building2, CircleDot, Download, FolderInput, Pencil, Tags, Trash2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { statusLabels, type CampaignStatus } from '@/studio/campaign-status';
import { entityLabel, renameNames, skippedMessage, splitSupported, supports, type RenameContext } from '@/studio/bulk';
import type { BulkAction, BulkTarget, Can, LibraryEntity, Space } from '@/studio/contracts';
import { RENAME_TOKENS } from '@/studio/rename-pattern';

/** One selected Library row, as the bulk bar needs it. */
export interface BulkItem extends BulkTarget {
  key: string;
  /** null when the row has no space yet (before team spaces) or is team-wide (templates). */
  spaceId: string | null;
  folderId: string | null;
  client?: string;
  tags?: string[];
}

export interface BulkFolder {
  id: string;
  name: string;
  spaceId?: string | null;
}

const RENAME_PREVIEW = 5;

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Why an action cannot run for this selection, or null when it can. */
function blockedReason(items: readonly BulkItem[], action: BulkAction | { kind: 'download' }, permission: string | null): string | null {
  if (permission) return permission;
  const { supported, skipped } = splitSupported(action, items);
  if (supported.length) return null;
  const kinds = (Object.keys(skipped) as LibraryEntity[]).map((entity) => entityLabel(entity));
  return `Not supported for ${kinds.join(' or ')}`;
}

/** A hint like "3 templates skipped" shown under an action when part of the selection does not apply. */
function skipHint(items: readonly BulkItem[], action: BulkAction | { kind: 'download' }) {
  const { supported, skipped } = splitSupported(action, items);
  return supported.length ? skippedMessage(skipped) : '';
}

function parseTags(value: string) {
  return [...new Set(value.split(',').map((tag) => tag.trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean))];
}

export function BulkBar({
  items,
  folders,
  spaces,
  showSpaces,
  can,
  busy,
  renameContext,
  onRun,
  onDownload,
  onTrash,
  onClear,
}: {
  items: BulkItem[];
  folders: BulkFolder[];
  spaces: Space[];
  /** Staff, or more than one space to choose from. */
  showSpaces: boolean;
  can: Can;
  busy: boolean;
  renameContext: RenameContext;
  onRun: (action: BulkAction) => void;
  onDownload: () => void;
  onTrash: () => void;
  onClear: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [tagging, setTagging] = useState(false);

  const count = items.length;
  const spaceIds = [...new Set(items.map((item) => item.spaceId))];
  const oneSpace = spaceIds.length <= 1 ? spaceIds[0] ?? null : undefined;
  const noEdit = items.filter((item) => !can('item.edit', item.spaceId));
  const noDownload = items.filter((item) => !can('item.download', item.spaceId));
  const editBlocked = noEdit.length
    ? `You can only view ${noEdit.length === count ? 'these items' : plural(noEdit.length, 'of the selected items', 'of the selected items')}. Ask a team member to change them.`
    : null;
  const downloadBlocked = noDownload.length ? 'You cannot download some of the selected items.' : null;

  // Only folders in the selection's space; a selection across spaces cannot share a folder.
  const moveFolders = oneSpace === undefined ? [] : folders.filter((folder) => folder.spaceId == null || oneSpace == null || folder.spaceId === oneSpace);
  const moveBlocked = editBlocked ?? (oneSpace === undefined ? 'The selected items are in different client spaces. Select items from one space to move them to a folder.' : null);
  const liveSpaces = spaces.filter((space) => !space.archived_at);

  const statusAction: BulkAction = { kind: 'update', patch: { status: 'generated' } };
  const spaceAction: BulkAction = { kind: 'move', folderId: null, spaceId: liveSpaces[0]?.id ?? 'any' };
  const moveAction: BulkAction = { kind: 'move', folderId: null };

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      data-bulk-bar
      className="bulk-bar sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 flex w-full max-w-full items-center gap-2 overflow-x-auto overscroll-x-contain rounded-[18px] border border-border bg-popover px-3 py-2 shadow-[var(--shadow-overlay)] [scrollbar-width:none] sm:mx-auto sm:max-w-[720px] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden"
    >
      <span className="mr-1 flex-none whitespace-nowrap text-sm font-semibold" aria-live="polite" data-bulk-count>{count} selected</span>
      <button type="button" className="btn btn-ghost btn-sm min-h-11 flex-none sm:min-h-9" onClick={onClear} aria-label="Clear selection">
        <X size={15} aria-hidden /> Clear
      </button>
      <span className="mx-1 h-6 w-px flex-none bg-border" aria-hidden />

      <Action reason={blockedReason(items, moveAction, moveBlocked)}>
        {(disabled) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="btn btn-quiet btn-sm min-h-11 sm:min-h-9" disabled={disabled || busy}>
                <FolderInput size={15} aria-hidden /> Move
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 min-w-48 overflow-y-auto border-border bg-card">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Move to folder</DropdownMenuLabel>
              <DropdownMenuItem className="min-h-11" onSelect={() => onRun({ kind: 'move', folderId: null })}>Library (no folder)</DropdownMenuItem>
              {moveFolders.map((folder) => (
                <DropdownMenuItem key={folder.id} className="min-h-11" onSelect={() => onRun({ kind: 'move', folderId: folder.id })}>
                  {folder.name}
                </DropdownMenuItem>
              ))}
              {!moveFolders.length && <DropdownMenuItem className="min-h-11" disabled>No folders in this space</DropdownMenuItem>}
              {skipHint(items, moveAction) && <p className="px-2 py-1 text-xs text-muted-foreground">{skipHint(items, moveAction)}</p>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </Action>

      {showSpaces && liveSpaces.length > 0 && (
        <Action reason={blockedReason(items, spaceAction, editBlocked)}>
          {(disabled) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="btn btn-quiet btn-sm min-h-11 sm:min-h-9" disabled={disabled || busy}>
                  <Building2 size={15} aria-hidden /> Client space
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 min-w-48 overflow-y-auto border-border bg-card">
                <DropdownMenuLabel className="text-xs text-muted-foreground">Move to client space</DropdownMenuLabel>
                {liveSpaces.map((space) => (
                  <DropdownMenuItem
                    key={space.id}
                    className="min-h-11"
                    disabled={oneSpace === space.id || !can('item.edit', space.id)}
                    onSelect={() => onRun({ kind: 'move', folderId: null, spaceId: space.id })}
                  >
                    {space.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <p className="max-w-60 px-2 py-1 text-xs text-muted-foreground">
                  Items land outside any folder in the new space.{skipHint(items, spaceAction) ? ` ${skipHint(items, spaceAction)}.` : ''}
                </p>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </Action>
      )}

      <Action reason={blockedReason(items, statusAction, editBlocked)}>
        {(disabled) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="btn btn-quiet btn-sm min-h-11 sm:min-h-9" disabled={disabled || busy}>
                <CircleDot size={15} aria-hidden /> Status
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-44 border-border bg-card">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Set campaign status</DropdownMenuLabel>
              {/* Draft only means "nothing has happened yet", so it can't be set. */}
              {(Object.keys(statusLabels) as CampaignStatus[]).filter((status) => status !== 'draft').map((status) => (
                <DropdownMenuItem key={status} className="min-h-11" onSelect={() => onRun({ kind: 'update', patch: { status } })}>
                  {statusLabels[status]}
                </DropdownMenuItem>
              ))}
              {skipHint(items, statusAction) && <p className="max-w-60 px-2 py-1 text-xs text-muted-foreground">{skipHint(items, statusAction)}</p>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </Action>

      <Action reason={blockedReason(items, statusAction, editBlocked)}>
        {(disabled) => (
          <button type="button" className="btn btn-quiet btn-sm min-h-11 sm:min-h-9" disabled={disabled || busy} onClick={() => setTagging(true)}>
            <Tags size={15} aria-hidden /> Tags
          </button>
        )}
      </Action>

      <Action reason={editBlocked}>
        {(disabled) => (
          <button type="button" className="btn btn-quiet btn-sm min-h-11 sm:min-h-9" disabled={disabled || busy} onClick={() => setRenaming(true)}>
            <Pencil size={15} aria-hidden /> Rename…
          </button>
        )}
      </Action>

      <Action reason={blockedReason(items, { kind: 'download' }, downloadBlocked)}>
        {(disabled) => (
          <button type="button" className="btn btn-quiet btn-sm min-h-11 sm:min-h-9" disabled={disabled || busy} onClick={onDownload}>
            <Download size={15} aria-hidden /> Download ZIP
          </button>
        )}
      </Action>

      <Action reason={editBlocked}>
        {(disabled) => (
          <button type="button" className="btn btn-quiet btn-sm min-h-11 text-destructive sm:min-h-9" disabled={disabled || busy} onClick={onTrash}>
            <Trash2 size={15} aria-hidden /> Delete
          </button>
        )}
      </Action>

      <RenameDialog open={renaming} items={items} context={renameContext} onClose={() => setRenaming(false)} onRename={(pattern) => { setRenaming(false); onRun({ kind: 'rename', pattern }); }} />
      <TagsDialog open={tagging} items={items} onClose={() => setTagging(false)} onSave={(patch) => { setTagging(false); onRun({ kind: 'update', patch }); }} />
    </div>
  );
}

/** Wraps an action so a disabled button still explains itself on hover (disabled buttons get no hover events). */
function Action({ reason, children }: { reason: string | null; children: (disabled: boolean) => ReactNode }) {
  return (
    <span className="inline-flex flex-none" title={reason ?? undefined} data-blocked={reason ? 'true' : undefined}>
      {children(Boolean(reason))}
    </span>
  );
}

function RenameDialog({
  open,
  items,
  context,
  onClose,
  onRename,
}: {
  open: boolean;
  items: BulkItem[];
  context: RenameContext;
  onClose: () => void;
  onRename: (pattern: string) => void;
}) {
  const [pattern, setPattern] = useState('{name}');
  // Same date for preview and run, so {date} cannot change between them at midnight.
  const preview = useMemo(() => {
    if (!open) return [];
    const names = renameNames(pattern, items, context);
    return items.map((item) => ({ item, next: names[item.id] ?? item.name }));
  }, [open, pattern, items, context]);
  const changes = preview.filter(({ item, next }) => next !== item.name).length;

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="rounded-[12px] border-border bg-card" data-rename-dialog>
        <DialogHeader>
          <DialogTitle className="display text-2xl font-semibold">Rename {plural(items.length, 'item')}</DialogTitle>
          <DialogDescription>
            Build the new names from a pattern. Names that clash get “(2)”, “(3)” at the end.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (changes) onRename(pattern);
          }}
        >
          <label className="label" htmlFor="bulk-rename-pattern">Pattern</label>
          <input id="bulk-rename-pattern" className="field" value={pattern} autoFocus autoComplete="off" maxLength={160} onChange={(event) => setPattern(event.target.value)} />
          <div className="flex flex-wrap gap-1" role="group" aria-label="Insert a token">
            {RENAME_TOKENS.map((token) => (
              <button key={token} type="button" className="chip min-h-9" onClick={() => setPattern((value) => `${value}${token}`)}>{token}</button>
            ))}
            <button type="button" className="chip min-h-9" onClick={() => setPattern('{client} – {name}')}>{'{client} – {name}'}</button>
          </div>
          <ul className="max-h-48 overflow-y-auto rounded-[12px] border border-border text-sm" aria-label="Preview" data-rename-preview>
            {preview.slice(0, RENAME_PREVIEW).map(({ item, next }) => (
              <li key={item.key} className="flex min-w-0 flex-col border-b border-border px-3 py-2 last:border-b-0">
                {next !== item.name && <span className="truncate text-muted-foreground line-through decoration-1" title={item.name}>{item.name}</span>}
                <span className="truncate font-medium" title={next}>{next}{next === item.name && <span className="font-normal text-muted-foreground"> · unchanged</span>}</span>
              </li>
            ))}
          </ul>
          {items.length > RENAME_PREVIEW && <p className="text-xs text-muted-foreground">And {items.length - RENAME_PREVIEW} more.</p>}
          <button type="submit" className="btn btn-primary" disabled={!changes}>
            {changes ? `Rename ${plural(changes, 'item')}` : 'Nothing changes yet'}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TagsDialog({
  open,
  items,
  onClose,
  onSave,
}: {
  open: boolean;
  items: BulkItem[];
  onClose: () => void;
  onSave: (patch: { tags_add?: string[]; tags_remove?: string[] }) => void;
}) {
  const [add, setAdd] = useState('');
  const [remove, setRemove] = useState('');
  const campaigns = items.filter((item) => supports({ kind: 'update', patch: {} }, item.entity));
  const existing = [...new Set(campaigns.flatMap((item) => item.tags ?? []))].sort((a, b) => a.localeCompare(b));
  const toAdd = parseTags(add);
  const toRemove = parseTags(remove);
  const others = items.length - campaigns.length;
  const otherKinds = [...new Set(items.filter((item) => item.entity !== 'campaign').map((item) => item.entity))] as LibraryEntity[];

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="rounded-[12px] border-border bg-card" data-tags-dialog>
        <DialogHeader>
          <DialogTitle className="display text-2xl font-semibold">Tags for {plural(campaigns.length, 'campaign')}</DialogTitle>
          <DialogDescription>
            Separate tags with commas.{others ? ` ${others} ${otherKinds.map((entity) => entityLabel(entity, others)).join(' and ')} skipped: tags are for campaigns.` : ''}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!toAdd.length && !toRemove.length) return;
            onSave({ ...(toAdd.length ? { tags_add: toAdd } : {}), ...(toRemove.length ? { tags_remove: toRemove } : {}) });
            setAdd('');
            setRemove('');
          }}
        >
          <label className="label" htmlFor="bulk-tags-add">Add tags</label>
          <input id="bulk-tags-add" className="field" value={add} autoFocus autoComplete="off" placeholder="q4, follow-up" onChange={(event) => setAdd(event.target.value)} />
          <label className="label" htmlFor="bulk-tags-remove">Remove tags</label>
          <input id="bulk-tags-remove" className="field" value={remove} autoComplete="off" onChange={(event) => setRemove(event.target.value)} />
          {existing.length > 0 && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Tags on the selected campaigns">
              {existing.map((tag) => (
                <button key={tag} type="button" className="chip min-h-9" title="Remove this tag" onClick={() => setRemove((value) => parseTags(`${value},${tag}`).join(', '))}>
                  {tag} <X size={12} aria-hidden />
                </button>
              ))}
            </div>
          )}
          <button type="submit" className="btn btn-primary" disabled={!toAdd.length && !toRemove.length}>Save tags</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
