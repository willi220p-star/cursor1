import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Bell, CheckCheck } from 'lucide-react';
import { useLocation } from 'wouter';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { errorMessage } from '@/lib/app-error';
import { useAccess } from '@/studio/access-context';
import { onAuthChange } from '@/studio/auth';
import { supabase } from '@/studio/cloud';
import type { AppNotification } from '@/studio/contracts';
import {
  badgeText,
  currentUserId,
  displayName,
  groupNotifications,
  listNotifications,
  loadCampaignNames,
  loadProfiles,
  markAllRead,
  markRead,
  notificationLabel,
  OPEN_REVIEW_KEY,
  reviewHref,
  subscribeNotifications,
  unreadCount,
  type NotificationGroup,
} from '@/studio/reviews';

function relative(at: string) {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? '' : formatDistanceToNow(date, { addSuffix: true });
}

/**
 * Nav bell with the unread count, a popover of recent notifications (grouped, newest first),
 * mark read / mark all read, and realtime updates. Self-contained: mount it anywhere in the nav.
 */
export function NotificationBell() {
  const { profile } = useAccess();
  const [, navigate] = useLocation();
  const [userId, setUserId] = useState<string | null>(profile?.user_id ?? null);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [count, setCount] = useState(0);
  const [names, setNames] = useState<{ actors: Map<string, string>; campaigns: Map<string, string> }>({ actors: new Map(), campaigns: new Map() });
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [announce, setAnnounce] = useState('');
  const lastCount = useRef(0);

  useEffect(() => {
    if (profile?.user_id) {
      setUserId(profile.user_id);
      return;
    }
    void currentUserId().then(setUserId);
    return onAuthChange((user) => setUserId(user?.id ?? null));
  }, [profile?.user_id]);

  const refresh = useCallback(async () => {
    try {
      const [list, unread] = await Promise.all([listNotifications(30), unreadCount()]);
      setItems(list);
      if (unread > lastCount.current) setAnnounce(`${unread} unread notification${unread === 1 ? '' : 's'}`);
      lastCount.current = unread;
      setCount(unread);
      setError(null);
      const [profiles, campaigns] = await Promise.all([
        loadProfiles(list.map((item) => item.actor)),
        loadCampaignNames(list.map((item) => item.campaign_id).filter((id): id is string => Boolean(id))),
      ]);
      const actors = new Map<string, string>();
      for (const [id, found] of profiles) if (found) actors.set(id, displayName(found));
      setNames({ actors, campaigns });
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, []);

  useEffect(() => {
    if (!userId || !supabase) return;
    void refresh();
    return subscribeNotifications(userId, () => void refresh());
  }, [userId, refresh]);

  const groups = useMemo(() => groupNotifications(items), [items]);

  if (!supabase || !userId) return null;

  const markLocal = (ids: readonly string[] | 'all') => {
    const now = new Date().toISOString();
    const wanted = ids === 'all' ? null : new Set(ids);
    const clears = (item: AppNotification) => !item.read_at && (!wanted || wanted.has(item.id));
    const cleared = items.filter(clears).length;
    setItems((current) => current.map((item) => (clears(item) ? { ...item, read_at: now } : item)));
    const next = ids === 'all' ? 0 : Math.max(0, count - cleared);
    lastCount.current = next;
    setCount(next);
  };

  const openGroup = async (group: NotificationGroup) => {
    const unreadIds = group.unread ? items.filter((item) => group.ids.includes(item.id) && !item.read_at).map((item) => item.id) : [];
    if (unreadIds.length) {
      markLocal(unreadIds);
      markRead(unreadIds).catch((reason) => {
        setError(errorMessage(reason));
        void refresh();
      });
    }
    setOpen(false);
    if (group.campaign_id) {
      try {
        localStorage.setItem(OPEN_REVIEW_KEY, group.campaign_id);
      } catch {
        // The query string still carries the campaign.
      }
      navigate(reviewHref(group.campaign_id));
    }
  };

  const clearAll = async () => {
    markLocal('all');
    try {
      await markAllRead();
    } catch (reason) {
      setError(errorMessage(reason));
      void refresh();
    }
  };

  const badge = badgeText(count);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="btn btn-ghost btn-icon relative"
          aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
          data-testid="notification-bell"
        >
          <Bell size={18} aria-hidden />
          {badge && (
            <span className="absolute -right-0.5 -top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-bold leading-none text-destructive-foreground tabular" data-testid="notification-count" aria-hidden>
              {badge}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <span className="sr-live" aria-live="polite" role="status">{announce}</span>
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-24px))] border-border bg-popover p-0 text-popover-foreground">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!count} onClick={() => void clearAll()}>
            <CheckCheck size={16} aria-hidden /> Mark all read
          </button>
        </div>
        {error && <p className="field-error mx-4" role="alert">{error}</p>}
        {groups.length ? (
          <ul className="max-h-[420px] overflow-y-auto py-1" aria-label="Recent notifications">
            {groups.map((group) => (
              <li key={group.id}>
                <button
                  type="button"
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-fill focus-visible:bg-fill"
                  onClick={() => void openGroup(group)}
                  data-unread={group.unread || undefined}
                  data-testid="notification-item"
                >
                  <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${group.unread ? 'bg-primary' : 'bg-transparent'}`} aria-hidden />
                  <span className="min-w-0">
                    <span className={`block text-sm ${group.unread ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                      {group.unread && <span className="sr-only">Unread: </span>}
                      {notificationLabel(group, {
                        actor: group.actor ? names.actors.get(group.actor) : null,
                        campaign: group.campaign_id ? names.campaigns.get(group.campaign_id) : null,
                      })}
                    </span>
                    <span className="block text-xs text-muted-foreground">{relative(group.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground" data-testid="notifications-empty">You're all caught up</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
