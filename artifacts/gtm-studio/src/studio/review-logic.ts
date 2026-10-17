/**
 * Pure review, comment and notification helpers: no Supabase, no React, so they unit-test in Node.
 * The data layer (studio/reviews.ts) and the review components build on these.
 */
import type { AppNotification, NotificationKind, Profile, Review, ReviewStatus } from './contracts';

/** Map key for the whole-campaign sign-off (reviews with `asset_id = null`). */
export const CAMPAIGN_KEY = '__campaign__';

export const NOTE_MAX = 500;
export const COMMENT_MAX = 4000;

/** One generated image row of `outbound_assets`, as reviews need it. */
export type AssetRef = {
  id: string;
  campaign_id: string;
  contact_key: string | null;
  public_url: string | null;
  created_at?: string | null;
};

export type ReviewSummary = {
  approved: number;
  changesRequested: number;
  total: number;
  /** The current campaign sign-off, when it is an approval. */
  signedOff: Review | null;
};

export const reviewKey = (assetId: string | null | undefined) => assetId ?? CAMPAIGN_KEY;

function newer(a: { created_at?: string | null }, b: { created_at?: string | null }) {
  return String(a.created_at ?? '') >= String(b.created_at ?? '');
}

/**
 * Latest review per (campaign, asset) wins. Rows with the same timestamp resolve to the later one in
 * the list, so an optimistic row appended after a fetched one replaces it.
 */
export function latestReviews(reviews: readonly Review[]): Map<string, Review> {
  const current = new Map<string, Review>();
  for (const review of reviews) {
    const key = reviewKey(review.asset_id);
    const seen = current.get(key);
    if (!seen || newer(review, seen)) current.set(key, review);
  }
  return current;
}

/**
 * One image per contact row: a regenerated row keeps only its newest file, so "42/50" counts people,
 * not every file ever uploaded for them.
 */
export function latestAssetPerContact<T extends AssetRef>(assets: readonly T[]): T[] {
  const byContact = new Map<string, T>();
  for (const asset of assets) {
    const key = asset.contact_key ? `${asset.campaign_id}:${asset.contact_key}` : `id:${asset.id}`;
    const seen = byContact.get(key);
    if (!seen || newer(asset, seen)) byContact.set(key, asset);
  }
  return [...byContact.values()];
}

/** Counts for one campaign: only the assets given count, and only their current review. */
export function summarizeReviews(assets: readonly AssetRef[], reviews: readonly Review[]): ReviewSummary {
  const counted = latestAssetPerContact(assets);
  const current = latestReviews(reviews);
  let approved = 0;
  let changesRequested = 0;
  for (const asset of counted) {
    const status = current.get(asset.id)?.status;
    if (status === 'approved') approved += 1;
    else if (status === 'changes_requested') changesRequested += 1;
  }
  const campaign = current.get(CAMPAIGN_KEY);
  return { approved, changesRequested, total: counted.length, signedOff: campaign?.status === 'approved' ? campaign : null };
}

/** Groups assets and reviews by campaign and summarises each requested id (empty campaigns get zeros). */
export function summarizeCampaigns(ids: readonly string[], assets: readonly AssetRef[], reviews: readonly Review[]): Map<string, ReviewSummary> {
  const assetsBy = new Map<string, AssetRef[]>();
  const reviewsBy = new Map<string, Review[]>();
  for (const asset of assets) assetsBy.set(asset.campaign_id, [...(assetsBy.get(asset.campaign_id) ?? []), asset]);
  for (const review of reviews) reviewsBy.set(review.campaign_id, [...(reviewsBy.get(review.campaign_id) ?? []), review]);
  return new Map(ids.map((id) => [id, summarizeReviews(assetsBy.get(id) ?? [], reviewsBy.get(id) ?? [])]));
}

export function summaryLabel(summary: Pick<ReviewSummary, 'approved' | 'total'>) {
  return `${summary.approved.toLocaleString('en-US')}/${summary.total.toLocaleString('en-US')} approved`;
}

const images = (count: number) => (count === 1 ? '1 image' : `${count.toLocaleString('en-US')} images`);

/** Shown before a sign-off while some images still have "changes requested". */
export function signoffWarning(changesRequested: number) {
  if (changesRequested <= 0) return null;
  return `${images(changesRequested)} still ${changesRequested === 1 ? 'needs' : 'need'} changes — sign off anyway?`;
}

export function statusVerb(status: ReviewStatus) {
  return status === 'approved' ? 'Approved' : 'Changes requested';
}

/** Unread badge text: 0 hides the badge, past 99 it reads "99+". */
export function badgeText(count: number) {
  if (count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

export function displayName(profile: Pick<Profile, 'display_name' | 'email'> | null | undefined, fallback = 'Someone') {
  const name = profile?.display_name?.trim();
  if (name) return name;
  const email = profile?.email?.trim();
  return email ? email.split('@')[0] : fallback;
}

export function validateNote(note: string): string | null {
  const text = note.trim();
  if (!text) return 'Add a note so the team knows what to change.';
  if (text.length > NOTE_MAX) return `Keep the note under ${NOTE_MAX} characters.`;
  return null;
}

export function validateComment(body: string): string | null {
  const text = body.trim();
  if (!text) return 'Write a comment first.';
  if (text.length > COMMENT_MAX) return `Comments can be up to ${COMMENT_MAX.toLocaleString('en-US')} characters.`;
  return null;
}

/** Comment counts per asset (or CAMPAIGN_KEY for campaign-level), ignoring deleted comments. */
export function commentCounts(comments: readonly { asset_id: string | null; deleted_at: string | null }[]) {
  const counts = new Map<string, number>();
  for (const comment of comments) {
    if (comment.deleted_at) continue;
    const key = reviewKey(comment.asset_id);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// ── Notifications ──────────────────────────────────────────────────────

export type NotificationGroup = {
  /** Id of the newest notification in the group, used as the React key. */
  id: string;
  ids: string[];
  kind: NotificationKind;
  actor: string | null;
  campaign_id: string | null;
  /** Distinct images named in the group (campaign-level rows do not count). */
  assetCount: number;
  count: number;
  unread: boolean;
  created_at: string;
  /** The newest row's trigger-written summary, the fallback label. */
  summary: string;
};

const GROUP_WINDOW_MS = 60 * 60 * 1000;

/**
 * Folds a newest-first list into groups: the same actor doing the same thing on the same campaign
 * within an hour reads as one line ("Sam approved 3 images in Acme Q4").
 */
export function groupNotifications(list: readonly AppNotification[], windowMs = GROUP_WINDOW_MS): NotificationGroup[] {
  const sorted = [...list].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const groups: NotificationGroup[] = [];
  const assets = new Map<NotificationGroup, Set<string>>();
  for (const item of sorted) {
    const group = groups.find((candidate) => candidate.kind === item.kind
      && candidate.actor === item.actor
      && candidate.campaign_id === item.campaign_id
      && item.campaign_id !== null
      && Date.parse(candidate.created_at) - Date.parse(item.created_at) <= windowMs);
    if (group) {
      group.ids.push(item.id);
      group.count += 1;
      group.unread ||= !item.read_at;
      if (item.asset_id) assets.get(group)!.add(item.asset_id);
      group.assetCount = assets.get(group)!.size;
      continue;
    }
    const next: NotificationGroup = {
      id: item.id,
      ids: [item.id],
      kind: item.kind,
      actor: item.actor,
      campaign_id: item.campaign_id,
      assetCount: item.asset_id ? 1 : 0,
      count: 1,
      unread: !item.read_at,
      created_at: item.created_at,
      summary: item.summary,
    };
    assets.set(next, new Set(item.asset_id ? [item.asset_id] : []));
    groups.push(next);
  }
  return groups;
}

/** Plain-English line for a group, e.g. "Sam approved 3 images in Acme Q4". */
export function notificationLabel(
  group: Pick<NotificationGroup, 'kind' | 'assetCount' | 'count' | 'summary'>,
  names: { actor?: string | null; campaign?: string | null },
) {
  const actor = names.actor || 'Someone';
  const campaign = names.campaign;
  if (!campaign) return group.summary || `${actor} updated a campaign`;
  switch (group.kind) {
    case 'approved':
      return group.assetCount ? `${actor} approved ${images(group.assetCount)} in ${campaign}` : `${actor} approved ${campaign}`;
    case 'changes_requested':
      return group.assetCount ? `${actor} requested changes on ${images(group.assetCount)} in ${campaign}` : `${actor} requested changes on ${campaign}`;
    case 'signed_off':
      return `${actor} signed off ${campaign}`;
    case 'commented':
      return group.count > 1 ? `${actor} left ${group.count} comments on ${campaign}` : `${actor} commented on ${campaign}`;
    case 'review_requested':
      return `${actor} asked you to review ${campaign}`;
    default:
      return group.summary || `${actor} updated ${campaign}`;
  }
}

/** Localstorage key the bell writes so the Desk can open that campaign's review. */
export const OPEN_REVIEW_KEY = 'gtm-studio-open-review';

/** Where a notification click goes: the campaign's review page. */
export function reviewHref(campaignId: string) {
  return `/review/${encodeURIComponent(campaignId)}`;
}
