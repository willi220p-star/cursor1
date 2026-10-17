/**
 * Reviews, comments and in-app notifications (Supabase tables reviews, comments, notifications).
 * Every write goes through withRetry; a review made offline is queued ('review' handler) and synced
 * later. Errors are AppErrors with plain-English messages, ready to show inline.
 * Pure logic lives in review-logic.ts.
 */
import { appError, isAppError, toAppError } from '@/lib/app-error';
import { enqueue, isOnline, registerQueueHandler } from '@/lib/offline-queue';
import { unwrap, withRetry } from '@/lib/retry';
import { supabase } from './cloud';
import type { AppNotification, Comment, Profile, Review, ReviewStatus } from './contracts';
import {
  latestReviews,
  summarizeCampaigns,
  validateComment,
  validateNote,
  type AssetRef,
  type ReviewSummary,
} from './review-logic';

export * from './review-logic';

const PAGE = 1000;
const MAX_ROWS = 50_000;
const REVIEW_COLUMNS = 'id,space_id,campaign_id,asset_id,status,note,reviewer,created_at';
const COMMENT_COLUMNS = 'id,space_id,campaign_id,asset_id,author,body,created_at,edited_at,deleted_at';
const NOTIFICATION_COLUMNS = 'id,recipient,kind,space_id,campaign_id,asset_id,actor,summary,created_at,read_at';

function client() {
  if (!supabase) throw appError('unknown', 'Reviews need the cloud. Supabase is not configured.');
  return supabase;
}

export async function currentUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

async function requireUser() {
  const id = await currentUserId();
  if (!id) throw appError('permission', 'Sign in to review campaigns.');
  return id;
}

/** Reads every page of a query (PostgREST caps one response at 1000 rows). */
async function allPages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const data = await unwrap(page(from, from + PAGE - 1));
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// ── Campaign context ───────────────────────────────────────────────────

export type CampaignInfo = { id: string; name: string; space_id: string | null };

export async function loadCampaignInfo(campaignId: string): Promise<CampaignInfo | null> {
  const db = client();
  return withRetry(() => unwrap(db.from('outbound_campaigns').select('id,name,space_id').eq('id', campaignId).maybeSingle())) as Promise<CampaignInfo | null>;
}

const campaignNameCache = new Map<string, string>();

export async function loadCampaignNames(ids: readonly string[]): Promise<Map<string, string>> {
  const missing = [...new Set(ids)].filter((id) => !campaignNameCache.has(id));
  if (missing.length && supabase) {
    const db = supabase;
    try {
      const rows = await withRetry(() => unwrap(db.from('outbound_campaigns').select('id,name').in('id', missing))) as { id: string; name: string }[] | null;
      for (const row of rows ?? []) campaignNameCache.set(row.id, row.name);
    } catch {
      // Names are cosmetic; the trigger-written summary is the fallback.
    }
  }
  return new Map(ids.filter((id) => campaignNameCache.has(id)).map((id) => [id, campaignNameCache.get(id)!]));
}

type AssetRow = AssetRef & { metadata?: { role?: string } | null };

const isGenerated = (row: AssetRow) => row.metadata?.role !== 'upload';

/** Non-deleted generated images of these campaigns (uploaded lists and pictures excluded). */
export async function listCampaignAssets(campaignIds: readonly string[]): Promise<AssetRef[]> {
  if (!campaignIds.length) return [];
  const db = client();
  const rows = await withRetry(() => allPages<AssetRow>((from, to) => db
    .from('outbound_assets')
    .select('id,campaign_id,contact_key,public_url,created_at,metadata')
    .in('campaign_id', [...campaignIds])
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .range(from, to)));
  return rows.filter(isGenerated).map(({ metadata: _metadata, ...asset }) => asset);
}

// ── Reviews ────────────────────────────────────────────────────────────

export type CampaignReviews = { current: Map<string, Review>; history: Review[] };

export async function listReviews(campaignId: string): Promise<CampaignReviews> {
  const db = client();
  const history = await withRetry(() => allPages<Review>((from, to) => db
    .from('reviews')
    .select(REVIEW_COLUMNS)
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true })
    .range(from, to)));
  return { current: latestReviews(history), history };
}

export type ReviewInput = {
  spaceId: string;
  campaignId: string;
  /** null = whole-campaign sign-off. */
  assetId: string | null;
  status: ReviewStatus;
  note?: string | null;
};

type QueuedReview = ReviewInput & { reviewer: string; id: string; created_at: string };

async function insertReview(row: QueuedReview): Promise<Review> {
  const db = client();
  const saved = await withRetry(() => unwrap(db.from('reviews').insert({
    id: row.id,
    space_id: row.spaceId,
    campaign_id: row.campaignId,
    asset_id: row.assetId,
    status: row.status,
    note: row.note?.trim() || null,
    reviewer: row.reviewer,
  }).select(REVIEW_COLUMNS).single())) as Review;
  invalidateReviewSummary(row.campaignId);
  return saved;
}

registerQueueHandler('review', async (payload) => {
  try {
    await insertReview(payload as QueuedReview);
  } catch (error) {
    // The row id is fixed when the review is made, so a replay of a review that already landed is a duplicate: done.
    const cause = isAppError(error) ? error.cause : error;
    if ((cause as { code?: string } | null)?.code === '23505') return;
    throw error;
  }
});

/**
 * Records a review (one new row; the latest row is the current state). Offline, or when the network
 * drops after retries, the review is queued and `queued: true` comes back with the optimistic row.
 */
export async function setReview(input: ReviewInput): Promise<{ review: Review; queued: boolean }> {
  if (input.status === 'changes_requested') {
    const problem = validateNote(input.note ?? '');
    if (problem) throw appError('validation', problem);
  }
  const reviewer = await requireUser();
  const row: QueuedReview = { ...input, reviewer, id: crypto.randomUUID(), created_at: new Date().toISOString() };
  const optimistic: Review = {
    id: row.id,
    space_id: input.spaceId,
    campaign_id: input.campaignId,
    asset_id: input.assetId,
    status: input.status,
    note: input.note?.trim() || null,
    reviewer,
    created_at: row.created_at,
  };
  const queue = async () => {
    await enqueue({ kind: 'review', payload: row, label: input.status === 'approved' ? 'Approve image' : 'Request changes' });
    return { review: optimistic, queued: true };
  };
  if (!isOnline()) return queue();
  try {
    return { review: await insertReview(row), queued: false };
  } catch (error) {
    const app = toAppError(error);
    if (app.code === 'offline' || app.code === 'network') return queue();
    throw app;
  }
}

// ── Review summaries (campaign cards) ──────────────────────────────────

const SUMMARY_TTL_MS = 30_000;
const summaryCache = new Map<string, { at: number; value: ReviewSummary }>();
const summaryListeners = new Set<(campaignId: string) => void>();

/** One aggregated pass for many campaigns: two paged queries, whatever the number of ids. */
export async function loadReviewSummaries(campaignIds: readonly string[]): Promise<Map<string, ReviewSummary>> {
  const ids = [...new Set(campaignIds)];
  if (!ids.length) return new Map();
  const db = client();
  const [assets, reviews] = await Promise.all([
    listCampaignAssets(ids),
    withRetry(() => allPages<Review>((from, to) => db
      .from('reviews')
      .select(REVIEW_COLUMNS)
      .in('campaign_id', ids)
      .order('created_at', { ascending: true })
      .range(from, to))),
  ]);
  const summaries = summarizeCampaigns(ids, assets, reviews);
  const at = Date.now();
  for (const [id, value] of summaries) summaryCache.set(id, { at, value });
  return summaries;
}

type Waiter = { resolve: (value: ReviewSummary) => void; reject: (error: unknown) => void };
let batch: Map<string, Waiter[]> | null = null;
const inflight = new Map<string, Promise<ReviewSummary>>();

function flushBatch() {
  const current = batch;
  batch = null;
  if (!current) return;
  const ids = [...current.keys()];
  loadReviewSummaries(ids).then((summaries) => {
    for (const [id, waiters] of current) {
      const value = summaries.get(id) ?? { approved: 0, changesRequested: 0, total: 0, signedOff: null };
      for (const waiter of waiters) waiter.resolve(value);
    }
  }, (error) => {
    for (const waiters of current.values()) for (const waiter of waiters) waiter.reject(toAppError(error));
  });
}

/**
 * Summary for one campaign. Calls made in the same tick (every badge on a visible list) coalesce
 * into one loadReviewSummaries call; results are cached for 30 seconds.
 */
export function getReviewSummary(campaignId: string): Promise<ReviewSummary> {
  const cached = summaryCache.get(campaignId);
  if (cached && Date.now() - cached.at < SUMMARY_TTL_MS) return Promise.resolve(cached.value);
  const running = inflight.get(campaignId);
  if (running) return running;
  const promise = new Promise<ReviewSummary>((resolve, reject) => {
    if (!batch) {
      batch = new Map();
      setTimeout(flushBatch, 0);
    }
    batch.set(campaignId, [...(batch.get(campaignId) ?? []), { resolve, reject }]);
  }).finally(() => inflight.delete(campaignId));
  inflight.set(campaignId, promise);
  return promise;
}

export function peekReviewSummary(campaignId: string) {
  return summaryCache.get(campaignId)?.value;
}

/** Drops the cached summary and tells mounted badges to refetch. */
export function invalidateReviewSummary(campaignId: string) {
  summaryCache.delete(campaignId);
  for (const listener of summaryListeners) listener(campaignId);
}

export function onReviewSummaryInvalidated(listener: (campaignId: string) => void) {
  summaryListeners.add(listener);
  return () => {
    summaryListeners.delete(listener);
  };
}

// ── Comments ───────────────────────────────────────────────────────────

/** Comments oldest first. `assetId` undefined or null = campaign thread; 'all' = every thread. */
export async function listComments(campaignId: string, assetId: string | null | 'all' = null): Promise<Comment[]> {
  const db = client();
  return withRetry(() => allPages<Comment>((from, to) => {
    let query = db.from('comments').select(COMMENT_COLUMNS).eq('campaign_id', campaignId).is('deleted_at', null);
    if (assetId === null) query = query.is('asset_id', null);
    else if (assetId !== 'all') query = query.eq('asset_id', assetId);
    return query.order('created_at', { ascending: true }).range(from, to);
  }));
}

export async function addComment(input: { spaceId: string; campaignId: string; assetId: string | null; body: string }): Promise<Comment> {
  const problem = validateComment(input.body);
  if (problem) throw appError('validation', problem);
  const author = await requireUser();
  const db = client();
  return withRetry(() => unwrap(db.from('comments').insert({
    space_id: input.spaceId,
    campaign_id: input.campaignId,
    asset_id: input.assetId,
    author,
    body: input.body.trim(),
  }).select(COMMENT_COLUMNS).single())) as Promise<Comment>;
}

/** Authors edit their own comments (RLS enforces it; the author filter keeps the intent explicit). */
export async function editComment(id: string, body: string): Promise<Comment> {
  const problem = validateComment(body);
  if (problem) throw appError('validation', problem);
  const author = await requireUser();
  const db = client();
  const rows = await withRetry(() => unwrap(db.from('comments')
    .update({ body: body.trim(), edited_at: new Date().toISOString() })
    .eq('id', id)
    .eq('author', author)
    .select(COMMENT_COLUMNS))) as Comment[] | null;
  if (!rows?.length) throw appError('permission', 'You can only edit your own comments.');
  return rows[0];
}

/** Soft delete: the row stays, `deleted_at` hides it. */
export async function deleteComment(id: string): Promise<void> {
  const author = await requireUser();
  const db = client();
  const rows = await withRetry(() => unwrap(db.from('comments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('author', author)
    .select('id'))) as { id: string }[] | null;
  if (!rows?.length) throw appError('permission', 'You can only delete your own comments.');
}

// ── Profiles (names) ───────────────────────────────────────────────────

const profileCache = new Map<string, Profile | null>();

/** Names for user ids. Unknown or hidden profiles (RLS) map to null and are not asked for again. */
export async function loadProfiles(ids: readonly (string | null | undefined)[]): Promise<Map<string, Profile | null>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const missing = wanted.filter((id) => !profileCache.has(id));
  if (missing.length && supabase) {
    const db = supabase;
    try {
      const rows = await withRetry(() => unwrap(db.from('profiles').select('user_id,email,display_name,org_role').in('user_id', missing))) as Profile[] | null;
      for (const row of rows ?? []) profileCache.set(row.user_id, row);
      for (const id of missing) if (!profileCache.has(id)) profileCache.set(id, null);
    } catch {
      // Leave uncached so a later call can try again.
    }
  }
  return new Map(wanted.map((id) => [id, profileCache.get(id) ?? null]));
}

// ── Notifications ──────────────────────────────────────────────────────

export async function listNotifications(limit = 30): Promise<AppNotification[]> {
  const db = client();
  return withRetry(() => unwrap(db.from('notifications')
    .select(NOTIFICATION_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit))) as Promise<AppNotification[]>;
}

export async function unreadCount(): Promise<number> {
  const db = client();
  return withRetry(async () => {
    const { count, error } = await db.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
    if (error) throw toAppError(error);
    return count ?? 0;
  });
}

export async function markRead(ids: string | readonly string[]): Promise<void> {
  const list = typeof ids === 'string' ? [ids] : [...ids];
  if (!list.length) return;
  const db = client();
  await withRetry(() => unwrap(db.from('notifications').update({ read_at: new Date().toISOString() }).in('id', list).is('read_at', null)));
}

export async function markAllRead(): Promise<void> {
  const db = client();
  await withRetry(() => unwrap(db.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)));
}

/** Realtime: any insert/update of this user's notifications. Also refreshes on window focus. */
export function subscribeNotifications(userId: string, onChange: () => void) {
  const onFocus = () => onChange();
  window.addEventListener('focus', onFocus);
  if (!supabase) return () => window.removeEventListener('focus', onFocus);
  const db = supabase;
  const channel = db
    .channel(`notifications-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `recipient=eq.${userId}` }, () => onChange())
    .subscribe();
  return () => {
    window.removeEventListener('focus', onFocus);
    void db.removeChannel(channel);
  };
}

/** Realtime: reviews and comments of one campaign. */
export function subscribeCampaignReviews(campaignId: string, onChange: (table: 'reviews' | 'comments') => void) {
  if (!supabase) return () => undefined;
  const db = supabase;
  const filter = `campaign_id=eq.${campaignId}`;
  const channel = db
    .channel(`campaign-reviews-${campaignId}-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews', filter }, () => {
      invalidateReviewSummary(campaignId);
      onChange('reviews');
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter }, () => onChange('comments'))
    .subscribe();
  return () => {
    void db.removeChannel(channel);
  };
}
