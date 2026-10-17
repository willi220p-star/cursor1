/**
 * The client's single source of truth for the permission matrix in
 * docs/superpowers/specs/2026-10-17-team-spaces-bulk-files-errors-design.md ("Permission matrix").
 * Pure: no React, no Supabase. The database enforces the same rules with RLS.
 */
import type { AccessAction, OrgRole, Space, SpaceMember, SpaceRole } from './contracts';

export type AccessInput = {
  orgRole: OrgRole;
  /** The signed-in user's own space memberships (client users only; staff have none). */
  memberships: SpaceMember[];
};

export function isStaff(orgRole: OrgRole) {
  return orgRole === 'owner' || orgRole === 'team';
}

function roleIn(memberships: SpaceMember[], spaceId: string): SpaceRole | null {
  return memberships.find((member) => member.space_id === spaceId)?.role ?? null;
}

/**
 * `spaceId` null/undefined means "any space": staff-wide checks such as members.manage.
 * Client users only ever pass for a specific space they belong to, except template.use,
 * which is team-wide (templates have no space) and open to any Client Manager.
 */
export function canDo(input: AccessInput, action: AccessAction, spaceId?: string | null): boolean {
  const { orgRole, memberships } = input;
  if (orgRole === 'owner') return true;
  if (orgRole === 'team') return action !== 'team.manage';
  // Client users from here on.
  if (action === 'template.use') {
    if (spaceId) return roleIn(memberships, spaceId) === 'client_manager';
    return memberships.some((member) => member.role === 'client_manager');
  }
  if (!spaceId) return false;
  const role = roleIn(memberships, spaceId);
  if (!role) return false;
  switch (action) {
    case 'space.view':
    case 'item.download':
    case 'review.write':
      return true;
    case 'campaign.generate':
    case 'item.edit':
    case 'activity.view':
      return role === 'client_manager';
    case 'item.purge':
    case 'template.edit':
    case 'members.manage':
    case 'team.manage':
      return false;
    default:
      return false;
  }
}

/** The most capable role a client user holds, or null for staff / no access. */
export function clientRole(memberships: SpaceMember[]): SpaceRole | null {
  if (memberships.some((member) => member.role === 'client_manager')) return 'client_manager';
  if (memberships.length) return 'client_viewer';
  return null;
}

export function internalSpace(spaces: Space[]) {
  return spaces.find((space) => space.kind === 'internal') ?? null;
}

/** The client user's own space: the first membership whose space is loaded and not archived, else the first membership. */
export function clientSpaceId(memberships: SpaceMember[], spaces: Space[]): string | null {
  const live = memberships.find((member) => spaces.some((space) => space.id === member.space_id && !space.archived_at));
  return live?.space_id ?? memberships[0]?.space_id ?? null;
}

/**
 * The space the app starts on. Staff: the remembered choice if that space still exists and is not
 * archived, else null (= All spaces). Clients: locked to their own space.
 */
export function defaultSpaceId(input: AccessInput & { spaces: Space[]; stored: string | null }): string | null {
  if (!isStaff(input.orgRole)) return clientSpaceId(input.memberships, input.spaces);
  const { stored, spaces } = input;
  if (stored && spaces.some((space) => space.id === stored && !space.archived_at)) return stored;
  return null;
}

/** What a staff member may select; clients can never leave their space. */
export function allowedCurrentSpace(input: AccessInput & { spaces: Space[] }, requested: string | null): string | null {
  if (!isStaff(input.orgRole)) {
    const own = clientSpaceId(input.memberships, input.spaces);
    return requested && input.memberships.some((member) => member.space_id === requested) ? requested : own;
  }
  if (requested && !input.spaces.some((space) => space.id === requested)) return null;
  return requested;
}

/**
 * Where new saves and uploads go: the current space; staff on "All spaces" save to Internal;
 * clients always save to their own space. Null when no space is known (local mode or before the
 * spaces migration), which makes cloud.ts fall back to the legacy per-user paths.
 */
export function saveSpaceId(input: AccessInput & { spaces: Space[]; currentSpaceId: string | null }): string | null {
  if (!isStaff(input.orgRole)) {
    const current = input.currentSpaceId;
    if (current && input.memberships.some((member) => member.space_id === current)) return current;
    return clientSpaceId(input.memberships, input.spaces);
  }
  return input.currentSpaceId ?? internalSpace(input.spaces)?.id ?? null;
}

export const orgRoleLabels: Record<OrgRole, string> = { owner: 'Owner', team: 'Team', client: 'Client' };
export const spaceRoleLabels: Record<SpaceRole, string> = { client_manager: 'Client Manager', client_viewer: 'Client Viewer' };
