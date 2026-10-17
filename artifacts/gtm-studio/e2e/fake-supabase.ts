import type { BrowserContext, Page, Request, Route } from '@playwright/test';

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
} & SpacesOptions;

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
  const spacesFake = createSpacesFake(options, requests);
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
    const handled = spacesFake.handle(route, request);
    if (handled) return handled;
    if (url.includes('/rest/v1/')) {
      const table = new URL(url).pathname.split('/rest/v1/')[1]?.split('/')[0] ?? '';
      const body: unknown = requestBody(request);
      if (method !== 'GET' && method !== 'HEAD') requests.push({ method, table, url, body });
      // 500 is not retried by the Supabase client, so the error shows at once.
      if (failLists && method === 'GET') return route.fulfill({ status: 500, json: { message: 'Internal error' } });
      const wantsObject = (request.headers().accept ?? '').includes('vnd.pgrst.object');
      if (table === 'outbound_campaigns') {
        if (method === 'GET') {
          const id = new URL(url).searchParams.get('id')?.replace(/^eq\./, '');
          const rows = filterBySpace(id ? campaigns.filter((row) => row.id === id) : campaigns, url);
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
      if (table === 'outbound_folders' && method === 'GET') return route.fulfill({ json: filterBySpace(folders, url) });
      if (table === 'outbound_assets' && method === 'GET') {
        const campaignId = new URL(url).searchParams.get('campaign_id')?.replace(/^eq\./, '');
        return route.fulfill({ json: filterBySpace(campaignId ? assets.filter((row) => row.campaign_id === campaignId) : assets, url) });
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
  return { requests, campaigns, assets, objects, ...spacesFake.state };
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

// --- spaces & roles ---
// Profiles, spaces, memberships, invites, the activity log, the accept_invite / bulk_move RPCs and
// the invite-member Edge Function. The signed-in user is the Owner unless `role` says otherwise,
// so older specs (which know nothing about spaces) keep working with no spaces at all.

export type FakeRole = 'owner' | 'team' | 'client_manager' | 'client_viewer';

export type SpacesOptions = {
  /** Who the signed-in user is (default 'owner'). Client roles get a membership in `clientSpaceId`. */
  role?: FakeRole;
  /** Rows for GET /rest/v1/spaces (default none). */
  spaces?: Array<{ id: string; name: string; kind: 'internal' | 'client'; archived_at?: string | null }>;
  /** The client user's space (default: the first client space). */
  clientSpaceId?: string;
  /** Other people's profiles (the signed-in user's own profile is added). */
  profiles?: Array<{ user_id: string; email: string; display_name?: string | null; org_role: 'owner' | 'team' | 'client' }>;
  /** Other people's memberships (the client user's own membership is added). */
  memberships?: Array<{ space_id: string; user_id: string; role: 'client_manager' | 'client_viewer' }>;
  invites?: Record<string, unknown>[];
  activity?: Record<string, unknown>[];
  /** Signed in, but no profile row (no invite was ever accepted). */
  noProfile?: boolean;
  /** What invite-member answers (default `{ ok: true }`). */
  inviteResult?: { ok: boolean; error?: string };
};

export const fakeEmail = 'operator@dgk.internal';

/** Keeps rows whose space_id matches a `space_id=eq.` filter, when the request has one. */
function filterBySpace<T extends Record<string, unknown>>(rows: T[], url: string) {
  const wanted = new URL(url).searchParams.get('space_id')?.replace(/^eq\./, '');
  return wanted ? rows.filter((row) => row.space_id === wanted) : rows;
}

function eqFilter<T extends Record<string, unknown>>(rows: T[], url: string, columns: string[]) {
  const params = new URL(url).searchParams;
  return rows.filter((row) => columns.every((column) => {
    const value = params.get(column);
    return !value?.startsWith('eq.') || String(row[column]) === value.slice(3);
  }));
}

function createSpacesFake(options: SpacesOptions, requests: FakeRequest[]) {
  const role = options.role ?? 'owner';
  const spaces = [...(options.spaces ?? [])].map((space) => ({ archived_at: null, ...space }));
  const clientSpace = options.clientSpaceId ?? spaces.find((space) => space.kind === 'client')?.id ?? '';
  const isClient = role === 'client_manager' || role === 'client_viewer';
  const ownProfile = { user_id: userId, email: fakeEmail, display_name: 'Operator', org_role: isClient ? 'client' : role };
  const profiles: Record<string, unknown>[] = [...(options.noProfile ? [] : [ownProfile]), ...(options.profiles ?? [])];
  const memberships: Record<string, unknown>[] = [
    ...(isClient ? [{ space_id: clientSpace, user_id: userId, role }] : []),
    ...(options.memberships ?? []),
  ];
  const invites = [...(options.invites ?? [])];
  const activity = [...(options.activity ?? [])];
  const functionCalls: Array<{ name: string; body: unknown }> = [];

  const visibleSpaces = () => (isClient ? spaces.filter((space) => memberships.some((member) => member.user_id === userId && member.space_id === space.id)) : spaces);

  function handle(route: Route, request: Request) {
    const url = request.url();
    const method = request.method();
    if (url.includes('/functions/v1/')) {
      const name = new URL(url).pathname.split('/functions/v1/')[1] ?? '';
      const body = requestBody(request);
      functionCalls.push({ name, body });
      requests.push({ method, table: `functions:${name}`, url, body });
      const result = options.inviteResult ?? { ok: true };
      if (name === 'invite-member' && result.ok && body && typeof body === 'object') {
        const sent = body as Record<string, unknown>;
        invites.unshift({
          id: `inv-${invites.length + 1}`,
          email: sent.email,
          org_role: sent.org_role,
          space_id: sent.space_id ?? null,
          role: sent.role ?? null,
          invited_by: userId,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          accepted_at: null,
          revoked_at: null,
        });
      }
      return route.fulfill({ json: result });
    }
    if (!url.includes('/rest/v1/')) return null;
    const path = new URL(url).pathname.split('/rest/v1/')[1] ?? '';
    const [table, rpcName] = path.split('/');
    const body: unknown = requestBody(request);
    const wantsObject = (request.headers().accept ?? '').includes('vnd.pgrst.object');
    const reply = (rows: unknown[]) => route.fulfill({ json: wantsObject ? rows[0] ?? null : rows });
    if (table === 'rpc') {
      requests.push({ method, table: `rpc:${rpcName}`, url, body });
      if (rpcName === 'accept_invite') return route.fulfill({ json: null });
      if (rpcName === 'bulk_move') {
        const ids = ((body as { ids?: string[] } | null)?.ids ?? []);
        return route.fulfill({ json: ids.map((id) => ({ id, ok: true, error_code: null, message: null })) });
      }
      return route.fulfill({ json: [] });
    }
    const tables: Record<string, Record<string, unknown>[]> = { profiles, spaces, space_members: memberships, invites, activity_log: activity };
    if (!(table in tables)) return null;
    if (method !== 'GET' && method !== 'HEAD') requests.push({ method, table, url, body });
    const rows = tables[table];
    if (method === 'GET') {
      if (table === 'spaces') return reply(eqFilter(visibleSpaces(), url, ['id']));
      if (table === 'activity_log') {
        const params = new URL(url).searchParams;
        const filtered = eqFilter(activity, url, ['space_id', 'actor', 'action']);
        const offset = Number(params.get('offset') ?? 0);
        const limit = Number(params.get('limit') ?? filtered.length);
        return reply(filtered.slice(offset, offset + limit));
      }
      return reply(eqFilter(rows, url, ['user_id', 'space_id', 'id']));
    }
    if (method === 'POST' && body && typeof body === 'object') {
      const added = (Array.isArray(body) ? body : [body]).map((row) => (table === 'spaces' ? { id: `space-${spaces.length + 1}`, archived_at: null, ...row } : row));
      rows.push(...added);
      return reply(added);
    }
    if (method === 'PATCH' && body && typeof body === 'object') {
      const matched = eqFilter(rows, url, ['user_id', 'space_id', 'id']);
      for (const row of matched) Object.assign(row, body);
      return reply(matched);
    }
    if (method === 'DELETE') {
      const matched = eqFilter(rows, url, ['user_id', 'space_id', 'id']);
      for (const row of matched) rows.splice(rows.indexOf(row), 1);
      return reply(matched);
    }
    return reply([]);
  }

  return { handle, state: { functionCalls, invites, memberships, profiles, spacesRows: spaces } };
}
