import type { BrowserContext, Page } from '@playwright/test';

export const userId = '00000000-0000-4000-8000-000000000001';
const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'operator@dgk.internal', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };

export type FakeOptions = { signedIn?: boolean; failLists?: boolean; contacts?: Record<string, unknown>[]; mode?: string };

/** Answers every Supabase call locally: an operator session, empty tables and accepted uploads. */
export async function fakeSupabase(context: BrowserContext, options: FakeOptions = {}) {
  const { signedIn = true, failLists = false, contacts, mode } = options;
  await context.route(/supabase\.co/, (route) => {
    const url = route.request().url();
    if (url.includes('/auth/v1/user')) return route.fulfill({ json: user });
    if (url.includes('/storage/v1/')) return route.fulfill({ json: { Key: 'ok' } });
    if (url.includes('/rest/v1/')) {
      // 500 is not retried by the Supabase client, so the error shows at once.
      if (failLists && route.request().method() === 'GET') return route.fulfill({ status: 500, json: { message: 'Internal error' } });
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
