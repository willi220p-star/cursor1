import { useState } from 'react';
import { BadgeCheck, MessageSquareWarning, TriangleAlert } from 'lucide-react';
import { useAccess } from '@/studio/access-context';
import { CAMPAIGN_KEY, NOTE_MAX, signoffWarning, summaryLabel, validateNote } from '@/studio/reviews';
import { submitReview } from './review-controls';
import { useCampaignReview } from './use-campaign-review';

function formatDay(at: string) {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Whole-campaign sign-off: "Sign off campaign" or "Request changes" with a note. */
export function CampaignSignoff({ campaignId }: { campaignId: string }) {
  const review = useCampaignReview(campaignId);
  const { can } = useAccess();
  const [confirming, setConfirming] = useState(false);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (review.status !== 'ready' || !review.campaign) return null;
  const spaceId = review.campaign.space_id;
  const current = review.current.get(CAMPAIGN_KEY);
  const who = current ? review.names.get(current.reviewer) ?? (current.reviewer === review.userId ? 'you' : 'a reviewer') : '';
  const writable = Boolean(spaceId) && can('review.write', spaceId);
  const warning = signoffWarning(review.summary.changesRequested);

  const save = async (status: 'approved' | 'changes_requested', text?: string) => {
    if (!spaceId) return false;
    setBusy(true);
    const ok = await submitReview({ campaignId, spaceId, assetId: null, status, note: text ?? null, reviewer: review.userId });
    setBusy(false);
    return ok;
  };

  const signOff = async () => {
    if (warning && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    await save('approved');
  };

  const sendNote = async () => {
    const problem = validateNote(note);
    if (problem) return setNoteError(problem);
    if (await save('changes_requested', note)) {
      setNoting(false);
      setNote('');
    }
  };

  return (
    <section className="rounded-[12px] border border-border bg-surface-2 p-4" aria-label="Campaign sign-off" data-testid="campaign-signoff">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            <span className="tabular" data-testid="signoff-summary">{summaryLabel(review.summary)}</span>
            {review.summary.changesRequested > 0 && <span className="ml-2 font-normal text-warning">{review.summary.changesRequested} need changes</span>}
          </p>
          {current?.status === 'approved' && (
            <p className="mt-1 flex items-center gap-1 text-sm text-success" data-testid="signoff-state"><BadgeCheck size={16} aria-hidden /> Signed off by {who} on {formatDay(current.created_at)}</p>
          )}
          {current?.status === 'changes_requested' && (
            <p className="mt-1 text-sm text-warning" data-testid="signoff-state">Changes requested by {who} on {formatDay(current.created_at)}{current.note ? `: “${current.note}”` : ''}</p>
          )}
          {!current && <p className="mt-1 text-sm text-muted-foreground" data-testid="signoff-state">Not signed off yet</p>}
        </div>
        {writable && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-quiet" disabled={busy} aria-expanded={noting} onClick={() => { setNoting((open) => !open); setConfirming(false); setNoteError(null); }}>
              <MessageSquareWarning size={16} aria-hidden /> Request changes
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void signOff()}>
              <BadgeCheck size={16} aria-hidden /> Sign off campaign
            </button>
          </div>
        )}
      </div>
      {confirming && warning && (
        <div className="mt-3 flex flex-col gap-2 rounded-[12px] border border-warning p-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <p className="flex items-center gap-2 text-sm text-warning"><TriangleAlert size={16} aria-hidden /> {warning}</p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>Cancel</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void signOff()}>Sign off anyway</button>
          </div>
        </div>
      )}
      {noting && (
        <form className="mt-3 flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void sendNote(); }}>
          <label className="text-sm font-semibold" htmlFor={`signoff-note-${campaignId}`}>What should change before sign-off?</label>
          <textarea
            id={`signoff-note-${campaignId}`}
            className="field min-h-[72px] text-sm"
            maxLength={NOTE_MAX}
            value={note}
            autoFocus
            aria-invalid={noteError ? true : undefined}
            onChange={(event) => { setNote(event.target.value); setNoteError(null); }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { event.stopPropagation(); setNoting(false); }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void sendNote(); }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground tabular">{note.length}/{NOTE_MAX}</span>
            <div className="flex gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNoting(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Send request</button>
            </div>
          </div>
          {noteError && <p className="field-error" role="alert">{noteError}</p>}
        </form>
      )}
      {review.error && <p className="field-error" role="alert">{review.error}</p>}
    </section>
  );
}
