import { useEffect, useSyncExternalStore } from 'react';
import { errorMessage } from '@/lib/app-error';
import type { Comment, Review } from '@/studio/contracts';
import {
  commentCounts,
  currentUserId,
  displayName,
  latestReviews,
  listCampaignAssets,
  listComments,
  listReviews,
  loadCampaignInfo,
  loadProfiles,
  subscribeCampaignReviews,
  summarizeReviews,
  type AssetRef,
  type CampaignInfo,
  type ReviewSummary,
} from '@/studio/reviews';
import { supabase } from '@/studio/cloud';

/** Everything the review UI of one campaign shares: tiles, sign-off and comment threads. */
export type CampaignReviewState = {
  status: 'loading' | 'ready' | 'error' | 'unavailable';
  error: string | null;
  campaign: CampaignInfo | null;
  assets: AssetRef[];
  history: Review[];
  current: Map<string, Review>;
  comments: Comment[];
  commentCounts: Map<string, number>;
  summary: ReviewSummary;
  /** user_id → display name, for reviewers and comment authors. */
  names: Map<string, string>;
  userId: string | null;
};

const EMPTY_SUMMARY: ReviewSummary = { approved: 0, changesRequested: 0, total: 0, signedOff: null };

function initialState(): CampaignReviewState {
  return {
    status: supabase ? 'loading' : 'unavailable',
    error: null,
    campaign: null,
    assets: [],
    history: [],
    current: new Map(),
    comments: [],
    commentCounts: new Map(),
    summary: EMPTY_SUMMARY,
    names: new Map(),
    userId: null,
  };
}

type Store = {
  state: CampaignReviewState;
  listeners: Set<() => void>;
  refs: number;
  stop?: () => void;
};

const stores = new Map<string, Store>();

function storeFor(campaignId: string) {
  let store = stores.get(campaignId);
  if (!store) {
    store = { state: initialState(), listeners: new Set(), refs: 0 };
    stores.set(campaignId, store);
  }
  return store;
}

function setState(campaignId: string, patch: Partial<CampaignReviewState>) {
  const store = storeFor(campaignId);
  const next = { ...store.state, ...patch };
  if (patch.history || patch.assets) {
    next.current = latestReviews(next.history);
    next.summary = summarizeReviews(next.assets, next.history);
  }
  if (patch.comments) next.commentCounts = commentCounts(next.comments);
  store.state = next;
  for (const listener of store.listeners) listener();
}

async function resolveNames(campaignId: string) {
  const { history, comments, names } = storeFor(campaignId).state;
  const ids = [...history.map((review) => review.reviewer), ...comments.map((comment) => comment.author)].filter((id) => !names.has(id));
  if (!ids.length) return;
  const profiles = await loadProfiles(ids);
  const next = new Map(storeFor(campaignId).state.names);
  for (const [id, profile] of profiles) next.set(id, displayName(profile));
  setState(campaignId, { names: next });
}

export async function refreshReviews(campaignId: string) {
  try {
    const { history } = await listReviews(campaignId);
    setState(campaignId, { history });
    void resolveNames(campaignId);
  } catch (error) {
    setState(campaignId, { error: errorMessage(error) });
  }
}

export async function refreshComments(campaignId: string) {
  try {
    const comments = await listComments(campaignId, 'all');
    setState(campaignId, { comments });
    void resolveNames(campaignId);
  } catch (error) {
    setState(campaignId, { error: errorMessage(error) });
  }
}

export async function refreshAssets(campaignId: string) {
  try {
    setState(campaignId, { assets: await listCampaignAssets([campaignId]) });
  } catch (error) {
    setState(campaignId, { error: errorMessage(error) });
  }
}

async function load(campaignId: string) {
  if (!supabase) return;
  try {
    const [campaign, assets, { history }, comments, userId] = await Promise.all([
      loadCampaignInfo(campaignId),
      listCampaignAssets([campaignId]),
      listReviews(campaignId),
      listComments(campaignId, 'all'),
      currentUserId(),
    ]);
    setState(campaignId, { status: 'ready', error: null, campaign, assets, history, comments, userId });
    void resolveNames(campaignId);
  } catch (error) {
    setState(campaignId, { status: 'error', error: errorMessage(error) });
  }
}

/** Optimistic: shows the review at once. Returns an undo for rollback on failure. */
export function applyReview(campaignId: string, review: Review) {
  const { history } = storeFor(campaignId).state;
  setState(campaignId, { history: [...history, review] });
  void resolveNames(campaignId);
  return () => {
    setState(campaignId, { history: storeFor(campaignId).state.history.filter((item) => item.id !== review.id) });
  };
}

/** Swaps the optimistic row for the saved one. */
export function confirmReview(campaignId: string, optimisticId: string, saved: Review) {
  const { history } = storeFor(campaignId).state;
  setState(campaignId, { history: [...history.filter((item) => item.id !== optimisticId && item.id !== saved.id), saved] });
}

export function upsertComment(campaignId: string, comment: Comment) {
  const { comments } = storeFor(campaignId).state;
  const rest = comments.filter((item) => item.id !== comment.id);
  setState(campaignId, { comments: comment.deleted_at ? rest : [...rest, comment].sort((a, b) => a.created_at.localeCompare(b.created_at)) });
  void resolveNames(campaignId);
}

export function removeCommentLocal(campaignId: string, commentId: string) {
  const { comments } = storeFor(campaignId).state;
  setState(campaignId, { comments: comments.filter((item) => item.id !== commentId) });
}

function subscribe(campaignId: string, listener: () => void) {
  const store = storeFor(campaignId);
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}

const unavailable = initialState();

/** Shared, live review state for a campaign. `undefined` campaign → status 'unavailable'. */
export function useCampaignReview(campaignId: string | undefined | null): CampaignReviewState {
  const state = useSyncExternalStore(
    (listener) => (campaignId ? subscribe(campaignId, listener) : () => undefined),
    () => (campaignId ? storeFor(campaignId).state : unavailable),
  );
  useEffect(() => {
    if (!campaignId || !supabase) return;
    const store = storeFor(campaignId);
    store.refs += 1;
    if (store.refs === 1) {
      void load(campaignId);
      store.stop = subscribeCampaignReviews(campaignId, (table) => {
        if (table === 'reviews') void refreshReviews(campaignId);
        else void refreshComments(campaignId);
      });
    }
    return () => {
      store.refs -= 1;
      if (store.refs === 0) {
        store.stop?.();
        store.stop = undefined;
      }
    };
  }, [campaignId]);
  return state;
}

/**
 * The outbound_assets id behind a review tile: its own id when it came from the cloud, else the
 * stored row with the same public URL (a file uploaded in this session keeps its local id).
 */
export function resolveAssetId(state: CampaignReviewState, asset: { id: string; publicUrl?: string }) {
  const byId = state.assets.find((item) => item.id === asset.id);
  if (byId) return byId.id;
  if (!asset.publicUrl) return null;
  return state.assets.find((item) => item.public_url === asset.publicUrl)?.id ?? null;
}
