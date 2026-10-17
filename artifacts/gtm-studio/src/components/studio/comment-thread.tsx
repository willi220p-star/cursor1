import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { errorMessage } from '@/lib/app-error';
import { useAccess } from '@/studio/access-context';
import type { Comment } from '@/studio/contracts';
import { addComment, COMMENT_MAX, deleteComment, editComment, reviewKey, validateComment } from '@/studio/reviews';
import { refreshComments, removeCommentLocal, resolveAssetId, upsertComment, useCampaignReview } from './use-campaign-review';

function relative(at: string) {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? '' : formatDistanceToNow(date, { addSuffix: true });
}

const sendKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

function CommentItem({ comment, name, own, campaignId, canWrite }: { comment: Comment; name: string; own: boolean; campaignId: string; canWrite: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const problem = validateComment(draft);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      upsertComment(campaignId, await editComment(comment.id, draft));
      setEditing(false);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    removeCommentLocal(campaignId, comment.id);
    try {
      await deleteComment(comment.id);
    } catch (reason) {
      upsertComment(campaignId, comment);
      toast.error('Comment not deleted', { description: errorMessage(reason) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-[12px] border border-border bg-card p-3" data-testid="comment">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{name}</p>
        <p className="text-xs text-muted-foreground" title={new Date(comment.created_at).toLocaleString('en-US')}>
          {relative(comment.created_at)}{comment.edited_at ? ' · edited' : ''}
        </p>
      </div>
      {editing ? (
        <div className="mt-2 flex flex-col gap-2">
          <label className="sr-only" htmlFor={`edit-${comment.id}`}>Edit comment</label>
          <textarea
            id={`edit-${comment.id}`}
            className="field min-h-[72px] text-sm"
            value={draft}
            maxLength={COMMENT_MAX}
            autoFocus
            onChange={(event) => { setDraft(event.target.value); setError(null); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void save(); }
              if (event.key === 'Escape') { event.stopPropagation(); setEditing(false); }
            }}
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save()}>Save</button>
          </div>
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{comment.body}</p>
      )}
      {own && canWrite && !editing && (
        <div className="mt-1 flex gap-1">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDraft(comment.body); setEditing(true); }} aria-label="Edit comment"><Pencil size={14} aria-hidden /> Edit</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void remove()} aria-label="Delete comment"><Trash2 size={14} aria-hidden /> Delete</button>
        </div>
      )}
    </li>
  );
}

/**
 * Comment button with a count badge that opens a side sheet. Without `asset` it is the campaign
 * thread; with `asset` it is that image's thread (hidden until the image has a cloud row).
 */
export function CommentThread({ campaignId, asset, label }: { campaignId: string; asset?: { id: string; publicUrl?: string; filename: string }; label?: string }) {
  const review = useCampaignReview(campaignId);
  const { can } = useAccess();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listEnd = useRef<HTMLLIElement>(null);

  const assetId = asset ? resolveAssetId(review, asset) : null;
  const key = reviewKey(assetId);
  const comments = useMemo(() => review.comments.filter((comment) => reviewKey(comment.asset_id) === key), [review.comments, key]);
  const count = review.commentCounts.get(key) ?? 0;
  const spaceId = review.campaign?.space_id ?? null;
  const canWrite = Boolean(spaceId) && can('review.write', spaceId);

  useEffect(() => {
    if (open) void refreshComments(campaignId);
  }, [open, campaignId]);

  useEffect(() => {
    if (open) listEnd.current?.scrollIntoView({ block: 'end' });
  }, [open, comments.length]);

  if (review.status !== 'ready' || !review.campaign || (asset && !assetId)) return null;

  const title = asset ? `Comments on ${asset.filename}` : `Comments on ${review.campaign.name}`;

  const send = async () => {
    const problem = validateComment(body);
    if (problem) return setError(problem);
    if (!spaceId) return;
    setSending(true);
    try {
      const saved = await addComment({ spaceId, campaignId, assetId, body });
      upsertComment(campaignId, saved);
      setBody('');
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={asset ? 'btn btn-ghost btn-sm w-full' : 'btn btn-quiet'}
        onClick={() => setOpen(true)}
        aria-label={`${label ?? (asset ? 'Comments' : 'Campaign comments')}${count ? ` (${count})` : ''}`}
        data-testid={asset ? 'image-comments' : 'campaign-comments'}
      >
        <MessageSquare size={16} aria-hidden /> {label ?? (asset ? 'Comments' : 'Campaign comments')}
        {count > 0 && <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular" aria-hidden>{count}</span>}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col gap-4 bg-background sm:max-w-md" aria-describedby={undefined}>
          <SheetHeader className="pr-8">
            <SheetTitle className="display text-xl">{title}</SheetTitle>
            <SheetDescription>{count ? `${count} comment${count === 1 ? '' : 's'}` : 'No comments yet. Start the thread below.'}</SheetDescription>
          </SheetHeader>
          <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto" aria-label="Comments">
            {comments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                campaignId={campaignId}
                canWrite={canWrite}
                own={comment.author === review.userId}
                name={review.names.get(comment.author) ?? (comment.author === review.userId ? 'You' : 'Someone')}
              />
            ))}
            <li ref={listEnd} aria-hidden className="h-px" />
          </ol>
          {canWrite && (
            <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void send(); }}>
              <label className="sr-only" htmlFor={`composer-${campaignId}-${key}`}>Write a comment</label>
              <textarea
                id={`composer-${campaignId}-${key}`}
                className="field min-h-[88px] text-sm"
                placeholder="Write a comment"
                value={body}
                maxLength={COMMENT_MAX}
                aria-invalid={error ? true : undefined}
                onChange={(event) => { setBody(event.target.value); setError(null); }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); }
                }}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground tabular">{body.length.toLocaleString('en-US')}/{COMMENT_MAX.toLocaleString('en-US')} · {sendKey}+Enter sends</span>
                <button type="submit" className="btn btn-primary btn-sm" disabled={sending} data-loading={sending || undefined}>Send</button>
              </div>
              {error && <p className="field-error" role="alert">{error}</p>}
            </form>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
