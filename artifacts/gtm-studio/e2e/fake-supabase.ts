import type { BrowserContext, Page, Request, WebSocketRoute } from '@playwright/test';

export const userId = '00000000-0000-4000-8000-000000000001';
const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'operator@dgk.internal', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };

export type FakeOptions = {
  signedIn?: boolean;
  failLists?: boolean;
  contacts?: Record<string, unknown>[];
  mode?: string;
  /** Rows served for GET /rest/v1/outbound_campaigns (filtered by `id=eq.` when asked). Saves are added. */
  campaigns?: Record<string, unknown>[];
  /** Rows served for GET /rest/v1/outbound_folders. */
  folders?: Record<string, unknown>[];
  /** Rows served for GET /rest/v1/outbound_assets (filtered by `campaign_id=eq.` when asked). */
  assets?: Record<string, unknown>[];
  /** Objects in the asset bucket, for storage list (sizes) and remove. */
  storageObjects?: Array<{ path: string; size: number }>;
  /** Let Google Fonts through (default: blocked). For checks that must see a font really draw. */
  allowFonts?: boolean;
  /** Turns on the reviews/comments/notifications/profiles tables and the realtime stub. */
  reviews?: ReviewTables;
};

/** `table` is the REST table, or `storage:list` / `storage:remove` for bucket calls. */
export type FakeRequest = { method: string; table: string; url: string; body: unknown };

function requestBody(request: Request) {
  try {
    return request.postDataJSON();
  } catch {
    return request.postData();
  }
}

/**
 * Answers every Supabase call locally: an operator session, empty tables (or the given campaign
 * and folder rows) and accepted uploads. Every write is recorded in `requests`.
 */
export async function fakeSupabase(context: BrowserContext, options: FakeOptions = {}) {
  const { signedIn = true, failLists = false, contacts, mode } = options;
  const campaigns = [...(options.campaigns ?? [])];
  const folders = options.folders ?? [];
  const assets = [...(options.assets ?? [])];
  const objects = [...(options.storageObjects ?? [])];
  const requests: FakeRequest[] = [];
  const reviewState = options.reviews ? await reviewTables(context, options.reviews) : null;
  await context.route(/supabase\.co/, (route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();
    if (url.includes('/auth/v1/user')) return route.fulfill({ json: user });
    if (url.includes('/storage/v1/object/list/')) {
      const body = requestBody(request) as { prefix?: string } | null;
      requests.push({ method, table: 'storage:list', url, body });
      const prefix = String(body?.prefix ?? '').replace(/\/$/, '');
      const listed = objects
        .filter((item) => item.path.slice(0, item.path.lastIndexOf('/')) === prefix)
        .map((item) => ({ name: item.path.slice(item.path.lastIndexOf('/') + 1), id: item.path, metadata: { size: item.size } }));
      return route.fulfill({ json: listed });
    }
    if (url.includes('/storage/v1/object/') && method === 'DELETE') {
      const body = requestBody(request) as { prefixes?: string[] } | null;
      requests.push({ method, table: 'storage:remove', url, body });
      const wanted = new Set(body?.prefixes ?? []);
      const removed = objects.filter((item) => wanted.has(item.path));
      for (const item of removed) objects.splice(objects.indexOf(item), 1);
      return route.fulfill({ json: removed.map((item) => ({ name: item.path })) });
    }
    if (url.includes('/storage/v1/')) return route.fulfill({ json: { Key: 'ok' } });
    if (url.includes('/rest/v1/')) {
      const table = new URL(url).pathname.split('/rest/v1/')[1]?.split('/')[0] ?? '';
      const body: unknown = requestBody(request);
      if (method !== 'GET' && method !== 'HEAD') requests.push({ method, table, url, body });
      // 500 is not retried by the Supabase client, so the error shows at once.
      if (failLists && method === 'GET') return route.fulfill({ status: 500, json: { message: 'Internal error' } });
      const wantsObject = (request.headers().accept ?? '').includes('vnd.pgrst.object');
      if (reviewState) {
        const handled = reviewState.handle({ table, method, url, body, wantsObject, prefer: request.headers().prefer ?? '', campaigns, assets });
        if (handled) return route.fulfill(handled);
      }
      if (table === 'outbound_campaigns') {
        if (method === 'GET') {
          const id = new URL(url).searchParams.get('id')?.replace(/^eq\./, '');
          const rows = id ? campaigns.filter((row) => row.id === id) : campaigns;
          return route.fulfill({ json: wantsObject ? rows[0] ?? null : rows });
        }
        if (method === 'POST' && body && typeof body === 'object') {
          const saved = { folder_id: null, ...(body as Record<string, unknown>) };
          const index = campaigns.findIndex((row) => row.id === saved.id);
          if (index >= 0) campaigns[index] = saved;
          else campaigns.unshift(saved);
          return route.fulfill({ json: wantsObject ? { id: saved.id } : [{ id: saved.id }] });
        }
        if (method === 'PATCH' && body && typeof body === 'object') {
          const id = new URL(url).searchParams.get('id')?.replace(/^eq\./, '');
          const index = campaigns.findIndex((row) => row.id === id);
          if (index >= 0) campaigns[index] = { ...campaigns[index], ...(body as Record<string, unknown>) };
          return route.fulfill({ json: [] });
        }
        if (method === 'DELETE') {
          const id = new URL(url).searchParams.get('id')?.replace(/^eq\./, '');
          const index = campaigns.findIndex((row) => row.id === id);
          if (index >= 0) campaigns.splice(index, 1);
          return route.fulfill({ json: [] });
        }
      }
      if (table === 'outbound_folders' && method === 'GET') return route.fulfill({ json: folders });
      if (table === 'outbound_assets' && method === 'GET') {
        const campaignId = new URL(url).searchParams.get('campaign_id')?.replace(/^eq\./, '');
        return route.fulfill({ json: campaignId ? assets.filter((row) => row.campaign_id === campaignId) : assets });
      }
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ json: {} });
  });
  // Web fonts are not needed for these checks and keep runs steady offline.
  if (!options.allowFonts) await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const now = Math.floor(Date.now() / 1000);
  const session = { access_token: 'e2e', token_type: 'bearer', expires_in: 86400, expires_at: now + 86400, refresh_token: 'e2e', user };
  await context.addInitScript(([signed, sessionJson, contactsKey, contactsJson]) => {
    try {
      if (signed) localStorage.setItem('sb-e2e-test-auth-token', sessionJson);
      if (contactsKey && contactsJson) localStorage.setItem(contactsKey, contactsJson);
    } catch {
      // Storage blocked; the app still renders signed out.
    }
  }, [signedIn, JSON.stringify(session), mode ? `gtm-contacts:${userId}:${mode}` : '', contacts ? JSON.stringify(contacts) : ''] as const);
  return { requests, campaigns, assets, objects, reviewTables: reviewState?.tables, pushRealtime: reviewState?.push };
}

/** A saved campaign row as Supabase returns it. */
export function campaignRow(id: string, name: string, { config, ...extra }: Record<string, unknown> = {}) {
  const contacts = sampleContacts(3);
  return {
    id,
    user_id: userId,
    name,
    mode: 'handwritten',
    config: { mode: 'handwritten', campaignName: name, copy: 'Hi {first_name}', ...(config as object | undefined) },
    source_columns: ['name', 'company', 'role', 'handwritten_url', 'handwritten_status'],
    source_data: contacts.map((row) => ({ ...row, handwritten_url: `https://e2e-test.supabase.co/storage/v1/object/public/outbound-assets/${userId}/x/${row.row}.jpg`, handwritten_status: 'uploaded' })),
    updated_at: '2026-10-09T12:00:00Z',
    folder_id: null,
    ...extra,
  };
}

export function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

export function sampleContacts(count: number) {
  const people = [['Maya', 'Top End Solar', '/avatars/maya.svg'], ['Ethan', 'Saltbush Studio', '/avatars/ethan.svg'], ['Priya', 'Larrakia Legal', '/avatars/priya.svg'], ['Noah', 'Red Centre Logistics', '/avatars/noah.svg']];
  return Array.from({ length: count }, (_, index) => {
    const [name, company, image] = people[index % people.length];
    return { row: index + 2, name: `${name} ${index}`, company, role: 'Director', city: 'Darwin', image_link: image, msg: 'Worth a quick chat?' };
  });
}

// --- reviews & notifications ---
// Opt-in (FakeOptions.reviews): PostgREST-style eq/in/is filters, order, limit/offset and exact counts
// for reviews, comments, notifications and profiles, plus a realtime websocket stub that accepts
// channel joins and replays inserts/updates on those tables to matching postgres_changes bindings.

export type ReviewTables = {
  reviews?: Record<string, unknown>[];
  comments?: Record<string, unknown>[];
  notifications?: Record<string, unknown>[];
  profiles?: Record<string, unknown>[];
};

const REVIEW_TABLES = ['reviews', 'comments', 'notifications', 'profiles'] as const;
type ReviewTable = (typeof REVIEW_TABLES)[number];
type Row = Record<string, unknown>;
type Fulfil = { status?: number; json?: unknown; body?: string; headers?: Record<string, string> };

function matches(row: Row, column: string, raw: string): boolean {
  const value = row[column];
  if (raw.startsWith('eq.')) return String(value) === raw.slice(3);
  if (raw.startsWith('neq.')) return String(value) !== raw.slice(4);
  if (raw === 'is.null') return value === null || value === undefined;
  if (raw === 'not.is.null') return value !== null && value !== undefined;
  if (raw.startsWith('in.(')) {
    const list = raw.slice(4, -1).split(',').map((item) => item.replace(/^"|"$/g, ''));
    return list.includes(String(value));
  }
  return true;
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict']);

/** Rows matching the URL's filters, ordered and paged like PostgREST. */
export function filterRows(rows: Row[], url: string): Row[] {
  const params = new URL(url).searchParams;
  let out = rows.filter((row) => [...params.entries()].every(([key, raw]) => RESERVED.has(key) || matches(row, key, raw)));
  const order = params.get('order');
  if (order) {
    const [column, direction] = order.split(',')[0].split('.');
    out = [...out].sort((a, b) => {
      const left = String(a[column] ?? '');
      const right = String(b[column] ?? '');
      return (left < right ? -1 : left > right ? 1 : 0) * (direction === 'desc' ? -1 : 1);
    });
  }
  const offset = Number(params.get('offset') ?? 0);
  const limit = params.get('limit');
  return out.slice(offset, limit ? offset + Number(limit) : undefined);
}

function filterMatches(row: Row, filter?: string) {
  if (!filter) return true;
  const [column, ...rest] = filter.split('=');
  return matches(row, column, rest.join('='));
}

type Binding = { id: number; event: string; table: string; filter?: string };
type Joined = { ws: WebSocketRoute; topic: string; joinRef: string; bindings: Binding[] };

async function reviewTables(context: BrowserContext, seed: ReviewTables) {
  const tables: Record<ReviewTable, Row[]> = {
    reviews: [...(seed.reviews ?? [])],
    comments: [...(seed.comments ?? [])],
    notifications: [...(seed.notifications ?? [])],
    profiles: [...(seed.profiles ?? [])],
  };
  const joined: Joined[] = [];
  let nextBinding = 1;
  let ref = 1000;

  await context.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    ws.onMessage((message) => {
      let frame: unknown;
      try {
        frame = JSON.parse(String(message));
      } catch {
        return;
      }
      // Protocol 2.0.0 frames are [join_ref, ref, topic, event, payload].
      if (!Array.isArray(frame)) return;
      const [joinRef, msgRef, topic, event, payload] = frame as [string | null, string, string, string, Row];
      const reply = (response: unknown) => ws.send(JSON.stringify([joinRef, msgRef, topic, 'phx_reply', { status: 'ok', response }]));
      if (event === 'phx_join') {
        const config = (payload?.config ?? {}) as { postgres_changes?: Array<{ event: string; schema: string; table: string; filter?: string }> };
        const bindings = (config.postgres_changes ?? []).map((binding) => ({ ...binding, id: nextBinding++ }));
        joined.push({ ws, topic, joinRef: String(joinRef), bindings });
        reply({ postgres_changes: bindings });
      } else if (event === 'phx_leave') {
        const index = joined.findIndex((item) => item.ws === ws && item.topic === topic);
        if (index >= 0) joined.splice(index, 1);
        reply({});
      } else if (event === 'heartbeat') {
        reply({});
      }
    });
  });

  /** Sends a postgres_changes event to every channel bound to this table (and filter). */
  const push = (table: string, type: 'INSERT' | 'UPDATE' | 'DELETE', record: Row) => {
    for (const channel of joined) {
      const ids = channel.bindings
        .filter((binding) => binding.table === table && (binding.event === '*' || binding.event === type) && filterMatches(record, binding.filter))
        .map((binding) => binding.id);
      if (!ids.length) continue;
      const data = { schema: 'public', table, commit_timestamp: new Date().toISOString(), type, record, old_record: {}, columns: [], errors: null };
      channel.ws.send(JSON.stringify([channel.joinRef, String(ref++), channel.topic, 'postgres_changes', { ids, data }]));
    }
  };

  const handle = (input: { table: string; method: string; url: string; body: unknown; wantsObject: boolean; prefer: string; campaigns: Row[]; assets: Row[] }): Fulfil | null => {
    const { table, method, url, body, wantsObject, prefer } = input;
    const params = new URL(url).searchParams;
    // Reviews ask for several campaigns' rows at once with `in.(…)`; the base fake only knows `eq.`.
    if (method === 'GET' && table === 'outbound_assets' && params.get('campaign_id')?.startsWith('in.')) {
      return { json: filterRows(input.assets, url) };
    }
    if (method === 'GET' && table === 'outbound_campaigns' && params.get('id')?.startsWith('in.')) {
      return { json: filterRows(input.campaigns, url) };
    }
    if (!(REVIEW_TABLES as readonly string[]).includes(table)) return null;
    const rows = tables[table as ReviewTable];
    if (method === 'HEAD' || (method === 'GET' && prefer.includes('count='))) {
      const count = filterRows(rows, url).length;
      return { status: 200, body: method === 'HEAD' ? '' : '[]', headers: {
        'content-range': count ? `0-${count - 1}/${count}` : '*/0',
        'content-type': 'application/json',
        // Cross-origin: the browser hides Content-Range from the app unless it is exposed.
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'content-range',
      } };
    }
    if (method === 'GET') {
      const found = filterRows(rows, url);
      return { json: wantsObject ? found[0] ?? null : found };
    }
    if (method === 'POST') {
      const inserted = (Array.isArray(body) ? body : [body]).map((item) => ({
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        ...(table === 'comments' ? { edited_at: null, deleted_at: null } : {}),
        ...(table === 'notifications' ? { read_at: null } : {}),
        ...(item as Row),
      }));
      rows.push(...inserted);
      for (const row of inserted) push(table, 'INSERT', row);
      return { status: 201, json: wantsObject ? inserted[0] : inserted };
    }
    if (method === 'PATCH') {
      const updated = filterRows(rows, url);
      for (const row of updated) {
        Object.assign(row, body as Row);
        push(table, 'UPDATE', row);
      }
      return { json: wantsObject ? updated[0] ?? null : updated };
    }
    if (method === 'DELETE') {
      const removed = filterRows(rows, url);
      for (const row of removed) rows.splice(rows.indexOf(row), 1);
      return { json: removed };
    }
    return null;
  };

  return { tables, handle, push };
}
