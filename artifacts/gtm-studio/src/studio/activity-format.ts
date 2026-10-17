/** Plain-English lines for activity_log rows: "Sam moved 12 campaigns to Acme · 2 min ago". */
import type { ActivityAction, ActivityEntry } from './contracts';

export const activityActionLabels: Record<ActivityAction, string> = {
  created: 'Created',
  renamed: 'Renamed',
  moved: 'Moved',
  updated: 'Updated',
  trashed: 'Moved to Trash',
  restored: 'Restored',
  purged: 'Deleted forever',
  approved: 'Approved',
  rejected: 'Requested changes',
  signed_off: 'Signed off',
  commented: 'Commented',
  member_added: 'Member added',
  member_removed: 'Member removed',
  role_changed: 'Role changed',
  invited: 'Invited',
};

const verbs: Record<ActivityAction, string> = {
  created: 'created',
  renamed: 'renamed',
  moved: 'moved',
  updated: 'updated',
  trashed: 'moved',
  restored: 'restored',
  purged: 'deleted',
  approved: 'approved',
  rejected: 'requested changes on',
  signed_off: 'signed off',
  commented: 'commented on',
  member_added: 'added',
  member_removed: 'removed',
  role_changed: 'changed the role of',
  invited: 'invited',
};

const nouns: Record<string, [string, string]> = {
  campaign: ['campaign', 'campaigns'],
  template: ['template', 'templates'],
  asset: ['file', 'files'],
  file: ['file', 'files'],
  folder: ['folder', 'folders'],
  space: ['space', 'spaces'],
  member: ['member', 'members'],
  profile: ['person', 'people'],
  invite: ['invite', 'invites'],
  review: ['review', 'reviews'],
  comment: ['comment', 'comments'],
};

const roleNames: Record<string, string> = { owner: 'Owner', team: 'Team', client: 'Client', client_manager: 'Client Manager', client_viewer: 'Client Viewer' };

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function pick(details: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = text(details[key]);
    if (value) return value;
  }
  return '';
}

export function relativeTime(at: string, now = Date.now()) {
  const then = new Date(at).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export type ActivityNames = {
  /** Display name for a user id (actor or subject). */
  person: (userId: string | null) => string;
  /** Space name for a space id. */
  space: (spaceId: string | null) => string;
};

/** "Sam moved 12 campaigns to Acme" (no time; the caller adds " · 2 min ago"). */
export function describeActivity(entry: ActivityEntry, names: ActivityNames) {
  const details = (entry.details ?? {}) as Record<string, unknown>;
  const actor = names.person(entry.actor) || 'Someone';
  const count = typeof details.count === 'number' ? details.count : Array.isArray(details.ids) ? details.ids.length : 1;
  const [one, many] = nouns[entry.entity_type] ?? [entry.entity_type.replace(/_/g, ' '), `${entry.entity_type.replace(/_/g, ' ')}s`];
  const name = pick(details, ['name', 'title', 'filename', 'old_name', 'email']);
  let object = count > 1 ? `${count} ${many}` : name ? `“${name}”` : `a ${one}`;
  if (entry.action === 'invited' || entry.action === 'member_added' || entry.action === 'member_removed' || entry.action === 'role_changed') {
    object = pick(details, ['email', 'name']) || names.person(text(details.user_id) || null) || `a ${one}`;
  }
  if (entry.action === 'renamed' && count <= 1) object = pick(details, ['old_name', 'from']) ? `“${pick(details, ['old_name', 'from'])}”` : object;
  let tail = '';
  switch (entry.action) {
    case 'moved': {
      const target = pick(details, ['to_space_name', 'target_space_name', 'space_name', 'to_folder_name', 'folder_name', 'to'])
        || (text(details.to_space) || text(details.target_space) ? names.space(text(details.to_space) || text(details.target_space)) : '');
      tail = target ? ` to ${target}` : '';
      break;
    }
    case 'trashed':
      tail = ' to Trash';
      break;
    case 'renamed': {
      const next = pick(details, ['new_name', 'to']);
      tail = next ? ` to “${next}”` : '';
      break;
    }
    case 'role_changed': {
      const role = roleNames[pick(details, ['role', 'new_role', 'to'])] ?? pick(details, ['role', 'new_role', 'to']);
      tail = role ? ` to ${role}` : '';
      break;
    }
    case 'invited': {
      const role = roleNames[pick(details, ['role', 'org_role'])];
      tail = role ? ` as ${role}` : '';
      break;
    }
    case 'signed_off':
      return `${actor} signed off ${name ? `“${name}”` : `a ${one}`}`;
    default:
      break;
  }
  return `${actor} ${verbs[entry.action] ?? entry.action} ${object}${tail}`;
}
