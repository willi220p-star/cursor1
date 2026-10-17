import { describe, expect, it } from 'vitest';
import { allowedCurrentSpace, canDo, clientRole, defaultSpaceId, saveSpaceId, type AccessInput } from './access';
import type { AccessAction, Space, SpaceMember } from './contracts';

const OWN = 'space-own';
const OTHER = 'space-other';
const me = 'user-1';

type Role = 'owner' | 'team' | 'client_manager' | 'client_viewer';
type Where = 'own' | 'other' | 'none';

function inputFor(role: Role): AccessInput {
  if (role === 'owner' || role === 'team') return { orgRole: role, memberships: [] };
  return { orgRole: 'client', memberships: [{ space_id: OWN, user_id: me, role }] };
}

const spaceFor = (where: Where) => (where === 'own' ? OWN : where === 'other' ? OTHER : null);

/**
 * The spec's permission matrix, row by row. For each action: [owner, team, manager, viewer],
 * each a triple for [own space, another space, no space (staff-wide check)].
 * Staff have no "own" space, so own/other both mean "a space".
 */
const Y: [boolean, boolean, boolean] = [true, true, true];
const N: [boolean, boolean, boolean] = [false, false, false];
const OWN_ONLY: [boolean, boolean, boolean] = [true, false, false];
const MATRIX: Record<AccessAction, [typeof Y, typeof Y, typeof Y, typeof Y]> = {
  // See spaces: all | all | own | own
  'space.view': [Y, Y, OWN_ONLY, OWN_ONLY],
  // Generate / save campaigns: ✓ | ✓ | own space | –
  'campaign.generate': [Y, Y, OWN_ONLY, N],
  // Rename, move, trash, restore, bulk update: ✓ | ✓ | own space | –
  'item.edit': [Y, Y, OWN_ONLY, N],
  // Purge from Trash: ✓ | ✓ | – | –
  'item.purge': [Y, Y, N, N],
  // Download / ZIP: ✓ | ✓ | own | own
  'item.download': [Y, Y, OWN_ONLY, OWN_ONLY],
  // Approve / reject / comment: ✓ | ✓ | own | own
  'review.write': [Y, Y, OWN_ONLY, OWN_ONLY],
  // Edit templates / looks: ✓ | ✓ | use only | –
  'template.edit': [Y, Y, N, N],
  // ...use only: templates are team-wide, so a manager may use them with no space given.
  'template.use': [Y, Y, [true, false, true], N],
  // Invite and manage client users, create/rename/archive spaces: ✓ | ✓ | – | –
  'members.manage': [Y, Y, N, N],
  // Invite or change Team members, change Owner: ✓ | – | – | –
  'team.manage': [Y, N, N, N],
  // Activity log: all | all | own space | –
  'activity.view': [Y, Y, OWN_ONLY, N],
};

const ROLES: Role[] = ['owner', 'team', 'client_manager', 'client_viewer'];
const WHERE: Where[] = ['own', 'other', 'none'];

describe('canDo matches the permission matrix', () => {
  for (const [action, perRole] of Object.entries(MATRIX) as Array<[AccessAction, (typeof MATRIX)[AccessAction]]>) {
    ROLES.forEach((role, roleIndex) => {
      WHERE.forEach((where, whereIndex) => {
        const expected = perRole[roleIndex][whereIndex];
        it(`${role} ${expected ? 'may' : 'may not'} ${action} (${where} space)`, () => {
          expect(canDo(inputFor(role), action, spaceFor(where))).toBe(expected);
        });
      });
    });
  }

  it('covers every action in the contract', () => {
    expect(Object.keys(MATRIX).sort()).toEqual([
      'activity.view', 'campaign.generate', 'item.download', 'item.edit', 'item.purge', 'members.manage',
      'review.write', 'space.view', 'team.manage', 'template.edit', 'template.use',
    ]);
  });

  it('gives a client with no membership nothing', () => {
    const none: AccessInput = { orgRole: 'client', memberships: [] };
    for (const action of Object.keys(MATRIX) as AccessAction[]) {
      expect(canDo(none, action, OWN)).toBe(false);
      expect(canDo(none, action, null)).toBe(false);
    }
  });

  it('treats undefined like null', () => {
    expect(canDo(inputFor('client_manager'), 'item.edit')).toBe(false);
    expect(canDo(inputFor('team'), 'members.manage')).toBe(true);
  });
});

const internal: Space = { id: 'int', name: 'Internal (DGK)', kind: 'internal', archived_at: null };
const acme: Space = { id: 'acme', name: 'Acme', kind: 'client', archived_at: null };
const old: Space = { id: 'old', name: 'Old Co', kind: 'client', archived_at: '2026-01-01T00:00:00Z' };
const spaces = [internal, acme, old];
const member = (space_id: string, role: SpaceMember['role'] = 'client_viewer'): SpaceMember => ({ space_id, user_id: me, role });

describe('space defaulting', () => {
  it('staff default to All spaces (null) without a stored choice', () => {
    expect(defaultSpaceId({ orgRole: 'owner', memberships: [], spaces, stored: null })).toBeNull();
  });

  it('staff get their stored space back when it still exists', () => {
    expect(defaultSpaceId({ orgRole: 'team', memberships: [], spaces, stored: 'acme' })).toBe('acme');
  });

  it('staff fall back to All spaces when the stored space is gone or archived', () => {
    expect(defaultSpaceId({ orgRole: 'team', memberships: [], spaces, stored: 'missing' })).toBeNull();
    expect(defaultSpaceId({ orgRole: 'team', memberships: [], spaces, stored: 'old' })).toBeNull();
  });

  it('clients are locked to their own space, ignoring any stored choice', () => {
    expect(defaultSpaceId({ orgRole: 'client', memberships: [member('acme')], spaces, stored: 'int' })).toBe('acme');
  });

  it('clients prefer a live space over an archived one', () => {
    expect(defaultSpaceId({ orgRole: 'client', memberships: [member('old'), member('acme')], spaces, stored: null })).toBe('acme');
  });

  it('clients cannot switch to a space they do not belong to', () => {
    const input = { orgRole: 'client' as const, memberships: [member('acme')], spaces };
    expect(allowedCurrentSpace(input, 'int')).toBe('acme');
    expect(allowedCurrentSpace(input, null)).toBe('acme');
  });

  it('staff may pick any known space or All spaces', () => {
    const input = { orgRole: 'owner' as const, memberships: [], spaces };
    expect(allowedCurrentSpace(input, 'acme')).toBe('acme');
    expect(allowedCurrentSpace(input, null)).toBeNull();
    expect(allowedCurrentSpace(input, 'nope')).toBeNull();
  });
});

describe('save space', () => {
  it('staff on All spaces save to Internal', () => {
    expect(saveSpaceId({ orgRole: 'owner', memberships: [], spaces, currentSpaceId: null })).toBe('int');
  });

  it('staff in a space save to that space', () => {
    expect(saveSpaceId({ orgRole: 'team', memberships: [], spaces, currentSpaceId: 'acme' })).toBe('acme');
  });

  it('clients always save to their own space', () => {
    expect(saveSpaceId({ orgRole: 'client', memberships: [member('acme', 'client_manager')], spaces, currentSpaceId: 'int' })).toBe('acme');
  });

  it('no spaces (local mode or before the migration) means no space', () => {
    expect(saveSpaceId({ orgRole: 'owner', memberships: [], spaces: [], currentSpaceId: null })).toBeNull();
  });
});

describe('clientRole', () => {
  it('reports the most capable role', () => {
    expect(clientRole([member('a'), member('b', 'client_manager')])).toBe('client_manager');
    expect(clientRole([member('a')])).toBe('client_viewer');
    expect(clientRole([])).toBeNull();
  });
});
