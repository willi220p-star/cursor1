import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertCircle, CheckCircle2, Clock, Copy, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { BulkResult, BulkTarget } from '@/studio/contracts';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { bulkResultText, defaultVerb, groupFailures, summarizeBulkResult } from '@/lib/bulk-summary';

type RetryFailed = (failed: BulkTarget[]) => void;

interface ResultEntry {
  result: BulkResult;
  verb?: string;
  onRetryFailed?: RetryFailed;
}

// ── Store shared by showBulkResult and the mounted ResultsHost ─────────

let latest: ResultEntry | null = null;
let shown: ResultEntry | null = null;
const listeners = new Set<() => void>();

function setShown(next: ResultEntry | null) {
  shown = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getShown() {
  return shown;
}

/** Opens the results panel for the most recent bulk result (what the "Details" toast action does). */
export function openResultsPanel(entry: ResultEntry | null = latest) {
  setShown(entry);
}

/**
 * Toasts the outcome of a bulk action:
 * all succeeded → "Moved 47 items"; some failed → "47 moved, 3 failed" + Details;
 * queued → "3 changes will sync when you're back online".
 */
export function showBulkResult(result: BulkResult, opts?: { verb?: string; onRetryFailed?: (failed: BulkTarget[]) => void }): void {
  const entry: ResultEntry = { result, verb: opts?.verb, onRetryFailed: opts?.onRetryFailed };
  latest = entry;
  // A panel that is already open follows the newest result (e.g. after "Retry failed").
  if (shown) setShown(entry);

  const summary = summarizeBulkResult(result, opts?.verb);
  if (summary.kind === 'empty') return;
  if (summary.kind === 'success') {
    toast.success(summary.title);
  } else if (summary.kind === 'partial') {
    toast.error(summary.title, {
      description: summary.description,
      duration: 12_000,
      action: { label: 'Details', onClick: () => openResultsPanel(entry) },
    });
  } else {
    toast(summary.title, { description: summary.description });
  }
}

/** Mount once at the app root. Shows the panel when a toast's "Details" is clicked. */
export function ResultsHost() {
  const entry = useSyncExternalStore(subscribe, getShown, getShown);
  return (
    <ResultsPanel
      result={entry?.result ?? null}
      verb={entry?.verb}
      onRetryFailed={entry?.onRetryFailed}
      onClose={() => setShown(null)}
    />
  );
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

export function ResultsPanel({
  result,
  verb,
  onRetryFailed,
  onClose,
}: {
  result: BulkResult | null;
  verb?: string;
  onRetryFailed?: (failed: BulkTarget[]) => void;
  onClose: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => setRetrying(false), [result]);

  const phrase = result ? (verb ?? defaultVerb(result.action)) : '';
  const summary = result ? summarizeBulkResult(result, phrase) : null;
  const groups = result ? groupFailures(result.failed) : [];
  const failedCount = result?.failed.length ?? 0;

  const retry = () => {
    if (!result || !onRetryFailed || retrying || failedCount === 0) return;
    setRetrying(true);
    let outcome: unknown;
    try {
      // The signature says void, but a caller may return a promise; the button stays busy until it settles.
      outcome = (onRetryFailed as (failed: BulkTarget[]) => unknown)(result.failed.map((failure) => failure.target));
    } catch {
      outcome = undefined;
    }
    if (isThenable(outcome)) {
      Promise.resolve(outcome).finally(() => {
        if (mounted.current) setRetrying(false);
      });
    } else {
      onClose();
    }
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(bulkResultText(result, phrase));
      toast.success('Details copied');
    } catch {
      toast.error("Couldn't copy. Select the text and copy it yourself.");
    }
  };

  const Icon = summary?.kind === 'partial' ? AlertCircle : summary?.kind === 'queued' ? Clock : CheckCircle2;
  const tone = summary?.kind === 'partial' ? 'text-destructive' : summary?.kind === 'queued' ? 'text-warning' : 'text-success';

  return (
    <Dialog open={result !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="w-[min(560px,calc(100vw-32px))] max-w-none rounded-[12px] border-border bg-card p-5 shadow-[var(--shadow-overlay)] sm:max-w-none sm:p-6"
        data-testid="results-panel"
      >
        <DialogHeader>
          <DialogTitle className="display pr-8 text-2xl font-semibold">Results</DialogTitle>
          <DialogDescription asChild>
            <p role="status" aria-live="polite" className="flex items-start gap-2 text-base text-foreground">
              <Icon size={20} aria-hidden className={`mt-0.5 flex-none ${tone}`} />
              <span>
                <strong className="font-semibold">{summary?.title}</strong>
                {result && result.total > 0 && (
                  <span className="block text-sm text-muted-foreground">
                    {result.succeeded.length} of {result.total} done
                    {result.queued.length > 0 ? `, ${result.queued.length} waiting to sync` : ''}
                  </span>
                )}
              </span>
            </p>
          </DialogDescription>
        </DialogHeader>

        {groups.length > 0 && (
          <div className="flex max-h-[48vh] flex-col gap-4 overflow-y-auto pr-1" aria-label="Items that failed">
            {groups.map((group) => (
              <section key={group.code} aria-labelledby={`results-group-${group.code}`}>
                <h3 id={`results-group-${group.code}`} className="text-sm font-semibold">
                  {group.label} <span className="font-normal text-muted-foreground">({group.failures.length})</span>
                </h3>
                <p className="mb-2 text-sm text-muted-foreground">{group.message}</p>
                <ul className="m-0 list-none overflow-hidden rounded-[12px] border border-border p-0">
                  {group.failures.map((failure) => (
                    <li
                      key={`${failure.target.entity}:${failure.target.id}`}
                      className="flex flex-col gap-0.5 border-t border-border px-3 py-2 text-sm first:border-t-0"
                    >
                      <span className="truncate font-medium" title={failure.target.name}>{failure.target.name}</span>
                      {failure.error.message !== group.message && (
                        <span className="text-muted-foreground">{failure.error.message}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {result && result.queued.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {result.queued.length === 1 ? '1 change' : `${result.queued.length} changes`} will sync when you're back online.
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-quiet" onClick={() => void copy()}>
            <Copy size={16} aria-hidden /> Copy details
          </button>
          {onRetryFailed && failedCount > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={retry}
              disabled={retrying}
              data-loading={retrying ? 'true' : undefined}
              aria-busy={retrying}
            >
              <RotateCcw size={16} aria-hidden /> Retry failed ({failedCount})
            </button>
          )}
          {!(onRetryFailed && failedCount > 0) && (
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
