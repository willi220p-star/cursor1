// SHIM: replaced by the real module on merge
import { toast } from 'sonner';
import type { BulkResult, BulkTarget } from '@/studio/contracts';

export function showBulkResult(result: BulkResult, opts: { verb?: string; onRetryFailed?: (failed: BulkTarget[]) => void } = {}) {
  const verb = opts.verb ?? 'done';
  const parts = [`${result.succeeded.length} ${verb}`];
  if (result.failed.length) parts.push(`${result.failed.length} failed`);
  if (result.queued.length) parts.push(`${result.queued.length} waiting to sync`);
  const title = parts.join(', ');
  if (!result.failed.length) {
    toast.success(title);
    return;
  }
  const failed = result.failed.map((failure) => failure.target);
  toast.error(title, {
    description: result.failed.slice(0, 5).map((failure) => `${failure.target.name}: ${failure.error.message}`).join('\n'),
    duration: 12_000,
    action: opts.onRetryFailed ? { label: 'Retry failed', onClick: () => opts.onRetryFailed?.(failed) } : undefined,
  });
}
