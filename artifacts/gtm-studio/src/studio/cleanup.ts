import { appendCampaignHistory, supabase } from './cloud';
import { ASSET_BUCKET, chunk, planCleanup, sizeFolders, type CleanupAssetRow, type CleanupPlan } from './cleanup-plan';
import type { Contact, SavedCampaign, StudioMode } from './types';

/**
 * Supabase side of "Clean up old versions". prepareCampaignCleanup only reads; runCampaignCleanup
 * deletes exactly the files a plan lists, in batches, and reports what went wrong per batch.
 */

const PAGE = 1000;
const REMOVE_BATCH = 100;

export type PreparedCleanup = CleanupPlan & { campaignId: string };

async function campaignAssetRows(campaignId: string, userId: string) {
  if (!supabase) return [];
  const rows: CleanupAssetRow[] = [];
  for (let from = 0; from < 20 * PAGE; from += PAGE) {
    const { data, error } = await supabase
      .from('outbound_assets')
      .select('id,campaign_id,storage_path,public_url,filename,bytes,metadata,created_at')
      .eq('user_id', userId)
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as CleanupAssetRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

/** Object sizes from storage listings of the folders the files sit in. Best effort. */
async function objectSizes(paths: string[]) {
  const sizes = new Map<string, number>();
  if (!supabase) return sizes;
  for (const folder of sizeFolders(paths).slice(0, 60)) {
    try {
      for (let offset = 0; offset < 10 * PAGE; offset += PAGE) {
        const { data, error } = await supabase.storage.from(ASSET_BUCKET).list(folder, { limit: PAGE, offset });
        if (error || !Array.isArray(data)) break;
        for (const item of data) {
          const size = Number((item.metadata as { size?: unknown } | null)?.size);
          if (item.name && Number.isFinite(size)) sizes.set(`${folder}/${item.name}`, size);
        }
        if (data.length < PAGE) break;
      }
    } catch {
      // No sizes for this folder; the dialog shows the count only.
    }
  }
  return sizes;
}

/** Reads the campaign's current list (fresh from Supabase), its asset rows and sizes, and plans. */
export async function prepareCampaignCleanup(campaign: SavedCampaign, userId?: string): Promise<PreparedCleanup> {
  const refuse = (refused: string): PreparedCleanup => ({ campaignId: campaign.id, keep: [], remove: [], bytes: 0, unknownSizes: 0, refused });
  if (!supabase || !userId) return refuse('Sign in to clean up files stored in Supabase.');
  if (!campaign.cloud) return refuse('This campaign is only saved in this browser. Save it to Supabase first.');
  const campaigns = await supabase.from('outbound_campaigns').select('id,mode,source_data').eq('user_id', userId);
  if (campaigns.error) throw campaigns.error;
  const all = (campaigns.data ?? []) as Array<{ id: string; mode: StudioMode; source_data: Contact[] | null }>;
  const current = all.find((row) => row.id === campaign.id);
  if (!current) return refuse('This campaign is not in Supabase any more. Refresh the library.');
  const rows = await campaignAssetRows(campaign.id, userId);
  const options = {
    userId,
    otherCampaigns: all.filter((row) => row.id !== campaign.id).map((row) => ({ id: row.id, contacts: row.source_data })),
  };
  const campaignInput = { id: campaign.id, mode: current.mode || campaign.mode, contacts: current.source_data ?? [] };
  const draft = planCleanup(campaignInput, rows, options);
  if (draft.refused || !draft.remove.length) return { ...draft, campaignId: campaign.id };
  const sizes = await objectSizes(draft.remove.map((file) => file.path));
  return { ...planCleanup(campaignInput, rows, { ...options, sizes }), campaignId: campaign.id };
}

export type CleanupResult = { deleted: number; freedBytes: number; unknownSizes: number; failures: string[] };

/** Deletes the plan's files (storage objects first, then their asset rows) and records it in history. */
export async function runCampaignCleanup(plan: PreparedCleanup, userId?: string): Promise<CleanupResult> {
  const result: CleanupResult = { deleted: 0, freedBytes: 0, unknownSizes: 0, failures: [] };
  if (!supabase || !userId) return { ...result, failures: ['Sign in to delete files from Supabase.'] };
  if (plan.refused) return { ...result, failures: [plan.refused] };
  const files = plan.remove.filter((file) => file.path.startsWith(`${userId}/`) && file.storagePath.startsWith(`${userId}/`));
  for (const batch of chunk(files, REMOVE_BATCH)) {
    const paths = batch.map((file) => file.storagePath);
    const removed = await supabase.storage.from(ASSET_BUCKET).remove(paths);
    if (removed.error) {
      result.failures.push(`${batch.length} ${batch.length === 1 ? 'file' : 'files'}: ${removed.error.message}`);
      continue;
    }
    result.deleted += batch.length;
    for (const file of batch) {
      if (file.bytes == null) result.unknownSizes += 1;
      else result.freedBytes += file.bytes;
    }
    // Stills have no row. The rows go only after their objects are gone, so a failed remove leaves both.
    const rowPaths = batch.filter((file) => file.kind === 'generated').map((file) => file.storagePath);
    if (!rowPaths.length) continue;
    const rows = await supabase
      .from('outbound_assets')
      .delete()
      .eq('user_id', userId)
      .eq('campaign_id', plan.campaignId)
      .in('storage_path', rowPaths);
    if (rows.error) result.failures.push(`Files deleted, but ${rowPaths.length} library ${rowPaths.length === 1 ? 'entry' : 'entries'} stayed: ${rows.error.message}`);
  }
  if (result.deleted) {
    const logged = await appendCampaignHistory(plan.campaignId, { kind: 'cleaned', rows: result.deleted }, userId);
    if (logged.syncError) result.failures.push(`Not added to history: ${logged.syncError}`);
  }
  return result;
}
