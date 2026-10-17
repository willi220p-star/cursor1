import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BulkRowResult, BulkTarget } from './contracts';

const shown = vi.hoisted(() => [] as Array<{ result: unknown; opts: unknown }>);
const queue = vi.hoisted(() => ({ online: true, ops: [] as unknown[], handlers: new Map<string, (payload: unknown) => Promise<void>>() }));
const toasts = vi.hoisted(() => [] as string[]);

vi.mock('@/components/results-panel', () => ({
  showBulkResult: (result: unknown, opts: unknown) => { shown.push({ result, opts }); },
}));
vi.mock('@/lib/offline-queue', () => ({
  isOnline: () => queue.online,
  enqueue: async (op: unknown) => { queue.ops.push(op); return op; },
  registerQueueHandler: (kind: string, handler: (payload: unknown) => Promise<void>) => { queue.handlers.set(kind, handler); },
}));
vi.mock('sonner', () => {
  const toast = Object.assign((title: string) => { toasts.push(title); }, {
    info: (title: string) => { toasts.push(title); },
    error: (title: string) => { toasts.push(title); },
    success: (title: string) => { toasts.push(title); },
  });
  return { toast };
});

const {
  chunk,
  entityForKind,
  executeBulk,
  mergeRows,
  parsePaths,
  renameNames,
  rpcCall,
  runBulk,
  skippedMessage,
  splitSupported,
  trashDaysLeft,
} = await import('./bulk');

type Call = { fn: string; args: Record<string, unknown> };

function fakeClient(answer: (call: Call) => { data: unknown; error: unknown } = okRows) {
  const calls: Call[] = [];
  const removed: string[][] = [];
  return {
    calls,
    removed,
    rpc: (fn: string, args: Record<string, unknown> = {}) => {
      calls.push({ fn, args });
      return Promise.resolve(answer({ fn, args }));
    },
    storage: { from: () => ({ remove: (paths: string[]) => { removed.push(paths); return Promise.resolve({ data: [], error: null }); } }) },
  };
}

function idsOf(call: Call): string[] {
  if (Array.isArray(call.args.ids)) return call.args.ids as string[];
  return (call.args.items as Array<{ id: string }>).map((item) => item.id);
}

function okRows(call: Call) {
  return { data: idsOf(call).map((id): BulkRowResult => ({ id, ok: true, error_code: null, message: null })), error: null };
}

const targets = (count: number, entity: BulkTarget['entity'] = 'campaign'): BulkTarget[] =>
  Array.from({ length: count }, (_, index) => ({ entity, id: `${entity}-${index}`, name: `${entity} ${index}` }));

beforeEach(() => {
  shown.length = 0;
  toasts.length = 0;
  queue.online = true;
  queue.ops.length = 0;
});

describe('bulk helpers', () => {
  it('chunks at 200', () => {
    expect(chunk(Array.from({ length: 401 }, (_, i) => i)).map((part) => part.length)).toEqual([200, 200, 1]);
  });

  it('maps library kinds to entities', () => {
    expect(entityForKind('file')).toBe('asset');
    expect(entityForKind('campaign')).toBe('campaign');
  });

  it('skips kinds an action does not apply to, and says so', () => {
    const mixed = [...targets(2, 'campaign'), ...targets(3, 'template')];
    const update = splitSupported({ kind: 'update', patch: { status: 'exported' } }, mixed);
    expect(update.supported).toHaveLength(2);
    expect(skippedMessage(update.skipped)).toBe('3 templates skipped: not supported for templates');
    const space = splitSupported({ kind: 'move', folderId: null, spaceId: 's1' }, mixed);
    expect(space.supported).toHaveLength(2);
    expect(splitSupported({ kind: 'move', folderId: 'f' }, [...mixed, ...targets(1, 'folder')]).skipped).toEqual({ folder: 1 });
    expect(skippedMessage({ asset: 1 })).toBe('1 file skipped: not supported for files');
  });

  it('builds RPC arguments for each action', () => {
    const two = targets(2);
    expect(rpcCall({ kind: 'move', folderId: 'f1' }, 'campaign', two)).toEqual({
      fn: 'bulk_move', args: { entity: 'campaign', ids: ['campaign-0', 'campaign-1'], target_folder: 'f1', target_space: null },
    });
    expect(rpcCall({ kind: 'update', patch: { tags_add: ['q4'] } }, 'campaign', two).args).toEqual({ ids: ['campaign-0', 'campaign-1'], patch: { tags_add: ['q4'] } });
    const versioned = [{ ...two[0], version: 4 }];
    expect(rpcCall({ kind: 'rename', pattern: 'x' }, 'campaign', versioned, { 'campaign-0': 'New' }).args).toEqual({
      entity: 'campaign', items: [{ id: 'campaign-0', name: 'New', version: 4 }],
    });
  });

  it('merges rows: missing rows fail, error codes map to AppErrors', () => {
    const three = targets(3);
    const merged = mergeRows(three, [
      { id: 'campaign-0', ok: true, error_code: null, message: null },
      { id: 'campaign-1', ok: false, error_code: 'conflict', message: 'Changed by Sam' },
    ]);
    expect(merged.succeeded.map((t) => t.id)).toEqual(['campaign-0']);
    expect(merged.failed.map((f) => [f.target.id, f.error.code, f.error.message])).toEqual([
      ['campaign-1', 'conflict', 'Changed by Sam'],
      ['campaign-2', 'unknown', 'The server did not report a result for this item.'],
    ]);
    expect(mergeRows(targets(1), [{ id: 'campaign-0', ok: false, error_code: 'weird' as never, message: null }]).failed[0].error.code).toBe('unknown');
  });

  it('parses purge paths', () => {
    expect(parsePaths('["a/1.png","b/2.png"]')).toEqual(['a/1.png', 'b/2.png']);
    expect(parsePaths('a/1.png\nb/2.png')).toEqual(['a/1.png', 'b/2.png']);
    expect(parsePaths(null)).toEqual([]);
  });

  it('counts trash days left', () => {
    const now = Date.parse('2026-10-17T12:00:00Z');
    expect(trashDaysLeft('2026-10-17T11:59:00Z', now)).toBe(30);
    expect(trashDaysLeft('2026-10-07T12:00:00Z', now)).toBe(20);
    expect(trashDaysLeft('2026-09-01T00:00:00Z', now)).toBe(0);
  });

  it('computes rename names per kind and avoids names other items use', () => {
    const names = renameNames('{client} – Batch', [...targets(2), ...targets(1, 'asset')], {
      clients: { 'campaign-0': 'Northwind' },
      taken: { campaign: ['Batch'] },
    });
    expect(names).toEqual({ 'campaign-0': 'Northwind – Batch', 'campaign-1': 'Batch (2)', 'asset-0': 'Batch' });
  });
});

describe('runBulk', () => {
  it('groups by entity, chunks at 200 and merges every chunk', async () => {
    const client = fakeClient();
    const result = await runBulk({ kind: 'trash' }, [...targets(450), ...targets(3, 'asset')], { client, show: false });
    expect(client.calls.map((call) => [call.fn, call.args.entity, idsOf(call).length])).toEqual([
      ['bulk_trash', 'campaign', 200],
      ['bulk_trash', 'campaign', 200],
      ['bulk_trash', 'campaign', 50],
      ['bulk_trash', 'asset', 3],
    ]);
    expect(result.total).toBe(453);
    expect(result.succeeded).toHaveLength(453);
    expect(result.failed).toEqual([]);
  });

  it('marks a whole failed chunk as failed with that error, and keeps the other chunks', async () => {
    let call = 0;
    const client = fakeClient((request) => {
      call += 1;
      return call === 2 ? { data: null, error: { code: '42501', message: 'denied' } } : okRows(request);
    });
    const result = await runBulk({ kind: 'move', folderId: 'f1' }, targets(250), { client, show: false });
    expect(result.succeeded).toHaveLength(200);
    expect(result.failed).toHaveLength(50);
    expect(result.failed.every((failure) => failure.error.code === 'permission')).toBe(true);
  });

  it('reports partial failures in the results panel with Retry failed running only those', async () => {
    const client = fakeClient((request) => ({
      data: idsOf(request).map((id) => ({ id, ok: id !== 'campaign-1', error_code: id === 'campaign-1' ? 'permission' : null, message: null })),
      error: null,
    }));
    const onDone = vi.fn();
    const result = await runBulk({ kind: 'move', folderId: 'f1' }, targets(3), { client, onDone });
    expect(result.succeeded).toHaveLength(2);
    expect(result.failed.map((failure) => failure.target.id)).toEqual(['campaign-1']);
    expect(shown).toHaveLength(1);
    const opts = shown[0].opts as { verb: string; onRetryFailed: (failed: BulkTarget[]) => void };
    expect(opts.verb).toBe('moved');
    opts.onRetryFailed([targets(3)[1]]);
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(2));
    expect(idsOf(client.calls[1])).toEqual(['campaign-1']);
  });

  it('retries temporary chunk errors before giving up', async () => {
    let call = 0;
    const client = fakeClient((request) => {
      call += 1;
      return call === 1 ? { data: null, error: { status: 503, message: 'busy' } } : okRows(request);
    });
    const result = await runBulk({ kind: 'restore' }, targets(2), { client, show: false });
    expect(call).toBe(2);
    expect(result.succeeded).toHaveLength(2);
  });

  it('queues the action when offline and returns the targets as queued', async () => {
    queue.online = false;
    const client = fakeClient();
    const result = await runBulk({ kind: 'trash' }, targets(2), { client, show: false });
    expect(client.calls).toEqual([]);
    expect(result.queued).toHaveLength(2);
    expect(queue.ops).toEqual([{ kind: 'bulk', payload: { action: { kind: 'trash' }, targets: targets(2), names: undefined }, label: 'Move 2 items to Trash' }]);
  });

  it('registers a bulk queue handler that runs the action', async () => {
    expect(queue.handlers.has('bulk')).toBe(true);
  });

  it('skips unsupported kinds and does not call the server for them', async () => {
    const client = fakeClient();
    const result = await runBulk({ kind: 'update', patch: { status: 'exported' } }, [...targets(1), ...targets(3, 'template')], { client });
    expect(client.calls.map((call) => call.fn)).toEqual(['bulk_update_campaigns']);
    expect(result.total).toBe(1);
    expect(toasts).toContain('3 templates skipped: not supported for templates');
  });

  it('rename sends the computed names with versions', async () => {
    const client = fakeClient();
    await runBulk({ kind: 'rename', pattern: '{name} v2' }, [{ entity: 'asset', id: 'a', name: 'x.png', version: 3 }], { client, show: false });
    expect(client.calls[0]).toEqual({ fn: 'bulk_rename', args: { entity: 'asset', items: [{ id: 'a', name: 'x.png v2', version: 3 }] } });
  });

  it('purge removes the returned storage paths in chunks of 100', async () => {
    const paths = Array.from({ length: 150 }, (_, i) => `u/${i}.png`);
    const client = fakeClient((request) => ({
      data: idsOf(request).map((id, index) => ({ id, ok: true, error_code: null, message: index === 0 ? JSON.stringify(paths) : null })),
      error: null,
    }));
    const { result } = await executeBulk({ kind: 'purge' }, targets(2, 'asset'), { client });
    expect(result.succeeded).toHaveLength(2);
    expect(client.removed.map((slice) => slice.length)).toEqual([100, 50]);
  });

  it('fails everything clearly when there is no cloud client', async () => {
    const { result } = await executeBulk({ kind: 'trash' }, targets(2), { client: null });
    expect(result.failed).toHaveLength(2);
  });
});
