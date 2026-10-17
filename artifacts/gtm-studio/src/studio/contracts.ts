/**
 * Shared types for team spaces, bulk file actions, error handling and reviews.
 * See docs/superpowers/specs/2026-10-17-team-spaces-bulk-files-errors-design.md.
 * Types only: implementations live in lib/app-error.ts, lib/retry.ts, lib/offline-queue.ts,
 * studio/access.ts, studio/bulk.ts and studio/reviews.ts.
 */

// ── Errors ─────────────────────────────────────────────────────────────

export type AppErrorCode =
  | 'network'
  | 'offline'
  | 'timeout'
  | 'permission'
  | 'conflict'
  | 'not_found'
  | 'validation'
  | 'rate_limited'
  | 'server'
  | 'unknown';

export interface AppError {
  code: AppErrorCode;
  /** Plain English, safe to show to the user. */
  message: string;
  /** True when trying again later could succeed (network, timeout, rate_limited, server). */
  retryable: boolean;
  cause?: unknown;
}

// ── Roles and spaces ───────────────────────────────────────────────────

export type OrgRole = 'owner' | 'team' | 'client';
export type SpaceRole = 'client_manager' | 'client_viewer';
export type SpaceKind = 'internal' | 'client';

export interface Profile {
  user_id: string;
  email: string;
  display_name: string | null;
  org_role: OrgRole;
}

export interface Space {
  id: string;
  name: string;
  kind: SpaceKind;
  archived_at: string | null;
}

export interface SpaceMember {
  space_id: string;
  user_id: string;
  role: SpaceRole;
}

export interface Invite {
  id: string;
  email: string;
  org_role: OrgRole;
  space_id: string | null;
  role: SpaceRole | null;
  invited_by: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

/** Every permission check in the client goes through one of these actions. */
export type AccessAction =
  | 'space.view'
  | 'campaign.generate'
  | 'item.edit' // rename, move, trash, restore, bulk update
  | 'item.purge'
  | 'item.download'
  | 'review.write' // approve, reject, comment
  | 'template.edit'
  | 'template.use'
  | 'members.manage' // invite/manage client users, create/rename/archive spaces
  | 'team.manage' // invite or change Team members
  | 'activity.view';

/** `null` space means "any space" (staff-wide checks such as members.manage). */
export type Can = (action: AccessAction, spaceId?: string | null) => boolean;

// ── Library items and bulk actions ─────────────────────────────────────

export type LibraryEntity = 'campaign' | 'template' | 'asset' | 'folder';

/** Columns every library table gains: conflict protection and Trash. */
export interface Versioned {
  version: number;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
}

export interface BulkTarget {
  entity: LibraryEntity;
  id: string;
  /** Shown in the results panel. */
  name: string;
  /** Sent with renames for conflict protection. */
  version?: number;
}

export type BulkAction =
  | { kind: 'trash' }
  | { kind: 'restore' }
  | { kind: 'purge' }
  | { kind: 'move'; folderId: string | null; spaceId?: string | null }
  | { kind: 'update'; patch: { status?: string; tags_add?: string[]; tags_remove?: string[] } }
  | { kind: 'rename'; pattern: string };

/** One row from a bulk_* RPC. */
export interface BulkRowResult {
  id: string;
  ok: boolean;
  error_code: AppErrorCode | null;
  message: string | null;
}

export interface BulkFailure {
  target: BulkTarget;
  error: AppError;
}

export interface BulkResult {
  action: BulkAction['kind'] | 'download';
  total: number;
  succeeded: BulkTarget[];
  failed: BulkFailure[];
  /** Items handed to the offline queue instead of running now. */
  queued: BulkTarget[];
}

/** RPC chunk size; the database rejects larger arrays. */
export const BULK_CHUNK = 200;

/** Days an item stays in Trash before the daily purge removes it. */
export const TRASH_DAYS = 30;

// ── Offline queue ──────────────────────────────────────────────────────

export interface QueuedOp {
  id: string;
  /** Registered handler name, e.g. 'bulk' or 'review'. */
  kind: string;
  /** JSON-serialisable arguments for the handler. */
  payload: unknown;
  label: string;
  createdAt: number;
  attempts: number;
}

export interface SyncStatus {
  pending: number;
  running: boolean;
  lastError: AppError | null;
}

// ── Reviews, comments, notifications ───────────────────────────────────

export type ReviewStatus = 'approved' | 'changes_requested';

export interface Review {
  id: string;
  space_id: string;
  campaign_id: string;
  /** null = whole-campaign sign-off. */
  asset_id: string | null;
  status: ReviewStatus;
  note: string | null;
  reviewer: string;
  created_at: string;
}

export interface Comment {
  id: string;
  space_id: string;
  campaign_id: string;
  asset_id: string | null;
  author: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

export type NotificationKind = 'approved' | 'changes_requested' | 'signed_off' | 'commented' | 'review_requested';

export interface AppNotification {
  id: string;
  recipient: string;
  kind: NotificationKind;
  space_id: string | null;
  campaign_id: string | null;
  asset_id: string | null;
  actor: string | null;
  summary: string;
  created_at: string;
  read_at: string | null;
}

export type ActivityAction =
  | 'created'
  | 'renamed'
  | 'moved'
  | 'updated'
  | 'trashed'
  | 'restored'
  | 'purged'
  | 'approved'
  | 'rejected'
  | 'signed_off'
  | 'commented'
  | 'member_added'
  | 'member_removed'
  | 'role_changed'
  | 'invited';

export interface ActivityEntry {
  id: number;
  at: string;
  actor: string | null;
  space_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: ActivityAction;
  details: Record<string, unknown>;
}
