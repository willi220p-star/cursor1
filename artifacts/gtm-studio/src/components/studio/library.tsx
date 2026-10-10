import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowUpDown, Database, FileText, Folder, FolderInput, FolderPlus, MoreHorizontal, Pencil, Search, Trash2 } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { relativeTime } from '@/studio/activity';
import { reportError } from '@/lib/report';
import {
  createFileFolder,
  listCampaigns,
  listFileFolders,
  listStoredFiles,
  listTemplateConfigs,
  moveCampaign,
  moveStoredFile,
  moveTemplateConfig,
  removeCampaign,
  removeFileFolder,
  removeStoredFile,
  removeTemplateConfig,
  renameCampaign,
  renameFileFolder,
  renameStoredFile,
  renameTemplateConfig,
  type FileFolder,
  type StoredFile,
} from '@/studio/cloud';
import { studioInfo, studioInitial } from '@/studio/studios';
import type { SavedCampaign, SavedTemplate, StudioMode } from '@/studio/types';

type LibraryItem =
  | { kind: 'template'; id: string; name: string; at: string; folderId: string | null; template: SavedTemplate }
  | { kind: 'campaign'; id: string; name: string; at: string; folderId: string | null; campaign: SavedCampaign }
  | { kind: 'file'; id: string; name: string; at: string; folderId: string | null; file: StoredFile };

type NameRequest =
  | { kind: 'create-folder' }
  | { kind: 'rename-folder'; folder: FileFolder }
  | { kind: 'rename-file'; file: StoredFile }
  | { kind: 'rename-template'; template: SavedTemplate }
  | { kind: 'rename-campaign'; campaign: SavedCampaign };

type KindFilter = 'all' | LibraryItem['kind'];

const kindFilters: Array<{ value: KindFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'campaign', label: 'Campaigns' },
  { value: 'template', label: 'Templates' },
  { value: 'file', label: 'Files' },
];

function itemMode(item: LibraryItem): StudioMode | null {
  if (item.kind === 'template') return item.template.mode;
  if (item.kind === 'campaign') return item.campaign.mode;
  return null;
}

function itemDetail(item: LibraryItem) {
  if (item.kind === 'template') return `${studioInfo(item.template.mode).label} template`;
  if (item.kind === 'campaign') {
    const rows = item.campaign.contacts?.length ?? 0;
    return `${studioInfo(item.campaign.mode).label} campaign with ${rows} ${rows === 1 ? 'row' : 'rows'}`;
  }
  return item.file.label;
}

export function Library({
  userId,
  revision,
  onChanged,
  onOpenCampaign,
  onOpenTemplate,
  onLoadSample,
}: {
  userId?: string;
  revision: number;
  onChanged: () => void;
  onOpenCampaign: (campaign: SavedCampaign) => void;
  onOpenTemplate: (template: SavedTemplate) => void;
  onLoadSample: () => void;
}) {
  const [files, setFiles] = useState<StoredFile[] | null>(null);
  const [folders, setFolders] = useState<FileFolder[] | null>(null);
  const [templates, setTemplates] = useState<SavedTemplate[] | null>(null);
  const [campaigns, setCampaigns] = useState<SavedCampaign[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [naming, setNaming] = useState<NameRequest | null>(null);
  const [draft, setDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sortDesc, setSortDesc] = useState(true);
  const [preview, setPreview] = useState<StoredFile | null>(null);
  const [previewBroken, setPreviewBroken] = useState(false);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [, navigate] = useLocation();

  const [loadFailed, setLoadFailed] = useState<string[]>([]);
  const load = () => {
    setLoadFailed([]);
    // Each list loads on its own, so one failure still shows the rest. Failures are named, not hidden.
    // The Supabase client already retries temporary errors, so no second retry layer here.
    const fetchList = <T,>(label: string, fetch: () => Promise<T[]>, set: (rows: T[]) => void) => {
      fetch()
        .then(set)
        .catch((error) => {
          reportError(error, { area: 'library', list: label });
          set([]);
          setLoadFailed((current) => (current.includes(label) ? current : [...current, label]));
        });
    };
    fetchList('files', () => listStoredFiles(userId), setFiles);
    fetchList('folders', () => listFileFolders(userId), setFolders);
    fetchList('templates', () => listTemplateConfigs(userId), setTemplates);
    fetchList('campaigns', () => listCampaigns(userId), setCampaigns);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, revision]);

  useEffect(() => {
    if (openId && folders && !folders.some((folder) => folder.id === openId)) setOpenId(null);
  }, [folders, openId]);

  const openFolder = folders?.find((folder) => folder.id === openId) ?? null;
  const loaded = files !== null && folders !== null && templates !== null && campaigns !== null;

  const items = useMemo(() => {
    const next: LibraryItem[] = [
      ...(templates ?? []).map((template) => ({
        kind: 'template' as const,
        id: template.id,
        name: template.name,
        at: template.updatedAt,
        folderId: template.folderId ?? null,
        template,
      })),
      ...(campaigns ?? []).map((campaign) => ({
        kind: 'campaign' as const,
        id: campaign.id,
        name: campaign.name,
        at: campaign.updatedAt,
        folderId: campaign.folderId ?? null,
        campaign,
      })),
      ...(files ?? []).map((file) => ({
        kind: 'file' as const,
        id: file.id,
        name: file.filename,
        at: file.createdAt,
        folderId: file.folderId,
        file,
      })),
    ];
    next.sort((a, b) => (sortDesc ? b.at.localeCompare(a.at) : a.at.localeCompare(b.at)));
    return next;
  }, [templates, campaigns, files, sortDesc]);

  const needle = query.trim().toLowerCase();
  // A search looks in every folder; otherwise show the open folder (or the loose items).
  const visibleItems = items.filter((item) => {
    if (kind !== 'all' && item.kind !== kind) return false;
    if (needle) return `${item.name} ${itemDetail(item)}`.toLowerCase().includes(needle);
    return openFolder ? item.folderId === openFolder.id : !item.folderId;
  });
  const kindCount = (value: KindFilter) => (value === 'all' ? items.length : items.filter((item) => item.kind === value).length);
  const folderCount = (folderId: string) => items.filter((item) => item.folderId === folderId).length;
  const libraryEmpty = loaded && items.length === 0 && (folders?.length ?? 0) === 0;

  const ask = (request: NameRequest, current = '') => {
    setDraft(current);
    setNaming(request);
  };

  const saveName = async () => {
    if (!naming || savingName) return;
    setSavingName(true);
    try {
      const result = naming.kind === 'create-folder'
        ? await createFileFolder(draft, userId)
        : naming.kind === 'rename-folder'
          ? await renameFileFolder(naming.folder.id, draft, userId)
          : naming.kind === 'rename-file'
            ? await renameStoredFile(naming.file.id, draft, userId)
            : naming.kind === 'rename-template'
              ? await renameTemplateConfig(naming.template, draft, userId)
              : await renameCampaign(naming.campaign, draft, userId);
      if (result.syncError) {
        toast.error(result.syncError);
        return;
      }
      setNaming(null);
      onChanged();
      toast.success(naming.kind === 'create-folder' ? 'Folder created' : 'Name saved');
    } finally {
      setSavingName(false);
    }
  };

  const run = async (id: string, work: () => Promise<{ syncError?: string }>, success: string, failure: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      const result = await work();
      onChanged();
      if (result.syncError) toast.error(failure, { description: result.syncError });
      else toast.success(success);
    } finally {
      setBusyId(null);
    }
  };

  const deleteItem = (item: LibraryItem) => {
    if (busyId) return;
    if (item.kind === 'template') {
      if (!window.confirm(`Delete “${item.name}”? It will be removed from this studio and from Supabase.`)) return;
      void run(item.id, () => removeTemplateConfig(item.template, userId), `${item.name} deleted`, `Could not delete ${item.name}`);
      return;
    }
    if (item.kind === 'campaign') {
      if (!window.confirm(`Delete “${item.name}”? The campaign and its stored files will be removed from Supabase.`)) return;
      void run(item.id, () => removeCampaign(item.campaign, userId), `${item.name} deleted`, `Could not delete ${item.name}`);
      return;
    }
    if (!window.confirm(`Delete “${item.name}” from Supabase?`)) return;
    void run(item.id, () => removeStoredFile(item.file, userId), `${item.name} deleted`, `Could not delete ${item.name}`);
  };

  const deleteFolder = (folder: FileFolder) => {
    if (busyId) return;
    if (!window.confirm(`Delete the folder “${folder.name}”? Templates, files, and campaigns inside it go back to the library. Nothing inside is deleted.`)) return;
    void run(folder.id, async () => {
      const result = await removeFileFolder(folder.id, userId);
      if (openId === folder.id) setOpenId(null);
      return result;
    }, `${folder.name} deleted`, `Could not delete ${folder.name}`);
  };

  const moveItem = (item: LibraryItem, folderId: string | null) => {
    if (busyId || item.folderId === folderId) return;
    const destination = folderId ? folders?.find((folder) => folder.id === folderId)?.name : 'Library';
    const work = item.kind === 'template'
      ? () => moveTemplateConfig(item.id, folderId, userId)
      : item.kind === 'campaign'
        ? () => moveCampaign(item.id, folderId, userId)
        : () => moveStoredFile(item.id, folderId, userId);
    void run(item.id, work, `${item.name} moved to ${destination}`, `Could not move ${item.name}`);
  };

  const openFile = (file: StoredFile) => {
    // Saved carousels are JSON decks; open them in the carousel editor rather than as raw files.
    if (file.label === 'Carousel' && file.storagePath) {
      navigate(`/carousel?open=${encodeURIComponent(file.storagePath)}`);
      return;
    }
    if (!file.publicUrl) {
      toast.error(`${file.filename} has no Supabase link.`);
      return;
    }
    if (/\.(png|jpe?g|gif|webp|svg)$/i.test(file.filename)) {
      setPreviewBroken(false);
      setPreview(file);
      return;
    }
    const opened = window.open(file.publicUrl, '_blank', 'noopener,noreferrer');
    if (!opened) toast.error('Allow pop-ups to open that file.');
  };

  const nameLabel = naming?.kind === 'rename-file'
    ? 'File name'
    : naming?.kind === 'rename-template' || naming?.kind === 'rename-campaign'
      ? 'Name'
      : 'Folder name';

  const openItem = (item: LibraryItem) => {
    if (item.kind === 'template') onOpenTemplate(item.template);
    else if (item.kind === 'campaign') onOpenCampaign(item.campaign);
    else openFile(item.file);
  };

  return (
    <section aria-labelledby="library-heading" className="flex flex-col gap-5">
      <div className="library-head">
        <h2 id="library-heading" className="section-title">Library</h2>
        <label className="search-field">
          <Search size={16} aria-hidden />
          <span className="sr-only">Search the library</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search campaigns, templates and files" />
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="segmented" role="group" aria-label="Show">
          {kindFilters.map((filter) => (
            <button key={filter.value} type="button" aria-pressed={kind === filter.value} onClick={() => setKind(filter.value)}>
              {filter.label}<span className="count">{loaded ? kindCount(filter.value) : ''}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSortDesc((value) => !value)} aria-label={sortDesc ? 'Sorted newest first. Show oldest first.' : 'Sorted oldest first. Show newest first.'}>
          <ArrowUpDown size={15} aria-hidden /> {sortDesc ? 'Newest first' : 'Oldest first'}
        </button>
      </div>
      {!needle && (
        <div className="chip-row" role="group" aria-label="Folders">
          <button type="button" className="chip" aria-pressed={!openFolder} onClick={() => setOpenId(null)}>Library</button>
          {folders?.map((folder) => (
            <span key={folder.id} className="inline-flex items-center gap-1">
              <button type="button" className="chip" aria-pressed={openId === folder.id} onClick={() => setOpenId(folder.id)}>
                <Folder size={14} aria-hidden /> {folder.name} <span className="count">{folderCount(folder.id)}</span>
              </button>
              {openId === folder.id && (
                <ActionsMenu label={`Actions for folder ${folder.name}`} busy={busyId === folder.id}>
                  <DropdownMenuItem className="min-h-11" onSelect={() => ask({ kind: 'rename-folder', folder }, folder.name)}>
                    <Pencil aria-hidden /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive" onSelect={() => deleteFolder(folder)}>
                    <Trash2 aria-hidden /> Delete folder
                  </DropdownMenuItem>
                </ActionsMenu>
              )}
            </span>
          ))}
          <button type="button" className="chip is-dashed" onClick={() => ask({ kind: 'create-folder' })}>
            <FolderPlus size={14} aria-hidden /> New folder
          </button>
        </div>
      )}

      {loadFailed.length > 0 && (
        <div className="load-error" role="alert">
          <span>Could not load your {loadFailed.join(', ')}. Check your connection; nothing has been deleted.</span>
          <button type="button" className="btn btn-quiet btn-sm" onClick={load}>Retry</button>
        </div>
      )}

      <div className="max-h-[640px] overflow-y-auto rounded-[20px]">
        {!loaded ? (
          <div className="group-list space-y-3 p-4" aria-busy="true" aria-label="Loading library">
            {[0, 1, 2].map((item) => <div key={item} className="h-11 animate-pulse rounded-[12px] bg-surface-2" />)}
          </div>
        ) : visibleItems.length ? (
          <ul className="group-list">
            {visibleItems.map((item) => {
              const mode = itemMode(item);
              return (
                <li
                  key={`${item.kind}-${item.id}`}
                  className="group-row"
                  data-library-kind={item.kind}
                  data-library-id={item.id}
                  data-library-name={item.name}
                  data-storage-path={item.kind === 'file' ? item.file.storagePath : undefined}
                  onClick={() => openItem(item)}
                >
                  <span className="item-mark" data-studio={mode ?? 'file'} aria-hidden>
                    {mode ? studioInitial(mode) : <FileText size={18} />}
                  </span>
                  <span className="item-text">
                    <strong title={item.name}>{item.name}</strong>
                    <small>{itemDetail(item)}</small>
                  </span>
                  <span className="item-when" title={new Date(item.at).toLocaleString()}>{relativeTime(item.at)}</span>
                  <span className="flex flex-none items-center gap-2" onClick={(event) => event.stopPropagation()}>
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => openItem(item)} aria-label={`Open ${item.name}`}>Open</button>
                    <ActionsMenu label={`Actions for ${item.name}`} busy={busyId === item.id} storagePath={item.kind === 'file' ? item.file.storagePath : undefined}>
                      <DropdownMenuItem
                        className="min-h-11"
                        onSelect={() => {
                          if (item.kind === 'file') ask({ kind: 'rename-file', file: item.file }, item.name);
                          else if (item.kind === 'template') ask({ kind: 'rename-template', template: item.template }, item.name);
                          else ask({ kind: 'rename-campaign', campaign: item.campaign }, item.name);
                        }}
                      >
                        <Pencil aria-hidden /> Rename
                      </DropdownMenuItem>
                      <MoveMenu current={item.folderId} folders={folders ?? []} onMove={(folderId) => moveItem(item, folderId)} />
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive" onSelect={() => deleteItem(item)}>
                        <Trash2 aria-hidden /> Delete
                      </DropdownMenuItem>
                    </ActionsMenu>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : libraryEmpty ? (
          <div className="group-list empty-state">
            <Database size={24} className="text-muted-foreground" aria-hidden />
            <h3>No campaigns yet</h3>
            <p>Import a list from any studio and press Save. Your first save appears here.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link href="/handwritten" className="btn btn-primary">Start with Notes</Link>
              <button type="button" className="btn btn-quiet" onClick={onLoadSample}>Load the sample list</button>
            </div>
            <ol className="process-strip mt-8 w-full max-w-[880px] text-left">
              <li><span>1</span> Drop a list on the desk</li>
              <li><span>2</span> Write once with merge tags</li>
              <li><span>3</span> Tune ink, paper or motion</li>
              <li><span>4</span> Download this row or the ZIP</li>
            </ol>
          </div>
        ) : (
          <div className="group-list empty-state">
            {needle ? <Search size={24} className="text-muted-foreground" aria-hidden /> : <Folder size={24} className="text-muted-foreground" aria-hidden />}
            <h3>{needle ? 'Nothing matches that' : openFolder ? 'This folder is empty' : kind !== 'all' ? 'Nothing of that kind here' : 'Everything is in a folder'}</h3>
            <p>
              {needle
                ? 'Try part of a name, a studio, or a file type like PNG.'
                : openFolder
                  ? 'Open the three dots on a template, file, or campaign and choose Move.'
                  : 'Open a folder to see what is inside, or leave new work here in the library.'}
            </p>
          </div>
        )}
      </div>

      <Dialog open={preview !== null} onOpenChange={(open) => { if (!open) setPreview(null); }}>
        <DialogContent className="max-w-3xl rounded-[12px] border-border bg-card">
          <DialogHeader>
            <DialogTitle className="display pr-8 text-2xl font-semibold">{preview?.filename}</DialogTitle>
            <DialogDescription>This is the file saved in Supabase.</DialogDescription>
          </DialogHeader>
          {preview && (previewBroken ? (
            <p className="text-sm text-muted-foreground">This image could not be loaded from Supabase.</p>
          ) : (
            <img
              src={preview.publicUrl}
              alt={preview.filename}
              className="max-h-[70vh] w-full rounded-md bg-surface-2 object-contain"
              onError={() => setPreviewBroken(true)}
            />
          ))}
          {preview?.publicUrl && (
            <a className="btn btn-primary" href={preview.publicUrl} target="_blank" rel="noreferrer">Open in a new tab</a>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={naming !== null} onOpenChange={(open) => { if (!open) setNaming(null); }}>
        <DialogContent className="rounded-[12px] border-border bg-card">
          <DialogHeader>
            <DialogTitle className="display text-2xl font-semibold">
              {naming?.kind === 'create-folder' ? 'New folder' : naming?.kind === 'rename-folder' ? 'Rename folder' : 'Rename'}
            </DialogTitle>
            <DialogDescription>
              {naming?.kind === 'rename-file'
                ? 'This changes the name in your library. The Supabase link stays the same.'
                : naming?.kind === 'create-folder' || naming?.kind === 'rename-folder'
                  ? 'Folders can hold templates, files, and campaigns. They are saved in Supabase for this operator.'
                  : 'The name updates in Supabase. Opening it uses this name.'}
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void saveName();
            }}
          >
            <label className="label" htmlFor="library-name">{nameLabel}</label>
            <input
              id="library-name"
              className="field"
              value={draft}
              autoFocus
              maxLength={naming?.kind === 'create-folder' || naming?.kind === 'rename-folder' ? 80 : 120}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={savingName || !draft.trim()}>
              {naming?.kind === 'create-folder' ? 'Create folder' : 'Save name'}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function MoveMenu({
  current,
  folders,
  onMove,
}: {
  current: string | null;
  folders: FileFolder[];
  onMove: (folderId: string | null) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="min-h-11">
        <FolderInput aria-hidden /> Move
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
        <DropdownMenuItem className="min-h-11" disabled={!current} onSelect={() => onMove(null)}>
          Library
        </DropdownMenuItem>
        {folders.length ? folders.map((folder) => (
          <DropdownMenuItem
            key={folder.id}
            className="min-h-11"
            disabled={current === folder.id}
            onSelect={() => onMove(folder.id)}
          >
            {folder.name}
          </DropdownMenuItem>
        )) : (
          <DropdownMenuItem className="min-h-11" disabled>No folders yet</DropdownMenuItem>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function ActionsMenu({
  label,
  busy = false,
  storagePath,
  children,
}: {
  label: string;
  busy?: boolean;
  storagePath?: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="btn btn-quiet btn-icon" aria-label={label} data-storage-path={storagePath} disabled={busy}>
          <MoreHorizontal size={16} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44 border-border bg-card" onCloseAutoFocus={(event) => event.preventDefault()}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
