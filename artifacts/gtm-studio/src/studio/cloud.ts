import { createClient } from '@supabase/supabase-js';
import { attachPortraitCaches, stripPortraitDataUrls } from './portraits';
import type { GeneratedAsset, SavedCampaign, SavedTemplate, StudioConfig, StudioMode } from './types';

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

export async function listCampaigns(userId?: string): Promise<SavedCampaign[]> {
  const local = readJson<SavedCampaign[]>(userKey(LOCAL_CAMPAIGNS, userId), []);
  if (!supabase || !userId) return local;
  const { data, error } = await supabase
    .from('outbound_campaigns')
    .select('id,name,mode,config,source_columns,source_data,updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  const cloud = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    mode: row.mode,
    config: { ...row.config, id: row.id },
    columns: row.source_columns,
    contacts: row.source_data ?? [],
    updatedAt: row.updated_at,
    cloud: true,
  })) as SavedCampaign[];
  return [...cloud, ...local.filter((item) => !cloud.some((cloudItem) => cloudItem.id === item.id))];
}

export async function saveCampaign(config: StudioConfig, columns: string[], contacts: import('./types').Contact[], userId?: string) {
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
  let cloudConfig = savedConfig;
  try {
    cloudConfig = { ...savedConfig, ...(await persistConfigImages(savedConfig, userId)), id: savedConfig.id };
  } catch (reason) {
    return { ...record, syncError: reason instanceof Error ? reason.message : 'Could not upload images to Supabase.' };
  }
  const cloudPayload = {
    id: record.id,
    user_id: userId,
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
    return { ...record, id: retry.data.id, config: { ...cloudConfig, id: retry.data.id, gifFrames: savedConfig.gifFrames, gifDelays: savedConfig.gifDelays }, cloud: true };
  }
  return { ...record, id: data.id, config: { ...cloudConfig, id: data.id, gifFrames: savedConfig.gifFrames, gifDelays: savedConfig.gifDelays }, cloud: true };
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
  };
}

function writeLocalTemplates(templates: SavedTemplate[], userId?: string) {
  localStorage.setItem(userKey(LOCAL_TEMPLATES, userId), JSON.stringify(templates.slice(0, 40)));
}

export function saveLocalTemplate(config: StudioConfig, userId?: string) {
  const record = asSavedTemplate({ ...config, templateId: config.templateId || crypto.randomUUID() });
  if (!record) return;
  const current = listLocalTemplates(userId);
  writeLocalTemplates([record, ...current.filter((item) => item.id !== record.id)], userId);
}

export function listLocalTemplates(userId?: string): SavedTemplate[] {
  const raw = readJson<Array<SavedTemplate | StudioConfig>>(userKey(LOCAL_TEMPLATES, userId), []);
  return raw.map((item) => asSavedTemplate(item)).filter((item): item is SavedTemplate => Boolean(item));
}

const LOCAL_COPY_TEMPLATES = 'gtm-studio-copy-templates-v1';

export type CopyTemplate = {
  id: string;
  name: string;
  body: string;
  updatedAt: string;
  cloud: boolean;
};

function readLocalCopyTemplates(userId?: string): CopyTemplate[] {
  const raw = readJson<CopyTemplate[]>(userKey(LOCAL_COPY_TEMPLATES, userId), []);
  return raw.filter((item) => item && item.id && item.name && item.body);
}

function writeLocalCopyTemplates(templates: CopyTemplate[], userId?: string) {
  localStorage.setItem(userKey(LOCAL_COPY_TEMPLATES, userId), JSON.stringify(templates.slice(0, 80)));
}

export async function listCopyTemplates(userId?: string): Promise<CopyTemplate[]> {
  const local = readLocalCopyTemplates(userId);
  if (!supabase || !userId) return local;
  const { data, error } = await supabase
    .from('outbound_copy_templates')
    .select('id,name,body,updated_at')
    .order('updated_at', { ascending: false });
  if (error) return local;
  const cloud = (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    body: row.body as string,
    updatedAt: row.updated_at as string,
    cloud: true,
  }));
  const merged = [...cloud, ...local.filter((item) => !cloud.some((row) => row.id === item.id || row.name.toLowerCase() === item.name.toLowerCase()))];
  writeLocalCopyTemplates(merged, userId);
  return merged;
}

export async function saveCopyTemplate(name: string, body: string, userId?: string): Promise<{ template: CopyTemplate; syncError?: string }> {
  const trimmedName = name.trim();
  const trimmedBody = body.trim();
  const current = readLocalCopyTemplates(userId);
  const existing = current.find((item) => item.name.toLowerCase() === trimmedName.toLowerCase());
  const record: CopyTemplate = {
    id: existing?.id ?? crypto.randomUUID(),
    name: trimmedName,
    body: trimmedBody,
    updatedAt: new Date().toISOString(),
    cloud: false,
  };
  writeLocalCopyTemplates([record, ...current.filter((item) => item.id !== record.id && item.name.toLowerCase() !== trimmedName.toLowerCase())], userId);
  if (!supabase || !userId) return { template: record };
  const found = await supabase
    .from('outbound_copy_templates')
    .select('id')
    .eq('name', record.name)
    .maybeSingle();
  if (found.error) return { template: record, syncError: found.error.message };
  const write = found.data
    ? supabase
      .from('outbound_copy_templates')
      .update({ body: record.body, updated_at: record.updatedAt })
      .eq('id', found.data.id)
      .select('id,name,body,updated_at')
      .single()
    : supabase
      .from('outbound_copy_templates')
      .insert({
        id: record.id,
        user_id: userId,
        name: record.name,
        body: record.body,
        updated_at: record.updatedAt,
      })
      .select('id,name,body,updated_at')
      .single();
  const { data, error } = await write;
  if (error || !data) return { template: record, syncError: error?.message ?? 'Could not save the template.' };
  const saved: CopyTemplate = {
    id: data.id,
    name: data.name,
    body: data.body,
    updatedAt: data.updated_at,
    cloud: true,
  };
  const next = readLocalCopyTemplates(userId);
  writeLocalCopyTemplates([saved, ...next.filter((item) => item.id !== record.id && item.id !== saved.id && item.name.toLowerCase() !== saved.name.toLowerCase())], userId);
  return { template: saved };
}

export async function removeCopyTemplate(template: CopyTemplate, userId?: string): Promise<{ syncError?: string }> {
  const current = readLocalCopyTemplates(userId);
  writeLocalCopyTemplates(
    current.filter((item) => item.id !== template.id && item.name.toLowerCase() !== template.name.toLowerCase()),
    userId,
  );
  if (!supabase || !userId) return {};
  const byId = await supabase.from('outbound_copy_templates').delete().eq('id', template.id);
  if (byId.error) return { syncError: byId.error.message };
  const byName = await supabase.from('outbound_copy_templates').delete().eq('name', template.name);
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
    .select('id,name,mode,metadata,updated_at')
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
    } as SavedTemplate, true))
    .filter((item): item is SavedTemplate => Boolean(item));
  return [...cloud, ...local.filter((item) => !cloud.some((cloudItem) => cloudItem.id === item.id))];
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
      { event: '*', schema: 'public', table: 'outbound_templates', filter: `user_id=eq.${userId}` },
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

function campaignSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'campaign';
}

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
  const path = `${userId}/lists/${crypto.randomUUID()}-${safeName.replace(/^\.+/, '')}`;
  const { error } = await supabase.storage.from(ASSET_BUCKET).upload(path, file, {
    contentType,
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(ASSET_BUCKET).getPublicUrl(path);
  const { error: metadataError } = await supabase.from('outbound_assets').insert({
    user_id: userId,
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
) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const blob = typeof source === 'string' ? await dataUrlBlob(source) : source;
  const ext = extensionFor(blob);
  const path = `${userId}/uploads/${kind}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(ASSET_BUCKET).upload(path, blob, {
    contentType: blob.type || `image/${ext}`,
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(ASSET_BUCKET).getPublicUrl(path);
  const { error: metadataError } = await supabase.from('outbound_assets').insert({
    user_id: userId,
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

export async function persistConfigImages(config: StudioConfig, userId: string): Promise<StudioConfig> {
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
    const stored = await persistStudioImage(value, kind, userId, next.id);
    next[field] = stored.publicUrl;
  }
  return next;
}

export async function removeStoredImage(url?: string, userId?: string) {
  if (!supabase || !url) return;
  const path = storagePathFromPublicUrl(url);
  if (!path) return;
  if (userId && !path.startsWith(`${userId}/`)) return;
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
  const { data, error } = await supabase
    .from('outbound_assets')
    .select('id,filename,public_url,bytes,contact_key,content_type,campaign_id,storage_path,metadata,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(400);
  if (error || !data) return [];
  const slug = campaignSlug(campaignName || `${mode} campaign`);
  const generated = data.filter((row) => {
    const meta = (row.metadata ?? {}) as { role?: string; mode?: string };
    if (meta.role === 'upload') return false;
    if (campaignId && row.campaign_id === campaignId) return true;
    if (meta.mode === mode) return true;
    return typeof row.storage_path === 'string' && row.storage_path.includes(`/${slug}/`);
  });
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
  const results: GeneratedAsset[] = [];
  for (const asset of assets) {
    const version = crypto.randomUUID();
    const path = `${userId}/${slug}/${date}/${version}-${asset.filename}`;
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
    const { error: metadataError } = await supabase.from('outbound_assets').insert({
      user_id: userId,
      campaign_id: options.campaignId || null,
      filename: asset.filename,
      storage_path: path,
      public_url: data.publicUrl,
      content_type: contentType,
      bytes: asset.bytes,
      contact_key: String(asset.row),
      metadata: { role: 'generated', mode: options.mode, row: asset.row },
    });
    if (metadataError) {
      await supabase.storage.from(ASSET_BUCKET).remove([path]);
      results.push({ ...asset, uploadStatus: 'failed', uploadError: `Asset metadata failed: ${metadataError.message}` });
      continue;
    }
    results.push({ ...asset, publicUrl: data.publicUrl, uploadStatus: 'uploaded', status: 'uploaded' });
  }
  return results;
}
