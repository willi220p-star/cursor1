import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Plus, Send, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toAppError } from '@/lib/app-error';
import { useAccess } from '@/studio/access-context';
import {
  buildPeople,
  canManagePerson,
  createSpace,
  inviteMember,
  listInvites,
  listMemberships,
  listProfiles,
  makeClient,
  makeTeam,
  moveMember,
  personRoleLabels,
  removeAccess,
  renameSpace,
  resendInvite,
  revokeInvite,
  setMemberRole,
  setSpaceArchived,
  sortSpaces,
  spaceItemCounts,
  validateInvite,
  type PersonRow,
  type SpaceCounts,
} from '@/studio/spaces';
import type { AppError, Invite, OrgRole, Profile, Space, SpaceMember, SpaceRole } from '@/studio/contracts';

type RoleChoice = 'team' | SpaceRole;

const roleChoiceLabels: Record<RoleChoice, string> = { team: 'Team', client_manager: 'Client Manager', client_viewer: 'Client Viewer' };

function roleOptions(orgRole: OrgRole): RoleChoice[] {
  return orgRole === 'owner' ? ['team', 'client_manager', 'client_viewer'] : ['client_manager', 'client_viewer'];
}

function InlineError({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>;
}

/** Runs one mutation: toast on success, inline + toast on failure. Returns true when it worked. */
async function runAction(label: string, fn: () => Promise<unknown>, onError: (message: string) => void, success?: string) {
  try {
    await fn();
    if (success) toast.success(success);
    return true;
  } catch (reason) {
    const error = toAppError(reason);
    onError(error.message);
    toast.error(`${label} failed`, { description: error.message });
    return false;
  }
}

type InviteActRunner = (label: string, fn: () => Promise<unknown>, success: string) => Promise<boolean>;

/** The three-dots menu for one person; shared by the phone cards and the desktop table. */
function PersonActions({ person, manageable, onEdit, onRemove, onInviteAction }: {
  person: PersonRow;
  manageable: boolean;
  onEdit: (person: PersonRow) => void;
  onRemove: (person: PersonRow) => void;
  onInviteAction: InviteActRunner;
}) {
  if (!manageable) return null;
  const invite = person.invite;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="btn btn-quiet btn-icon flex-none" aria-label={`Actions for ${person.email}`}><MoreHorizontal size={18} aria-hidden /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52 border-border bg-popover">
        {invite ? (
          <>
            <DropdownMenuItem className="min-h-11" onSelect={() => void onInviteAction('Resend invite', () => resendInvite(invite), `Invite sent again to ${person.email}`)}>
              <Send aria-hidden /> Resend invite
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11 text-destructive" onSelect={() => void onInviteAction('Revoke invite', () => revokeInvite(invite.id), `Invite for ${person.email} revoked`)}>
              Revoke invite
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem className="min-h-11" onSelect={() => onEdit(person)}>
              <Pencil aria-hidden /> Change role or space…
            </DropdownMenuItem>
            {person.status !== 'No access' && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="min-h-11 text-destructive" onSelect={() => onRemove(person)}>
                  Remove access…
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MembersPage({ userId }: { userId: string }) {
  const access = useAccess();
  const { orgRole, spaces, refresh: refreshAccess } = access;
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [memberships, setMemberships] = useState<SpaceMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loadError, setLoadError] = useState<AppError | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<PersonRow | null>(null);
  const [removing, setRemoving] = useState<PersonRow | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [nextProfiles, nextMembers, nextInvites] = await Promise.all([listProfiles(), listMemberships(), listInvites()]);
      setProfiles(nextProfiles);
      setMemberships(nextMembers);
      setInvites(nextInvites);
    } catch (reason) {
      setLoadError(toAppError(reason));
      setProfiles((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const people = useMemo(() => buildPeople(profiles ?? [], memberships, invites), [profiles, memberships, invites]);
  const clientSpaces = useMemo(() => sortSpaces(spaces.filter((space) => space.kind === 'client' && !space.archived_at)), [spaces]);
  const nameOf = (spaceId: string | null) => (spaceId ? spaces.find((space) => space.id === spaceId)?.name ?? 'Unknown space' : '');
  const viewer = { userId, orgRole };

  const act = async (label: string, fn: () => Promise<unknown>, success: string) => {
    setActionError(null);
    const ok = await runAction(label, fn, setActionError, success);
    if (ok) await load();
    return ok;
  };

  return (
    <div className="mx-auto max-w-[1100px] animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[clamp(36px,4.4vw,52px)] font-semibold leading-[1.05]">Members</h1>
          <p className="mt-3 max-w-[60ch] text-base text-muted-foreground">Who can sign in, what they can do, and which client space they see.</p>
        </div>
        <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={() => { setActionError(null); setInviteOpen(true); }}>
          <UserPlus size={16} aria-hidden /> Invite someone
        </button>
      </div>

      <Tabs defaultValue="people" className="mt-8">
        <TabsList className="h-12 sm:h-10">
          <TabsTrigger value="people" className="h-full px-5">People</TabsTrigger>
          <TabsTrigger value="spaces" className="h-full px-5">Spaces</TabsTrigger>
        </TabsList>

        <TabsContent value="people" className="mt-6">
          {loadError && (
            <div className="load-error" role="alert">
              <span>Could not load members. {loadError.message}</span>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => void load()}>Retry</button>
            </div>
          )}
          <InlineError error={actionError} />
          {profiles === null ? (
            <p className="text-sm text-muted-foreground" role="status">Loading members…</p>
          ) : (
            <>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="People list">
              {people.map((person) => {
                const manageable = canManagePerson(viewer, person);
                const isSelf = person.profile?.user_id === userId;
                return (
                  <li key={`card-${person.key}`} className="panel flex items-start gap-3 p-4" data-person-card={person.email}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{person.name}{isSelf && <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>}</p>
                      <p className="truncate text-sm text-muted-foreground" title={person.email}>{person.email}</p>
                      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span>{personRoleLabels[person.role]}</span>
                        <span className="text-muted-foreground" aria-hidden>·</span>
                        <span className="min-w-0 truncate">{person.role === 'owner' || person.role === 'team' ? 'All spaces' : nameOf(person.spaceId) || '—'}</span>
                        <span className="status-pill" data-status={person.status.toLowerCase().replace(' ', '-')}>{person.status}</span>
                      </p>
                    </div>
                    <PersonActions person={person} manageable={manageable} onEdit={(row) => { setActionError(null); setEditing(row); }} onRemove={setRemoving} onInviteAction={act} />
                  </li>
                );
              })}
              {!people.length && <li className="panel p-6 text-center text-sm text-muted-foreground">No members yet. Invite someone to get started.</li>}
            </ul>
            <div className="panel hidden overflow-x-auto p-0 lg:block">
              <table className="w-full min-w-[720px] text-left text-sm" aria-label="People">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Space</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((person) => {
                    const manageable = canManagePerson(viewer, person);
                    const isSelf = person.profile?.user_id === userId;
                    return (
                      <tr key={person.key} className="border-t border-border" data-person={person.email}>
                        <td className="px-4 py-3 font-medium">{person.name}{isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}</td>
                        <td className="px-4 py-3 text-muted-foreground">{person.email}</td>
                        <td className="px-4 py-3">{personRoleLabels[person.role]}</td>
                        <td className="px-4 py-3">{person.role === 'owner' || person.role === 'team' ? 'All spaces' : nameOf(person.spaceId) || '—'}</td>
                        <td className="px-4 py-3"><span className="status-pill" data-status={person.status.toLowerCase().replace(' ', '-')}>{person.status}</span></td>
                        <td className="px-4 py-3 text-right">
                          <PersonActions person={person} manageable={manageable} onEdit={(row) => { setActionError(null); setEditing(row); }} onRemove={setRemoving} onInviteAction={act} />
                        </td>
                      </tr>
                    );
                  })}
                  {!people.length && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No members yet. Invite someone to get started.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="spaces" className="mt-6">
          <SpacesTab spaces={spaces} onChanged={refreshAccess} />
        </TabsContent>
      </Tabs>

      <InviteDialog
        open={inviteOpen}
        orgRole={orgRole}
        clientSpaces={clientSpaces}
        onClose={() => setInviteOpen(false)}
        onInvited={async () => {
          setInviteOpen(false);
          await load();
        }}
      />

      <EditAccessDialog
        person={editing}
        orgRole={orgRole}
        clientSpaces={clientSpaces}
        onClose={() => setEditing(null)}
        onSave={async (person, role, spaceId) => {
          const targetUser = person.profile!.user_id;
          const label = 'Change access';
          const ok = await act(label, async () => {
            if (role === 'team') return makeTeam(targetUser);
            if (!spaceId) throw new Error('Pick a client space.');
            if (person.role === 'team' || person.status === 'No access') return makeClient(targetUser, spaceId, role);
            if (person.spaceId && person.spaceId !== spaceId) await moveMember(targetUser, person.spaceId, spaceId);
            if (person.role !== role) await setMemberRole(spaceId, targetUser, role);
          }, `${person.name} is now ${roleChoiceLabels[role]}${role === 'team' ? '' : ` in ${nameOf(spaceId)}`}`);
          if (ok) setEditing(null);
        }}
      />

      <Dialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
        <DialogContent className="max-w-md rounded-[12px] border-border bg-card">
          <DialogHeader>
            <DialogTitle className="display text-2xl font-semibold">Remove access?</DialogTitle>
            <DialogDescription>
              {removing?.name} ({removing?.email}) will no longer see any space. Their campaigns and files stay where they are.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex justify-end gap-3">
            <button type="button" className="btn btn-quiet" onClick={() => setRemoving(null)}>Cancel</button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={async () => {
                const person = removing;
                if (!person?.profile) return;
                const ok = await act('Remove access', () => removeAccess(person.profile!.user_id), `${person.name} no longer has access`);
                if (ok) setRemoving(null);
              }}
            >
              Remove access
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SpaceSelect({ value, onChange, spaces, id }: { value: string; onChange: (value: string) => void; spaces: Space[]; id: string }) {
  return (
    <select id={id} className="field w-full" value={value} onChange={(event) => onChange(event.target.value)} required>
      <option value="">Pick a client space</option>
      {spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
    </select>
  );
}

function InviteDialog({ open, orgRole, clientSpaces, onClose, onInvited }: {
  open: boolean;
  orgRole: OrgRole;
  clientSpaces: Space[];
  onClose: () => void;
  onInvited: () => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<RoleChoice>('client_viewer');
  const [spaceId, setSpaceId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmail('');
    setRole('client_viewer');
    setSpaceId('');
    setError(null);
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const request = role === 'team'
      ? { email, org_role: 'team' as const, space_id: null, role: null }
      : { email, org_role: 'client' as const, space_id: spaceId || null, role };
    const invalid = validateInvite(request, orgRole);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    const ok = await runAction('Invite', () => inviteMember(request), setError, `Invite sent to ${email.trim()}`);
    setBusy(false);
    if (ok) await onInvited();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-md rounded-[12px] border-border bg-card">
        <DialogHeader>
          <DialogTitle className="display text-2xl font-semibold">Invite someone</DialogTitle>
          <DialogDescription>They get an email with a sign-in link. Invites last seven days.</DialogDescription>
        </DialogHeader>
        <form className="mt-2 flex flex-col gap-4" onSubmit={submit} noValidate>
          <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="invite-email">
            Email
            <input id="invite-email" type="email" className="field" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" required />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="invite-role">
            Role
            <select id="invite-role" className="field" value={role} onChange={(event) => setRole(event.target.value as RoleChoice)}>
              {roleOptions(orgRole).map((option) => <option key={option} value={option}>{roleChoiceLabels[option]}</option>)}
            </select>
          </label>
          {role !== 'team' && (
            <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="invite-space">
              Client space
              <SpaceSelect id="invite-space" value={spaceId} onChange={setSpaceId} spaces={clientSpaces} />
              {!clientSpaces.length && <span className="text-xs font-normal text-muted-foreground">Create a client space on the Spaces tab first.</span>}
            </label>
          )}
          <InlineError error={error} />
          <div className="flex justify-end gap-3">
            <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy || undefined}>
              <Send size={16} aria-hidden /> {busy ? 'Sending…' : 'Send invite'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditAccessDialog({ person, orgRole, clientSpaces, onClose, onSave }: {
  person: PersonRow | null;
  orgRole: OrgRole;
  clientSpaces: Space[];
  onClose: () => void;
  onSave: (person: PersonRow, role: RoleChoice, spaceId: string | null) => Promise<void>;
}) {
  const [role, setRole] = useState<RoleChoice>('client_viewer');
  const [spaceId, setSpaceId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!person) return;
    setRole(person.role === 'team' ? 'team' : person.role === 'client_manager' ? 'client_manager' : 'client_viewer');
    setSpaceId(person.spaceId ?? '');
  }, [person]);

  return (
    <Dialog open={person !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md rounded-[12px] border-border bg-card">
        <DialogHeader>
          <DialogTitle className="display text-2xl font-semibold">Change access</DialogTitle>
          <DialogDescription>{person?.name} · {person?.email}</DialogDescription>
        </DialogHeader>
        <form
          className="mt-2 flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!person) return;
            setBusy(true);
            await onSave(person, role, role === 'team' ? null : spaceId || null);
            setBusy(false);
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="edit-role">
            Role
            <select id="edit-role" className="field" value={role} onChange={(event) => setRole(event.target.value as RoleChoice)}>
              {roleOptions(orgRole).map((option) => <option key={option} value={option}>{roleChoiceLabels[option]}</option>)}
            </select>
          </label>
          {role !== 'team' && (
            <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="edit-space">
              Client space
              <SpaceSelect id="edit-space" value={spaceId} onChange={setSpaceId} spaces={clientSpaces} />
            </label>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy || (role !== 'team' && !spaceId)}>Save</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SpacesTab({ spaces, onChanged }: { spaces: Space[]; onChanged: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState<SpaceCounts | null>(null);
  const [renaming, setRenaming] = useState<Space | null>(null);
  const [draft, setDraft] = useState('');
  const sorted = useMemo(() => sortSpaces(spaces), [spaces]);

  useEffect(() => {
    let live = true;
    spaceItemCounts(spaces).then((next) => { if (live) setCounts(next); }).catch(() => { if (live) setCounts({}); });
    return () => { live = false; };
  }, [spaces]);

  const act = async (label: string, fn: () => Promise<unknown>, success: string) => {
    setError(null);
    setBusy(true);
    const ok = await runAction(label, fn, setError, success);
    if (ok) await onChanged();
    setBusy(false);
    return ok;
  };

  return (
    <div>
      <form
        className="panel flex flex-wrap items-end gap-3 p-5"
        onSubmit={async (event) => {
          event.preventDefault();
          const ok = await act('Create space', () => createSpace(name), `${name.trim()} created`);
          if (ok) setName('');
        }}
      >
        <label className="flex min-w-[240px] flex-1 flex-col gap-1.5 text-sm font-medium" htmlFor="new-space">
          New client space
          <input id="new-space" className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Client name, e.g. Acme" />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}><Plus size={16} aria-hidden /> Create space</button>
      </form>
      <InlineError error={error} />
      <ul className="mt-4 flex flex-col gap-2" aria-label="Spaces">
        {sorted.map((space) => {
          const count = counts?.[space.id];
          return (
            <li key={space.id} className="panel flex flex-wrap items-center gap-3 p-4" data-space={space.name}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {space.name}
                  {space.kind === 'internal' && <span className="ml-2 text-xs font-normal text-muted-foreground">Internal</span>}
                  {space.archived_at && <span className="status-pill ml-2" data-status="archived">Archived</span>}
                </p>
                <p className="text-sm text-muted-foreground">
                  {count ? `${count.campaigns} ${count.campaigns === 1 ? 'campaign' : 'campaigns'} · ${count.files} ${count.files === 1 ? 'file' : 'files'}` : counts ? '—' : 'Counting…'}
                </p>
              </div>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setRenaming(space); setDraft(space.name); }} aria-label={`Rename ${space.name}`}>
                <Pencil size={14} aria-hidden /> Rename
              </button>
              {space.kind === 'client' && (
                space.archived_at ? (
                  <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => void act('Unarchive', () => setSpaceArchived(space, false), `${space.name} is back`)}>
                    <ArchiveRestore size={14} aria-hidden /> Unarchive
                  </button>
                ) : (
                  <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => void act('Archive', () => setSpaceArchived(space, true), `${space.name} archived`)}>
                    <Archive size={14} aria-hidden /> Archive
                  </button>
                )
              )}
            </li>
          );
        })}
        {!sorted.length && <li className="text-sm text-muted-foreground">No spaces yet.</li>}
      </ul>

      <Dialog open={renaming !== null} onOpenChange={(open) => { if (!open) setRenaming(null); }}>
        <DialogContent className="max-w-md rounded-[12px] border-border bg-card">
          <DialogHeader>
            <DialogTitle className="display text-2xl font-semibold">Rename space</DialogTitle>
            <DialogDescription>Everyone in this space sees the new name.</DialogDescription>
          </DialogHeader>
          <form
            className="mt-2 flex flex-col gap-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!renaming) return;
              const ok = await act('Rename space', () => renameSpace(renaming.id, draft), 'Space renamed');
              if (ok) setRenaming(null);
            }}
          >
            <input className="field" aria-label="Space name" value={draft} onChange={(event) => setDraft(event.target.value)} />
            <div className="flex justify-end gap-3">
              <button type="button" className="btn btn-quiet" onClick={() => setRenaming(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>Save</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
