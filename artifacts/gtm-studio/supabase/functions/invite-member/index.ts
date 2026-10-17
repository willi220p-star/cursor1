// Edge Function: invite-member
// Staff invite people by email. Team members may invite client users; only the Owner may invite staff.
// POST { email, org_role: 'owner'|'team'|'client', space_id?: uuid, role?: 'client_manager'|'client_viewer' }
// → 200 { ok: true, error: null, existing_user: boolean } or { ok: false, error: { code, message } }.
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (provided by Supabase), APP_URL (redirect after
// accepting). On first sign-in the app calls accept_invite(), which turns the invites row into a profile/membership.
import { createClient } from 'jsr:@supabase/supabase-js@2';

type Code = 'permission' | 'validation' | 'not_found' | 'server';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const fail = (status: number, code: Code, message: string) => json(status, { ok: false, error: { code, message } });

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORG_ROLES = ['owner', 'team', 'client'];
const SPACE_ROLES = ['client_manager', 'client_viewer'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail(405, 'validation', 'Use POST.');

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const appUrl = Deno.env.get('APP_URL');
  if (!url || !anonKey || !serviceKey || !appUrl) return fail(500, 'server', 'The invite service is not configured.');

  // Who is asking: verify the caller's JWT with their own Authorization header.
  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return fail(401, 'permission', 'Sign in first.');
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) return fail(401, 'permission', 'Sign in first.');

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: profile } = await admin
    .from('profiles')
    .select('org_role')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  const callerRole = profile?.org_role as string | undefined;
  if (callerRole !== 'owner' && callerRole !== 'team') {
    return fail(403, 'permission', 'Only the Owner and Team can invite people.');
  }

  // Validate input.
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'validation', 'Send a JSON body.');
  }
  const email = String(body.email ?? '').trim().toLowerCase();
  const orgRole = String(body.org_role ?? '');
  const spaceId = body.space_id == null || body.space_id === '' ? null : String(body.space_id);
  const role = body.role == null || body.role === '' ? null : String(body.role);

  if (!EMAIL.test(email) || email.length > 254) return fail(400, 'validation', 'Enter a valid email address.');
  if (!ORG_ROLES.includes(orgRole)) return fail(400, 'validation', 'Choose a role.');
  if (orgRole !== 'client' && callerRole !== 'owner') {
    return fail(403, 'permission', 'Only the Owner can invite Team members.');
  }
  if (orgRole === 'client') {
    if (!spaceId || !UUID.test(spaceId)) return fail(400, 'validation', 'Choose a client space.');
    if (!role || !SPACE_ROLES.includes(role)) return fail(400, 'validation', 'Choose Client Manager or Client Viewer.');
    const { data: space } = await admin.from('spaces').select('id, kind, archived_at').eq('id', spaceId).maybeSingle();
    if (!space) return fail(404, 'not_found', 'That client space no longer exists.');
    if (space.kind !== 'client' || space.archived_at) return fail(400, 'validation', 'Pick an active client space.');
  } else if (spaceId || role) {
    return fail(400, 'validation', 'Team and Owner invites do not take a space.');
  }

  // Send the email. Someone who already has an account gets no new email; accept_invite() picks the
  // invite up on their next sign-in.
  let existingUser = false;
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: appUrl });
  if (inviteError) {
    if (/already (been )?registered|already exists/i.test(inviteError.message)) existingUser = true;
    else return fail(502, 'server', 'The invite email could not be sent. Try again in a minute.');
  }

  // One pending invite per email: revoke older ones, then record this one.
  const now = new Date().toISOString();
  await admin
    .from('invites')
    .update({ revoked_at: now })
    .eq('email', email) // stored lower-case by this function
    .is('accepted_at', null)
    .is('revoked_at', null);
  const { error: insertError } = await admin.from('invites').insert({
    email,
    org_role: orgRole,
    space_id: orgRole === 'client' ? spaceId : null,
    role: orgRole === 'client' ? role : null,
    invited_by: userData.user.id,
  });
  if (insertError) return fail(500, 'server', 'The invite was sent but could not be recorded. Try again.');

  return json(200, { ok: true, error: null, existing_user: existingUser });
});
