/**
 * Queries for profiles, spaces, members, invites and the activity log. Every call throws an
 * AppError (via unwrap / toAppError); mutations retry temporary failures with withRetry.
 */
import { appError, toAppError } from '@/lib/app-error';
import { unwrap, withRetry } from '@/lib/retry';
import { supabase } from './cloud';
import type { ActivityAction, ActivityEntry, Invite, OrgRole, Profile, Space, SpaceMember, SpaceRole } from './contracts';

export const ACTIVITY_PAGE = 50;

function client() {
  if (!supabase) throw appError('unknown', 'Supabase is not configured.');
  return supabase;
}

const mutate = <T>(fn: () => PromiseLike<{ data: T; error: unknown }>) => withRetry(() => unwrap(fn()));

// ── Reads ──────────────────────────────────────────────────────────────

/** Links a pending invite to this login. Never throws: "no invite" is the normal case. */
export async function acceptInvite(): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc('accept_invite');
  } catch {
    // No invite, or the function is missing: the profile lookup decides access.
  }
}

export async function loadProfile(userId: string): Promise<Profile | null> {
  const data = await unwrap(
    client().from('profiles').select('user_id,email,display_name,org_role').eq('user_id', userId).maybeSingle(),
  );
  return (data as Profile | null) ?? null;
}

export async function listProfiles(): Promise<Profile[]> {
  const data = await unwrap(client().from('profiles').select('user_id,email,display_name,org_role').order('email', { ascending: true }));
  return (data ?? []) as Profile[];
}

export async function listSpaces(): Promise<Space[]> {
  const data = await unwrap(client().from('spaces').select('id,name,kind,archived_at').order('name', { ascending: true }));
  return sortSpaces((data ?? []) as Space[]);
}

/** Internal first, then client spaces by name. */
export function sortSpaces(spaces: Space[]) {
  return [...spaces].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'internal' ? -1 : 1));
}

/** Every membership row the caller may read (RLS: staff all, clients their own space). */
export async function listMemberships(): Promise<SpaceMember[]> {
  const data = await unwrap(client().from('space_members').select('space_id,user_id,role'));
  return (data ?? []) as SpaceMember[];
}

export async function listInvites(): Promise<Invite[]> {
  const data = await unwrap(client().from('invites').select('*').order('created_at', { ascending: false }));
  return (data ?? []) as Invite[];
}

export type SpaceCounts = Record<string, { campaigns: number; files: number }>;

async function countIn(table: string, spaceId: string) {
  const { count, error } = await client().from(table).select('id', { count: 'exact', head: true }).eq('space_id', spaceId).is('deleted_at', null);
  if (error) throw toAppError(error);
  return count ?? 0;
}

/** Campaign and file counts per space (head-only count queries, six spaces at a time). */
export async function spaceItemCounts(spaces: Space[]): Promise<SpaceCounts> {
  const result: SpaceCounts = {};
  const queue = [...spaces];
  const worker = async () => {
    for (let space = queue.shift(); space; space = queue.shift()) {
      const [campaigns, files] = await Promise.all([countIn('outbound_campaigns', space.id), countIn('outbound_assets', space.id)]);
      result[space.id] = { campaigns, files };
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, spaces.length) }, worker));
  return result;
}

export type ActivityFilter = { spaceId?: string | null; actor?: string | null; action?: ActivityAction | null };

/** One page, newest first. Asks for one extra row to know whether there is a next page. */
export async function listActivity(page: number, filter: ActivityFilter = {}): Promise<{ rows: ActivityEntry[]; hasMore: boolean }> {
  const from = page * ACTIVITY_PAGE;
  let query = client().from('activity_log').select('id,at,actor,space_id,entity_type,entity_id,action,details');
  if (filter.spaceId) query = query.eq('space_id', filter.spaceId);
  if (filter.actor) query = query.eq('actor', filter.actor);
  if (filter.action) query = query.eq('action', filter.action);
  const data = await unwrap(query.order('at', { ascending: false }).range(from, from + ACTIVITY_PAGE));
  const rows = (data ?? []) as ActivityEntry[];
  return { rows: rows.slice(0, ACTIVITY_PAGE), hasMore: rows.length > ACTIVITY_PAGE };
}

// ── Invites ────────────────────────────────────────────────────────────

export type InviteRequest = { email: string; org_role: OrgRole; space_id: string | null; role: SpaceRole | null };

/** Client-side checks before calling the Edge Function (which checks again). */
export function validateInvite(request: InviteRequest, inviterRole: OrgRole): string | null {
  const email = request.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
  if (request.org_role === 'owner') return 'Owners cannot be invited.';
  if (request.org_role === 'team' && inviterRole !== 'owner') return 'Only the Owner can invite Team members.';
  if (request.org_role === 'client' && (!request.space_id || !request.role)) return 'Pick a client space and a role.';
  if (inviterRole === 'client') return 'Only DGK staff can invite people.';
  return null;
}

export async function inviteMember(request: InviteRequest): Promise<void> {
  const body = {
    email: request.email.trim().toLowerCase(),
    org_role: request.org_role,
    space_id: request.org_role === 'client' ? request.space_id : null,
    role: request.org_role === 'client' ? request.role : null,
  };
  await withRetry(async () => {
    const { data, error } = await client().functions.invoke('invite-member', { body });
    if (error) throw toAppError(error);
    const result = (data ?? {}) as { ok?: boolean; error?: string };
    if (!result.ok) throw appError('validation', result.error || 'The invite was not sent.');
  });
}

export function resendInvite(invite: Invite) {
  return inviteMember({ email: invite.email, org_role: invite.org_role, space_id: invite.space_id, role: invite.role });
}

export async function revokeInvite(inviteId: string) {
  await mutate(() => client().from('invites').update({ revoked_at: new Date().toISOString() }).eq('id', inviteId));
}

export type InviteStatus = 'Invited' | 'Expired' | 'Revoked' | 'Accepted';

export function inviteStatus(invite: Invite, now = Date.now()): InviteStatus {
  if (invite.accepted_at) return 'Accepted';
  if (invite.revoked_at) return 'Revoked';
  if (new Date(invite.expires_at).getTime() < now) return 'Expired';
  return 'Invited';
}

// ── Members ────────────────────────────────────────────────────────────

export async function setOrgRole(userId: string, orgRole: OrgRole) {
  await mutate(() => client().from('profiles').update({ org_role: orgRole }).eq('user_id', userId));
}

export async function setMemberRole(spaceId: string, userId: string, role: SpaceRole) {
  await mutate(() => client().from('space_members').update({ role }).eq('space_id', spaceId).eq('user_id', userId));
}

/** Moves a client user to another space (keeping their role). */
export async function moveMember(userId: string, fromSpaceId: string, toSpaceId: string) {
  await mutate(() => client().from('space_members').update({ space_id: toSpaceId }).eq('space_id', fromSpaceId).eq('user_id', userId));
}

/** Turns a Team member into a client of one space (owner only, enforced by RLS). */
export async function makeClient(userId: string, spaceId: string, role: SpaceRole) {
  await mutate(() => client().from('space_members').upsert({ space_id: spaceId, user_id: userId, role }));
  await setOrgRole(userId, 'client');
}

/** Makes someone a Team member (owner only, enforced by RLS); Team see every space, so memberships go. */
export async function makeTeam(userId: string) {
  await mutate(() => client().from('space_members').delete().eq('user_id', userId));
  await setOrgRole(userId, 'team');
}

/** Removes access: drops every membership and marks the profile a client with no space (= no access). */
export async function removeAccess(userId: string) {
  await mutate(() => client().from('space_members').delete().eq('user_id', userId));
  await setOrgRole(userId, 'client');
}

// ── Spaces ─────────────────────────────────────────────────────────────

export function cleanSpaceName(name: string) {
  return name.replace(/\s+/g, ' ').trim().slice(0, 80);
}

export async function createSpace(name: string): Promise<Space> {
  const cleaned = cleanSpaceName(name);
  if (!cleaned) throw appError('validation', 'Give the space a name.');
  const data = await mutate(() => client().from('spaces').insert({ name: cleaned, kind: 'client' }).select('id,name,kind,archived_at').single());
  return data as Space;
}

export async function renameSpace(spaceId: string, name: string) {
  const cleaned = cleanSpaceName(name);
  if (!cleaned) throw appError('validation', 'Give the space a name.');
  await mutate(() => client().from('spaces').update({ name: cleaned }).eq('id', spaceId));
}

export async function setSpaceArchived(space: Space, archived: boolean) {
  if (space.kind === 'internal' && archived) throw appError('validation', 'The Internal space cannot be archived.');
  await mutate(() => client().from('spaces').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', space.id));
}

// ── People list (pure) ─────────────────────────────────────────────────

export type PersonRole = OrgRole | SpaceRole | 'none';
export type PersonStatus = 'Active' | 'Invited' | 'Expired' | 'No access';

export type PersonRow = {
  key: string;
  name: string;
  email: string;
  role: PersonRole;
  spaceId: string | null;
  status: PersonStatus;
  profile?: Profile;
  invite?: Invite;
};

/** Profiles (with their membership) plus open invites, owners first, then by name. */
export function buildPeople(profiles: Profile[], memberships: SpaceMember[], invites: Invite[], now = Date.now()): PersonRow[] {
  const people: PersonRow[] = profiles.map((profile) => {
    const member = memberships.find((row) => row.user_id === profile.user_id);
    const staff = profile.org_role !== 'client';
    return {
      key: `p:${profile.user_id}`,
      name: profile.display_name || profile.email.split('@')[0] || profile.email,
      email: profile.email,
      role: staff ? profile.org_role : member?.role ?? 'none',
      spaceId: staff ? null : member?.space_id ?? null,
      status: staff || member ? 'Active' : 'No access',
      profile,
    };
  });
  const known = new Set(profiles.map((profile) => profile.email.toLowerCase()));
  for (const invite of invites) {
    const status = inviteStatus(invite, now);
    if (status !== 'Invited' && status !== 'Expired') continue;
    if (known.has(invite.email.toLowerCase())) continue;
    people.push({
      key: `i:${invite.id}`,
      name: invite.email.split('@')[0] || invite.email,
      email: invite.email,
      role: invite.org_role === 'client' ? invite.role ?? 'none' : invite.org_role,
      spaceId: invite.space_id,
      status,
      invite,
    });
  }
  const rank: Record<PersonRole, number> = { owner: 0, team: 1, client_manager: 2, client_viewer: 3, client: 4, none: 5 };
  return people.sort((a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name));
}

export const personRoleLabels: Record<PersonRole, string> = {
  owner: 'Owner',
  team: 'Team',
  client: 'Client',
  client_manager: 'Client Manager',
  client_viewer: 'Client Viewer',
  none: 'No role',
};

/** Who may change this person: the Owner changes anyone but themselves; Team only client users. */
export function canManagePerson(viewer: { userId: string; orgRole: OrgRole }, person: PersonRow) {
  if (viewer.orgRole === 'client') return false;
  if (person.profile?.user_id === viewer.userId) return false;
  if (person.role === 'owner') return false;
  if (person.role === 'team') return viewer.orgRole === 'owner';
  return true;
}
