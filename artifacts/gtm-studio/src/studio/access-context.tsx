import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { LogOut, RotateCw } from 'lucide-react';
import { toAppError } from '@/lib/app-error';
import { signOutUser } from './auth';
import { supabaseConfigured } from './cloud';
import { allowedCurrentSpace, canDo, defaultSpaceId, isStaff, saveSpaceId } from './access';
import { acceptInvite, listMemberships, listSpaces, loadProfile } from './spaces';
import { setKnownSpaces, setQuerySpace, setSaveSpace } from './space-scope';
import type { AccessAction, AppError, Can, OrgRole, Profile, Space, SpaceMember } from './contracts';

export { getQuerySpace, setQuerySpace } from './space-scope';

export type AccessValue = {
  profile: Profile | null;
  orgRole: OrgRole;
  spaces: Space[];
  /** The signed-in user's own memberships. */
  memberships: SpaceMember[];
  /** null = All spaces (staff only). Clients are locked to their space. */
  currentSpaceId: string | null;
  setCurrentSpace(id: string | null): void;
  can: Can;
  loading: boolean;
  error: AppError | null;
  refresh(): Promise<void>;
};

const SPACE_KEY = 'gtm-studio-space';

export function readStoredSpace(userId: string): string | null {
  try {
    return localStorage.getItem(`${SPACE_KEY}:${userId}`) || null;
  } catch {
    return null;
  }
}

function writeStoredSpace(userId: string, spaceId: string | null) {
  try {
    if (spaceId) localStorage.setItem(`${SPACE_KEY}:${userId}`, spaceId);
    else localStorage.removeItem(`${SPACE_KEY}:${userId}`);
  } catch {
    // Storage blocked: the choice lasts for this tab only.
  }
}

const ownerCan: Can = () => true;

/** Used outside a provider (isolated components, tests) and in local mode: an owner with no spaces. */
const fallbackAccess: AccessValue = {
  profile: null,
  orgRole: 'owner',
  spaces: [],
  memberships: [],
  currentSpaceId: null,
  setCurrentSpace: () => undefined,
  can: ownerCan,
  loading: false,
  error: null,
  refresh: async () => undefined,
};

const AccessContext = createContext<AccessValue | null>(null);

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; profile: Profile; spaces: Space[]; memberships: SpaceMember[] }
  | { status: 'no-access' }
  | { status: 'error'; error: AppError };

function localProfile(user: User): Profile {
  return { user_id: user.id, email: user.email ?? '', display_name: null, org_role: 'owner' };
}

async function loadAccess(user: User): Promise<LoadState> {
  if (!supabaseConfigured) return { status: 'ready', profile: localProfile(user), spaces: [], memberships: [] };
  try {
    await acceptInvite();
    const profile = await loadProfile(user.id);
    if (!profile) return { status: 'no-access' };
    const [spaces, memberships] = await Promise.all([listSpaces(), listMemberships()]);
    const own = memberships.filter((member) => member.user_id === user.id);
    // A client with no membership has no access (that is how access is removed).
    if (!isStaff(profile.org_role) && !own.length) return { status: 'no-access' };
    return { status: 'ready', profile, spaces, memberships: own };
  } catch (error) {
    return { status: 'error', error: toAppError(error) };
  }
}

function GateScreen({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="login-shell is-boot">
      <div className="mx-auto max-w-[460px] px-4 text-center" role="status" aria-live="polite">
        <p className="brand-lockup justify-center"><span className="brand-mark">DGK</span><span className="brand-name">Outbound Studio</span></p>
        <h1 className="display mt-4 text-2xl font-semibold">{title}</h1>
        {body && <p className="mt-3 text-sm text-muted-foreground">{body}</p>}
        {children && <div className="mt-6 flex flex-wrap justify-center gap-3">{children}</div>}
      </div>
    </div>
  );
}

function SignOutButton() {
  return (
    <button type="button" className="btn btn-outline" onClick={() => void signOutUser()}>
      <LogOut size={16} aria-hidden /> Sign out
    </button>
  );
}

/**
 * Loads who the user is (profile, spaces, memberships) after login and renders the app only when
 * they have access. Also mirrors the current space into space-scope for cloud.ts.
 */
export function AccessProvider({ user, children }: { user: User; children: ReactNode }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [chosenSpace, setChosenSpace] = useState<string | null>(() => readStoredSpace(user.id));

  // The auth listener hands over a new user object on every token refresh; only a different
  // person (id) reloads access, so the app is not torn down every hour.
  const userRef = useRef(user);
  userRef.current = user;

  const refresh = useCallback(async () => {
    const next = await loadAccess(userRef.current);
    setState(next);
  }, []);

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    setChosenSpace(readStoredSpace(user.id));
    void loadAccess(userRef.current).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [user.id]);

  const ready = state.status === 'ready' ? state : null;
  const orgRole: OrgRole = ready?.profile.org_role ?? 'client';
  const spaces = useMemo(() => ready?.spaces ?? [], [ready]);
  const memberships = useMemo(() => ready?.memberships ?? [], [ready]);
  const input = useMemo(() => ({ orgRole, memberships, spaces }), [orgRole, memberships, spaces]);
  const currentSpaceId = ready ? defaultSpaceId({ ...input, stored: allowedCurrentSpace(input, chosenSpace) }) : null;
  const saveSpace = ready ? saveSpaceId({ ...input, currentSpaceId }) : null;

  // Written during render (idempotent) so children's first fetches already see the right space.
  setKnownSpaces(spaces);
  setQuerySpace(currentSpaceId);
  setSaveSpace(saveSpace);

  const setCurrentSpace = useCallback((id: string | null) => {
    const allowed = allowedCurrentSpace(input, id);
    setQuerySpace(allowed);
    setChosenSpace(allowed);
    if (isStaff(input.orgRole)) writeStoredSpace(user.id, allowed);
  }, [input, user.id]);

  const can = useCallback<Can>((action: AccessAction, spaceId?: string | null) => canDo({ orgRole, memberships }, action, spaceId), [orgRole, memberships]);

  const value = useMemo<AccessValue>(() => ({
    profile: ready?.profile ?? null,
    orgRole,
    spaces,
    memberships,
    currentSpaceId,
    setCurrentSpace,
    can,
    loading: state.status === 'loading',
    error: state.status === 'error' ? state.error : null,
    refresh,
  }), [ready, orgRole, spaces, memberships, currentSpaceId, setCurrentSpace, can, state, refresh]);

  if (state.status === 'loading') return <GateScreen title="Checking access…" />;
  if (state.status === 'no-access') {
    return (
      <GateScreen title="Your account has no access yet." body={`Signed in as ${user.email ?? 'this account'}. Ask DGK to invite you.`}>
        <SignOutButton />
      </GateScreen>
    );
  }
  if (state.status === 'error') {
    return (
      <GateScreen title="Could not check your access" body={state.error.message}>
        <button type="button" className="btn btn-primary" onClick={() => { setState({ status: 'loading' }); void refresh(); }}>
          <RotateCw size={16} aria-hidden /> Try again
        </button>
        <SignOutButton />
      </GateScreen>
    );
  }
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessValue {
  return useContext(AccessContext) ?? fallbackAccess;
}

/** The space's display name, "All spaces" for null. */
export function spaceName(spaces: Space[], spaceId: string | null) {
  if (!spaceId) return 'All spaces';
  return spaces.find((space) => space.id === spaceId)?.name ?? 'Unknown space';
}

/** Whether the user may open the Activity page: staff, or a Client Manager of their space. */
export function canSeeActivity(access: Pick<AccessValue, 'orgRole' | 'can' | 'memberships'>) {
  if (isStaff(access.orgRole)) return true;
  return access.memberships.some((member) => access.can('activity.view', member.space_id));
}

/** Whether the studios (generate) are open to this user anywhere. */
export function canUseStudios(access: Pick<AccessValue, 'orgRole' | 'can' | 'memberships'>) {
  if (isStaff(access.orgRole)) return true;
  return access.memberships.some((member) => access.can('campaign.generate', member.space_id));
}
