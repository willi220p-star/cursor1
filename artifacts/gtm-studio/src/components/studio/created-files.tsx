import { useEffect, useState, type ReactNode } from 'react';
import { Folder, FolderInput, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
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
  listFileFolders,
  listStoredFiles,
  moveStoredFile,
  removeFileFolder,
  removeStoredFile,
  renameFileFolder,
  renameStoredFile,
  type FileFolder,
  type StoredFile,
} from '@/studio/cloud';

type NameRequest =
  | { kind: 'create-folder' }
  | { kind: 'rename-folder'; folder: FileFolder }
  | { kind: 'rename-file'; file: StoredFile };

export function CreatedFiles({ userId, revision }: { userId?: string; revision: number }) {
  const [files, setFiles] = useState<StoredFile[] | null>(null);
  const [folders, setFolders] = useState<FileFolder[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [naming, setNaming] = useState<NameRequest | null>(null);
  const [draft, setDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    listStoredFiles(userId).then(setFiles).catch(() => setFiles([]));
    listFileFolders(userId).then(setFolders).catch(() => setFolders([]));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, revision]);

  useEffect(() => {
    if (openId && folders && !folders.some((folder) => folder.id === openId)) setOpenId(null);
  }, [folders, openId]);

  const openFolder = folders?.find((folder) => folder.id === openId) ?? null;
  const visibleFiles = (files ?? []).filter((file) => (openFolder ? file.folderId === openFolder.id : !file.folderId));
  const folderCount = (folderId: string) => (files ?? []).filter((file) => file.folderId === folderId).length;

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
          : await renameStoredFile(naming.file.id, draft, userId);
      if (result.syncError) {
        toast.error(result.syncError);
        return;
      }
      setNaming(null);
      load();
      toast.success(naming.kind === 'create-folder' ? 'Folder created' : 'Name saved');
    } finally {
      setSavingName(false);
    }
  };

  const deleteFile = async (file: StoredFile) => {
    if (busyId) return;
    if (!window.confirm(`Delete “${file.filename}” from Supabase?`)) return;
    setBusyId(file.id);
    try {
      const result = await removeStoredFile(file, userId);
      load();
      if (result.syncError) toast.error(`Could not delete ${file.filename}`, { description: result.syncError });
      else toast.success(`${file.filename} deleted`);
    } finally {
      setBusyId(null);
    }
  };

  const deleteFolder = async (folder: FileFolder) => {
    if (busyId) return;
    if (!window.confirm(`Delete the folder “${folder.name}”? Files inside it go back to All files. The files stay in Supabase.`)) return;
    setBusyId(folder.id);
    try {
      const result = await removeFileFolder(folder.id, userId);
      if (openId === folder.id) setOpenId(null);
      load();
      if (result.syncError) toast.error(`Could not delete ${folder.name}`, { description: result.syncError });
      else toast.success(`${folder.name} deleted`);
    } finally {
      setBusyId(null);
    }
  };

  const moveFile = async (file: StoredFile, folderId: string | null) => {
    if (busyId || file.folderId === folderId) return;
    setBusyId(file.id);
    try {
      const result = await moveStoredFile(file.id, folderId, userId);
      load();
      if (result.syncError) toast.error(`Could not move ${file.filename}`, { description: result.syncError });
      else {
        const destination = folderId ? folders?.find((folder) => folder.id === folderId)?.name : 'All files';
        toast.success(`${file.filename} moved to ${destination}`);
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="files-heading" className="mt-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Files</p>
          <h2 id="files-heading" className="display mt-1 text-2xl font-semibold">Created files</h2>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => ask({ kind: 'create-folder' })}>
          <Folder size={16} aria-hidden /> New folder
        </button>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpenId(null)} aria-current={openFolder ? undefined : 'page'}>
          All files
        </button>
        {openFolder && (
          <span className="inline-flex items-center gap-1 font-semibold">
            {openFolder.name}
            <ActionsMenu label={`Actions for folder ${openFolder.name}`}>
              <DropdownMenuItem className="min-h-11" onSelect={() => ask({ kind: 'rename-folder', folder: openFolder }, openFolder.name)}>
                <Pencil aria-hidden /> Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive" onSelect={() => void deleteFolder(openFolder)}>
                <Trash2 aria-hidden /> Delete folder
              </DropdownMenuItem>
            </ActionsMenu>
          </span>
        )}
        <span className="mono text-muted-foreground">
          {files === null ? 'Loading…' : `${visibleFiles.length} ${visibleFiles.length === 1 ? 'file' : 'files'}`}
        </span>
      </div>

      {!openFolder && (folders?.length ?? 0) > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {folders?.map((folder) => (
            <article key={folder.id} className="panel flex min-w-0 items-center gap-2 p-3">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setOpenId(folder.id)}>
                <span className="icon-disc"><Folder size={16} aria-hidden /></span>
                <span className="min-w-0">
                  <strong className="block truncate">{folder.name}</strong>
                  <small className="block text-muted-foreground">{folderCount(folder.id)} {folderCount(folder.id) === 1 ? 'file' : 'files'}</small>
                </span>
              </button>
              <ActionsMenu label={`Actions for folder ${folder.name}`} busy={busyId === folder.id}>
                <DropdownMenuItem className="min-h-11" onSelect={() => ask({ kind: 'rename-folder', folder }, folder.name)}>
                  <Pencil aria-hidden /> Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive" onSelect={() => void deleteFolder(folder)}>
                  <Trash2 aria-hidden /> Delete folder
                </DropdownMenuItem>
              </ActionsMenu>
            </article>
          ))}
        </div>
      )}

      <div className="ledger max-h-[420px] overflow-y-auto">
        {files === null ? (
          <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading files">
            {[0, 1].map((item) => <div key={item} className="h-11 animate-pulse rounded-md bg-surface-2" />)}
          </div>
        ) : visibleFiles.length ? (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col" className="mobile-hide">Kind</th>
                  <th scope="col">Added</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleFiles.map((file) => (
                  <tr key={file.id} className="is-file">
                    <td>
                      <span className="block max-w-[280px] truncate font-semibold" title={file.filename}>{file.filename}</span>
                    </td>
                    <td className="mobile-hide text-muted-foreground">{file.label}</td>
                    <td className="text-muted-foreground" title={new Date(file.createdAt).toLocaleString()}>{relativeTime(file.createdAt)}</td>
                    <td className="text-right">
                      <ActionsMenu label={`Actions for ${file.filename}`} busy={busyId === file.id} storagePath={file.storagePath}>
                        <DropdownMenuItem className="min-h-11" onSelect={() => ask({ kind: 'rename-file', file }, file.filename)}>
                          <Pencil aria-hidden /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger className="min-h-11">
                            <FolderInput aria-hidden /> Move to folder
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                            <DropdownMenuItem className="min-h-11" disabled={!file.folderId} onSelect={() => void moveFile(file, null)}>
                              All files
                            </DropdownMenuItem>
                            {(folders ?? []).length ? folders?.map((folder) => (
                              <DropdownMenuItem
                                key={folder.id}
                                className="min-h-11"
                                disabled={file.folderId === folder.id}
                                onSelect={() => void moveFile(file, folder.id)}
                              >
                                {folder.name}
                              </DropdownMenuItem>
                            )) : (
                              <DropdownMenuItem className="min-h-11" disabled>No folders yet</DropdownMenuItem>
                            )}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive" onSelect={() => void deleteFile(file)}>
                          <Trash2 aria-hidden /> Delete
                        </DropdownMenuItem>
                      </ActionsMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <Folder size={24} className="text-muted-foreground" aria-hidden />
            <h3>{openFolder ? 'This folder is empty' : (files ?? []).length ? 'All files are in folders' : 'No files yet'}</h3>
            <p>
              {openFolder
                ? 'Open the three dots on a file in All files and choose Move to folder.'
                : 'Imported lists, photos, and generated images land here. New folder keeps them sorted.'}
            </p>
          </div>
        )}
      </div>

      <Dialog open={naming !== null} onOpenChange={(open) => { if (!open) setNaming(null); }}>
        <DialogContent className="rounded-[12px] border-border bg-card">
          <DialogHeader>
            <DialogTitle className="display text-2xl font-semibold">
              {naming?.kind === 'create-folder' ? 'New folder' : naming?.kind === 'rename-folder' ? 'Rename folder' : 'Rename file'}
            </DialogTitle>
            <DialogDescription>
              {naming?.kind === 'rename-file'
                ? 'This changes the name in your library. The Supabase link stays the same.'
                : 'Folders are saved in Supabase for this operator.'}
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void saveName();
            }}
          >
            <label className="label" htmlFor="library-name">{naming?.kind === 'rename-file' ? 'File name' : 'Folder name'}</label>
            <input
              id="library-name"
              className="field"
              value={draft}
              autoFocus
              maxLength={naming?.kind === 'rename-file' ? 120 : 80}
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
