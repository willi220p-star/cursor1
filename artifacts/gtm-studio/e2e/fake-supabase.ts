import type { BrowserContext, Page, Request } from '@playwright/test';

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
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
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
  return { requests, campaigns, assets, objects };
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
