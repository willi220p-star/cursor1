import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, CircleX, Download, RotateCcw, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { planZipParts, zipItemsFor } from '@/studio/batch-chunks';
import { Skeleton } from '@/components/ui/skeleton';
import type { GeneratedAsset } from '@/studio/types';
import { formatBytes } from './shared';

function StatusBadge({ asset }: { asset: GeneratedAsset }) {
  if (asset.status === 'failed') {
    return <span className="status-badge is-failed"><CircleX size={12} aria-hidden /> Failed</span>;
  }
  if (asset.status === 'warning') {
    return <span className="status-badge is-warning"><TriangleAlert size={12} aria-hidden /> Over 200 KB</span>;
  }
  return <span className="status-badge is-ready"><Check size={12} aria-hidden /> {asset.status === 'uploaded' ? 'Uploaded' : 'Ready'}</span>;
}

/** Cards per page: thousands of rows stay quick to scroll and select. */
export const REVIEW_PAGE_SIZE = 100;

function PageControls({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null;
  const first = page * REVIEW_PAGE_SIZE + 1;
  const last = Math.min(total, (page + 1) * REVIEW_PAGE_SIZE);
  return (
    <nav className="review-pager" aria-label="Review pages">
      <button type="button" className="btn btn-quiet btn-icon" aria-label="Previous page" disabled={page <= 0} onClick={() => onPage(page - 1)}><ChevronLeft size={16} aria-hidden /></button>
      <span className="text-sm tabular" aria-live="polite">{first.toLocaleString('en-US')}–{last.toLocaleString('en-US')} of {total.toLocaleString('en-US')}</span>
      <label className="sr-only" htmlFor="review-page">Page</label>
      <select id="review-page" className="field review-page-select" value={page} onChange={(event) => onPage(Number(event.target.value))}>
        {Array.from({ length: pages }, (_, index) => <option key={index} value={index}>Page {index + 1} of {pages}</option>)}
      </select>
      <button type="button" className="btn btn-quiet btn-icon" aria-label="Next page" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}><ChevronRight size={16} aria-hidden /></button>
    </nav>
  );
}

export function BatchReview({
  assets,
  animatedExport,
  onToggle,
  onSelectAll,
  onClear,
  onDownloadAsset,
  onDownloadSelected,
  onCompress,
  onRetry,
  onDelete,
  zipping = false,
}: {
  zipping?: boolean;
  assets: GeneratedAsset[];
  animatedExport: boolean;
  onToggle: (id: string, selected: boolean) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onDownloadAsset: (asset: GeneratedAsset) => void;
  onDownloadSelected: () => void;
  onCompress: () => void;
  onRetry: (asset: GeneratedAsset) => void;
  onDelete: (asset: GeneratedAsset) => void;
}) {
  const selected = useMemo(() => assets.filter((asset) => asset.selected && asset.status !== 'failed'), [assets]);
  const warnings = useMemo(() => assets.filter((asset) => asset.status === 'warning').length, [assets]);
  const failed = useMemo(() => assets.filter((asset) => asset.status === 'failed').length, [assets]);
  const zipParts = useMemo(() => planZipParts(zipItemsFor(selected)).length, [selected]);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(assets.length / REVIEW_PAGE_SIZE));
  // A shorter list (deleted rows, a new run) never leaves the view on an empty page.
  useEffect(() => {
    if (page > pages - 1) setPage(pages - 1);
  }, [page, pages]);
  const current = Math.min(page, pages - 1);
  const visible = assets.slice(current * REVIEW_PAGE_SIZE, (current + 1) * REVIEW_PAGE_SIZE);
  const goTo = (next: number) => {
    setPage(Math.max(0, Math.min(pages - 1, next)));
    document.getElementById('review-heading')?.scrollIntoView({ block: 'start' });
  };
  const downloadLabel = zipping ? 'Preparing ZIP…' : `Download selected (${selected.length.toLocaleString('en-US')})`;
  return (
    <section className="panel animate-rise p-6" aria-labelledby="review-heading">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Batch review</p>
          <h2 id="review-heading" className="display mt-1 text-2xl font-semibold">Review before anything ships</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {assets.length.toLocaleString('en-US')} generated · {selected.length.toLocaleString('en-US')} selected · {warnings} over 200 KB{failed ? ` · ${failed} failed` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!animatedExport && warnings > 0 && (
            <button type="button" className="btn btn-quiet" onClick={onCompress}><Sparkles size={16} aria-hidden /> Compress large files</button>
          )}
          <button type="button" className="btn btn-primary" onClick={onDownloadSelected} disabled={!selected.length || zipping} aria-busy={zipping || undefined}>
            <Download size={16} aria-hidden /> {downloadLabel}
          </button>
        </div>
      </div>
      {zipParts > 1 && (
        <p className="helper mb-4" data-testid="zip-parts-note">This selection downloads as {zipParts} ZIP parts. Each part has its own manifest and CSV slice; the last part also has the full list CSV.</p>
      )}
      <PageControls page={current} pages={pages} total={assets.length} onPage={goTo} />
      <ul className="review-grid" aria-label="Generated assets">
        {visible.map((asset) => {
          const checkboxId = `select-${asset.id}`;
          const failedAsset = asset.status === 'failed';
          return (
            <li key={asset.id} className={`review-card ${asset.selected ? 'is-selected' : ''}`}>
              <div className="review-image">
                {asset.url ? (
                  <img src={asset.url} alt={`Generated asset for row ${asset.row}`} loading="lazy" decoding="async" width={360} height={450} />
                ) : failedAsset ? (
                  <CircleX size={28} className="text-destructive" aria-hidden />
                ) : (
                  <Skeleton className="h-full w-full rounded-none bg-surface-2" />
                )}
                {!failedAsset && (
                  <span className="review-select">
                    <Checkbox
                      id={checkboxId}
                      checked={asset.selected}
                      onCheckedChange={(value) => onToggle(asset.id, value === true)}
                      aria-label={`Select ${asset.filename}`}
                      className="h-6 w-6 rounded-[6px] border-input bg-card shadow-none data-[state=checked]:border-primary"
                    />
                  </span>
                )}
              </div>
              <div className="review-body">
                <p className="truncate text-sm font-semibold" title={asset.filename}>{asset.filename}</p>
                <div className="flex items-center justify-between gap-2">
                  <span className="mono text-xs text-muted-foreground">Row {asset.row} · {formatBytes(asset.bytes)}</span>
                  <StatusBadge asset={asset} />
                </div>
                {failedAsset && (
                  <p className="text-sm text-destructive">
                    {asset.error || 'This row could not be rendered.'}{' '}
                    <button type="button" className="inline-flex min-h-10 items-center gap-1 font-semibold underline underline-offset-4" onClick={() => onRetry(asset)}>
                      <RotateCcw size={14} aria-hidden /> Retry
                    </button>
                  </p>
                )}
                {asset.note && <p className="text-xs text-muted-foreground">{asset.note}</p>}
                {asset.still && <p className="mono truncate text-xs text-muted-foreground" title={asset.still.publicUrl ?? asset.still.filename}>+ {asset.still.filename}</p>}
                {asset.publicUrl && <p className="mono truncate text-xs text-muted-foreground" title={asset.publicUrl}>{asset.publicUrl}</p>}
                {asset.uploadStatus === 'failed' && <p className="text-sm text-destructive">{asset.uploadError || 'Upload failed.'}</p>}
                <button type="button" className="btn btn-quiet w-full" onClick={() => onDownloadAsset(asset)} disabled={!asset.blob.size && !asset.publicUrl}>
                  <Download size={16} aria-hidden /> Download this row
                </button>
                <button type="button" className="btn btn-danger w-full" onClick={() => onDelete(asset)} aria-label={`Delete ${asset.filename}`}>
                  <Trash2 size={16} aria-hidden /> Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <PageControls page={current} pages={pages} total={assets.length} onPage={goTo} />
      <div className="selection-bar" role="toolbar" aria-label="Selection">
        <span className="text-sm font-medium">{selected.length.toLocaleString('en-US')} selected of {(assets.length - failed).toLocaleString('en-US')}</span>
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost" onClick={onSelectAll}>Select all</button>
          <button type="button" className="btn btn-ghost" onClick={onClear}>Clear</button>
          <button type="button" className="btn btn-quiet" onClick={onDownloadSelected} disabled={!selected.length || zipping}><Download size={16} aria-hidden /> {zipping ? 'Preparing…' : `Download (${selected.length.toLocaleString('en-US')})`}</button>
        </div>
      </div>
    </section>
  );
}
