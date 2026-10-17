import { createClient } from '@supabase/supabase-js';
import { campaignAssetRows, campaignSlug } from './asset-scope';
import { campaignHistory, cleanClient, pushHistory } from './campaign-status';
import { attachPortraitCaches, stripPortraitDataUrls } from './portraits';
import { outputColumnNames } from './writeback';
import type { GeneratedAsset, SavedCampaign, SavedTemplate, StudioConfig, StudioMode } from './types';
import type { AppError } from './contracts';
import { conflictError, toAppError } from '@/lib/app-error';
import {
  getKnownSpaces,
  getQuerySpace,
  getSaveSpace,
  isCarouselPath,
  isManagedPath,
  spaceFields,
  spaceFromPath as spaceFromStoragePath,
  storagePathFor,
} from './space-scope';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

export const supabase = url && key
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
export const supabaseConfigured = Boolean(supabase);

const LOCAL_CAMPAIGNS = 'gtm-studio-campaigns-v2';
const LOCAL_TEMPLATES = 'gtm-studio-templates-v2';
const ANONYMOUS_SCOPE = 'anonymous';
const userKey = (base: string, userId?: string) => `${base}:${userId ?? ANONYMOUS_SCOPE}`;

function readJson<T>(keyName: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(keyName) || '') as T;
  } catch {
    return fallback;
  }
}

export function peekLocalCampaign(mode: StudioMode, userId?: string): SavedCampaign | undefined {
  const local = readJson<SavedCampaign[]>(userKey(LOCAL_CAMPAIGNS, userId), []);
  return local.find((item) => item.mode === mode);
}

/** Campaign id → space id, learned from lists and saves, so uploads land in the campaign's own space. */
const campaignSpaces = new Map<string, string>();

/** The space a campaign lives in (cached, else one lookup), falling back to the save space for new campaigns. */
async function resolveCampaignSpace(campaignId?: string | null): Promise<string | null> {
  if (campaignId) {
    const known = campaignSpaces.get(campaignId);
    if (known) return known;
    if (supabase) {
      const { data, error } = await supabase.from('outbound_campaigns').select('space_id').eq('id', campaignId).maybeSingle();
      const found = !error && data && typeof data.space_id === 'string' ? data.space_id : null;
      if (found) {
        campaignSpaces.set(campaignId, found);
        return found;
      }
    }
  }
  return getSaveSpace();
}

/** Single-item result: `syncError` for existing callers, `error` (an AppError) for new ones. */
export type ItemResult = { syncError?: string; error?: AppError };

function failed(error: unknown): ItemResult {
  const appError = toAppError(error);
  return { syncError: appError.message, error: appError };
}

/** Best effort "who changed it and when" for a conflict message. */
async function describeConflict(table: string, id: string): Promise<AppError> {
  if (!supabase) return conflictError();
  try {
    const row = await supabase.from(table).select('updated_at').eq('id', id).maybeSingle();
    const at = row.data && typeof row.data.updated_at === 'string' ? row.data.updated_at : undefined;
    const last = await supabase.from('activity_log').select('actor').eq('entity_id', id).order('at', { ascending: false }).limit(1);
    const actor = (last.data as Array<{ actor?: string | null }> | null)?.[0]?.actor;
    let editor: string | undefined;
    if (actor) {
      const profile = await supabase.from('profiles').select('display_name,email').eq('user_id', actor).maybeSingle();
      editor = (profile.data?.display_name as string | undefined) || (profile.data?.email as string | undefined) || undefined;
    }
    return conflictError(editor, at);
  } catch {
    return conflictError();
  }
}

/**
 * Updates one row by id. With a known `version` it only matches that version, and zero rows
 * updated becomes a conflict AppError (someone else saved in between).
 */
async function updateOne(table: string, id: string, patch: Record<string, unknown>, version?: number): Promise<ItemResult> {
  if (!supabase) return {};
  let query = supabase.from(table).update(patch).eq('id', id);
  if (typeof version === 'number') query = query.eq('version', version);
  const { data, error } = await query.select('id');
  if (error) return failed(error);
  if (typeof version === 'number' && !(data ?? []).length) {
    const conflict = await describeConflict(table, id);
    return { syncError: conflict.message, error: conflict };
  }
  return {};
}

export async function listCampaigns(userId?: string): Promise<SavedCampaign[]> {
  const local = readJson<SavedCampaign[]>(userKey(LOCAL_CAMPAIGNS, userId), []);
  if (!supabase || !userId) return local;
  // RLS decides which rows are visible; the current space (if one is picked) narrows it further.
  let query = supabase
    .from('outbound_campaigns')
    .select('id,name,mode,config,source_columns,source_data,updated_at,folder_id,space_id,version')
    .is('deleted_at', null);
  const space = getQuerySpace();
  if (space) query = query.eq('space_id', space);
  const { data, error } = await query.order('updated_at', { ascending: false });
  if (error) throw error;
  const cloud = (data ?? []).map((row) => {
    if (row.space_id) campaignSpaces.set(row.id, row.space_id);
    return {
      id: row.id,
      name: row.name,
      mode: row.mode,
      config: { ...row.config, id: row.id },
      columns: row.source_columns,
      contacts: row.source_data ?? [],
      updatedAt: row.updated_at,
      cloud: true,
      folderId: row.folder_id ?? null,
      spaceId: row.space_id ?? undefined,
      version: typeof row.version === 'number' ? row.version : undefined,
    };
  }) as SavedCampaign[];
  return [...cloud, ...local.filter((item) => !cloud.some((cloudItem) => cloudItem.id === item.id))];
}

export async function saveCampaign(
  config: StudioConfig,
  columns: string[],
  contacts: import('./types').Contact[],
  userId?: string,
  /** `spaceId` puts a new campaign in that space instead of the save space (e.g. a copy stays beside its original). */
  options: { spaceId?: string | null } = {},
) {
  const storageKey = userKey(LOCAL_CAMPAIGNS, userId);
  const local = readJson<SavedCampaign[]>(storageKey, []);
  const existing = local.find((item) => item.id === config.id)
    ?? local.find((item) => item.name === config.campaignName && item.mode === config.mode);
  const id = config.id ?? existing?.id ?? crypto.randomUUID();
  const savedConfig = { ...config, id };
  const durableContacts = await attachPortraitCaches(contacts, config.avatarColumn);
  const record: SavedCampaign = {
    id,
    name: config.campaignName,
    mode: config.mode,
    config: savedConfig,
    columns,
    contacts: durableContacts,
    updatedAt: new Date().toISOString(),
    cloud: false,
    folderId: existing?.folderId ?? null,
  };
  const nextLocal = [record, ...local.filter((item) => item.id !== record.id)].slice(0, 30);
  try {
    localStorage.setItem(storageKey, JSON.stringify(nextLocal));
  } catch {
    const slim = nextLocal.map((item) => (
      item.id === record.id ? { ...item, contacts: stripPortraitDataUrls(item.contacts) } : item
    ));
    try {
      localStorage.setItem(storageKey, JSON.stringify(slim));
    } catch {
      // IndexedDB already holds portrait pixels for this browser.
    }
  }
  if (!supabase || !userId) return record;
  // An existing campaign keeps its space and its creator; a new one goes to the save space.
  const existingRow = await supabase.from('outbound_campaigns').select('space_id,user_id').eq('id', record.id).maybeSingle();
  const existingSpace = !existingRow.error && typeof existingRow.data?.space_id === 'string' ? existingRow.data.space_id : null;
  const creator = !existingRow.error && typeof existingRow.data?.user_id === 'string' ? existingRow.data.user_id : userId;
  const spaceId = existingSpace ?? options.spaceId ?? getSaveSpace();
  if (spaceId) campaignSpaces.set(record.id, spaceId);
  let cloudConfig = savedConfig;
  try {
    cloudConfig = { ...savedConfig, ...(await persistConfigImages(savedConfig, userId, spaceId)), id: savedConfig.id };
  } catch (reason) {
    return { ...record, syncError: reason instanceof Error ? reason.message : 'Could not upload images to Supabase.' };
  }
  const cloudPayload = {
    id: record.id,
    user_id: creator,
    ...spaceFields(spaceId),
    name: record.name,
    mode: record.mode,
    config: { ...cloudConfig, gifFrames: undefined, gifDelays: undefined },
    source_columns: columns,
    source_data: durableContacts,
    updated_at: record.updatedAt,
  };
  const { data, error } = await supabase.from('outbound_campaigns').upsert(cloudPayload).select('id').single();
  if (error) {
    const slimContacts = stripPortraitDataUrls(durableContacts);
    const retry = await supabase.from('outbound_campaigns').upsert({ ...cloudPayload, source_data: slimContacts }).select('id').single();
    if (retry.error) return { ...record, syncError: retry.error.message };
    return { ...record, id: retry.data.id, config: { ...cloudConfig, id: retry.data.id, gifFrames: savedConfig.gifFrames, gifDelays: savedConfig.gifDelays }, cloud: true, spaceId: spaceId ?? undefined };
  }
  return { ...record, id: data.id, config: { ...cloudConfig, id: data.id, gifFrames: savedConfig.gifFrames, gifDelays: savedConfig.gifDelays }, cloud: true, spaceId: spaceId ?? undefined };
}

function asSavedTemplate(item: SavedTemplate | StudioConfig, cloud = false): SavedTemplate | null {
  if (!item || typeof item !== 'object') return null;
  if ('config' in item && item.config && 'mode' in item) {
    const record = item as SavedTemplate;
    return {
      id: record.id || record.config.templateId || crypto.randomUUID(),
      name: record.name || record.config.campaignName,
      mode: record.mode || record.config.mode,
      config: { ...record.config, templateId: record.id || record.config.templateId },
      updatedAt: record.updatedAt || new Date().toISOString(),
      cloud: record.cloud ?? cloud,
      folderId: record.folderId ?? null,
      ...(typeof record.version === 'number' ? { version: record.version } : {}),
    };
  }
  const config = item as StudioConfig;
  if (!config.mode) return null;
  const id = config.templateId || crypto.randomUUID();
  return {
    id,
    name: config.campaignName,
    mode: config.mode,
    config: { ...config, templateId: id },
    updatedAt: new Date().toISOString(),
    cloud,
    folderId: null,
  };
}

function writeLocalTemplates(templates: SavedTemplate[], userId?: string) {
  localStorage.setItem(userKey(LOCAL_TEMPLATES, userId), JSON.stringify(templates.slice(0, 40)));
}

export function saveLocalTemplate(config: StudioConfig, userId?: string) {
  const record = asSavedTemplate({ ...config, templateId: config.templateId || crypto.randomUUID() });
  if (!record) return;
  const current = listLocalTemplates(userId);
  const previous = current.find((item) => item.id === record.id);
  const next = { ...record, folderId: previous?.folderId ?? record.folderId ?? null };
  writeLocalTemplates([next, ...current.filter((item) => item.id !== record.id)], userId);
}

export function listLocalTemplates(userId?: string): SavedTemplate[] {
  const raw = readJson<Array<SavedTemplate | StudioConfig>>(userKey(LOCAL_TEMPLATES, userId), []);
  return raw.map((item) => asSavedTemplate(item)).filter((item): item is SavedTemplate => Boolean(item));
}

const LOCAL_COPY_TEMPLATES = 'gtm-studio-copy-templates-v1';
const COPY_STUDIOS = ['handwritten', 'avatar', 'memes', 'gif', 'handgif', 'carousel'] as const;

export type CopyStudio = (typeof COPY_STUDIOS)[number];

export type CopyTemplate = {
  id: string;
  studio: CopyStudio;
  name: string;
  body: string;
  updatedAt: string;
  cloud: boolean;
};

function asCopyStudio(value: unknown): CopyStudio {
  return COPY_STUDIOS.includes(value as CopyStudio) ? value as CopyStudio : 'handwritten';
}

function normalizeCopyTemplate(item: { id?: string; studio?: unknown; name?: string; body?: string; updatedAt?: string; cloud?: boolean } | null | undefined): CopyTemplate | null {
  if (!item?.id || !item.name || !item.body) return null;
  return {
    id: item.id,
    studio: asCopyStudio(item.studio),
    name: item.name,
    body: item.body,
    updatedAt: item.updatedAt || new Date().toISOString(),
    cloud: Boolean(item.cloud),
  };
}

function sameCopyName(item: CopyTemplate, studio: CopyStudio, name: string) {
  return item.studio === studio && item.name.toLowerCase() === name.toLowerCase();
}

function readLocalCopyTemplates(userId?: string): CopyTemplate[] {
  const raw = readJson<Partial<CopyTemplate>[]>(userKey(LOCAL_COPY_TEMPLATES, userId), []);
  return raw.map((item) => normalizeCopyTemplate(item)).filter((item): item is CopyTemplate => Boolean(item));
}

function writeLocalCopyTemplates(templates: CopyTemplate[], userId?: string) {
  const kept: CopyTemplate[] = [];
  const counts = new Map<CopyStudio, number>();
  for (const item of templates) {
    const count = counts.get(item.studio) ?? 0;
    if (count >= 40) continue;
    counts.set(item.studio, count + 1);
    kept.push(item);
  }
  localStorage.setItem(userKey(LOCAL_COPY_TEMPLATES, userId), JSON.stringify(kept));
}

export async function listCopyTemplates(studio: CopyStudio, userId?: string): Promise<CopyTemplate[]> {
  const local = readLocalCopyTemplates(userId);
  const localStudio = local.filter((item) => item.studio === studio);
  if (!supabase || !userId) return localStudio;
  const { data, error } = await supabase
    .from('outbound_copy_templates')
    .select('id,studio,name,body,updated_at')
    .eq('studio', studio)
    .order('updated_at', { ascending: false });
  if (error) return localStudio;
  const cloud = (data ?? []).map((row) => normalizeCopyTemplate({
    id: row.id as string,
    studio: row.studio as string,
    name: row.name as string,
    body: row.body as string,
    updatedAt: row.updated_at as string,
    cloud: true,
  })).filter((item): item is CopyTemplate => Boolean(item));
  const mergedStudio = [
    ...cloud,
    ...localStudio.filter((item) => !cloud.some((row) => row.id === item.id || sameCopyName(row, studio, item.name))),
  ];
  writeLocalCopyTemplates([...mergedStudio, ...local.filter((item) => item.studio !== studio)], userId);
  return mergedStudio;
}

export async function saveCopyTemplate(studio: CopyStudio, name: string, body: string, userId?: string): Promise<{ template: CopyTemplate; syncError?: string }> {
  const trimmedName = name.trim();
  const trimmedBody = body.trim();
  const current = readLocalCopyTemplates(userId);
  const existing = current.find((item) => sameCopyName(item, studio, trimmedName));
  const record: CopyTemplate = {
    id: existing?.id ?? crypto.randomUUID(),
    studio,
    name: trimmedName,
    body: trimmedBody,
    updatedAt: new Date().toISOString(),
    cloud: false,
  };
  writeLocalCopyTemplates([
    record,
    ...current.filter((item) => item.id !== record.id && !sameCopyName(item, studio, trimmedName)),
  ], userId);
  if (!supabase || !userId) return { template: record };
  const found = await supabase
    .from('outbound_copy_templates')
    .select('id')
    .eq('studio', studio)
    .eq('name', record.name)
    .maybeSingle();
  if (found.error) return { template: record, syncError: found.error.message };
  const write = found.data
    ? supabase
      .from('outbound_copy_templates')
      .update({ body: record.body, updated_at: record.updatedAt })
      .eq('id', found.data.id)
      .eq('studio', studio)
      .select('id,studio,name,body,updated_at')
      .single()
    : supabase
      .from('outbound_copy_templates')
      .insert({
        id: record.id,
        user_id: userId,
        studio,
        name: record.name,
        body: record.body,
        updated_at: record.updatedAt,
      })
      .select('id,studio,name,body,updated_at')
      .single();
  const { data, error } = await write;
  if (error || !data) return { template: record, syncError: error?.message ?? 'Could not save the template.' };
  const saved = normalizeCopyTemplate({
    id: data.id,
    studio: data.studio,
    name: data.name,
    body: data.body,
    updatedAt: data.updated_at,
    cloud: true,
  });
  if (!saved) return { template: record, syncError: 'Could not save the template.' };
  const next = readLocalCopyTemplates(userId);
  writeLocalCopyTemplates([
    saved,
    ...next.filter((item) => item.id !== record.id && item.id !== saved.id && !sameCopyName(item, studio, saved.name)),
  ], userId);
  return { template: saved };
}

export async function removeCopyTemplate(template: CopyTemplate, userId?: string): Promise<{ syncError?: string }> {
  const studio = asCopyStudio(template.studio);
  const current = readLocalCopyTemplates(userId);
  writeLocalCopyTemplates(
    current.filter((item) => item.id !== template.id && !sameCopyName(item, studio, template.name)),
    userId,
  );
  if (!supabase || !userId) return {};
  const byId = await supabase.from('outbound_copy_templates').delete().eq('id', template.id).eq('studio', studio);
  if (byId.error) return { syncError: byId.error.message };
  const byName = await supabase.from('outbound_copy_templates').delete().eq('studio', studio).eq('name', template.name);
  if (byName.error) return { syncError: byName.error.message };
  return {};
}

async function dataUrlBlob(dataUrl: string) {
  return (await fetch(dataUrl)).blob();
}

function templatePayload(config: StudioConfig, userId: string, storagePath: string | null) {
  const templateId = config.templateId || crypto.randomUUID();
  const named = { ...config, templateId };
  return {
    id: templateId,
    user_id: userId,
    name: named.campaignName,
    mode: named.mode,
    storage_path: storagePath,
    zones: {
      layers: named.layers,
      website: named.websiteZone,
      avatar: named.avatarZone,
      note: named.noteZone,
      text: named.textZone,
      imageCrop: named.imageCrop,
      avatarCrop: named.avatarCrop,
    },
    metadata: { config: named },
    updated_at: new Date().toISOString(),
  };
}

export async function saveTemplateConfig(config: StudioConfig, userId?: string) {
  const templateId = config.templateId || crypto.randomUUID();
  const localConfig = { ...config, templateId };
  saveLocalTemplate(localConfig, userId);
  if (!supabase || !userId) return { cloud: false, id: templateId, config: localConfig };
  let cloudConfig = localConfig;
  try {
    cloudConfig = { ...localConfig, ...(await persistConfigImages(localConfig, userId)), templateId, gifFrames: undefined, gifDelays: undefined };
  } catch (reason) {
    return { cloud: false, id: templateId, config: localConfig, syncError: reason instanceof Error ? reason.message : 'Could not upload images to Supabase.' };
  }
  const storagePath = storagePathFromPublicUrl(cloudConfig.customImage || cloudConfig.gifSourceDataUrl);
  const payload = templatePayload(cloudConfig, userId, storagePath);
  const { error } = await supabase.from('outbound_templates').upsert(payload);
  if (error) return { cloud: false, id: templateId, config: localConfig, syncError: error.message };
  return { cloud: true, id: templateId, config: { ...cloudConfig, gifFrames: localConfig.gifFrames, gifDelays: localConfig.gifDelays } };
}

export async function copyTemplateConfig(template: SavedTemplate, userId?: string) {
  const copyName = / copy(?: \d+)?$/.test(template.name)
    ? `${template.name.replace(/ copy(?: \d+)?$/, '')} copy ${new Date().toLocaleTimeString()}`
    : `${template.name} copy`;
  return saveTemplateConfig({
    ...template.config,
    templateId: crypto.randomUUID(),
    campaignName: copyName,
    mode: template.mode,
  }, userId);
}

export async function listTemplateConfigs(userId?: string): Promise<SavedTemplate[]> {
  const local = listLocalTemplates(userId);
  if (!supabase || !userId) return local;
  const { data, error } = await supabase
    .from('outbound_templates')
    .select('id,name,mode,metadata,updated_at,folder_id,version')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(80);
  if (error) return local;
  const cloud = (data ?? [])
    .map((row) => asSavedTemplate({
      id: row.id,
      name: row.name,
      mode: row.mode as StudioMode,
      config: { ...(row.metadata?.config as StudioConfig | undefined), templateId: row.id, mode: row.mode, campaignName: row.name || row.metadata?.config?.campaignName },
      updatedAt: row.updated_at,
      cloud: true,
      folderId: row.folder_id ?? null,
      version: typeof row.version === 'number' ? row.version : undefined,
    } as SavedTemplate, true))
    .filter((item): item is SavedTemplate => Boolean(item));
  return [...cloud, ...local.filter((item) => !cloud.some((cloudItem) => cloudItem.id === item.id))];
}

const CONFIG_FILE_MARKER = '/storage/v1/object/public/outbound-assets/';

function collectStoragePaths(value: unknown, into: Set<string>, depth = 0) {
  if (depth > 8 || value == null) return;
  if (typeof value === 'string') {
    if (!value.includes(CONFIG_FILE_MARKER)) return;
    const path = storagePathFromPublicUrl(value);
    if (path) into.add(path);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStoragePaths(item, into, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectStoragePaths(item, into, depth + 1);
  }
}

function clearPendingLoad(prefix: string, id: string, userId?: string) {
  const key = `${prefix}:${userId ?? ANONYMOUS_SCOPE}`;
  try {
    const pending = JSON.parse(localStorage.getItem(key) || '') as { id?: string };
    if (pending?.id === id) localStorage.removeItem(key);
  } catch {
    // A stale hand-off key should not block the delete.
  }
}

async function pathsUsedByOthers(paths: string[], except: { templateId?: string; campaignId?: string }) {
  const wanted = new Set(paths);
  const used = new Set<string>();
  if (!supabase || !wanted.size) return { used, failed: false as const };
  const mark = (path: string | null | undefined) => {
    if (path && wanted.has(path)) used.add(path);
  };
  const templates = await supabase.from('outbound_templates').select('id,storage_path,metadata');
  if (templates.error) return { used: wanted, failed: true as const };
  for (const row of templates.data ?? []) {
    if (except.templateId && row.id === except.templateId) continue;
    mark(typeof row.storage_path === 'string' ? row.storage_path : null);
    const config = row.metadata && typeof row.metadata === 'object' ? (row.metadata as { config?: unknown }).config : undefined;
    const found = new Set<string>();
    collectStoragePaths(config, found);
    found.forEach((path) => mark(path));
  }
  const campaigns = await supabase.from('outbound_campaigns').select('id,config');
  if (campaigns.error) return { used: wanted, failed: true as const };
  const liveCampaigns = new Set<string>();
  for (const row of campaigns.data ?? []) {
    if (except.campaignId && row.id === except.campaignId) continue;
    liveCampaigns.add(row.id);
    const found = new Set<string>();
    collectStoragePaths(row.config, found);
    found.forEach((path) => mark(path));
  }
  const list = [...wanted];
  for (let index = 0; index < list.length; index += 40) {
    const slice = list.slice(index, index + 40);
    const assets = await supabase.from('outbound_assets').select('storage_path,campaign_id').in('storage_path', slice);
    if (assets.error) return { used: wanted, failed: true as const };
    for (const row of assets.data ?? []) {
      if (!row.campaign_id || row.campaign_id === except.campaignId) continue;
      if (!liveCampaigns.has(row.campaign_id)) continue;
      mark(row.storage_path);
    }
  }
  return { used, failed: false as const };
}

async function deleteStoragePaths(paths: string[]) {
  if (!supabase || !paths.length) return null;
  for (let index = 0; index < paths.length; index += 50) {
    const slice = paths.slice(index, index + 50);
    const removed = await supabase.storage.from(ASSET_BUCKET).remove(slice);
    if (removed.error) return removed.error.message;
    const deleted = await supabase.from('outbound_assets').delete().in('storage_path', slice);
    if (deleted.error) return deleted.error.message;
  }
  return null;
}

function ownedPaths(paths: Iterable<string>, userId: string, used: Set<string>) {
  return [...new Set(paths)].filter((path) => isManagedPath(path, userId) && !used.has(path));
}

export async function removeTemplateConfig(template: SavedTemplate, userId?: string): Promise<{ syncError?: string }> {
  if (supabase && userId) {
    const row = await supabase
      .from('outbound_templates')
      .select('id,storage_path,metadata')
      .eq('id', template.id)
      .maybeSingle();
    if (row.error) return { syncError: row.error.message };
    const paths = new Set<string>();
    if (typeof row.data?.storage_path === 'string') paths.add(row.data.storage_path);
    const config = row.data?.metadata && typeof row.data.metadata === 'object'
      ? (row.data.metadata as { config?: unknown }).config
      : template.config;
    collectStoragePaths(config ?? template.config, paths);
    const shared = await pathsUsedByOthers([...paths], { templateId: template.id });
    const stored = await deleteStoragePaths(ownedPaths(paths, userId, shared.used));
    if (stored) return { syncError: stored };
    const deleted = await supabase.from('outbound_templates').delete().eq('id', template.id);
    if (deleted.error) return { syncError: deleted.error.message };
  }
  try {
    writeLocalTemplates(listLocalTemplates(userId).filter((item) => item.id !== template.id), userId);
  } catch {
    // The Supabase row is already gone.
  }
  clearPendingLoad('gtm-studio-load-template', template.id, userId);
  return {};
}

export async function removeCampaign(campaign: SavedCampaign, userId?: string): Promise<{ syncError?: string }> {
  if (supabase && userId) {
    const assets = await supabase.from('outbound_assets').select('storage_path').eq('campaign_id', campaign.id);
    if (assets.error) return { syncError: assets.error.message };
    const paths = new Set<string>();
    for (const row of assets.data ?? []) {
      if (typeof row.storage_path === 'string') paths.add(row.storage_path);
    }
    collectStoragePaths(campaign.config, paths);
    collectStoragePaths(campaign.contacts, paths);
    const shared = await pathsUsedByOthers([...paths], { campaignId: campaign.id });
    const stored = await deleteStoragePaths(ownedPaths(paths, userId, shared.used));
    if (stored) return { syncError: stored };
    const deleted = await supabase.from('outbound_campaigns').delete().eq('id', campaign.id);
    if (deleted.error) return { syncError: deleted.error.message };
  }
  const storageKey = userKey(LOCAL_CAMPAIGNS, userId);
  const local = readJson<SavedCampaign[]>(storageKey, []);
  try {
    localStorage.setItem(storageKey, JSON.stringify(local.filter((item) => item.id !== campaign.id)));
  } catch {
    // The Supabase row is already gone.
  }
  clearPendingLoad('gtm-studio-load-campaign', campaign.id, userId);
  return {};
}

export type StoredFile = {
  id: string;
  filename: string;
  publicUrl: string;
  storagePath: string;
  bytes: number;
  label: string;
  createdAt: string;
  folderId: string | null;
  spaceId?: string;
  version?: number;
};

export type FileFolder = {
  id: string;
  name: string;
  createdAt: string;
  spaceId?: string;
};

function cleanLibraryName(value: string, limit = 80) {
  return value.replace(/\s+/g, ' ').trim().slice(0, limit);
}

function libraryError(error: { code?: string; message?: string }, fallback: string) {
  if (error.code === '23505' || /duplicate|unique/i.test(error.message || '')) return 'You already have a folder with that name.';
  return error.message || fallback;
}

function storedFileLabel(metadata: { kind?: string; role?: string } | null, filename: string) {
  const kind = metadata?.kind;
  if (kind === 'list') return 'Imported list';
  if (kind === 'desk') return 'Desk photo';
  if (kind === 'paper') return 'Paper photo';
  if (kind === 'signature') return 'Signature';
  if (kind === 'gif') return 'GIF';
  if (kind === 'carousel') return 'Carousel';
  if (metadata?.role === 'generated') return 'Generated image';
  if (/\.(csv|xlsx|xls|ods|tsv|txt)$/i.test(filename)) return 'Imported list';
  return 'File';
}

export async function listStoredFiles(userId?: string): Promise<StoredFile[]> {
  if (!supabase || !userId) return [];
  let query = supabase
    .from('outbound_assets')
    .select('id,filename,public_url,storage_path,bytes,metadata,created_at,folder_id,space_id,version')
    .is('deleted_at', null);
  const space = getQuerySpace();
  if (space) query = query.eq('space_id', space);
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(400);
  // Callers show a load error with Retry; an empty list here would hide the failure.
  if (error) throw error;
  if (!data) return [];
  return data.map((row) => ({
    id: row.id,
    filename: row.filename,
    publicUrl: row.public_url,
    storagePath: row.storage_path,
    bytes: row.bytes ?? 0,
    label: storedFileLabel((row.metadata ?? null) as { kind?: string; role?: string } | null, row.filename),
    createdAt: row.created_at,
    folderId: row.folder_id ?? null,
    spaceId: row.space_id ?? undefined,
    version: typeof row.version === 'number' ? row.version : undefined,
  }));
}

export async function listFileFolders(userId?: string): Promise<FileFolder[]> {
  if (!supabase || !userId) return [];
  let query = supabase
    .from('outbound_folders')
    .select('id,name,created_at,space_id')
    .is('deleted_at', null);
  const space = getQuerySpace();
  if (space) query = query.eq('space_id', space);
  const { data, error } = await query.order('name', { ascending: true });
  if (error) throw error;
  if (!data) return [];
  return data.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at, spaceId: row.space_id ?? undefined }));
}

export async function createFileFolder(name: string, userId?: string): Promise<{ folder?: FileFolder; syncError?: string }> {
  const cleaned = cleanLibraryName(name);
  if (!cleaned) return { syncError: 'Give the folder a name.' };
  if (!supabase || !userId) return { syncError: 'Sign in to create a folder in Supabase.' };
  const { data, error } = await supabase
    .from('outbound_folders')
    .insert({ user_id: userId, name: cleaned, ...spaceFields(getSaveSpace()) })
    .select('id,name,created_at')
    .single();
  if (error || !data) return { syncError: libraryError(error ?? {}, 'Could not create that folder.') };
  return { folder: { id: data.id, name: data.name, createdAt: data.created_at } };
}

export async function renameFileFolder(folderId: string, name: string, userId?: string, version?: number): Promise<ItemResult> {
  const cleaned = cleanLibraryName(name);
  if (!cleaned) return { syncError: 'Give the folder a name.' };
  if (!supabase || !userId) return { syncError: 'Sign in to rename a folder in Supabase.' };
  const result = await updateOne('outbound_folders', folderId, { name: cleaned }, version);
  if (result.error && result.error.code !== 'conflict') {
    return { ...result, syncError: libraryError(result.error.cause as { code?: string; message?: string } ?? {}, result.syncError ?? 'Could not rename that folder.') };
  }
  return result;
}

export async function removeFileFolder(folderId: string, userId?: string): Promise<{ syncError?: string }> {
  if (!supabase || !userId) return { syncError: 'Sign in to delete a folder in Supabase.' };
  const { error } = await supabase.from('outbound_folders').delete().eq('id', folderId);
  if (error) return { syncError: error.message };
  return {};
}

export async function renameStoredFile(fileId: string, filename: string, userId?: string, version?: number): Promise<ItemResult> {
  const cleaned = cleanLibraryName(filename, 120);
  if (!cleaned) return { syncError: 'Give the file a name.' };
  if (!supabase || !userId) return { syncError: 'Sign in to rename a file in Supabase.' };
  return updateOne('outbound_assets', fileId, { filename: cleaned }, version);
}

export async function moveStoredFile(fileId: string, folderId: string | null, userId?: string, version?: number): Promise<ItemResult> {
  if (!supabase || !userId) return { syncError: 'Sign in to move a file in Supabase.' };
  return updateOne('outbound_assets', fileId, { folder_id: folderId }, version);
}

function patchLocalCampaign(userId: string | undefined, id: string, patch: (item: SavedCampaign) => SavedCampaign) {
  const storageKey = userKey(LOCAL_CAMPAIGNS, userId);
  const local = readJson<SavedCampaign[]>(storageKey, []);
  if (!local.some((item) => item.id === id)) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(local.map((item) => (item.id === id ? patch(item) : item))));
  } catch {
    // The Supabase row already has the new name or folder.
  }
}

export async function renameTemplateConfig(template: SavedTemplate, name: string, userId?: string): Promise<ItemResult> {
  const cleaned = cleanLibraryName(name, 120);
  if (!cleaned) return { syncError: 'Give it a name.' };
  if (supabase && userId) {
    const row = await supabase.from('outbound_templates').select('metadata').eq('id', template.id).maybeSingle();
    if (row.error) return failed(row.error);
    const metadata = row.data?.metadata && typeof row.data.metadata === 'object' ? { ...row.data.metadata } : {};
    const previous = metadata.config && typeof metadata.config === 'object' ? metadata.config as StudioConfig : template.config;
    const updated = await updateOne(
      'outbound_templates',
      template.id,
      { name: cleaned, metadata: { ...metadata, config: { ...previous, campaignName: cleaned, templateId: template.id } } },
      template.version,
    );
    if (updated.syncError) return updated;
  }
  try {
    const current = listLocalTemplates(userId);
    writeLocalTemplates(current.map((item) => (
      item.id === template.id
        ? { ...item, name: cleaned, config: { ...item.config, campaignName: cleaned }, updatedAt: new Date().toISOString() }
        : item
    )), userId);
  } catch {
    // The Supabase row already has the new name.
  }
  return {};
}

export async function moveTemplateConfig(templateId: string, folderId: string | null, userId?: string, version?: number): Promise<ItemResult> {
  if (!supabase || !userId) return { syncError: 'Sign in to move a template in Supabase.' };
  const moved = await updateOne('outbound_templates', templateId, { folder_id: folderId }, version);
  if (moved.syncError) return moved;
  try {
    const current = listLocalTemplates(userId);
    writeLocalTemplates(current.map((item) => (item.id === templateId ? { ...item, folderId } : item)), userId);
  } catch {
    // The Supabase row already has the new folder.
  }
  return {};
}

export async function renameCampaign(campaign: SavedCampaign, name: string, userId?: string): Promise<ItemResult> {
  const cleaned = cleanLibraryName(name, 120);
  if (!cleaned) return { syncError: 'Give it a name.' };
  if (supabase && userId) {
    const row = await supabase.from('outbound_campaigns').select('config').eq('id', campaign.id).maybeSingle();
    if (row.error) return failed(row.error);
    const previous = row.data?.config && typeof row.data.config === 'object' ? row.data.config as StudioConfig : campaign.config;
    const updated = await updateOne(
      'outbound_campaigns',
      campaign.id,
      { name: cleaned, config: { ...previous, campaignName: cleaned, id: campaign.id }, updated_at: new Date().toISOString() },
      campaign.version,
    );
    if (updated.syncError) return updated;
  }
  patchLocalCampaign(userId, campaign.id, (item) => ({
    ...item,
    name: cleaned,
    config: { ...item.config, campaignName: cleaned },
    updatedAt: new Date().toISOString(),
  }));
  return {};
}

export async function moveCampaign(campaignId: string, folderId: string | null, userId?: string, version?: number): Promise<ItemResult> {
  if (!supabase || !userId) return { syncError: 'Sign in to move a campaign in Supabase.' };
  const moved = await updateOne('outbound_campaigns', campaignId, { folder_id: folderId }, version);
  if (moved.syncError) return moved;
  patchLocalCampaign(userId, campaignId, (item) => ({ ...item, folderId }));
  return {};
}

/** "<name> copy", then "<name> copy 2", 3… until no campaign (cloud or this browser) has it. */
export function uniqueCopyName(name: string, taken: Iterable<string>) {
  const used = new Set([...taken].map((item) => item.trim().toLowerCase()));
  const base = `${name.replace(/ copy(?: \d+)?$/i, '').trim() || 'Campaign'} copy`;
  if (!used.has(base.toLowerCase())) return base;
  for (let index = 2; index < 1000; index++) {
    const candidate = `${base} ${index}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${crypto.randomUUID().slice(0, 6)}`;
}

/** The list without this studio's generated columns, so a copy starts as a fresh draft. */
export function stripOutputColumns(campaign: Pick<SavedCampaign, 'mode' | 'columns' | 'contacts' | 'config'>) {
  const outputs = new Set(outputColumnNames(campaign.mode));
  const columns = (campaign.columns ?? []).filter((column) => !outputs.has(column));
  const contacts = (campaign.contacts ?? []).map((row) => {
    const next = { ...row };
    for (const column of outputs) delete next[column];
    return next;
  });
  const config: StudioConfig = {
    ...campaign.config,
    sourceColumns: campaign.config.sourceColumns?.filter((column) => !outputs.has(column)),
    fieldMap: campaign.config.fieldMap?.filter((item) => !outputs.has(item.column) && !outputs.has(item.customTag ?? '')),
  };
  return { columns, contacts, config };
}

/**
 * Saves a copy under a new id and a unique name (the browser mirror matches by name + mode, so
 * the name must differ), then files it in the same folder. The save never carries folder_id;
 * moveCampaign sets it on its own.
 */
export async function duplicateCampaign(
  campaign: SavedCampaign,
  userId?: string,
  takenNames: Iterable<string> = [],
): Promise<{ campaign?: SavedCampaign; syncError?: string }> {
  const local = readJson<SavedCampaign[]>(userKey(LOCAL_CAMPAIGNS, userId), []);
  const name = uniqueCopyName(campaign.name, [...takenNames, ...local.map((item) => item.name)]);
  const stripped = stripOutputColumns(campaign);
  const id = crypto.randomUUID();
  const config: StudioConfig = { ...stripped.config, id, campaignName: name, mode: campaign.mode, history: [] };
  const saved = await saveCampaign(config, stripped.columns, stripped.contacts, userId, { spaceId: campaign.spaceId ?? null });
  if (saved.syncError) return { campaign: saved, syncError: saved.syncError };
  const folderId = campaign.folderId ?? null;
  if (folderId && saved.cloud) {
    const moved = await moveCampaign(saved.id, folderId, userId);
    if (moved.syncError) return { campaign: saved, syncError: `Copied, but not moved to its folder: ${moved.syncError}` };
    return { campaign: { ...saved, folderId } };
  }
  return { campaign: saved };
}

/** Read-modify-write of one campaign's config jsonb (name, folder and list untouched). */
async function patchCampaignConfig(
  campaignId: string,
  fallback: StudioConfig | undefined,
  patch: (config: StudioConfig) => StudioConfig,
  userId?: string,
): Promise<ItemResult> {
  if (supabase && userId) {
    // Read-modify-write guarded by version: if someone saved in between, read again (up to 3 tries).
    for (let attempt = 0; ; attempt++) {
      const row = await supabase.from('outbound_campaigns').select('config,version').eq('id', campaignId).maybeSingle();
      if (row.error) return failed(row.error);
      if (!row.data) break;
      const previous = row.data.config && typeof row.data.config === 'object' ? row.data.config as StudioConfig : fallback;
      if (!previous) break;
      const version = typeof row.data.version === 'number' ? row.data.version : undefined;
      const updated = await updateOne('outbound_campaigns', campaignId, { config: { ...patch(previous), id: campaignId } }, version);
      if (!updated.syncError) break;
      if (updated.error?.code !== 'conflict' || attempt >= 2) return updated;
    }
  }
  patchLocalCampaign(userId, campaignId, (item) => ({ ...item, config: patch(item.config) }));
  return {};
}

/**
 * "Set client" now moves the campaign into an existing client space (an empty name moves it back
 * to Internal). Spaces are created on the Members page, never here. Without known spaces (local
 * mode, or a database before the spaces migration) it only sets the label, as before.
 */
export async function setCampaignClient(campaign: SavedCampaign, client: string, userId?: string): Promise<ItemResult> {
  const cleaned = cleanClient(client);
  const spaces = getKnownSpaces();
  if (!supabase || !userId || !spaces.length) {
    return patchCampaignConfig(campaign.id, campaign.config, (config) => ({ ...config, client: cleaned || undefined }), userId);
  }
  const target = cleaned
    ? spaces.find((space) => space.kind === 'client' && !space.archived_at && space.name.trim().toLowerCase() === cleaned.toLowerCase())
    : spaces.find((space) => space.kind === 'internal');
  if (!target) {
    return { syncError: cleaned ? `There is no client space called “${cleaned}”. Create it on the Members page first.` : 'The Internal space is missing.' };
  }
  const { data, error } = await supabase.rpc('bulk_move', { entity: 'campaign', ids: [campaign.id], target_folder: null, target_space: target.id });
  if (error) return failed(error);
  const row = (data as Array<{ ok?: boolean; message?: string | null; error_code?: string | null }> | null)?.[0];
  if (row && row.ok === false) return { syncError: row.message || 'Could not move that campaign.' };
  campaignSpaces.set(campaign.id, target.id);
  const label = target.kind === 'client' ? target.name : undefined;
  return patchCampaignConfig(campaign.id, campaign.config, (config) => ({ ...config, client: label }), userId);
}

/** Adds a history event to a saved campaign without a full save (used for exports). */
export async function appendCampaignHistory(
  campaignId: string,
  event: { kind: import('./types').CampaignEventKind; rows: number; at?: string },
  userId?: string,
) {
  const at = event.at ?? new Date().toISOString();
  return patchCampaignConfig(campaignId, undefined, (config) => ({ ...config, history: pushHistory(campaignHistory(config), { ...event, at }) }), userId);
}

export async function removeStoredFile(
  file: { storagePath?: string; publicUrl?: string },
  userId?: string,
): Promise<{ syncError?: string }> {
  const path = file.storagePath || storagePathFromPublicUrl(file.publicUrl);
  if (!path) return {};
  if (!supabase || !userId) return { syncError: 'Sign in to delete files from Supabase.' };
  if (!isManagedPath(path, userId)) return { syncError: 'That file is outside your Supabase folders.' };
  const removed = await supabase.storage.from(ASSET_BUCKET).remove([path]);
  if (removed.error) return { syncError: removed.error.message };
  const deleted = await supabase.from('outbound_assets').delete().eq('storage_path', path);
  if (deleted.error) return { syncError: deleted.error.message };
  return {};
}

export function subscribeTemplateChanges(userId: string | undefined, onChange: () => void) {
  const onFocus = () => onChange();
  window.addEventListener('focus', onFocus);
  if (!supabase || !userId) {
    return () => window.removeEventListener('focus', onFocus);
  }
  const channel = supabase
    .channel(`outbound-templates-${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'outbound_templates' },
      () => onChange(),
    )
    .subscribe();
  return () => {
    window.removeEventListener('focus', onFocus);
    void supabase.removeChannel(channel);
  };
}

const ASSET_BUCKET = 'outbound-assets';
const PUBLIC_OBJECT = `/storage/v1/object/public/${ASSET_BUCKET}/`;

export type StudioImageKind = 'desk' | 'paper' | 'signature' | 'gif' | 'list';

export function storagePathFromPublicUrl(url?: string) {
  if (!url) return null;
  const marker = url.indexOf(PUBLIC_OBJECT);
  if (marker === -1) return null;
  try {
    return decodeURIComponent(url.slice(marker + PUBLIC_OBJECT.length).split('?')[0]);
  } catch {
    return url.slice(marker + PUBLIC_OBJECT.length).split('?')[0];
  }
}

function extensionFor(blob: Blob, fallback = 'png') {
  if (blob.type.includes('gif')) return 'gif';
  if (blob.type.includes('webp')) return 'webp';
  if (blob.type.includes('jpeg')) return 'jpg';
  if (blob.type.includes('svg')) return 'svg';
  if (blob.type.includes('csv') || blob.type.includes('spreadsheet') || blob.type.includes('excel')) {
    if (blob.type.includes('spreadsheetml')) return 'xlsx';
    if (blob.type.includes('opendocument')) return 'ods';
    return 'csv';
  }
  if (blob.type.includes('png')) return 'png';
  return fallback;
}

export async function persistImportedList(file: File | Blob, filename: string, userId: string, campaignId?: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const safeName = filename.replace(/[^\w.-]+/g, '-') || 'prospects.csv';
  const ext = (safeName.includes('.') ? safeName.split('.').pop() : '') || extensionFor(file, 'csv');
  const mimeByExt: Record<string, string> = {
    csv: 'text/csv',
    tsv: 'text/plain',
    txt: 'text/plain',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
  };
  const contentType = mimeByExt[ext.toLowerCase()] || 'text/csv';
  const spaceId = await resolveCampaignSpace(campaignId);
  const path = storagePathFor(spaceId, userId, `lists/${crypto.randomUUID()}-${safeName.replace(/^\.+/, '')}`);
  const { error } = await supabase.storage.from(ASSET_BUCKET).upload(path, file, {
    contentType,
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(ASSET_BUCKET).getPublicUrl(path);
  const { error: metadataError } = await supabase.from('outbound_assets').insert({
    user_id: userId,
    ...spaceFields(spaceId),
    campaign_id: campaignId || null,
    filename: safeName,
    storage_path: path,
    public_url: data.publicUrl,
    content_type: contentType,
    bytes: file.size,
    contact_key: 'list',
    metadata: { kind: 'list', role: 'upload', originalName: filename },
  });
  if (metadataError) {
    await supabase.storage.from(ASSET_BUCKET).remove([path]);
    throw metadataError;
  }
  return { publicUrl: data.publicUrl, storagePath: path };
}

export async function persistStudioImage(
  source: File | Blob | string,
  kind: StudioImageKind,
  userId: string,
  campaignId?: string,
  /** Known space; undefined looks it up from the campaign (or uses the save space). */
  spaceIdHint?: string | null,
) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const blob = typeof source === 'string' ? await dataUrlBlob(source) : source;
  const ext = extensionFor(blob);
  const spaceId = spaceIdHint === undefined ? await resolveCampaignSpace(campaignId) : spaceIdHint;
  const path = storagePathFor(spaceId, userId, `uploads/${kind}/${crypto.randomUUID()}.${ext}`);
  const { error } = await supabase.storage.from(ASSET_BUCKET).upload(path, blob, {
    contentType: blob.type || `image/${ext}`,
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(ASSET_BUCKET).getPublicUrl(path);
  const { error: metadataError } = await supabase.from('outbound_assets').insert({
    user_id: userId,
    ...spaceFields(spaceId),
    campaign_id: campaignId || null,
    filename: `${kind}.${ext}`,
    storage_path: path,
    public_url: data.publicUrl,
    content_type: blob.type || `image/${ext}`,
    bytes: blob.size,
    contact_key: kind,
    metadata: { kind, role: 'upload' },
  });
  if (metadataError) {
    await supabase.storage.from(ASSET_BUCKET).remove([path]);
    throw metadataError;
  }
  return { publicUrl: data.publicUrl, storagePath: path };
}

export async function persistConfigImages(config: StudioConfig, userId: string, spaceId?: string | null): Promise<StudioConfig> {
  const next = { ...config };
  const jobs: Array<{ field: 'deskImage' | 'signatureImage' | 'customImage' | 'gifSourceDataUrl'; kind: StudioImageKind }> = [
    { field: 'deskImage', kind: 'desk' },
    { field: 'signatureImage', kind: 'signature' },
    { field: 'customImage', kind: 'paper' },
    { field: 'gifSourceDataUrl', kind: 'gif' },
  ];
  for (const { field, kind } of jobs) {
    const value = next[field];
    if (typeof value !== 'string' || !value.startsWith('data:')) continue;
    const stored = await persistStudioImage(value, kind, userId, next.id, spaceId);
    next[field] = stored.publicUrl;
  }
  return next;
}

export async function removeStoredImage(url?: string, userId?: string) {
  if (!supabase || !url) return;
  const path = storagePathFromPublicUrl(url);
  if (!path) return;
  if (userId && !isManagedPath(path, userId)) return;
  await supabase.storage.from(ASSET_BUCKET).remove([path]);
  await supabase.from('outbound_assets').delete().eq('storage_path', path);
}

function rowFromAssetRecord(row: {
  id: string;
  filename: string;
  public_url: string;
  bytes: number;
  contact_key: string | null;
  content_type: string | null;
  created_at?: string;
  metadata?: { mode?: StudioMode; role?: string } | null;
}): GeneratedAsset {
  return {
    id: row.id,
    row: Number(row.contact_key) || 0,
    filename: row.filename,
    blob: new Blob(),
    url: row.public_url,
    bytes: row.bytes ?? 0,
    selected: true,
    status: 'uploaded',
    publicUrl: row.public_url,
    uploadStatus: 'uploaded',
    createdAt: row.created_at,
    mode: row.metadata?.mode,
  };
}

export async function listStudioAssets(userId: string, mode: StudioMode, campaignId?: string, campaignName?: string) {
  if (!supabase) return [];
  // Paged, so a campaign of thousands of rows reviews in full (not just the newest 400 files).
  const client = supabase;
  const pageSize = 1000;
  // A saved campaign's files are found by campaign id (anyone's uploads); an unsaved one only has
  // the uploader's own files, matched by the name's slug in the path.
  const fetchPage = (from: number) => {
    const base = client
      .from('outbound_assets')
      .select('id,filename,public_url,bytes,contact_key,content_type,campaign_id,storage_path,metadata,created_at')
      .is('deleted_at', null);
    const scoped = campaignId ? base.eq('campaign_id', campaignId) : base.eq('user_id', userId);
    return scoped
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
  };
  const data: NonNullable<Awaited<ReturnType<typeof fetchPage>>['data']> = [];
  for (let from = 0; from < 20_000; from += pageSize) {
    const page = await fetchPage(from);
    if (page.error || !page.data) {
      if (!data.length) return [];
      break;
    }
    data.push(...page.data);
    if (page.data.length < pageSize) break;
  }
  const slug = campaignSlug(campaignName || `${mode} campaign`);
  const generated = campaignAssetRows(data, { campaignId, slug });
  const seen = new Set<string>();
  const unique: GeneratedAsset[] = [];
  for (const row of generated) {
    const key = `${row.contact_key}:${row.filename}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(rowFromAssetRecord(row));
  }
  return unique.sort((a, b) => a.row - b.row);
}

export async function ensureAssetBlob(asset: GeneratedAsset): Promise<GeneratedAsset> {
  if (asset.blob?.size) return asset;
  const src = asset.publicUrl || asset.url;
  if (!src) return asset;
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Could not download ${asset.filename} from Supabase.`);
  const blob = await response.blob();
  return {
    ...asset,
    blob,
    bytes: blob.size,
    url: URL.createObjectURL(blob),
    status: asset.status === 'failed' ? asset.status : blob.size > 200_000 ? 'warning' : asset.status,
  };
}

export async function uploadGeneratedAssets(
  assets: GeneratedAsset[],
  campaignName: string,
  userId: string,
  options: { campaignId?: string; mode?: StudioMode } = {},
) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const date = new Date().toISOString().slice(0, 10);
  const slug = campaignSlug(campaignName);
  const spaceId = await resolveCampaignSpace(options.campaignId);
  const results: GeneratedAsset[] = [];
  for (const asset of assets) {
    const version = crypto.randomUUID();
    const path = storagePathFor(spaceId, userId, `${slug}/${date}/${version}-${asset.filename}`);
    const ext = asset.filename.split('.').pop()?.toLowerCase();
    const contentType = asset.blob.type
      || (ext === 'gif' ? 'image/gif' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png');
    const { error } = await supabase.storage.from(ASSET_BUCKET).upload(path, asset.blob, {
      contentType,
      upsert: false,
    });
    if (error) {
      results.push({ ...asset, uploadStatus: 'failed', uploadError: error.message });
      continue;
    }
    const { data } = supabase.storage.from(ASSET_BUCKET).getPublicUrl(path);
    // The GIF's JPG poster goes up beside it. It is optional: if it fails, the GIF still counts as uploaded.
    let still = asset.still;
    if (still?.blob.size) {
      const stillPath = storagePathFor(spaceId, userId, `${slug}/${date}/${version}-${still.filename}`);
      const { error: stillError } = await supabase.storage.from(ASSET_BUCKET).upload(stillPath, still.blob, { contentType: 'image/jpeg', upsert: false });
      if (!stillError) still = { ...still, publicUrl: supabase.storage.from(ASSET_BUCKET).getPublicUrl(stillPath).data.publicUrl };
    }
    const { error: metadataError } = await supabase.from('outbound_assets').insert({
      user_id: userId,
      ...spaceFields(spaceId),
      campaign_id: options.campaignId || null,
      filename: asset.filename,
      storage_path: path,
      public_url: data.publicUrl,
      content_type: contentType,
      bytes: asset.bytes,
      contact_key: String(asset.row),
      metadata: { role: 'generated', mode: options.mode, row: asset.row, ...(still?.publicUrl ? { still_url: still.publicUrl } : {}) },
    });
    if (metadataError) {
      await supabase.storage.from(ASSET_BUCKET).remove([path]);
      results.push({ ...asset, uploadStatus: 'failed', uploadError: `Asset metadata failed: ${metadataError.message}` });
      continue;
    }
    results.push({ ...asset, ...(still ? { still } : {}), publicUrl: data.publicUrl, uploadStatus: 'uploaded', status: 'uploaded' });
  }
  return results;
}

// Carousel decks ---------------------------------------------------------------------------------
// The campaign and template tables only accept studio modes, so each carousel is a JSON text file
// in the asset bucket with an outbound_assets row tagged { kind: 'carousel' } for listing.

export type CarouselFileRow = { id: string; title: string; savedAt: string; storagePath: string };

function carouselRowTitle(metadata: { title?: unknown } | null, filename: string) {
  const fromName = filename.replace(/\.json$/i, '').trim();
  return fromName || (typeof metadata?.title === 'string' ? metadata.title : '') || 'Untitled carousel';
}

export async function saveCarouselFile(
  body: string,
  meta: { id: string; title: string; savedAt: string; filename: string; storagePath: string },
  userId: string,
) {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (!isCarouselPath(meta.storagePath, userId)) throw new Error('That carousel is outside your Supabase folders.');
  // A deck saved before keeps its file (legacy or space path); a new deck goes to the save space.
  const known = await supabase.from('outbound_assets').select('id,storage_path').eq('metadata->>carouselId', meta.id).limit(1);
  if (known.error) throw known.error;
  const knownRow = (known.data as Array<{ id: string; storage_path: string }> | null)?.[0];
  const spaceId = getSaveSpace();
  const storagePath = knownRow?.storage_path && isCarouselPath(knownRow.storage_path, userId)
    ? knownRow.storage_path
    : storagePathFor(spaceId, userId, `carousels/${meta.id}.json`);
  const blob = new Blob([body], { type: 'text/plain' });
  const { error } = await supabase.storage.from(ASSET_BUCKET).upload(storagePath, blob, {
    contentType: 'text/plain',
    upsert: true,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(ASSET_BUCKET).getPublicUrl(storagePath);
  const record = {
    filename: meta.filename,
    public_url: data.publicUrl,
    content_type: 'text/plain',
    bytes: blob.size,
    contact_key: 'carousel',
    metadata: { kind: 'carousel', role: 'carousel', mode: 'carousel', title: meta.title, carouselId: meta.id, savedAt: meta.savedAt },
  };
  const existing = knownRow?.storage_path === storagePath
    ? { data: [knownRow], error: null }
    : await supabase.from('outbound_assets').select('id').eq('storage_path', storagePath).limit(1);
  if (existing.error) throw existing.error;
  const rowId = (existing.data as Array<{ id: string }> | null)?.[0]?.id;
  const written = rowId
    ? await supabase.from('outbound_assets').update(record).eq('id', rowId)
    : await supabase.from('outbound_assets').insert({ ...record, user_id: userId, ...spaceFields(spaceFromStoragePath(storagePath) ?? spaceId), campaign_id: null, storage_path: storagePath });
  if (written.error) throw written.error;
  return { storagePath, publicUrl: data.publicUrl };
}

export async function listCarouselFiles(userId?: string): Promise<CarouselFileRow[]> {
  if (!supabase || !userId) return [];
  let query = supabase
    .from('outbound_assets')
    .select('id,filename,storage_path,metadata,created_at')
    .eq('metadata->>kind', 'carousel')
    .is('deleted_at', null);
  const space = getQuerySpace();
  if (space) query = query.eq('space_id', space);
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const metadata = (row.metadata ?? null) as { title?: unknown; savedAt?: unknown; carouselId?: unknown } | null;
    const fromPath = /\/carousels\/([a-z0-9-]+)\.json$/i.exec(String(row.storage_path))?.[1];
    return {
      id: typeof metadata?.carouselId === 'string' ? metadata.carouselId : fromPath || row.id,
      title: carouselRowTitle(metadata, String(row.filename ?? '')),
      savedAt: typeof metadata?.savedAt === 'string' ? metadata.savedAt : row.created_at,
      storagePath: row.storage_path,
    };
  });
}

export async function loadCarouselFile(storagePath: string, userId?: string) {
  if (!supabase || !userId) throw new Error('Sign in to open carousels saved in Supabase.');
  if (!isCarouselPath(storagePath, userId)) throw new Error('That carousel is outside your Supabase folders.');
  const { data, error } = await supabase.storage.from(ASSET_BUCKET).download(storagePath);
  if (error) throw error;
  return data.text();
}
