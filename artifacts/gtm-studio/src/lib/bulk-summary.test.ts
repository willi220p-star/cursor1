import { describe, expect, it } from 'vitest';
import type { BulkResult, BulkTarget } from '@/studio/contracts';
import { appError, conflictError } from './app-error';
import { bulkResultText, groupFailures, summarizeBulkResult } from './bulk-summary';

function targets(count: number, prefix = 'Item'): BulkTarget[] {
  return Array.from({ length: count }, (_, i) => ({ entity: 'asset' as const, id: `${prefix}-${i}`, name: `${prefix} ${i + 1}` }));
}

function result(partial: Partial<BulkResult> & Pick<BulkResult, 'action'>): BulkResult {
  const succeeded = partial.succeeded ?? [];
  const failed = partial.failed ?? [];
  const queued = partial.queued ?? [];
  return { total: succeeded.length + failed.length + queued.length, succeeded, failed, queued, ...partial };
}

describe('summarizeBulkResult', () => {
  it('all succeeded', () => {
    expect(summarizeBulkResult(result({ action: 'move', succeeded: targets(47) }))).toEqual({ kind: 'success', title: 'Moved 47 items' });
    expect(summarizeBulkResult(result({ action: 'move', succeeded: targets(1) })).title).toBe('Moved 1 item');
    expect(summarizeBulkResult(result({ action: 'trash', succeeded: targets(3) })).title).toBe('Moved 3 items to Trash');
    expect(summarizeBulkResult(result({ action: 'download', succeeded: targets(2) })).title).toBe('Downloaded 2 files');
    expect(summarizeBulkResult(result({ action: 'update', succeeded: targets(5) }), 'tagged').title).toBe('Tagged 5 items');
  });

  it('some failed', () => {
    const failed = targets(3, 'Bad').map((target) => ({ target, error: appError('permission', "You don't have permission to do that.") }));
    const summary = summarizeBulkResult(result({ action: 'move', succeeded: targets(47), failed }));
    expect(summary.kind).toBe('partial');
    expect(summary.title).toBe('47 moved, 3 failed');
    expect(summary.description).toBe("You don't have permission to do that.");
  });

  it('all failed, mixed reasons', () => {
    const [a, b] = targets(2);
    const summary = summarizeBulkResult(
      result({ action: 'trash', failed: [{ target: a, error: conflictError('Sam') }, { target: b, error: appError('not_found', 'Gone') }] }),
    );
    expect(summary.title).toBe('None moved to Trash, 2 failed');
    expect(summary.description).toBe('Open Details to see what went wrong.');
  });

  it('queued', () => {
    expect(summarizeBulkResult(result({ action: 'move', queued: targets(3) }))).toEqual({
      kind: 'queued',
      title: "3 changes will sync when you're back online",
    });
    expect(summarizeBulkResult(result({ action: 'move', queued: targets(1) })).title).toBe("1 change will sync when you're back online");
    const mixed = summarizeBulkResult(result({ action: 'move', succeeded: targets(2), queued: targets(3) }));
    expect(mixed.title).toBe('Moved 2 items');
    expect(mixed.description).toBe("3 changes will sync when you're back online.");
  });

  it('failed and queued together', () => {
    const failed = [{ target: targets(1)[0], error: appError('validation', 'Bad name') }];
    expect(summarizeBulkResult(result({ action: 'rename', succeeded: targets(4), failed, queued: targets(2) })).title).toBe(
      '4 renamed, 1 failed, 2 waiting to sync',
    );
  });

  it('nothing to report', () => {
    expect(summarizeBulkResult(result({ action: 'move' })).kind).toBe('empty');
  });
});

describe('groupFailures and bulkResultText', () => {
  it('groups by error code, biggest group first, and writes plain text', () => {
    const t = targets(4);
    const failed = [
      { target: t[0], error: appError('not_found', 'That item no longer exists.') },
      { target: t[1], error: appError('permission', 'Not yours.') },
      { target: t[2], error: appError('permission', 'Not yours.') },
      { target: t[3], error: appError('permission', 'Archived space.') },
    ];
    const groups = groupFailures(failed);
    expect(groups.map((g) => [g.code, g.failures.length])).toEqual([
      ['permission', 3],
      ['not_found', 1],
    ]);
    const text = bulkResultText(result({ action: 'move', succeeded: targets(10, 'Ok'), failed }));
    expect(text).toBe(
      [
        '10 moved, 4 failed',
        '',
        'Not allowed (3): Not yours.',
        '- Item 2',
        '- Item 3',
        '- Item 4 - Archived space.',
        '',
        'No longer exists (1): That item no longer exists.',
        '- Item 1',
      ].join('\n'),
    );
  });
});
