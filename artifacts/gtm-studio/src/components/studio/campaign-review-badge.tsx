import { useEffect, useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import { supabase } from '@/studio/cloud';
import { getReviewSummary, onReviewSummaryInvalidated, peekReviewSummary, summaryLabel, type ReviewSummary } from '@/studio/reviews';

/**
 * "42/50 approved" plus the sign-off state, for campaign cards. Self-contained and cheap: every badge
 * rendered in the same tick shares one aggregated query (getReviewSummary batches and caches).
 * Renders nothing until there is something to say (no images and no sign-off).
 */
export function CampaignReviewBadge({ campaignId, className = '' }: { campaignId: string; className?: string }) {
  const [summary, setSummary] = useState<ReviewSummary | undefined>(() => peekReviewSummary(campaignId));

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    const load = () => {
      getReviewSummary(campaignId).then((value) => {
        if (alive) setSummary(value);
      }, () => undefined);
    };
    load();
    const stop = onReviewSummaryInvalidated((id) => {
      if (id === campaignId) load();
    });
    return () => {
      alive = false;
      stop();
    };
  }, [campaignId]);

  if (!summary || (!summary.total && !summary.signedOff)) return null;
  const complete = summary.total > 0 && summary.approved === summary.total;
  const tone = summary.signedOff || complete ? 'text-success' : summary.changesRequested ? 'text-warning' : 'text-muted-foreground';
  const signedOffOn = summary.signedOff ? new Date(summary.signedOff.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  const description = [
    summaryLabel(summary),
    summary.changesRequested ? `${summary.changesRequested} need changes` : '',
    summary.signedOff ? `signed off ${signedOffOn}` : '',
  ].filter(Boolean).join(', ');
  return (
    <span
      className={`inline-flex h-[22px] flex-none items-center gap-1 rounded-full bg-fill px-2 text-xs font-semibold tabular ${tone} ${className}`}
      title={description}
      aria-label={description}
      data-testid="campaign-review-badge"
    >
      {summary.signedOff && <BadgeCheck size={12} aria-hidden />}
      {summary.total > 0 ? summaryLabel(summary) : 'Signed off'}
      {summary.changesRequested > 0 && <span aria-hidden>· {summary.changesRequested} changes</span>}
    </span>
  );
}
