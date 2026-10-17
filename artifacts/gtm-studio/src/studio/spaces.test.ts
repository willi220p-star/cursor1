import { describe, expect, it } from 'vitest';
import { buildPeople, canManagePerson, inviteStatus, sortSpaces, validateInvite } from './spaces';
import { isCarouselPath, isManagedPath, spaceFields, spaceFromPath, storagePathFor } from './space-scope';
import { describeActivity, relativeTime } from './activity-format';
import type { ActivityEntry, Invite, Profile, SpaceMember } from './contracts';

const uid = '00000000-0000-4000-8000-000000000001';

describe('storage paths and payload fields', () => {
  it('puts new uploads under spaces/<space>/ when a space is known', () => {
    expect(storagePathFor('s1', uid, 'uploads/desk/a.png')).toBe('spaces/s1/uploads/desk/a.png');
    expect(storagePathFor('s1', uid, '/lists/x.csv')).toBe('spaces/s1/lists/x.csv');
  });

  it('falls back to the legacy <userId>/ folder without a space', () => {
    expect(storagePathFor(null, uid, 'uploads/desk/a.png')).toBe(`${uid}/uploads/desk/a.png`);
  });

  it('treats legacy and space paths as managed, others not', () => {
    expect(isManagedPath(`${uid}/x/1.jpg`, uid)).toBe(true);
    expect(isManagedPath('spaces/s1/x/1.jpg', uid)).toBe(true);
    expect(isManagedPath('someone-else/x/1.jpg', uid)).toBe(false);
    expect(isManagedPath('spaces//x.jpg', uid)).toBe(false);
  });

  it('reads the space from a space path', () => {
    expect(spaceFromPath('spaces/abc/carousels/x.json')).toBe('abc');
    expect(spaceFromPath(`${uid}/carousels/x.json`)).toBeNull();
  });

  it('recognises carousel files in both layouts', () => {
    expect(isCarouselPath(`${uid}/carousels/a.json`, uid)).toBe(true);
    expect(isCarouselPath('spaces/s/carousels/a.json', uid)).toBe(true);
    expect(isCarouselPath('spaces/s/lists/a.json', uid)).toBe(false);
  });

  it('adds space_id to row payloads only when known', () => {
    expect(spaceFields('s1')).toEqual({ space_id: 's1' });
    expect(spaceFields(null)).toEqual({});
  });
});

const profiles: Profile[] = [
  { user_id: 'o', email: 'owner@dgk.com', display_name: 'Olive', org_role: 'owner' },
  { user_id: 't', email: 'sam@dgk.com', display_name: 'Sam', org_role: 'team' },
  { user_id: 'c', email: 'cara@acme.com', display_name: null, org_role: 'client' },
  { user_id: 'gone', email: 'gone@acme.com', display_name: 'Gone', org_role: 'client' },
];
const members: SpaceMember[] = [{ space_id: 'acme', user_id: 'c', role: 'client_manager' }];
const now = Date.parse('2026-10-17T12:00:00Z');
const invite = (id: string, extra: Partial<Invite> = {}): Invite => ({
  id,
  email: `${id}@acme.com`,
  org_role: 'client',
  space_id: 'acme',
  role: 'client_viewer',
  invited_by: 'o',
  created_at: '2026-10-15T00:00:00Z',
  expires_at: '2026-10-22T00:00:00Z',
  accepted_at: null,
  revoked_at: null,
  ...extra,
});

describe('people list', () => {
  it('lists profiles with role, space and status, then open invites', () => {
    const people = buildPeople(profiles, members, [
      invite('new'),
      invite('late', { expires_at: '2026-10-01T00:00:00Z' }),
      invite('done', { accepted_at: '2026-10-16T00:00:00Z' }),
      invite('cancelled', { revoked_at: '2026-10-16T00:00:00Z' }),
    ], now);
    const byEmail = Object.fromEntries(people.map((person) => [person.email, person]));
    expect(byEmail['owner@dgk.com']).toMatchObject({ role: 'owner', status: 'Active', spaceId: null });
    expect(byEmail['cara@acme.com']).toMatchObject({ name: 'cara', role: 'client_manager', spaceId: 'acme', status: 'Active' });
    expect(byEmail['gone@acme.com']).toMatchObject({ role: 'none', status: 'No access' });
    expect(byEmail['new@acme.com']).toMatchObject({ status: 'Invited', role: 'client_viewer' });
    expect(byEmail['late@acme.com']).toMatchObject({ status: 'Expired' });
    expect(byEmail['done@acme.com']).toBeUndefined();
    expect(byEmail['cancelled@acme.com']).toBeUndefined();
    expect(people[0].role).toBe('owner');
  });

  it('works out invite status', () => {
    expect(inviteStatus(invite('a'), now)).toBe('Invited');
    expect(inviteStatus(invite('a', { expires_at: '2026-10-01T00:00:00Z' }), now)).toBe('Expired');
  });

  it('lets the Owner manage anyone but themselves, Team only clients', () => {
    const people = buildPeople(profiles, members, [], now);
    const find = (email: string) => people.find((person) => person.email === email)!;
    const owner = { userId: 'o', orgRole: 'owner' as const };
    const team = { userId: 't', orgRole: 'team' as const };
    expect(canManagePerson(owner, find('owner@dgk.com'))).toBe(false);
    expect(canManagePerson(owner, find('sam@dgk.com'))).toBe(true);
    expect(canManagePerson(team, find('sam@dgk.com'))).toBe(false);
    expect(canManagePerson(team, find('owner@dgk.com'))).toBe(false);
    expect(canManagePerson(team, find('cara@acme.com'))).toBe(true);
    expect(canManagePerson({ userId: 'c', orgRole: 'client' }, find('gone@acme.com'))).toBe(false);
  });
});

describe('invite validation', () => {
  it('needs a valid email', () => {
    expect(validateInvite({ email: 'nope', org_role: 'client', space_id: 's', role: 'client_viewer' }, 'owner')).toMatch(/valid email/);
  });
  it('needs a space and role for client roles', () => {
    expect(validateInvite({ email: 'a@b.co', org_role: 'client', space_id: null, role: 'client_viewer' }, 'team')).toMatch(/space/);
  });
  it('only lets the Owner invite Team members', () => {
    expect(validateInvite({ email: 'a@b.co', org_role: 'team', space_id: null, role: null }, 'team')).toMatch(/Only the Owner/);
    expect(validateInvite({ email: 'a@b.co', org_role: 'team', space_id: null, role: null }, 'owner')).toBeNull();
  });
  it('accepts a complete client invite from Team', () => {
    expect(validateInvite({ email: 'a@b.co', org_role: 'client', space_id: 's', role: 'client_manager' }, 'team')).toBeNull();
  });
});

describe('sortSpaces', () => {
  it('puts Internal first, then clients by name', () => {
    const sorted = sortSpaces([
      { id: 'z', name: 'Zed', kind: 'client', archived_at: null },
      { id: 'i', name: 'Internal (DGK)', kind: 'internal', archived_at: null },
      { id: 'a', name: 'Acme', kind: 'client', archived_at: null },
    ]);
    expect(sorted.map((space) => space.id)).toEqual(['i', 'a', 'z']);
  });
});

describe('activity lines', () => {
  const names = { person: (id: string | null) => (id === 't' ? 'Sam' : ''), space: (id: string | null) => (id === 'acme' ? 'Acme' : '') };
  const entry = (extra: Partial<ActivityEntry>): ActivityEntry => ({
    id: 1, at: '2026-10-17T11:58:00Z', actor: 't', space_id: 'acme', entity_type: 'campaign', entity_id: null, action: 'moved', details: {}, ...extra,
  });

  it('describes a bulk move with the target space', () => {
    expect(describeActivity(entry({ details: { count: 12, to_space: 'acme' } }), names)).toBe('Sam moved 12 campaigns to Acme');
  });
  it('describes a rename', () => {
    expect(describeActivity(entry({ action: 'renamed', details: { old_name: 'Spring', new_name: 'Autumn' } }), names)).toBe('Sam renamed “Spring” to “Autumn”');
  });
  it('describes trash and invites', () => {
    expect(describeActivity(entry({ action: 'trashed', entity_type: 'asset', details: { count: 3 } }), names)).toBe('Sam moved 3 files to Trash');
    expect(describeActivity(entry({ action: 'invited', entity_type: 'invite', details: { email: 'cara@acme.com', role: 'client_viewer' } }), names)).toBe('Sam invited cara@acme.com as Client Viewer');
  });
  it('falls back to Someone for an unknown actor', () => {
    expect(describeActivity(entry({ actor: null, action: 'created', details: { name: 'Q4' } }), names)).toBe('Someone created “Q4”');
  });
  it('says how long ago', () => {
    expect(relativeTime('2026-10-17T11:58:00Z', now)).toBe('2 min ago');
    expect(relativeTime('2026-10-17T11:59:50Z', now)).toBe('just now');
    expect(relativeTime('2026-10-17T09:00:00Z', now)).toBe('3 h ago');
    expect(relativeTime('2026-10-16T10:00:00Z', now)).toBe('yesterday');
  });
});
