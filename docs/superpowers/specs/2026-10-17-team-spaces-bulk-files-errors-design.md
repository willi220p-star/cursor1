# Team spaces, bulk file management and enterprise error handling

Date: 2026-10-17. App: `artifacts/gtm-studio` (DGK Outbound Studio). Status: approved direction, building.

## Why

Team members and clients will use the Studio. Today there is one operator login, every row is keyed to one
`user_id`, the Library acts on one item at a time, and errors surface as one-off toasts. Target scale for the
next year: 10–50 users, 20–100 clients, tens of thousands of files, bulk actions on hundreds of items.

## Decisions (from the user)

| Topic | Decision |
|---|---|
| Users | Team + clients, each client sees only their own space |
| Roles | Owner, Team, Client Manager, Client Viewer |
| Client Viewer | View, download, approve/reject, comment, inside own space |
| Client Manager | Viewer rights + rename, move, delete (to Trash), generate, inside own space |
| Accounts | Invite by email only (Owner/Team send from a Members page), no public sign-up |
| Bulk actions | Delete (to Trash), move to folder / client space, update fields (status, tags, rename pattern), download ZIP |
| Delete | Trash for 30 days, restore any time, auto-purge after 30 days |
| Errors | Per-item results + "Retry failed", auto-retry + offline queue, activity log, conflict protection |
| Approval | Per image approve/reject with note, plus whole-campaign sign-off, comment threads |
| Notifications | In-app only (bell with unread count), no email |
| Existing data | Each campaign client label becomes a Client space; unlabelled → "Internal (DGK)"; templates stay team-wide |
| Client UI | Same app, trimmed to what the role allows |
| Database | Use the existing live Supabase project (no new project). Backup first, reversible additive migrations, RLS tested locally with fake users before anything is applied to live. Nothing is applied to live without the user's OK. |
| Email images | Stay public-by-link (needed so Smartlead emails load them); file names stay unguessable |
| Client labels | "Set client" picks only from existing spaces; spaces are created on the Members page |

Assumptions taken (user can override): clients can restore from Trash; only Owner/Team purge permanently;
Client Managers see their own space's activity, Viewers do not; the offline queue covers Library actions and
review actions, not image generation or uploads.

## Permission matrix

| Action | Owner | Team | Client Manager | Client Viewer |
|---|---|---|---|---|
| See spaces | all | all | own | own |
| Generate / save campaigns | ✓ | ✓ | own space | – |
| Rename, move, trash, restore, bulk update | ✓ | ✓ | own space | – |
| Purge from Trash | ✓ | ✓ | – | – |
| Download / ZIP | ✓ | ✓ | own | own |
| Approve / reject / comment | ✓ | ✓ | own | own |
| Edit templates / looks | ✓ | ✓ | use only | – |
| Invite and manage client users, create/rename/archive spaces | ✓ | ✓ | – | – |
| Invite or change Team members, change Owner | ✓ | – | – | – |
| Activity log | all | all | own space | – |

The single source of truth for this table in the client is `can(access, action, spaceId)` in
`src/studio/access.ts`; in the database it is the RLS helper functions. Both are tested against this table.

## Architecture

```
Browser (React)                                    Supabase (existing project)
───────────────                                    ─────────────────────────────
AccessProvider ── profile, spaces, can() ───────▶  profiles, spaces, space_members, invites
Library + selection + bulk bar                     RLS on every table via app_* helper functions
  └─ runBulk() ─ chunks of 200 ─ withRetry ─────▶  bulk_* RPCs (per-item savepoints, per-item results)
       └─ offline? → OfflineQueue (IndexedDB)      version column + trigger (conflict protection)
ResultsPanel ◀── BulkResult                        activity_log (written by triggers, read-only to clients)
Review UI / NotificationBell ───────────────────▶  reviews, comments, notifications (+ realtime)
Members page ── invite ─────────────────────────▶  Edge Function invite-member (service role, staff only)
                                                   Edge Function purge-trash (daily, pg_cron + pg_net)
```

### Bulk execution: database functions (option B)

One RPC call per chunk of 200 ids. RPCs are `security invoker`, so RLS still decides what the caller may touch.
Each item runs in its own `begin … exception` block, so one bad item never rolls back the rest, and the RPC
returns one result row per id. Storage files are only removed at purge time.

## Data model (migrations, additive and reversible)

All new migrations live in `artifacts/gtm-studio/supabase/migrations/2026101700NN_*.sql`, each with a matching
`supabase/rollbacks/2026101700NN_*.down.sql`.

### New tables

- `profiles(user_id pk → auth.users, email, display_name, org_role in ('owner','team','client'), created_at)`
- `spaces(id, name, kind in ('internal','client'), created_at, archived_at)`; unique on `lower(btrim(name))`.
- `space_members(space_id, user_id, role in ('client_manager','client_viewer'), created_at, pk(space_id,user_id))`.
  Only client users get rows; Owner/Team see every space through `org_role`.
- `invites(id, email, org_role, space_id null, role null, invited_by, created_at, expires_at (+7 days), accepted_at, revoked_at)`
- `activity_log(id bigint identity, at, actor uuid, space_id, entity_type, entity_id, action, details jsonb)`
  actions: `created, renamed, moved, updated, trashed, restored, purged, approved, rejected, signed_off, commented,
  member_added, member_removed, role_changed, invited`.
- `reviews(id, space_id, campaign_id, asset_id null, status in ('approved','changes_requested'), note, reviewer, created_at)`.
  `asset_id null` = whole-campaign sign-off. Latest row per (campaign, asset) wins.
- `comments(id, space_id, campaign_id, asset_id null, author, body (1–4000 chars), created_at, edited_at, deleted_at)`
- `notifications(id, recipient, kind, space_id, campaign_id, asset_id, actor, summary, created_at, read_at)`

### Changes to existing tables (`outbound_campaigns`, `outbound_assets`, `outbound_folders`, `outbound_templates`)

- `space_id uuid references spaces` on campaigns, assets, folders (templates stay `space_id`-less, team-wide).
- `version integer not null default 1`, `updated_at` (assets get one), `deleted_at timestamptz`, `deleted_by uuid`
  on all four. A `before update` trigger bumps `version` and `updated_at`.
- `tags text[] not null default '{}'` on campaigns.
- Folder rule: an item's folder must be in the same space; template folders must be in the Internal space.
  Replaces `library_folder_same_owner`. Folder name unique per space instead of per user.
- `user_id` stays and now means "created by"; it no longer decides visibility.

### Data migration

1. Create "Internal (DGK)" (`kind='internal'`) and one client space per distinct trimmed, case-insensitive
   `config->>'client'` on campaigns.
2. Set `space_id` on campaigns from the label (else Internal); assets follow their campaign (else Internal);
   folders go to the space most of their items are in (else Internal).
3. Insert the existing operator(s) into `profiles` as `owner`.
4. Then make `space_id` `not null`.

Rollback restores the old policies and trigger and drops the new columns/tables; old rows are untouched.

### RLS helpers (`security definer`, `stable`, `search_path = public`)

`app_org_role()`, `app_is_staff()`, `app_is_owner()`, `app_can_view_space(space uuid)`,
`app_can_edit_space(space uuid)` (staff, or client_manager of that space).

- campaigns/assets/folders: select if `app_can_view_space(space_id)`; insert/update if `app_can_edit_space(space_id)`
  (with check on the new `space_id` too, so moving into a space you cannot edit fails); hard delete staff only.
- templates: select for staff and client managers; write staff only.
- profiles: read own row + staff read all; only owner changes `org_role`; staff manage client profiles.
- spaces: read if viewable; write staff. space_members: read own space; write staff.
- activity_log: select staff all, client_manager own space; no client writes (triggers are security definer).
- reviews/comments: select/insert if `app_can_view_space`; edit/delete own comment only.
- notifications: recipient only.
- Storage: new uploads under `spaces/<space_id>/…`, insert/update/delete if `app_can_edit_space`; legacy
  `<user_id>/…` paths keep the old owner-only policies. Bucket reads stay public.

### RPCs (all return `table(id uuid, ok boolean, error_code text, message text)`)

| RPC | Purpose |
|---|---|
| `bulk_trash(entity text, ids uuid[])` | set `deleted_at/by` |
| `bulk_restore(entity text, ids uuid[])` | clear `deleted_at`; restore into Root if folder gone |
| `bulk_move(entity text, ids uuid[], target_folder uuid, target_space uuid)` | move to folder and/or space (assets follow a moved campaign) |
| `bulk_update_campaigns(ids uuid[], patch jsonb)` | `status`, `tags_add`, `tags_remove` |
| `bulk_rename(entity text, items jsonb)` | `[{id, name, version}]`, names computed client-side from a pattern |
| `bulk_purge(entity text, ids uuid[])` | staff only, must already be in Trash; returns storage paths in `message` |
| `accept_invite()` | security definer; matches the caller's email to a pending invite, creates profile + membership |

`entity` ∈ `campaign | template | asset | folder`. `error_code` uses the AppError codes below.
`ids` over 200 → error. Conflict: when an item carries `version` (rename) and the stored version differs →
`conflict` with the name of the last editor in `message`.

Purge: Edge Function `purge-trash` (service role) runs daily via `pg_cron` + `pg_net`, removes storage objects
of items trashed > 30 days ago, then the rows; writes `purged` activity.

Invites: Edge Function `invite-member` verifies the caller is staff (Owner for `org_role='team'`), calls
`auth.admin.inviteUserByEmail(email, { redirectTo: <app url> })`, inserts the `invites` row. On login the app
calls `accept_invite()`.

## Client modules

### Error foundation (`src/lib/`)

- `app-error.ts`: `AppError { code, message, retryable, cause? }`, codes
  `network | offline | timeout | permission | conflict | not_found | validation | rate_limited | server | unknown`;
  `toAppError(unknown)` maps fetch failures, PostgREST/Postgres codes (`42501`→permission, `PGRST116`→not_found,
  `23505`/`23514`/`22*`→validation, `429`→rate_limited, `5xx`→server) to plain-English messages.
- `retry.ts`: `withRetry(fn, { attempts = 3, baseMs = 400, maxMs = 4000 })` with full jitter; retries only
  `retryable` errors; aborts on `AbortSignal`.
- `offline-queue.ts`: persisted in IndexedDB (memory fallback), FIFO, replays on `online` and app start,
  one op at a time, stops and reports on `permission`/`conflict` (never overwrites); exposes
  `useSyncStatus()` → `{ pending, running, lastError }`.
- `components/results-panel.tsx`: shows a `BulkResult` ("47 moved, 3 failed"), failed rows with reason,
  "Retry failed", "Copy details". `components/sync-status.tsx`: nav pill "3 changes waiting to sync".
- Conflict: single-item edits send `.eq('version', v)`; zero rows updated → `conflict` AppError
  ("Changed by Sam 2 minutes ago. Reload to see their version.").

### Access (`src/studio/access.ts`, `src/studio/access-context.tsx`)

`AccessProvider` loads profile, spaces, memberships after login (calls `accept_invite()` first), exposes
`useAccess()` → `{ profile, orgRole, spaces, currentSpaceId, setCurrentSpace, can(action, spaceId) }`.
Staff get a space switcher in the nav (All spaces / Internal / each client). Saves use the current space
(a staff user on "All spaces" saves to Internal). Client users are locked to their space.

### Bulk files (`src/studio/bulk.ts`, `src/studio/selection.ts`, Library)

- Selection: checkbox per row, shift-click range, "Select all N matching" for the current filter, Esc clears,
  ⌘A selects visible. Selection survives filtering but is cleared on space change.
- Bulk bar (sticky bottom, appears when ≥1 selected): Move, Client space, Status, Tags, Rename…, Download ZIP,
  Delete. Buttons hidden when `can()` says no.
- `runBulk(action, items)` → chunks of 200 → `withRetry` → RPC → merged `BulkResult`; offline → queued.
- Trash: Library filter "Trash" with days left, Restore, Delete forever (staff). Single-item delete also goes
  to Trash; the old 10-second undo toast becomes "Moved to Trash · Undo".
- ZIP: `jszip`, fetch public URLs with concurrency 6, progress, failed files listed in the results panel,
  split at 400 files per ZIP like batch export.

### Spaces, members, activity (`src/pages/members.tsx`, `src/pages/activity.tsx`)

Members (staff): people list with role and space, Invite dialog (email, role, space), change role, remove,
resend/revoke invite; Spaces tab: create, rename, archive. Activity: newest first, filter by space, person,
action, 50 per page.

### Review and notifications (`src/studio/reviews.ts`, review components, `notification-bell.tsx`)

Per-image Approve / Request changes (+ note) in batch review and Library preview; campaign sign-off button
and "42/50 approved" on campaign cards; comment thread drawer per campaign and per image; bell in nav with
unread count, realtime via Supabase channel, mark read / mark all read. Staff are notified of client
actions; client members are notified when staff comment on or request review of their campaign.

### Trimmed client UI

Client Viewer: Desk shows their space's Library and review, no studio tabs, no generate. Client Manager: studio
tabs plus Library actions in their space; template editing hidden. Members and Activity hidden from clients
(Client Managers see Activity for their space).

## Testing

- SQL: every migration applied to a local Postgres 16 with a stub `auth` schema (`auth.uid()` from a session
  setting); scripted tests assert the permission matrix for each role, each RPC's per-item results, conflict,
  trash/restore/purge, activity rows, and that rollbacks leave the old schema working.
- Unit (Vitest): `toAppError`, `withRetry`, offline queue (fake IndexedDB/memory), `can()` against the matrix,
  `runBulk` chunking and merging, selection logic, rename pattern.
- E2E (Playwright, fake Supabase): multi-select + bulk move + results panel with a forced partial failure,
  Trash restore, offline queue replay, client viewer sees only their space.
- Live rollout: backup, apply migrations, check advisors, smoke test with throwaway test users per role.

## Rollout

1. Build on `claude/keen-hypatia-o4trrw` (parallel agents, one per module, merged and verified together).
2. User approves applying migrations to the live project; backup first; apply; run advisors and RLS smoke test.
3. Deploy Edge Functions; schedule purge.
4. PR to `main` (GitHub Pages redeploys) only after the live database has the new schema.
