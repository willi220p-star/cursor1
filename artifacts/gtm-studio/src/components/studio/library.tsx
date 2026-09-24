import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUpDown, CircleUser, Database, FileText, Film, Folder, FolderInput, Image, MoreHorizontal, Pencil, PenLine, Trash2 } from 'lucide-react';
import { Link } from 'wouter';
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

function modeLabel(mode: StudioMode) {
  if (mode === 'handwritten') return 'Handwritten notes';
  if (mode === 'handgif') return 'Handwriting GIF';
  if (mode === 'memes') return 'Moving memes';
  if (mode === 'avatar') return 'Avatar cards';
  return 'Animated GIFs';
}

function ModeIcon({ mode }: { mode: StudioMode }) {
  if (mode === 'handwritten') return <PenLine size={16} aria-hidden />;
  if (mode === 'handgif') return <Pencil size={16} aria-hidden />;
  if (mode === 'avatar') return <CircleUser size={16} aria-hidden />;
  if (mode === 'memes') return <Image size={16} aria-hidden />;
  return <Film size={16} aria-hidden />;
}

function itemDetail(item: LibraryItem) {
  if (item.kind === 'template') return `Template · ${modeLabel(item.template.mode)}`;
  if (item.kind === 'campaign') {
    const rows = item.campaign.contacts?.length ?? 0;
    return `Campaign · ${modeLabel(item.campaign.mode)} · ${rows} ${rows === 1 ? 'row' : 'rows'}`;
  }
  return `File · ${item.file.label}`;
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

  const load = () => {
    listStoredFiles(userId).then(setFiles).catch(() => setFiles([]));
    listFileFolders(userId).then(setFolders).catch(() => setFolders([]));
    listTemplateConfigs(userId).then(setTemplates).catch(() => setTemplates([]));
    listCampaigns(userId).then(setCampaigns).catch(() => setCampaigns([]));
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

  const visibleItems = items.filter((item) => (openFolder ? item.folderId === openFolder.id : !item.folderId));
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

  const nameLabel = naming?.kind === 'rename-file'
    ? 'File name'
    : naming?.kind === 'rename-template' || naming?.kind === 'rename-campaign'
      ? 'Name'
      : 'Folder name';

  return (
    <section aria-labelledby="library-heading" className="mt-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Library</p>
          <h2 id="library-heading" className="display mt-1 text-2xl font-semibold">Templates, files, and campaigns</h2>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => ask({ kind: 'create-folder' })}>
          <Folder size={16} aria-hidden /> New folder
        </button>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpenId(null)} aria-current={openFolder ? undefined : 'page'}>
          Library
        </button>
        {openFolder && (
          <span className="inline-flex items-center gap-1 font-semibold">
            {openFolder.name}
            <ActionsMenu label={`Actions for folder ${openFolder.name}`}>
              <DropdownMenuItem className="min-h-11" onSelect={() => ask({ kind: 'rename-folder', folder: openFolder }, openFolder.name)}>
                <Pencil aria-hidden /> Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive" onSelect={() => deleteFolder(openFolder)}>
                <Trash2 aria-hidden /> Delete folder
              </DropdownMenuItem>
            </ActionsMenu>
          </span>
        )}
        <span className="mono text-muted-foreground">
          {loaded ? `${visibleItems.length} ${visibleItems.length === 1 ? 'item' : 'items'}` : 'Loading…'}
        </span>
      </div>

      {!openFolder && (folders?.length ?? 0) > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {folders?.map((folder) => {
            const count = folderCount(folder.id);
            return (
              <article key={folder.id} className="panel flex min-w-0 items-center gap-2 p-3">
                <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setOpenId(folder.id)}>
                  <span className="icon-disc"><Folder size={16} aria-hidden /></span>
                  <span className="min-w-0">
                    <strong className="block truncate">{folder.name}</strong>
                    <small className="block text-muted-foreground">{count} {count === 1 ? 'item' : 'items'}</small>
                  </span>
                </button>
                <ActionsMenu label={`Actions for folder ${folder.name}`} busy={busyId === folder.id}>
                  <DropdownMenuItem className="min-h-11" onSelect={() => ask({ kind: 'rename-folder', folder }, folder.name)}>
                    <Pencil aria-hidden /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive" onSelect={() => deleteFolder(folder)}>
                    <Trash2 aria-hidden /> Delete folder
                  </DropdownMenuItem>
                </ActionsMenu>
              </article>
            );
          })}
        </div>
      )}

      <div className="ledger max-h-[560px] overflow-y-auto">
        {!loaded ? (
          <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading library">
            {[0, 1, 2].map((item) => <div key={item} className="h-11 animate-pulse rounded-md bg-surface-2" />)}
          </div>
        ) : visibleItems.length ? (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col" aria-sort={sortDesc ? 'descending' : 'ascending'}>
                    <button type="button" className="inline-flex h-11 items-center gap-1 uppercase tracking-[.06em]" onClick={() => setSortDesc((value) => !value)}>
                      Updated <ArrowUpDown size={14} aria-hidden />
                    </button>
                  </th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr
                    key={`${item.kind}-${item.id}`}
                    className={item.kind === 'file' ? 'is-file' : undefined}
                    data-library-kind={item.kind}
                    data-library-id={item.id}
                    data-library-name={item.name}
                    data-storage-path={item.kind === 'file' ? item.file.storagePath : undefined}
                    onClick={() => {
                      if (item.kind === 'template') onOpenTemplate(item.template);
                      if (item.kind === 'campaign') onOpenCampaign(item.campaign);
                    }}
                  >
                    <td>
                      <span className="flex items-center gap-3">
                        <span className="icon-disc">
                          {item.kind === 'file'
                            ? <FileText size={16} aria-hidden />
                            : <ModeIcon mode={item.kind === 'template' ? item.template.mode : item.campaign.mode} />}
                        </span>
                        <span className="min-w-0">
                          <strong className="block max-w-[280px] truncate" title={item.name}>{item.name}</strong>
                          <small className="block truncate text-muted-foreground">{itemDetail(item)}</small>
                        </span>
                      </span>
                    </td>
                    <td className="text-muted-foreground" title={new Date(item.at).toLocaleString()}>{relativeTime(item.at)}</td>
                    <td className="text-right" onClick={(event) => event.stopPropagation()}>
                      <div className="flex justify-end gap-2">
                        {item.kind !== 'file' && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => (item.kind === 'template' ? onOpenTemplate(item.template) : onOpenCampaign(item.campaign))}
                          >
                            Open <ArrowRight size={16} aria-hidden />
                          </button>
                        )}
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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : libraryEmpty ? (
          <div className="empty-state">
            <Database size={24} className="text-muted-foreground" aria-hidden />
            <h3>No campaigns yet</h3>
            <p>Import a list from any studio and press Save. Your first save appears here.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link href="/handwritten" className="btn btn-primary">Start with Notes</Link>
              <button type="button" className="btn btn-quiet" onClick={onLoadSample}>Load sample list</button>
            </div>
            <ol className="process-strip mt-8 w-full max-w-[880px] text-left">
              <li><span>01</span> Drop a list on the desk</li>
              <li><span>02</span> Write once with merge tags</li>
              <li><span>03</span> Tune ink, paper or motion</li>
              <li><span>04</span> Download this row or the ZIP</li>
            </ol>
          </div>
        ) : (
          <div className="empty-state">
            <Folder size={24} className="text-muted-foreground" aria-hidden />
            <h3>{openFolder ? 'This folder is empty' : 'Everything is in a folder'}</h3>
            <p>
              {openFolder
                ? 'Open the three dots on a template, file, or campaign and choose Move.'
                : 'Open a folder to see what is inside, or leave new work here in the library.'}
            </p>
          </div>
        )}
      </div>

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
