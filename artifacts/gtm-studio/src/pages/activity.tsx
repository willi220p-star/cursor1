import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { toAppError } from '@/lib/app-error';
import { isStaff } from '@/studio/access';
import { useAccess } from '@/studio/access-context';
import { activityActionLabels, describeActivity, relativeTime } from '@/studio/activity-format';
import { listActivity, listProfiles, sortSpaces } from '@/studio/spaces';
import type { ActivityAction, ActivityEntry, AppError, Profile } from '@/studio/contracts';

const ACTIONS = Object.keys(activityActionLabels) as ActivityAction[];

export function ActivityPage() {
  const access = useAccess();
  const staff = isStaff(access.orgRole);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  // Staff start on the space picked in the nav; Client Managers only ever see their own space.
  const [spaceId, setSpaceId] = useState<string>(access.currentSpaceId ?? '');
  const [actor, setActor] = useState('');
  const [action, setAction] = useState<ActivityAction | ''>('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<ActivityEntry[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const ownSpace = staff ? null : access.memberships.find((member) => member.role === 'client_manager')?.space_id ?? null;

  useEffect(() => {
    listProfiles().then(setProfiles).catch(() => setProfiles([]));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setRows(null);
    try {
      const result = await listActivity(page, {
        spaceId: staff ? spaceId || null : ownSpace,
        actor: actor || null,
        action: action || null,
      });
      setRows(result.rows);
      setHasMore(result.hasMore);
    } catch (reason) {
      setError(toAppError(reason));
      setRows([]);
    }
  }, [page, spaceId, actor, action, staff, ownSpace]);

  useEffect(() => {
    void load();
  }, [load]);

  const names = useMemo(() => {
    const people = new Map(profiles.map((profile) => [profile.user_id, profile.display_name || profile.email.split('@')[0] || profile.email]));
    const spaces = new Map(access.spaces.map((space) => [space.id, space.name]));
    return {
      person: (id: string | null) => (id ? people.get(id) ?? (id === access.profile?.user_id ? 'You' : 'Someone') : 'Someone'),
      space: (id: string | null) => (id ? spaces.get(id) ?? '' : ''),
    };
  }, [profiles, access.spaces, access.profile]);

  const resetPage = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setPage(0);
  };
  const filtered = Boolean(spaceId || actor || action);

  return (
    <div className="mx-auto max-w-[960px] animate-rise">
      <h1 className="display text-[clamp(36px,4.4vw,52px)] font-semibold leading-[1.05]">Activity</h1>
      <p className="mt-3 max-w-[60ch] text-base text-muted-foreground">
        {staff ? 'Everything that changed, newest first.' : 'What changed in your space, newest first.'}
      </p>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap" role="group" aria-label="Filter activity">
        {staff && (
          <select className="field col-span-2 min-w-0 sm:col-span-1 sm:w-auto! sm:max-w-[280px]!" aria-label="Filter by space" value={spaceId} onChange={(event) => resetPage(setSpaceId)(event.target.value)}>
            <option value="">All spaces</option>
            {sortSpaces(access.spaces).map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
          </select>
        )}
        {profiles.length > 1 && (
          <select className="field min-w-0 sm:w-auto! sm:max-w-[240px]!" aria-label="Filter by person" value={actor} onChange={(event) => resetPage(setActor)(event.target.value)}>
            <option value="">Everyone</option>
            {profiles.map((profile) => <option key={profile.user_id} value={profile.user_id}>{profile.display_name || profile.email}</option>)}
          </select>
        )}
        <select className="field min-w-0 sm:w-auto!" aria-label="Filter by action" value={action} onChange={(event) => resetPage(setAction)(event.target.value as ActivityAction | '')}>
          <option value="">Every action</option>
          {ACTIONS.map((item) => <option key={item} value={item}>{activityActionLabels[item]}</option>)}
        </select>
      </div>

      {error && (
        <div className="load-error mt-6" role="alert">
          <span>Could not load activity. {error.message}</span>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => void load()}>Retry</button>
        </div>
      )}

      {rows === null ? (
        <p className="mt-6 text-sm text-muted-foreground" role="status">Loading activity…</p>
      ) : rows.length ? (
        <ol className="mt-6 flex flex-col divide-y divide-border panel p-0" aria-label="Activity">
          {rows.map((entry) => {
            const where = staff && !spaceId ? names.space(entry.space_id) : '';
            return (
              <li key={entry.id} className="flex min-w-0 flex-wrap items-baseline gap-x-2 break-words px-4 py-3 text-sm sm:px-5" data-action={entry.action}>
                <span className="font-medium">{describeActivity(entry, names)}</span>
                <span className="text-muted-foreground">
                  {where ? `${where} · ` : ''}
                  <time dateTime={entry.at} title={new Date(entry.at).toLocaleString()}>{relativeTime(entry.at)}</time>
                </span>
              </li>
            );
          })}
        </ol>
      ) : !error && (
        <div className="mt-6 panel p-8 text-center">
          <h2 className="text-lg font-semibold">{filtered ? 'Nothing matches those filters' : 'No activity yet'}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {filtered ? 'Try another space, person or action.' : 'Saves, moves, reviews and invites show up here as they happen.'}
          </p>
        </div>
      )}

      {(page > 0 || hasMore) && (
        <nav className="mt-4 flex items-center justify-between pb-[env(safe-area-inset-bottom)]" aria-label="Activity pages">
          <button type="button" className="btn btn-quiet btn-sm" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>
            <ChevronLeft size={16} aria-hidden /> Newer
          </button>
          <span className="text-sm text-muted-foreground">Page {page + 1}</span>
          <button type="button" className="btn btn-quiet btn-sm" disabled={!hasMore} onClick={() => setPage((value) => value + 1)}>
            Older <ChevronRight size={16} aria-hidden />
          </button>
        </nav>
      )}
    </div>
  );
}
