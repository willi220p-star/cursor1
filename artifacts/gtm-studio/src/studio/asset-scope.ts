/** Which stored asset rows belong to one campaign, for "Review all images". */

export type AssetScopeRow = {
  campaign_id?: string | null;
  storage_path?: string | null;
  metadata?: unknown;
};

export function campaignSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'campaign';
}

/**
 * Generated files for this campaign only. A saved campaign matches on its id; the mode alone never
 * matches (that pulled in every other campaign of the same studio). Only an unsaved campaign, which
 * has no id yet, falls back to the upload path, which carries the campaign name's slug.
 */
export function campaignAssetRows<T extends AssetScopeRow>(rows: T[], scope: { campaignId?: string; slug: string }): T[] {
  return rows.filter((row) => {
    const meta = (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as { role?: string };
    if (meta.role === 'upload') return false;
    if (scope.campaignId) return row.campaign_id === scope.campaignId;
    return typeof row.storage_path === 'string' && row.storage_path.includes(`/${scope.slug}/`);
  });
}
