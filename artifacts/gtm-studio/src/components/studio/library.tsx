import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowUpDown, Copy, Database, Eraser, FileText, Folder, FolderInput, FolderPlus, History, MoreHorizontal, Pencil, Search, Tag, Trash2 } from 'lucide-react';
import { BulkBar, type BulkFolder, type BulkItem } from '@/components/studio/bulk-bar';
import { TrashView } from '@/components/studio/trash-view';
import { Link, useLocation } from 'wouter';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { relativeTime } from '@/studio/activity';
import {
  campaignClient,
  campaignSearchText,
  campaignStatus,
  formatHistoryEntry,
  knownClients,
  recentHistory,
  statusLabels,
} from '@/studio/campaign-status';
import { reportError } from '@/lib/report';
import { useAccess } from '@/studio/access-context';
import { entityForKind, onBulkApplied, runBulk, trashWithUndo, type RenameContext } from '@/studio/bulk';
import type { BulkAction, BulkResult, LibraryEntity } from '@/studio/contracts';
import {
  clear as clearSelection,
  clickSelect,
  deselectAll,
  emptySelection,
  headerState,
  prune,
  selectAll,
  selectionShortcut,
  type Selection,
} from '@/studio/selection';
import { downloadZip } from '@/studio/zip-download';
import { formatBytes } from '@/studio/cleanup-plan';
import { prepareCampaignCleanup, runCampaignCleanup, type CleanupResult, type PreparedCleanup } from '@/studio/cleanup';
import {
  createFileFolder,
  duplicateCampaign,
  listCampaigns,
  listFileFolders,
  listStoredFiles,
  listTemplateConfigs,
  moveCampaign,
  moveStoredFile,
  moveTemplateConfig,
  removeCampaign,
  removeStoredFile,
  removeTemplateConfig,
  renameCampaign,
  renameFileFolder,
  renameStoredFile,
  renameTemplateConfig,
  setCampaignClient,
  type FileFolder,
  type StoredFile,
} from '@/studio/cloud';
import { studioInfo, studioInitial } from '@/studio/studios';
import { CampaignReviewBadge } from '@/components/studio/campaign-review-badge';
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
  | { kind: 'rename-campaign'; campaign: SavedCampaign }
  | { kind: 'set-client'; campaign: SavedCampaign };

type KindFilter = 'all' | LibraryItem['kind'] | 'trash';

type CleanupRequest = {
  campaign: SavedCampaign;
  phase: 'checking' | 'ready' | 'deleting';
  plan?: PreparedCleanup;
  error?: string;
};

/** How many file names the clean-up dialog lists before "and N more". */
const CLEANUP_PREVIEW = 10;

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function cleanupSize(plan: Pick<PreparedCleanup, 'bytes' | 'unknownSizes'>) {
  return plan.unknownSizes === 0 && plan.bytes > 0 ? formatBytes(plan.bytes) : '';
}

function cleanupToast(result: CleanupResult, total: number) {
  const freed = result.freedBytes > 0 ? `, freed ${result.unknownSizes ? 'at least ' : ''}${formatBytes(result.freedBytes)}` : '';
  if (!result.failures.length) {
    toast.success(`Deleted ${plural(result.deleted, 'file')}${freed}`);
    return;
  }
  const title = result.deleted ? `Deleted ${result.deleted} of ${plural(total, 'file')}${freed}` : 'Could not clean up old files';
  toast.error(title, { description: result.failures.join('\n'), duration: 12_000 });
}

function shortDate(at: string | null) {
  if (!at) return '';
  const date = new Date(at);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

const kindFilters: Array<{ value: KindFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'campaign', label: 'Campaigns' },
  { value: 'template', label: 'Templates' },
  { value: 'file', label: 'Files' },
  { value: 'trash', label: 'Trash' },
];

/** Rows drawn at once; "Show more" draws the next batch. "Select all N matching" covers every row. */
export const RENDER_STEP = 100;

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

const ALL_CLIENTS = '__all';
const NO_CLIENT = '__none';

const itemKey = (item: Pick<LibraryItem, 'kind' | 'id'>) => `${item.kind}-${item.id}`;

/** Fields the team-spaces migration adds; read loosely so rows saved before it still work. */
type SpaceFields = { spaceId?: string | null; version?: number; tags?: string[] };

function itemSource(item: LibraryItem): SpaceFields {
  return (item.kind === 'template' ? item.template : item.kind === 'campaign' ? item.campaign : item.file) as SpaceFields;
}

/** Templates are team-wide; other rows carry the client space they live in (null before the migration). */
function itemSpaceId(item: LibraryItem): string | null {
  return item.kind === 'template' ? null : itemSource(item).spaceId ?? null;
}

/** Only rows saved in Supabase can go to Trash; local-only drafts are deleted straight away. */
function inCloud(item: LibraryItem) {
  if (item.kind === 'template') return Boolean(item.template.cloud);
  if (item.kind === 'campaign') return Boolean(item.campaign.cloud);
  return true;
}

function bulkItem(item: LibraryItem): BulkItem {
  const source = itemSource(item);
  return {
    key: itemKey(item),
    entity: entityForKind(item.kind),
    id: item.id,
    name: item.name,
    version: source.version,
    spaceId: itemSpaceId(item),
    folderId: item.folderId,
    client: item.kind === 'campaign' ? campaignClient(item.campaign) : undefined,
    tags: item.kind === 'campaign' ? source.tags : undefined,
  };
}

function removeItem(item: LibraryItem, userId?: string) {
  if (item.kind === 'template') return removeTemplateConfig(item.template, userId);
  if (item.kind === 'campaign') return removeCampaign(item.campaign, userId);
  return removeStoredFile(item.file, userId);
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
  const [clientFilter, setClientFilter] = useState(ALL_CLIENTS);
  const [cleanup, setCleanup] = useState<CleanupRequest | null>(null);
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const [renderLimit, setRenderLimit] = useState(RENDER_STEP);
  const [bulkBusy, setBulkBusy] = useState(false);
  const headerBox = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const [, navigate] = useLocation();
  const { can, currentSpaceId, spaces } = useAccess();

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

  const clients = useMemo(() => knownClients(campaigns ?? []), [campaigns]);
  useEffect(() => {
    if (clientFilter !== ALL_CLIENTS && clientFilter !== NO_CLIENT && campaigns && !clients.includes(clientFilter)) setClientFilter(ALL_CLIENTS);
  }, [clients, clientFilter, campaigns]);
  // Search text per item, built once per load: name, kind, client and (for campaigns) the
  // company values in the list, capped so big lists stay quick.
  const searchText = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      const base = `${item.name} ${itemDetail(item)}`.toLowerCase();
      map.set(itemKey(item), item.kind === 'campaign' ? `${base} ${campaignSearchText(item.campaign)}` : base);
    }
    return map;
  }, [items]);

  const needle = query.trim().toLowerCase();
  const liveItems = items;
  const clientItems = clientFilter === ALL_CLIENTS
    ? liveItems
    : liveItems.filter((item) => item.kind === 'campaign' && (clientFilter === NO_CLIENT ? !campaignClient(item.campaign) : campaignClient(item.campaign) === clientFilter));
  // A search (or a client filter) looks in every folder; otherwise show the open folder (or the loose items).
  const visibleItems = clientItems.filter((item) => {
    if (kind !== 'all' && item.kind !== kind) return false;
    if (needle) return (searchText.get(itemKey(item)) ?? '').includes(needle);
    if (clientFilter !== ALL_CLIENTS) return true;
    return openFolder ? item.folderId === openFolder.id : !item.folderId;
  });
  const kindCount = (value: KindFilter) => (value === 'trash' ? '' : value === 'all' ? clientItems.length : clientItems.filter((item) => item.kind === value).length);
  const inTrash = kind === 'trash';

  // Selection: survives filtering and folder changes, drops rows that are gone, clears on space change.
  const renderedItems = visibleItems.slice(0, renderLimit);
  const renderedKeys = renderedItems.map(itemKey);
  const matchingKeys = visibleItems.map(itemKey);
  const allKeys = useMemo(() => items.map(itemKey), [items]);
  useEffect(() => {
    if (loaded) setSelection((current) => prune(current, allKeys));
  }, [allKeys, loaded]);
  useEffect(() => setSelection(clearSelection()), [currentSpaceId]);
  useEffect(() => setRenderLimit(RENDER_STEP), [needle, kind, clientFilter, openId]);
  const selectedItems = items.filter((item) => selection.keys.has(itemKey(item)));
  const anySelected = selectedItems.length > 0;
  const header = headerState(selection, renderedKeys);
  const allMatchingSelected = matchingKeys.length > 0 && matchingKeys.every((key) => selection.keys.has(key));
  useEffect(() => {
    if (headerBox.current) headerBox.current.indeterminate = header === 'some';
  });

  // A bulk action replayed from the offline queue refreshes the Library too.
  useEffect(() => onBulkApplied(() => onChangedRef.current()), []);
  const folderCount = (folderId: string) => liveItems.filter((item) => item.folderId === folderId).length;
  const libraryEmpty = loaded && items.length === 0 && (folders?.length ?? 0) === 0;

  const ask = (request: NameRequest, current = '') => {
    setDraft(current);
    setNaming(request);
  };

  const saveName = async () => {
    if (!naming || savingName) return;
    setSavingName(true);
    try {
      const result = naming.kind === 'set-client'
        ? await setCampaignClient(naming.campaign, draft, userId)
        : naming.kind === 'create-folder'
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
      toast.success(naming.kind === 'create-folder' ? 'Folder created' : naming.kind === 'set-client' ? (draft.trim() ? `Client set to ${draft.trim()}` : 'Client cleared') : 'Name saved');
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

  /** Delete goes to Trash ("Moved to Trash · Undo"). Local-only drafts have no Trash and go at once. */
  const deleteItem = (item: LibraryItem) => {
    if (busyId) return;
    if (!inCloud(item)) {
      void removeItem(item, userId)
        .then((result) => {
          if (result.syncError) toast.error(`Could not delete ${item.name}`, { description: result.syncError });
          else toast.success(`${item.name} deleted`);
        })
        .catch((error) => {
          reportError(error, { area: 'library', action: 'delete' });
          toast.error(`Could not delete ${item.name}`, { description: error instanceof Error ? error.message : undefined });
        })
        .finally(() => onChangedRef.current());
      return;
    }
    void trashWithUndo([bulkItem(item)]);
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Keeps only the items that failed selected, so they are easy to retry or inspect. */
  const keepFailed = (result: BulkResult) => {
    const failed = new Set(result.failed.map((failure) => `${failure.target.entity}:${failure.target.id}`));
    setSelection((current) => ({
      keys: new Set([...current.keys].filter((key) => {
        const item = items.find((candidate) => itemKey(candidate) === key);
        return item ? failed.has(`${entityForKind(item.kind)}:${item.id}`) : false;
      })),
      anchor: null,
    }));
  };

  const renameContext = useMemo<RenameContext>(() => {
    const clientsById: Record<string, string> = {};
    const taken: Partial<Record<LibraryEntity, string[]>> = {};
    const spaceNames = new Map(spaces.filter((space) => space.kind === 'client').map((space) => [space.id, space.name]));
    for (const item of items) {
      const entity = entityForKind(item.kind);
      (taken[entity] ??= []).push(item.name);
      const client = item.kind === 'campaign' ? campaignClient(item.campaign) : '';
      const spaceId = itemSpaceId(item);
      clientsById[item.id] = client || (spaceId ? spaceNames.get(spaceId) ?? '' : '');
    }
    return { clients: clientsById, taken };
  }, [items, spaces]);

  const runSelected = async (action: BulkAction) => {
    if (bulkBusy || !selectedItems.length) return;
    setBulkBusy(true);
    try {
      const result = await runBulk(action, selectedItems.map(bulkItem), { rename: renameContext });
      keepFailed(result);
    } catch (error) {
      reportError(error, { area: 'library', action: `bulk-${action.kind}` });
      toast.error('That bulk action did not run', { description: error instanceof Error ? error.message : undefined });
    } finally {
      setBulkBusy(false);
    }
  };

  const trashSelected = async () => {
    if (bulkBusy || !selectedItems.length) return;
    setBulkBusy(true);
    try {
      const cloud = selectedItems.filter(inCloud);
      const local = selectedItems.filter((item) => !inCloud(item));
      for (const item of local) deleteItem(item);
      if (cloud.length) keepFailed(await trashWithUndo(cloud.map(bulkItem)));
      else setSelection(clearSelection());
    } finally {
      setBulkBusy(false);
    }
  };

  const downloadSelected = async () => {
    if (bulkBusy || !selectedItems.length) return;
    setBulkBusy(true);
    try {
      await downloadZip(selectedItems.map(bulkItem));
    } catch (error) {
      reportError(error, { area: 'library', action: 'bulk-download' });
      toast.error('Could not build the ZIP', { description: error instanceof Error ? error.message : undefined });
    } finally {
      setBulkBusy(false);
    }
  };

  const onLibraryKey = (event: KeyboardEvent<HTMLElement>) => {
    // Keys typed in dialogs (rendered in portals) bubble here through React; only act on the library itself.
    if (inTrash || !(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    const shortcut = selectionShortcut(event);
    if (shortcut === 'clear' && selection.keys.size) {
      event.preventDefault();
      setSelection(clearSelection());
    } else if (shortcut === 'select-visible' && renderedKeys.length) {
      event.preventDefault();
      setSelection((current) => selectAll(current, renderedKeys));
    }
  };

  const duplicateItem = (item: LibraryItem) => {
    if (item.kind !== 'campaign' || busyId) return;
    setBusyId(item.id);
    void duplicateCampaign(item.campaign, userId, (campaigns ?? []).map((campaign) => campaign.name))
      .then((result) => {
        onChanged();
        if (result.syncError) toast.error(`Could not fully copy ${item.name}`, { description: result.syncError });
        else if (result.campaign) {
          const copy = result.campaign;
          toast.success(`Copied as ${copy.name}`, { action: { label: 'Open', onClick: () => onOpenCampaign(copy) } });
        }
      })
      .catch((error) => {
        reportError(error, { area: 'library', action: 'duplicate' });
        toast.error(`Could not copy ${item.name}`, { description: error instanceof Error ? error.message : undefined });
      })
      .finally(() => setBusyId(null));
  };

  /** Opens the clean-up dialog and works out, read-only, what would be deleted. */
  const startCleanup = (campaign: SavedCampaign) => {
    if (busyId) return;
    setCleanup({ campaign, phase: 'checking' });
    const same = (current: CleanupRequest | null) => current?.campaign.id === campaign.id;
    void prepareCampaignCleanup(campaign, userId)
      .then((plan) => setCleanup((current) => (same(current) ? { campaign, phase: 'ready', plan } : current)))
      .catch((error) => {
        reportError(error, { area: 'library', action: 'cleanup-plan' });
        const message = error instanceof Error ? error.message : 'Could not read the stored files.';
        setCleanup((current) => (same(current) ? { campaign, phase: 'ready', error: `${message} Nothing was deleted.` } : current));
      });
  };

  const confirmCleanup = () => {
    const plan = cleanup?.plan;
    if (!cleanup || cleanup.phase !== 'ready' || !plan || plan.refused || !plan.remove.length) return;
    const { campaign } = cleanup;
    setCleanup({ ...cleanup, phase: 'deleting' });
    setBusyId(campaign.id);
    void runCampaignCleanup(plan, userId)
      .then((result) => cleanupToast(result, plan.remove.length))
      .catch((error) => {
        reportError(error, { area: 'library', action: 'cleanup' });
        toast.error('Could not clean up old files', { description: error instanceof Error ? error.message : undefined });
      })
      .finally(() => {
        setBusyId(null);
        setCleanup(null);
        if (mounted.current) onChangedRef.current();
      });
  };

  /** A folder goes to Trash on its own; what was inside shows in the library until it is restored. */
  const deleteFolder = (folder: FileFolder) => {
    if (busyId) return;
    if (openId === folder.id) setOpenId(null);
    void trashWithUndo([{ entity: 'folder', id: folder.id, name: folder.name }]);
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

  const nameLabel = naming?.kind === 'set-client'
    ? 'Client'
    : naming?.kind === 'rename-file'
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
    <section aria-labelledby="library-heading" className={`flex flex-col gap-5 outline-none ${anySelected ? 'pb-4 sm:pb-0' : ''}`} tabIndex={-1} onKeyDown={onLibraryKey}>
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
        {!inTrash && (clients.length > 0 || clientFilter !== ALL_CLIENTS) && (
          <label className="client-filter">
            <span className="sr-only">Client</span>
            <select className="field" value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} aria-label="Filter by client">
              <option value={ALL_CLIENTS}>All clients</option>
              {clients.map((client) => <option key={client} value={client}>{client}</option>)}
              <option value={NO_CLIENT}>No client</option>
            </select>
          </label>
        )}
        {!inTrash && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSortDesc((value) => !value)} aria-label={sortDesc ? 'Sorted newest first. Show oldest first.' : 'Sorted oldest first. Show newest first.'}>
          <ArrowUpDown size={15} aria-hidden /> {sortDesc ? 'Newest first' : 'Oldest first'}
        </button>}
      </div>
      {!inTrash && !needle && clientFilter === ALL_CLIENTS && (
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

      {inTrash ? (
        <TrashView userId={userId} revision={revision} needle={needle} />
      ) : (
      <>
      {loaded && visibleItems.length > 0 && (
        <div className="-mb-3 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-sm" data-select-header>
          <label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2">
            <input
              ref={headerBox}
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={header === 'all'}
              aria-label={header === 'all' ? 'Clear the visible selection' : 'Select all visible'}
              onChange={() => setSelection((current) => (header === 'all' ? deselectAll(current, renderedKeys) : selectAll(current, renderedKeys)))}
            />
            <span className="font-medium">Select</span>
          </label>
          {anySelected && <span className="text-muted-foreground" data-selected-count>{selectedItems.length} selected</span>}
          {anySelected && !allMatchingSelected && matchingKeys.length > renderedKeys.length && (
            <button type="button" className="btn btn-ghost btn-sm min-h-11 px-2 underline sm:min-h-9" onClick={() => setSelection((current) => selectAll(current, matchingKeys))}>
              Select all {matchingKeys.length} matching
            </button>
          )}
        </div>
      )}
      <div className="max-h-[640px] overflow-y-auto rounded-[20px]">
        {!loaded ? (
          <div className="group-list space-y-3 p-4" aria-busy="true" aria-label="Loading library">
            {[0, 1, 2].map((item) => <div key={item} className="h-11 animate-pulse rounded-[12px] bg-surface-2" />)}
          </div>
        ) : visibleItems.length ? (
          <>
          <ul className="group-list">
            {renderedItems.map((item) => {
              const mode = itemMode(item);
              const status = item.kind === 'campaign' ? campaignStatus(item.campaign.config) : null;
              const history = item.kind === 'campaign' ? recentHistory(item.campaign.config) : [];
              const client = item.kind === 'campaign' ? campaignClient(item.campaign) : '';
              const key = itemKey(item);
              const checked = selection.keys.has(key);
              return (
                <li
                  key={key}
                  className="group group-row"
                  data-selected={checked || undefined}
                  data-library-kind={item.kind}
                  data-library-id={item.id}
                  data-library-name={item.name}
                  data-storage-path={item.kind === 'file' ? item.file.storagePath : undefined}
                  onClick={() => openItem(item)}
                >
                  <label
                    className={`-ml-2 -mr-2 inline-flex size-11 flex-none cursor-pointer items-center justify-center transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100 ${anySelected ? 'opacity-100' : 'opacity-0'}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={checked}
                      aria-label={`Select ${item.name}`}
                      onChange={(event) => {
                        // React fires a checkbox's change from the native click, which carries Shift.
                        const shift = (event.nativeEvent as MouseEvent).shiftKey === true;
                        setSelection((current) => clickSelect(current, key, renderedKeys, shift));
                      }}
                    />
                  </label>
                  <span className="item-mark" data-studio={mode ?? 'file'} aria-hidden>
                    {mode ? studioInitial(mode) : <FileText size={18} />}
                  </span>
                  <span className="item-text">
                    <span className="item-title">
                      <strong title={item.name}>{item.name}</strong>
                      {status && (
                        <span
                          className="status-pill"
                          data-status={status}
                          title={history.length ? history.map(formatHistoryEntry).join('\n') : 'Not generated yet'}
                        >
                          {statusLabels[status]}
                        </span>
                      )}
                      {item.kind === 'campaign' && item.campaign.cloud && <CampaignReviewBadge campaignId={item.id} />}
                    </span>
                    <small>{client && <><span className="client-tag">{client}</span> · </>}{itemDetail(item)}</small>
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
                      {item.kind === 'campaign' && (
                        <>
                          <DropdownMenuItem className="min-h-11" onSelect={() => duplicateItem(item)}>
                            <Copy aria-hidden /> Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem className="min-h-11" onSelect={() => ask({ kind: 'set-client', campaign: item.campaign }, client)}>
                            <Tag aria-hidden /> {client ? 'Change client…' : 'Set client…'}
                          </DropdownMenuItem>
                          <DropdownMenuItem className="min-h-11" onSelect={() => startCleanup(item.campaign)}>
                            <Eraser aria-hidden /> Clean up old versions…
                          </DropdownMenuItem>
                        </>
                      )}
                      <MoveMenu current={item.folderId} folders={folders ?? []} onMove={(folderId) => moveItem(item, folderId)} />
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive" onSelect={() => deleteItem(item)}>
                        <Trash2 aria-hidden /> Delete
                      </DropdownMenuItem>
                      {item.kind === 'campaign' && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                            <History size={14} aria-hidden /> History
                          </DropdownMenuLabel>
                          {history.length ? history.map((event) => (
                            <p key={`${event.at}-${event.kind}`} className="px-2 py-1 text-xs text-muted-foreground" data-history-entry>
                              {formatHistoryEntry(event)}
                            </p>
                          )) : (
                            <p className="px-2 py-1 text-xs text-muted-foreground">Draft. Nothing generated yet.</p>
                          )}
                        </>
                      )}
                    </ActionsMenu>
                  </span>
                </li>
              );
            })}
          </ul>
          {visibleItems.length > renderedItems.length && (
            <button type="button" className="btn btn-quiet mt-3 w-full" onClick={() => setRenderLimit((value) => value + RENDER_STEP)}>
              Show {Math.min(RENDER_STEP, visibleItems.length - renderedItems.length)} more of {visibleItems.length - renderedItems.length}
            </button>
          )}
          </>
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
            <h3>{needle ? 'Nothing matches that' : clientFilter !== ALL_CLIENTS ? 'No campaigns for that client' : openFolder ? 'This folder is empty' : kind !== 'all' ? 'Nothing of that kind here' : 'Everything is in a folder'}</h3>
            <p>
              {needle
                ? 'Try part of a name, a client, a company on the list, a studio, or a file type like PNG.'
                : clientFilter !== ALL_CLIENTS
                  ? 'Open the three dots on a campaign and choose Set client.'
                : openFolder
                  ? 'Open the three dots on a template, file, or campaign and choose Move.'
                  : 'Open a folder to see what is inside, or leave new work here in the library.'}
            </p>
          </div>
        )}
      </div>
      {anySelected && (
        <BulkBar
          items={selectedItems.map(bulkItem)}
          folders={(folders ?? []).map((folder): BulkFolder => ({ id: folder.id, name: folder.name, spaceId: (folder as { spaceId?: string | null }).spaceId }))}
          spaces={spaces}
          showSpaces={can('members.manage', null) || spaces.length > 1}
          can={can}
          busy={bulkBusy}
          renameContext={renameContext}
          onRun={(action) => void runSelected(action)}
          onDownload={() => void downloadSelected()}
          onTrash={() => void trashSelected()}
          onClear={() => setSelection(clearSelection())}
        />
      )}
      </>
      )}

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

      <CleanupDialog request={cleanup} onCancel={() => setCleanup(null)} onConfirm={confirmCleanup} />

      <Dialog open={naming !== null} onOpenChange={(open) => { if (!open) setNaming(null); }}>
        <DialogContent className="rounded-[12px] border-border bg-card">
          <DialogHeader>
            <DialogTitle className="display text-2xl font-semibold">
              {naming?.kind === 'create-folder' ? 'New folder' : naming?.kind === 'rename-folder' ? 'Rename folder' : naming?.kind === 'set-client' ? 'Set client' : 'Rename'}
            </DialogTitle>
            <DialogDescription>
              {naming?.kind === 'set-client'
                ? 'Who this campaign is for. Filter and search the library by client. Leave empty to clear it.'
                : naming?.kind === 'rename-file'
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
              list={naming?.kind === 'set-client' ? 'library-clients' : undefined}
              autoComplete="off"
              maxLength={naming?.kind === 'create-folder' || naming?.kind === 'rename-folder' || naming?.kind === 'set-client' ? 80 : 120}
              onChange={(event) => setDraft(event.target.value)}
            />
            {naming?.kind === 'set-client' && (
              <datalist id="library-clients">
                {clients.map((client) => <option key={client} value={client} />)}
              </datalist>
            )}
            <button type="submit" className="btn btn-primary" disabled={savingName || (naming?.kind !== 'set-client' && !draft.trim())}>
              {naming?.kind === 'create-folder' ? 'Create folder' : naming?.kind === 'set-client' ? 'Save client' : 'Save name'}
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

function CleanupDialog({
  request,
  onCancel,
  onConfirm,
}: {
  request: CleanupRequest | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const plan = request?.plan;
  const deleting = request?.phase === 'deleting';
  const checking = request?.phase === 'checking';
  const blocked = Boolean(request?.error || plan?.refused);
  const count = plan && !plan.refused ? plan.remove.length : 0;
  const size = plan ? cleanupSize(plan) : '';
  const shown = plan?.remove.slice(0, CLEANUP_PREVIEW) ?? [];
  const kept = plan?.keep.length ?? 0;

  let description: string;
  if (checking) description = `Checking which stored files the current list of ${request?.campaign.name ?? 'this campaign'} links to. Nothing is deleted yet.`;
  else if (request?.error) description = request.error;
  else if (plan?.refused) description = plan.refused;
  else if (!count) description = 'Nothing to clean up. Every generated file for this campaign is linked from your current list.';
  else description = `${plural(count, 'old file')}${size ? ` (${size})` : ''} from earlier runs will be deleted. Files your current list links to are kept.`;

  return (
    <Dialog open={request !== null} onOpenChange={(open) => { if (!open && !deleting) onCancel(); }}>
      <DialogContent className="rounded-[12px] border-border bg-card" data-cleanup-dialog aria-busy={checking || deleting}>
        <DialogHeader>
          <DialogTitle className="display pr-8 text-2xl font-semibold">Clean up old versions</DialogTitle>
          <DialogDescription data-cleanup-summary className={blocked ? 'text-foreground' : undefined}>{description}</DialogDescription>
        </DialogHeader>
        {checking && (
          <div className="space-y-2" aria-hidden>
            {[0, 1, 2].map((row) => <div key={row} className="h-6 animate-pulse rounded-[8px] bg-surface-2" />)}
          </div>
        )}
        {count > 0 && (
          <div className="min-w-0">
            <ul className="max-h-60 overflow-y-auto rounded-[12px] border border-border text-sm" data-cleanup-list aria-label="Files that will be deleted">
              {shown.map((file) => (
                <li key={file.path} className="flex min-w-0 items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-b-0" title={file.path}>
                  <span className="min-w-0 truncate">{file.name}{file.kind === 'still' && <span className="text-muted-foreground"> · still</span>}</span>
                  <span className="flex-none text-xs text-muted-foreground">{shortDate(file.createdAt)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              {count > shown.length ? `And ${count - shown.length} more. ` : ''}
              {kept ? `${plural(kept, 'file')} stay${kept === 1 ? 's' : ''} linked. ` : ''}
              Imported lists, uploaded images and other campaigns are never touched.
            </p>
          </div>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={deleting}>
            {count > 0 ? 'Cancel' : 'Done'}
          </button>
          {count > 0 && (
            <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={deleting} data-loading={deleting || undefined}>
              <Trash2 size={16} aria-hidden /> Delete {plural(count, 'file')}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
