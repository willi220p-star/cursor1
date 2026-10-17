import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BulkResult, BulkTarget } from '@/studio/contracts';
import { appError } from '@/lib/app-error';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { showBulkResult } from './results-panel';
import { syncPillLabel } from './sync-status';

function targets(count: number): BulkTarget[] {
  return Array.from({ length: count }, (_, i) => ({ entity: 'campaign' as const, id: String(i), name: `Campaign ${i + 1}` }));
}

function result(parts: Partial<BulkResult>): BulkResult {
  const succeeded = parts.succeeded ?? [];
  const failed = parts.failed ?? [];
  const queued = parts.queued ?? [];
  return { action: 'move', total: succeeded.length + failed.length + queued.length, succeeded, failed, queued, ...parts };
}

beforeEach(() => {
  toast.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe('showBulkResult', () => {
  it('toasts success when everything worked', () => {
    showBulkResult(result({ succeeded: targets(47) }));
    expect(toast.success).toHaveBeenCalledWith('Moved 47 items');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('toasts an error with a Details action when some failed', () => {
    const failed = targets(3).map((target) => ({ target, error: appError('permission', "You don't have permission to do that.") }));
    showBulkResult(result({ succeeded: targets(47), failed }));
    expect(toast.error).toHaveBeenCalledTimes(1);
    const [title, options] = toast.error.mock.calls[0];
    expect(title).toBe('47 moved, 3 failed');
    expect(options.action.label).toBe('Details');
    expect(typeof options.action.onClick).toBe('function');
  });

  it('toasts the queued note when offline', () => {
    showBulkResult(result({ queued: targets(3) }));
    expect(toast).toHaveBeenCalledWith("3 changes will sync when you're back online", expect.anything());
  });

  it('uses a custom verb', () => {
    showBulkResult(result({ action: 'trash', succeeded: targets(2) }), { verb: 'deleted' });
    expect(toast.success).toHaveBeenCalledWith('Deleted 2 items');
  });
});

describe('syncPillLabel', () => {
  it('describes the queue state', () => {
    expect(syncPillLabel({ online: false, pending: 3, running: false, failures: 0 })).toBe('Offline · 3 changes waiting');
    expect(syncPillLabel({ online: false, pending: 1, running: false, failures: 0 })).toBe('Offline · 1 change waiting');
    expect(syncPillLabel({ online: true, pending: 3, running: true, failures: 0 })).toBe('Syncing 3…');
    expect(syncPillLabel({ online: true, pending: 2, running: false, failures: 0 })).toBe('2 changes waiting to sync');
    expect(syncPillLabel({ online: true, pending: 0, running: false, failures: 1 })).toBe("1 change couldn't sync");
    expect(syncPillLabel({ online: true, pending: 0, running: false, failures: 0 })).toBeNull();
  });
});
