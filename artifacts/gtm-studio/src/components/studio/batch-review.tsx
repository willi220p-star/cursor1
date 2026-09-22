import { Check, CircleX, Download, RotateCcw, Sparkles, TriangleAlert } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
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
}: {
  assets: GeneratedAsset[];
  animatedExport: boolean;
  onToggle: (id: string, selected: boolean) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onDownloadAsset: (asset: GeneratedAsset) => void;
  onDownloadSelected: () => void;
  onCompress: () => void;
  onRetry: (asset: GeneratedAsset) => void;
}) {
  const selected = assets.filter((asset) => asset.selected && asset.status !== 'failed');
  const warnings = assets.filter((asset) => asset.status === 'warning').length;
  const failed = assets.filter((asset) => asset.status === 'failed').length;
  return (
    <section className="panel animate-rise p-6" aria-labelledby="review-heading">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Batch review</p>
          <h2 id="review-heading" className="display mt-1 text-2xl font-semibold">Review before anything ships</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {assets.length} generated · {selected.length} selected · {warnings} over 200 KB{failed ? ` · ${failed} failed` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!animatedExport && warnings > 0 && (
            <button type="button" className="btn btn-quiet" onClick={onCompress}><Sparkles size={16} aria-hidden /> Compress large files</button>
          )}
          <button type="button" className="btn btn-primary" onClick={onDownloadSelected} disabled={!selected.length}>
            <Download size={16} aria-hidden /> Download selected ({selected.length})
          </button>
        </div>
      </div>
      <ul className="review-grid" aria-label="Generated assets">
        {assets.map((asset) => {
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
                {asset.publicUrl && <p className="mono truncate text-xs text-muted-foreground" title={asset.publicUrl}>{asset.publicUrl}</p>}
                {asset.uploadStatus === 'failed' && <p className="text-sm text-destructive">{asset.uploadError || 'Upload failed.'}</p>}
                <button type="button" className="btn btn-quiet w-full" onClick={() => onDownloadAsset(asset)} disabled={!asset.blob.size}>
                  <Download size={16} aria-hidden /> Download this row
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="selection-bar" role="toolbar" aria-label="Selection">
        <span className="text-sm font-medium">{selected.length} selected of {assets.length - failed}</span>
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost" onClick={onSelectAll}>Select all</button>
          <button type="button" className="btn btn-ghost" onClick={onClear}>Clear</button>
          <button type="button" className="btn btn-quiet" onClick={onDownloadSelected} disabled={!selected.length}><Download size={16} aria-hidden /> Download ({selected.length})</button>
        </div>
      </div>
    </section>
  );
}
