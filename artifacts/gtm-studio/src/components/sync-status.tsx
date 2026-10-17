import { useState } from 'react';
import { AlertCircle, CloudOff, RefreshCw, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  clearQueueFailures,
  discardQueued,
  flushQueue,
  useOnline,
  useQueuedOps,
  useQueueFailures,
  useSyncStatus,
} from '@/lib/offline-queue';
import { relativeTime } from '@/lib/app-error';

function changes(count: number): string {
  return `${count} change${count === 1 ? '' : 's'}`;
}

/** Text for the nav pill, or null when there is nothing to say. Exported for tests. */
export function syncPillLabel(state: { online: boolean; pending: number; running: boolean; failures: number }): string | null {
  const { online, pending, running, failures } = state;
  if (!online) return pending > 0 ? `Offline · ${changes(pending)} waiting` : 'Offline';
  if (running) return `Syncing ${pending}…`;
  if (pending > 0) return `${changes(pending)} waiting to sync`;
  if (failures > 0) return `${changes(failures)} couldn't sync`;
  return null;
}

/** Nav pill: "Offline · 3 changes waiting", "Syncing 3…", hidden when idle. Opens a list with Discard. */
export function SyncStatusPill() {
  const status = useSyncStatus();
  const online = useOnline();
  const queued = useQueuedOps();
  const failures = useQueueFailures();
  const [open, setOpen] = useState(false);

  const label = syncPillLabel({ online, pending: status.pending, running: status.running, failures: failures.length });
  if (label === null) return null;

  const tone = failures.length > 0 && status.pending === 0 ? 'var(--destructive)' : !online ? 'var(--warning)' : 'var(--primary)';
  const Icon = !online ? CloudOff : failures.length > 0 && status.pending === 0 ? AlertCircle : RefreshCw;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-11 w-11 flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-0 text-[13px] font-semibold sm:h-9 sm:w-auto sm:px-3"
          style={{ background: `color-mix(in srgb, ${tone} 13%, transparent)`, color: tone }}
          aria-live="polite"
          data-testid="sync-status-pill"
        >
          <Icon size={14} aria-hidden className={status.running ? 'animate-spin' : undefined} />
          {/* On phones the nav only has room for the icon; the words stay for screen readers. */}
          <span className="sr-only sm:not-sr-only">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(340px,calc(100vw-24px))] rounded-[12px] border-border bg-card p-0 shadow-[var(--shadow-overlay)]">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <strong className="text-sm font-semibold">{online ? 'Sync' : "You're offline"}</strong>
          {online && status.pending > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void flushQueue()} disabled={status.running}>
              Try now
            </button>
          )}
        </div>
        {!online && (
          <p className="px-4 pt-3 text-sm text-muted-foreground">Changes are saved on this device and sync when you're back online.</p>
        )}
        {status.lastError && status.pending > 0 && online && (
          <p className="px-4 pt-3 text-sm text-muted-foreground">Last try: {status.lastError.message}</p>
        )}

        {queued.length > 0 && (
          <section className="px-4 py-3" aria-label="Waiting to sync">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Waiting ({queued.length})</h3>
            <ul className="m-0 flex max-h-56 list-none flex-col gap-1 overflow-y-auto p-0">
              {queued.map((op) => (
                <li key={op.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate" title={op.label}>{op.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {relativeTime(op.createdAt) ?? ''}{op.attempts > 0 ? ` · tried ${op.attempts}×` : ''}
                    </span>
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void discardQueued(op.id)} aria-label={`Discard ${op.label}`}>
                    Discard
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {failures.length > 0 && (
          <section className="border-t border-border px-4 py-3" aria-label="Couldn't sync">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Couldn't sync ({failures.length})</h3>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => clearQueueFailures()}>Clear all</button>
            </div>
            <ul className="m-0 flex max-h-56 list-none flex-col gap-2 overflow-y-auto p-0">
              {failures.map((failure) => (
                <li key={failure.id} className="flex items-start justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium" title={failure.op.label}>{failure.op.label}</span>
                    <span className="block text-muted-foreground">{failure.error.message}</span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => clearQueueFailures(failure.id)}
                    aria-label={`Dismiss ${failure.op.label}`}
                  >
                    <X size={16} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </PopoverContent>
    </Popover>
  );
}
