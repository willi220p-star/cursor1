import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, MessageSquareWarning } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/app-error';
import { useAccess } from '@/studio/access-context';
import type { Review, ReviewStatus } from '@/studio/contracts';
import { NOTE_MAX, setReview, statusVerb, validateNote } from '@/studio/reviews';
import { applyReview, confirmReview, resolveAssetId, useCampaignReview } from './use-campaign-review';

export function formatReviewTime(at: string) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Saves a review optimistically; rolls back with an error toast if the save fails. */
export async function submitReview(input: { campaignId: string; spaceId: string; assetId: string | null; status: ReviewStatus; note?: string | null; reviewer: string | null }) {
  const optimistic: Review = {
    id: `optimistic-${crypto.randomUUID()}`,
    space_id: input.spaceId,
    campaign_id: input.campaignId,
    asset_id: input.assetId,
    status: input.status,
    note: input.note?.trim() || null,
    reviewer: input.reviewer ?? '',
    created_at: new Date().toISOString(),
  };
  const rollback = applyReview(input.campaignId, optimistic);
  try {
    const { review, queued } = await setReview(input);
    confirmReview(input.campaignId, optimistic.id, review);
    if (queued) toast.message('Saved offline', { description: 'It syncs when you are back online.' });
    return true;
  } catch (error) {
    rollback();
    toast.error('Review not saved', { description: errorMessage(error) });
    return false;
  }
}

const isEditable = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * Approve / Request changes for one generated image. Mount it inside an element with
 * `data-review-tile` and tabIndex: with that tile focused, A approves and R opens the note.
 */
export function ReviewControls({ campaignId, asset }: { campaignId: string; asset: { id: string; publicUrl?: string; filename: string } }) {
  const review = useCampaignReview(campaignId);
  const { can } = useAccess();
  const root = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const spaceId = review.campaign?.space_id ?? null;
  const assetId = resolveAssetId(review, asset);
  const current = assetId ? review.current.get(assetId) : undefined;
  const allowed = review.status === 'ready' && Boolean(assetId && spaceId) && can('review.write', spaceId);

  const save = useCallback(async (status: ReviewStatus, text?: string) => {
    if (!assetId || !spaceId) return false;
    setBusy(true);
    const ok = await submitReview({ campaignId, spaceId, assetId, status, note: text ?? null, reviewer: review.userId });
    setBusy(false);
    return ok;
  }, [assetId, spaceId, campaignId, review.userId]);

  const approve = useCallback(() => {
    setNoting(false);
    void save('approved');
  }, [save]);

  const openNote = useCallback(() => {
    setNote('');
    setNoteError(null);
    setNoting(true);
  }, []);

  useEffect(() => {
    if (noting) noteRef.current?.focus();
  }, [noting]);

  useEffect(() => {
    if (!allowed) return;
    const tile = root.current?.closest<HTMLElement>('[data-review-tile]');
    if (!tile) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'a') {
        event.preventDefault();
        approve();
      } else if (key === 'r') {
        event.preventDefault();
        openNote();
      }
    };
    tile.addEventListener('keydown', onKey);
    return () => tile.removeEventListener('keydown', onKey);
  }, [allowed, approve, openNote]);

  if (!allowed) return null;

  const who = current ? review.names.get(current.reviewer) ?? (current.reviewer === review.userId ? 'you' : 'a reviewer') : '';
  const detail = current ? `${statusVerb(current.status)} by ${who} · ${formatReviewTime(current.created_at)}${current.note ? `\n“${current.note}”` : ''}` : undefined;

  const sendNote = async () => {
    const problem = validateNote(note);
    if (problem) {
      setNoteError(problem);
      noteRef.current?.focus();
      return;
    }
    const ok = await save('changes_requested', note);
    if (ok) setNoting(false);
  };

  return (
    <div ref={root} className="flex flex-col gap-2" data-testid="review-controls" data-review-status={current?.status ?? 'none'}>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={`Review ${asset.filename}`}>
        <button
          type="button"
          className={`btn btn-sm ${current?.status === 'approved' ? 'border-success bg-success text-background hover:bg-success' : 'btn-quiet'}`}
          aria-pressed={current?.status === 'approved'}
          aria-keyshortcuts="A"
          title={current?.status === 'approved' ? detail : 'Approve (A)'}
          disabled={busy}
          onClick={approve}
        >
          <Check size={16} aria-hidden /> Approve
        </button>
        <button
          type="button"
          className={`btn btn-sm ${current?.status === 'changes_requested' ? 'border-warning bg-warning text-background hover:bg-warning' : 'btn-quiet'}`}
          aria-pressed={current?.status === 'changes_requested'}
          aria-expanded={noting}
          aria-label="Request changes"
          aria-keyshortcuts="R"
          title={current?.status === 'changes_requested' ? detail : 'Request changes (R)'}
          disabled={busy}
          onClick={() => (noting ? setNoting(false) : openNote())}
        >
          <MessageSquareWarning size={16} aria-hidden /> Changes
        </button>
      </div>
      {current && !noting && (
        <p className="text-xs text-muted-foreground" title={detail} data-testid="review-status">
          {statusVerb(current.status)} by {who}
          {current.note ? <span className="block truncate">“{current.note}”</span> : null}
        </p>
      )}
      {noting && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void sendNote();
          }}
        >
          <label className="text-xs font-semibold" htmlFor={`note-${asset.id}`}>What should change?</label>
          <textarea
            id={`note-${asset.id}`}
            ref={noteRef}
            className="field min-h-[72px] text-sm"
            maxLength={NOTE_MAX}
            value={note}
            aria-invalid={noteError ? true : undefined}
            aria-describedby={noteError ? `note-error-${asset.id}` : undefined}
            onChange={(event) => {
              setNote(event.target.value);
              if (noteError) setNoteError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setNoting(false);
              }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void sendNote();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground tabular">{note.length}/{NOTE_MAX}</span>
            <div className="flex gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNoting(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Send</button>
            </div>
          </div>
          {noteError && <p id={`note-error-${asset.id}`} className="field-error" role="alert">{noteError}</p>}
        </form>
      )}
    </div>
  );
}
