-- STEP 2 of 4. Run AFTER step 1. Creates client spaces, roles, Trash, bulk actions, reviews,
-- activity log and notifications. It is the migration files in order, in one paste.
-- Safe to run again if it stops part-way: every step checks before it changes anything.

-- ===== 202610170001_spaces_and_profiles.sql =====
-- Team spaces: who is who (profiles), client spaces, client memberships and invites,
-- plus the RLS helper functions every later policy uses.
-- Spec: docs/superpowers/specs/2026-10-17-team-spaces-bulk-files-errors-design.md
-- Additive and re-runnable. Reversed by supabase/rollbacks/202610170001_spaces_and_profiles.down.sql.

-- ── Tables ─────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text,
  org_role text not null check (org_role in ('owner', 'team', 'client')),
  created_at timestamptz not null default now(),
  constraint profiles_display_name_len check (display_name is null or char_length(display_name) <= 120)
);

create index if not exists profiles_org_role on public.profiles (org_role);
create index if not exists profiles_lower_email on public.profiles (lower(email));

create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('internal', 'client')),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint spaces_name_len check (char_length(btrim(name)) between 1 and 80)
);

create unique index if not exists spaces_lower_name on public.spaces (lower(btrim(name)));
-- Exactly one Internal space: templates, unlabelled work and staff saves live there.
create unique index if not exists spaces_one_internal on public.spaces (kind) where kind = 'internal';

create table if not exists public.space_members (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  role text not null check (role in ('client_manager', 'client_viewer')),
  created_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create index if not exists space_members_user on public.space_members (user_id);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  org_role text not null check (org_role in ('owner', 'team', 'client')),
  space_id uuid references public.spaces(id) on delete cascade,
  role text check (role in ('client_manager', 'client_viewer')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  revoked_at timestamptz,
  constraint invites_email_shape check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- Client invites name a space and a space role; staff invites name neither.
  constraint invites_client_has_space check (
    (org_role = 'client' and space_id is not null and role is not null)
    or (org_role <> 'client' and space_id is null and role is null)
  )
);

create index if not exists invites_pending_email on public.invites (lower(email))
  where accepted_at is null and revoked_at is null;
create index if not exists invites_space on public.invites (space_id);

-- ── RLS helpers ────────────────────────────────────────────────────────
-- security definer so policies can read profiles/space_members without recursing into their own RLS.

create or replace function public.app_org_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select org_role from public.profiles where user_id = auth.uid();
$$;

create or replace function public.app_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_org_role() in ('owner', 'team'), false);
$$;

create or replace function public.app_is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_org_role() = 'owner', false);
$$;

create or replace function public.app_can_view_space(space uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.app_is_staff()
    or (space is not null and exists (
      select 1 from public.space_members m
      where m.space_id = space and m.user_id = auth.uid()
    ));
$$;

-- Staff, or the client manager of that space. A null space (team-wide rows) is staff only.
create or replace function public.app_can_edit_space(space uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.app_is_staff()
    or (space is not null and exists (
      select 1 from public.space_members m
      where m.space_id = space and m.user_id = auth.uid() and m.role = 'client_manager'
    ));
$$;

-- Client managers may use (read) templates; staff may also edit them.
create or replace function public.app_is_client_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.space_members m
    where m.user_id = auth.uid() and m.role = 'client_manager'
  );
$$;

revoke all on function public.app_org_role() from public, anon;
revoke all on function public.app_is_staff() from public, anon;
revoke all on function public.app_is_owner() from public, anon;
revoke all on function public.app_can_view_space(uuid) from public, anon;
revoke all on function public.app_can_edit_space(uuid) from public, anon;
revoke all on function public.app_is_client_manager() from public, anon;
grant execute on function public.app_org_role() to authenticated, service_role;
grant execute on function public.app_is_staff() to authenticated, service_role;
grant execute on function public.app_is_owner() to authenticated, service_role;
grant execute on function public.app_can_view_space(uuid) to authenticated, service_role;
grant execute on function public.app_can_edit_space(uuid) to authenticated, service_role;
grant execute on function public.app_is_client_manager() to authenticated, service_role;

-- ── Guards ─────────────────────────────────────────────────────────────

-- Only the Owner changes org_role. Signed-in users hit this check; service role and
-- security definer functions (accept_invite) run as a different database role and pass.
create or replace function public.profiles_guard_org_role()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user = 'authenticated'
     and new.org_role is distinct from old.org_role
     and not public.app_is_owner() then
    raise exception 'Only the Owner can change a person''s role'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_guard_org_role() from public, anon, authenticated;

drop trigger if exists profiles_guard_org_role on public.profiles;
create trigger profiles_guard_org_role
before update of org_role on public.profiles
for each row execute function public.profiles_guard_org_role();

-- Only client users get space memberships; staff see every space through org_role.
create or replace function public.space_members_client_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where user_id = new.user_id and org_role = 'client') then
    raise exception 'Only client users can be members of a space'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.space_members_client_only() from public, anon, authenticated;

drop trigger if exists space_members_client_only on public.space_members;
create trigger space_members_client_only
before insert or update of user_id on public.space_members
for each row execute function public.space_members_client_only();

-- ── Row level security ─────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.invites enable row level security;

-- profiles: read own row, staff read all; staff manage client profiles; only the Owner manages staff.
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.app_is_staff()));

drop policy if exists "profiles insert" on public.profiles;
create policy "profiles insert" on public.profiles for insert to authenticated
  with check ((select public.app_is_owner()) or ((select public.app_is_staff()) and org_role = 'client'));

drop policy if exists "profiles update" on public.profiles;
create policy "profiles update" on public.profiles for update to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.app_is_owner())
    or ((select public.app_is_staff()) and org_role = 'client')
  )
  with check (
    user_id = (select auth.uid())
    or (select public.app_is_owner())
    or ((select public.app_is_staff()) and org_role = 'client')
  );

drop policy if exists "profiles delete" on public.profiles;
create policy "profiles delete" on public.profiles for delete to authenticated
  using ((select public.app_is_owner()) or ((select public.app_is_staff()) and org_role = 'client'));

-- spaces: read if viewable; write staff.
drop policy if exists "spaces read" on public.spaces;
create policy "spaces read" on public.spaces for select to authenticated
  using (public.app_can_view_space(id));

drop policy if exists "spaces write" on public.spaces;
create policy "spaces write" on public.spaces for all to authenticated
  using ((select public.app_is_staff()))
  with check ((select public.app_is_staff()));

-- space_members: read rows of spaces you can view; write staff.
drop policy if exists "space members read" on public.space_members;
create policy "space members read" on public.space_members for select to authenticated
  using (public.app_can_view_space(space_id));

drop policy if exists "space members write" on public.space_members;
create policy "space members write" on public.space_members for all to authenticated
  using ((select public.app_is_staff()))
  with check ((select public.app_is_staff()));

-- invites: staff read; staff write client invites; the Owner writes any.
drop policy if exists "invites read" on public.invites;
create policy "invites read" on public.invites for select to authenticated
  using ((select public.app_is_staff()));

drop policy if exists "invites write" on public.invites;
create policy "invites write" on public.invites for all to authenticated
  using ((select public.app_is_owner()) or ((select public.app_is_staff()) and org_role = 'client'))
  with check ((select public.app_is_owner()) or ((select public.app_is_staff()) and org_role = 'client'));

revoke all on public.profiles, public.spaces, public.space_members, public.invites from anon;
grant select, insert, update, delete on public.profiles, public.spaces, public.space_members, public.invites to authenticated;
grant all on public.profiles, public.spaces, public.space_members, public.invites to service_role;

-- ===== 202610170002_library_spaces.sql =====
-- Library tables join spaces: space_id, conflict protection (version), Trash (deleted_at/by), campaign tags,
-- the same-space folder rule, and the one-off data migration that files existing rows into spaces.
-- Additive and re-runnable. Reversed by supabase/rollbacks/202610170002_library_spaces.down.sql.

-- ── Columns ────────────────────────────────────────────────────────────

alter table public.outbound_campaigns
  add column if not exists space_id uuid references public.spaces(id),
  add column if not exists version integer not null default 1,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null,
  add column if not exists tags text[] not null default '{}';

alter table public.outbound_assets
  add column if not exists space_id uuid references public.spaces(id),
  add column if not exists version integer not null default 1,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

alter table public.outbound_folders
  add column if not exists space_id uuid references public.spaces(id),
  add column if not exists version integer not null default 1,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

-- Templates stay team-wide: no space_id.
alter table public.outbound_templates
  add column if not exists version integer not null default 1,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

-- The owner-only folder rule goes; the same-space rule below replaces it.
drop trigger if exists outbound_templates_folder_owner on public.outbound_templates;
drop trigger if exists outbound_campaigns_folder_owner on public.outbound_campaigns;
drop trigger if exists outbound_assets_folder_owner on public.outbound_assets;
drop function if exists public.library_folder_same_owner();

-- Same normalisation as cleanClient() in src/studio/campaign-status.ts.
create or replace function public.app_clean_client_label(value text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(left(btrim(regexp_replace(coalesce(value, ''), '[[:space:]]+', ' ', 'g')), 80), '');
$$;

-- ── Data migration (only touches rows that have no space yet) ─────────

do $$
declare
  v_internal uuid;
begin
  insert into public.spaces (name, kind) values ('Internal (DGK)', 'internal') on conflict do nothing;
  select id into v_internal from public.spaces where kind = 'internal';

  -- One client space per distinct label, case-insensitive.
  insert into public.spaces (name, kind)
  select min(label), 'client'
  from (
    select public.app_clean_client_label(config->>'client') as label
    from public.outbound_campaigns
    where space_id is null
  ) labels
  where label is not null
  group by lower(label)
  on conflict do nothing;

  update public.outbound_campaigns c
  set space_id = coalesce(
    (select s.id from public.spaces s
     where lower(btrim(s.name)) = lower(public.app_clean_client_label(c.config->>'client'))),
    v_internal)
  where c.space_id is null;

  update public.outbound_assets a
  set space_id = coalesce((select c.space_id from public.outbound_campaigns c where c.id = a.campaign_id), v_internal)
  where a.space_id is null;

  -- Folders go to the space most of their items are in (ties prefer Internal); empty folders to Internal.
  with items as (
    select folder_id, space_id from public.outbound_campaigns where folder_id is not null
    union all
    select folder_id, space_id from public.outbound_assets where folder_id is not null
    union all
    select folder_id, v_internal from public.outbound_templates where folder_id is not null
  ),
  ranked as (
    select distinct on (folder_id) folder_id, space_id
    from (select folder_id, space_id, count(*) as n from items group by folder_id, space_id) counts
    order by folder_id, n desc, (space_id = v_internal) desc, space_id
  )
  update public.outbound_folders f
  set space_id = coalesce((select r.space_id from ranked r where r.folder_id = f.id), v_internal)
  where f.space_id is null;

  -- Items left in a folder of another space go back to Root.
  update public.outbound_campaigns c set folder_id = null
  from public.outbound_folders f
  where c.folder_id = f.id and f.space_id <> c.space_id;

  update public.outbound_assets a set folder_id = null
  from public.outbound_folders f
  where a.folder_id = f.id and f.space_id <> a.space_id;

  update public.outbound_templates t set folder_id = null
  from public.outbound_folders f
  where t.folder_id = f.id and f.space_id <> v_internal;

  -- Folder names were unique per operator; now they are unique per space. Suffix clashes " (2)", " (3)".
  with numbered as (
    select id, row_number() over (partition by space_id, lower(btrim(name)) order by created_at, id) as rn
    from public.outbound_folders
    where deleted_at is null
  )
  update public.outbound_folders f
  set name = left(btrim(f.name), 74) || ' (' || n.rn || ')'
  from numbered n
  where n.id = f.id and n.rn > 1;

  -- Everyone who already owns rows is an operator today: they become Owners.
  insert into public.profiles (user_id, email, org_role)
  select u.id, coalesce(u.email, ''), 'owner'
  from auth.users u
  where exists (select 1 from public.outbound_campaigns where user_id = u.id)
     or exists (select 1 from public.outbound_templates where user_id = u.id)
     or exists (select 1 from public.outbound_assets where user_id = u.id)
     or exists (select 1 from public.outbound_folders where user_id = u.id)
     or exists (select 1 from public.outbound_copy_templates where user_id = u.id)
  on conflict (user_id) do nothing;
end
$$;

alter table public.outbound_campaigns alter column space_id set not null;
alter table public.outbound_assets alter column space_id set not null;
alter table public.outbound_folders alter column space_id set not null;

-- ── Indexes ────────────────────────────────────────────────────────────

drop index if exists public.outbound_folders_user_lower_name;
create unique index if not exists outbound_folders_space_lower_name
  on public.outbound_folders (space_id, lower(btrim(name))) where deleted_at is null;

create index if not exists outbound_campaigns_space on public.outbound_campaigns (space_id, updated_at desc);
create index if not exists outbound_assets_space on public.outbound_assets (space_id, created_at desc);
create index if not exists outbound_folders_space on public.outbound_folders (space_id);
create index if not exists outbound_assets_campaign on public.outbound_assets (campaign_id);

create index if not exists outbound_campaigns_deleted_at on public.outbound_campaigns (deleted_at) where deleted_at is not null;
create index if not exists outbound_assets_deleted_at on public.outbound_assets (deleted_at) where deleted_at is not null;
create index if not exists outbound_folders_deleted_at on public.outbound_folders (deleted_at) where deleted_at is not null;
create index if not exists outbound_templates_deleted_at on public.outbound_templates (deleted_at) where deleted_at is not null;

-- ── Triggers ───────────────────────────────────────────────────────────

-- Every update bumps version (conflict protection: clients send .eq('version', v)) and updated_at.
create or replace function public.library_bump_version()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

-- Compatibility: an insert without space_id (e.g. a client build from before spaces) lands in the
-- folder's space, else the campaign's space, else Internal.
create or replace function public.library_default_space()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
begin
  if new.space_id is null and v_row->>'folder_id' is not null then
    select space_id into new.space_id from public.outbound_folders where id = (v_row->>'folder_id')::uuid;
  end if;
  if new.space_id is null and v_row->>'campaign_id' is not null then
    select space_id into new.space_id from public.outbound_campaigns where id = (v_row->>'campaign_id')::uuid;
  end if;
  if new.space_id is null then
    select id into new.space_id from public.spaces where kind = 'internal';
  end if;
  return new;
end;
$$;

-- An item's folder must be in the item's space; template folders must be in the Internal space.
create or replace function public.library_folder_same_space()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  v_folder_space uuid;
  v_folder_deleted timestamptz;
  v_space uuid;
begin
  if new.folder_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and v_new->>'folder_id' is not distinct from v_old->>'folder_id'
     and v_new->>'space_id' is not distinct from v_old->>'space_id' then
    return new;
  end if;

  select space_id, deleted_at into v_folder_space, v_folder_deleted
  from public.outbound_folders where id = new.folder_id;
  if not found then
    raise exception 'That folder no longer exists' using errcode = '23503';
  end if;

  if tg_table_name = 'outbound_templates' then
    select id into v_space from public.spaces where kind = 'internal';
  else
    v_space := (v_new->>'space_id')::uuid;
  end if;

  if v_folder_space is distinct from v_space then
    raise exception 'That folder belongs to a different space' using errcode = '23514';
  end if;
  if v_folder_deleted is not null and v_new->>'folder_id' is distinct from v_old->>'folder_id' then
    raise exception 'That folder is in Trash' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Assets follow their campaign into a new space (folders of the old space are dropped back to Root).
create or replace function public.campaign_space_cascade()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.space_id is distinct from old.space_id then
    update public.outbound_assets a
    set space_id = new.space_id,
        folder_id = case
          when exists (select 1 from public.outbound_folders f where f.id = a.folder_id and f.space_id = new.space_id)
          then a.folder_id
          else null
        end
    where a.campaign_id = new.id and a.space_id is distinct from new.space_id;
  end if;
  return null;
end;
$$;

-- A folder holding templates stays in Internal.
create or replace function public.folder_space_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.space_id is distinct from old.space_id
     and exists (select 1 from public.outbound_templates where folder_id = new.id)
     and not exists (select 1 from public.spaces where id = new.space_id and kind = 'internal') then
    raise exception 'This folder holds templates, which stay in the Internal space'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- A folder moved to another space takes its campaigns (and their assets) and files along.
create or replace function public.folder_space_cascade()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.space_id is distinct from old.space_id then
    update public.outbound_campaigns set space_id = new.space_id
    where folder_id = new.id and space_id is distinct from new.space_id;
    update public.outbound_assets set space_id = new.space_id
    where folder_id = new.id and space_id is distinct from new.space_id;
  end if;
  return null;
end;
$$;

revoke all on function public.library_bump_version() from public, anon, authenticated;
revoke all on function public.library_default_space() from public, anon, authenticated;
revoke all on function public.library_folder_same_space() from public, anon, authenticated;
revoke all on function public.campaign_space_cascade() from public, anon, authenticated;
revoke all on function public.folder_space_guard() from public, anon, authenticated;
revoke all on function public.folder_space_cascade() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['outbound_campaigns', 'outbound_assets', 'outbound_folders', 'outbound_templates'] loop
    execute format('drop trigger if exists library_bump_version on public.%I', t);
    execute format('create trigger library_bump_version before update on public.%I
                    for each row execute function public.library_bump_version()', t);
  end loop;

  foreach t in array array['outbound_campaigns', 'outbound_assets', 'outbound_folders'] loop
    execute format('drop trigger if exists library_default_space on public.%I', t);
    execute format('create trigger library_default_space before insert on public.%I
                    for each row execute function public.library_default_space()', t);
  end loop;

  foreach t in array array['outbound_campaigns', 'outbound_assets'] loop
    execute format('drop trigger if exists library_folder_same_space on public.%I', t);
    execute format('create trigger library_folder_same_space before insert or update of folder_id, space_id on public.%I
                    for each row execute function public.library_folder_same_space()', t);
  end loop;
end
$$;

drop trigger if exists library_folder_same_space on public.outbound_templates;
create trigger library_folder_same_space
before insert or update of folder_id on public.outbound_templates
for each row execute function public.library_folder_same_space();

drop trigger if exists campaign_space_cascade on public.outbound_campaigns;
create trigger campaign_space_cascade
after update of space_id on public.outbound_campaigns
for each row execute function public.campaign_space_cascade();

drop trigger if exists folder_space_guard on public.outbound_folders;
create trigger folder_space_guard
before update of space_id on public.outbound_folders
for each row execute function public.folder_space_guard();

drop trigger if exists folder_space_cascade on public.outbound_folders;
create trigger folder_space_cascade
after update of space_id on public.outbound_folders
for each row execute function public.folder_space_cascade();

-- ===== 202610170003_space_policies.sql =====
-- Space-based row level security for the library tables and storage. Replaces the owner-only policies.
-- Reversed by supabase/rollbacks/202610170003_space_policies.down.sql.

drop policy if exists "campaign owners manage campaigns" on public.outbound_campaigns;
drop policy if exists "asset owners manage assets" on public.outbound_assets;
drop policy if exists "folder owners manage folders" on public.outbound_folders;
drop policy if exists "template owners manage templates" on public.outbound_templates;

-- Campaigns, assets and folders: view by space, write by space (the new space_id is checked too, so
-- moving into a space you cannot edit fails), hard delete (purge) staff only. user_id = created by.
do $$
declare
  t text;
begin
  foreach t in array array['outbound_campaigns', 'outbound_assets', 'outbound_folders'] loop
    execute format('drop policy if exists "space members read" on public.%I', t);
    execute format('create policy "space members read" on public.%I for select to authenticated
      using ((select public.app_is_staff()) or public.app_can_view_space(space_id))', t);

    execute format('drop policy if exists "space editors insert" on public.%I', t);
    execute format('create policy "space editors insert" on public.%I for insert to authenticated
      with check (user_id = (select auth.uid()) and public.app_can_edit_space(space_id))', t);

    execute format('drop policy if exists "space editors update" on public.%I', t);
    execute format('create policy "space editors update" on public.%I for update to authenticated
      using ((select public.app_is_staff()) or public.app_can_edit_space(space_id))
      with check ((select public.app_is_staff()) or public.app_can_edit_space(space_id))', t);

    execute format('drop policy if exists "staff purge" on public.%I', t);
    execute format('create policy "staff purge" on public.%I for delete to authenticated
      using ((select public.app_is_staff()))', t);
  end loop;
end
$$;

-- Templates: staff and client managers read (use); staff write.
drop policy if exists "templates read" on public.outbound_templates;
create policy "templates read" on public.outbound_templates for select to authenticated
  using ((select public.app_is_staff()) or (select public.app_is_client_manager()));

drop policy if exists "templates insert" on public.outbound_templates;
create policy "templates insert" on public.outbound_templates for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.app_is_staff()));

drop policy if exists "templates update" on public.outbound_templates;
create policy "templates update" on public.outbound_templates for update to authenticated
  using ((select public.app_is_staff()))
  with check ((select public.app_is_staff()));

drop policy if exists "templates purge" on public.outbound_templates;
create policy "templates purge" on public.outbound_templates for delete to authenticated
  using ((select public.app_is_staff()));

-- ── Storage ────────────────────────────────────────────────────────────
-- New uploads go under spaces/<space_id>/…; legacy <user_id>/… paths keep their owner-only policies
-- from 202609160001. Reads stay public (bucket is public, email images load by link).

-- The space id in "spaces/<uuid>/…", or null for any other path (never raises on odd names).
create or replace function public.app_storage_space(object_name text)
returns uuid
language sql
immutable
set search_path = public
as $$
  select case
    when object_name ~* '^spaces/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+'
    then split_part(object_name, '/', 2)::uuid
  end;
$$;

revoke all on function public.app_storage_space(text) from public, anon;
grant execute on function public.app_storage_space(text) to authenticated, service_role;

drop policy if exists "space editors upload outbound assets" on storage.objects;
create policy "space editors upload outbound assets" on storage.objects for insert to authenticated
  with check (bucket_id = 'outbound-assets' and public.app_can_edit_space(public.app_storage_space(name)));

drop policy if exists "space editors update outbound assets" on storage.objects;
create policy "space editors update outbound assets" on storage.objects for update to authenticated
  using (bucket_id = 'outbound-assets' and public.app_can_edit_space(public.app_storage_space(name)))
  with check (bucket_id = 'outbound-assets' and public.app_can_edit_space(public.app_storage_space(name)));

drop policy if exists "space editors delete outbound assets" on storage.objects;
create policy "space editors delete outbound assets" on storage.objects for delete to authenticated
  using (bucket_id = 'outbound-assets' and public.app_can_edit_space(public.app_storage_space(name)));

-- Purge from Trash is staff-only and must also remove legacy <user_id>/… files uploaded by someone else.
drop policy if exists "staff delete outbound assets" on storage.objects;
create policy "staff delete outbound assets" on storage.objects for delete to authenticated
  using (bucket_id = 'outbound-assets' and (select public.app_is_staff()));

-- ===== 202610170004_activity_reviews_notifications.sql =====
-- Activity log (written only by triggers), reviews, comments and in-app notifications.
-- Reversed by supabase/rollbacks/202610170004_activity_reviews_notifications.down.sql.

-- ── Tables ─────────────────────────────────────────────────────────────

create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  space_id uuid references public.spaces(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null check (action in (
    'created', 'renamed', 'moved', 'updated', 'trashed', 'restored', 'purged', 'approved', 'rejected',
    'signed_off', 'commented', 'member_added', 'member_removed', 'role_changed', 'invited'
  )),
  details jsonb not null default '{}'::jsonb
);

create index if not exists activity_log_space_at on public.activity_log (space_id, at desc);
create index if not exists activity_log_at on public.activity_log (at desc);
create index if not exists activity_log_entity on public.activity_log (entity_type, entity_id, at desc);
create index if not exists activity_log_actor on public.activity_log (actor, at desc);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  campaign_id uuid not null references public.outbound_campaigns(id) on delete cascade,
  asset_id uuid references public.outbound_assets(id) on delete cascade,
  status text not null check (status in ('approved', 'changes_requested')),
  note text check (note is null or char_length(note) <= 4000),
  reviewer uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists reviews_campaign_asset_created on public.reviews (campaign_id, asset_id, created_at desc);
create index if not exists reviews_space on public.reviews (space_id);
create index if not exists reviews_asset on public.reviews (asset_id) where asset_id is not null;

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  campaign_id uuid not null references public.outbound_campaigns(id) on delete cascade,
  asset_id uuid references public.outbound_assets(id) on delete cascade,
  author uuid not null default auth.uid(),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index if not exists comments_campaign_asset_created on public.comments (campaign_id, asset_id, created_at);
create index if not exists comments_space on public.comments (space_id);
create index if not exists comments_asset on public.comments (asset_id) where asset_id is not null;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('approved', 'changes_requested', 'signed_off', 'commented', 'review_requested')),
  space_id uuid references public.spaces(id) on delete cascade,
  campaign_id uuid references public.outbound_campaigns(id) on delete cascade,
  asset_id uuid references public.outbound_assets(id) on delete cascade,
  actor uuid,
  summary text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists notifications_recipient_read on public.notifications (recipient, read_at);
create index if not exists notifications_recipient_created on public.notifications (recipient, created_at desc);
create index if not exists notifications_campaign on public.notifications (campaign_id);

-- ── Row level security ─────────────────────────────────────────────────

alter table public.activity_log enable row level security;
alter table public.reviews enable row level security;
alter table public.comments enable row level security;
alter table public.notifications enable row level security;

-- Activity: staff see all, client managers their own space (app_can_edit_space(null) is staff only).
drop policy if exists "activity read" on public.activity_log;
create policy "activity read" on public.activity_log for select to authenticated
  using ((select public.app_is_staff()) or public.app_can_edit_space(space_id));

drop policy if exists "reviews read" on public.reviews;
create policy "reviews read" on public.reviews for select to authenticated
  using ((select public.app_is_staff()) or public.app_can_view_space(space_id));

drop policy if exists "reviews insert" on public.reviews;
create policy "reviews insert" on public.reviews for insert to authenticated
  with check (reviewer = (select auth.uid()) and public.app_can_view_space(space_id));

drop policy if exists "comments read" on public.comments;
create policy "comments read" on public.comments for select to authenticated
  using ((select public.app_is_staff()) or public.app_can_view_space(space_id));

drop policy if exists "comments insert" on public.comments;
create policy "comments insert" on public.comments for insert to authenticated
  with check (author = (select auth.uid()) and public.app_can_view_space(space_id));

drop policy if exists "comments edit own" on public.comments;
create policy "comments edit own" on public.comments for update to authenticated
  using (author = (select auth.uid()))
  with check (author = (select auth.uid()));

drop policy if exists "comments delete own" on public.comments;
create policy "comments delete own" on public.comments for delete to authenticated
  using (author = (select auth.uid()));

drop policy if exists "notifications read" on public.notifications;
create policy "notifications read" on public.notifications for select to authenticated
  using (recipient = (select auth.uid()));

drop policy if exists "notifications mark read" on public.notifications;
create policy "notifications mark read" on public.notifications for update to authenticated
  using (recipient = (select auth.uid()))
  with check (recipient = (select auth.uid()));

drop policy if exists "notifications delete" on public.notifications;
create policy "notifications delete" on public.notifications for delete to authenticated
  using (recipient = (select auth.uid()));

revoke all on public.activity_log, public.reviews, public.comments, public.notifications from anon, authenticated;
grant select on public.activity_log to authenticated;
grant select, insert on public.reviews to authenticated;
grant select, insert, update (body, deleted_at), delete on public.comments to authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.activity_log, public.reviews, public.comments, public.notifications to service_role;

-- ── Review/comment integrity ───────────────────────────────────────────
-- space_id always comes from the campaign (never trusted from the client); the asset must belong to it;
-- the reviewer/author is the signed-in user.

create or replace function public.review_fill_space()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space uuid;
  v_row jsonb := to_jsonb(new);
begin
  select space_id into v_space from public.outbound_campaigns where id = new.campaign_id;
  if v_space is null then
    raise exception 'Campaign not found' using errcode = '23503';
  end if;
  if new.asset_id is not null and not exists (
    select 1 from public.outbound_assets where id = new.asset_id and campaign_id = new.campaign_id
  ) then
    raise exception 'That image is not part of this campaign' using errcode = '23514';
  end if;
  new.space_id := v_space;
  if auth.uid() is not null then
    if tg_table_name = 'reviews' then
      new.reviewer := auth.uid();
    else
      new.author := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.comment_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.review_fill_space() from public, anon, authenticated;
revoke all on function public.comment_guard_update() from public, anon, authenticated;

drop trigger if exists review_fill_space on public.reviews;
create trigger review_fill_space before insert on public.reviews
for each row execute function public.review_fill_space();

drop trigger if exists comment_fill_space on public.comments;
create trigger comment_fill_space before insert on public.comments
for each row execute function public.review_fill_space();

drop trigger if exists comment_guard_update on public.comments;
create trigger comment_guard_update before update on public.comments
for each row execute function public.comment_guard_update();

-- ── Activity triggers (security definer: clients cannot write the log directly) ──

create or replace function public.log_library_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity text := tg_argv[0];
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_name_key text := case when v_entity = 'asset' then 'filename' else 'name' end;
  v_space uuid := (v_row->>'space_id')::uuid;
  v_id uuid := (v_row->>'id')::uuid;
  v_ignored text[] := array['version', 'updated_at'];
  v_logged boolean := false;
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
    values (auth.uid(), v_space, v_entity, v_id, 'created', jsonb_build_object('name', v_new->>v_name_key));
    return null;
  end if;

  if tg_op = 'DELETE' then
    insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
    values (auth.uid(), v_space, v_entity, v_id, 'purged',
            jsonb_strip_nulls(jsonb_build_object('name', v_old->>v_name_key, 'storage_path', v_old->>'storage_path')));
    return null;
  end if;

  -- UPDATE: Trash moves win; otherwise rename and move are logged separately, anything else is 'updated'.
  if v_old->>'deleted_at' is null and v_new->>'deleted_at' is not null then
    insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
    values (auth.uid(), v_space, v_entity, v_id, 'trashed', jsonb_build_object('name', v_new->>v_name_key));
    return null;
  end if;
  if v_old->>'deleted_at' is not null and v_new->>'deleted_at' is null then
    insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
    values (auth.uid(), v_space, v_entity, v_id, 'restored', jsonb_build_object('name', v_new->>v_name_key));
    return null;
  end if;

  if v_new->>v_name_key is distinct from v_old->>v_name_key then
    insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
    values (auth.uid(), v_space, v_entity, v_id, 'renamed',
            jsonb_build_object('from', v_old->>v_name_key, 'to', v_new->>v_name_key));
    v_logged := true;
  end if;

  if v_new->>'folder_id' is distinct from v_old->>'folder_id'
     or v_new->>'space_id' is distinct from v_old->>'space_id' then
    insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
    values (auth.uid(), v_space, v_entity, v_id, 'moved', jsonb_build_object(
      'name', v_new->>v_name_key,
      'from_folder', v_old->'folder_id', 'to_folder', v_new->'folder_id',
      'from_space', v_old->'space_id', 'to_space', v_new->'space_id'));
    v_logged := true;
  end if;

  if not v_logged and (v_new - v_ignored) is distinct from (v_old - v_ignored) then
    insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
    values (auth.uid(), v_space, v_entity, v_id, 'updated', jsonb_build_object(
      'name', v_new->>v_name_key,
      'fields', (select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
                 from jsonb_each(v_new - v_ignored) n
                 where n.value is distinct from (v_old - v_ignored)->n.key)));
  end if;
  return null;
end;
$$;

create or replace function public.log_member_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
    values (auth.uid(), new.space_id, 'member', new.user_id, 'member_added', jsonb_build_object('role', new.role));
  elsif tg_op = 'DELETE' then
    insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
    values (auth.uid(), old.space_id, 'member', old.user_id, 'member_removed', jsonb_build_object('role', old.role));
  elsif new.role is distinct from old.role then
    insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
    values (auth.uid(), new.space_id, 'member', new.user_id, 'role_changed',
            jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  return null;
end;
$$;

create or replace function public.log_invite_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
  values (coalesce(auth.uid(), new.invited_by), new.space_id, 'invite', new.id, 'invited',
          jsonb_strip_nulls(jsonb_build_object('email', new.email, 'org_role', new.org_role, 'role', new.role)));
  return null;
end;
$$;

create or replace function public.log_review_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
begin
  if tg_table_name = 'comments' then
    v_action := 'commented';
  elsif new.status = 'changes_requested' then
    v_action := 'rejected';
  elsif new.asset_id is null then
    v_action := 'signed_off';
  else
    v_action := 'approved';
  end if;
  insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
  values (
    auth.uid(), new.space_id,
    case when new.asset_id is null then 'campaign' else 'asset' end,
    coalesce(new.asset_id, new.campaign_id),
    v_action,
    jsonb_strip_nulls(jsonb_build_object(
      'campaign_id', new.campaign_id,
      case when tg_table_name = 'comments' then 'comment_id' else 'review_id' end, new.id,
      'note', case when tg_table_name = 'reviews' then to_jsonb(new)->>'note' end))
  );
  return null;
end;
$$;

-- ── Notifications: client actions notify staff; staff actions notify the space's client members ──

create or replace function public.notify_review_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := case when tg_table_name = 'reviews' then to_jsonb(new)->>'reviewer' else to_jsonb(new)->>'author' end;
  v_actor_role text;
  v_actor_name text;
  v_campaign text;
  v_kind text;
  v_verb text;
begin
  select org_role, coalesce(nullif(btrim(display_name), ''), nullif(email, ''), 'Someone')
  into v_actor_role, v_actor_name
  from public.profiles where user_id = v_actor;
  if v_actor_role is null then
    return null;
  end if;

  select name into v_campaign from public.outbound_campaigns where id = new.campaign_id;

  if tg_table_name = 'comments' then
    v_kind := 'commented';
    v_verb := case when new.asset_id is null then 'commented on' else 'commented on an image in' end;
  elsif to_jsonb(new)->>'status' = 'changes_requested' then
    v_kind := 'changes_requested';
    v_verb := case when new.asset_id is null then 'requested changes to' else 'requested changes to an image in' end;
  elsif new.asset_id is null then
    v_kind := 'signed_off';
    v_verb := 'signed off';
  else
    v_kind := 'approved';
    v_verb := 'approved an image in';
  end if;

  insert into public.notifications (recipient, kind, space_id, campaign_id, asset_id, actor, summary)
  select r.user_id, v_kind, new.space_id, new.campaign_id, new.asset_id, v_actor,
         left(v_actor_name || ' ' || v_verb || ' "' || coalesce(v_campaign, 'a campaign') || '"', 300)
  from (
    select p.user_id from public.profiles p
    where v_actor_role = 'client' and p.org_role in ('owner', 'team')
    union
    select m.user_id from public.space_members m
    where v_actor_role in ('owner', 'team') and m.space_id = new.space_id
  ) r
  where r.user_id <> v_actor;
  return null;
end;
$$;

revoke all on function public.log_library_activity() from public, anon, authenticated;
revoke all on function public.log_member_activity() from public, anon, authenticated;
revoke all on function public.log_invite_activity() from public, anon, authenticated;
revoke all on function public.log_review_activity() from public, anon, authenticated;
revoke all on function public.notify_review_activity() from public, anon, authenticated;

drop trigger if exists log_activity on public.outbound_campaigns;
create trigger log_activity after insert or update or delete on public.outbound_campaigns
for each row execute function public.log_library_activity('campaign');

drop trigger if exists log_activity on public.outbound_templates;
create trigger log_activity after insert or update or delete on public.outbound_templates
for each row execute function public.log_library_activity('template');

drop trigger if exists log_activity on public.outbound_assets;
create trigger log_activity after insert or update or delete on public.outbound_assets
for each row execute function public.log_library_activity('asset');

drop trigger if exists log_activity on public.outbound_folders;
create trigger log_activity after insert or update or delete on public.outbound_folders
for each row execute function public.log_library_activity('folder');

drop trigger if exists log_activity on public.space_members;
create trigger log_activity after insert or update or delete on public.space_members
for each row execute function public.log_member_activity();

drop trigger if exists log_activity on public.invites;
create trigger log_activity after insert on public.invites
for each row execute function public.log_invite_activity();

drop trigger if exists log_activity on public.reviews;
create trigger log_activity after insert on public.reviews
for each row execute function public.log_review_activity();

drop trigger if exists log_activity on public.comments;
create trigger log_activity after insert on public.comments
for each row execute function public.log_review_activity();

drop trigger if exists notify on public.reviews;
create trigger notify after insert on public.reviews
for each row execute function public.notify_review_activity();

drop trigger if exists notify on public.comments;
create trigger notify after insert on public.comments
for each row execute function public.notify_review_activity();

-- ── Realtime (only where the publication exists, e.g. on Supabase) ─────

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['notifications', 'reviews', 'comments'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end
$$;

-- ===== 202610170005_bulk_rpcs.sql =====
-- Bulk library actions and invite acceptance.
-- Every bulk_* RPC is security invoker (RLS decides what the caller may touch), runs each item in its own
-- begin … exception block (one bad item never rolls back the rest) and returns one row per distinct id:
--   (id uuid, ok boolean, error_code text, message text)
-- error_code is an AppErrorCode from src/studio/contracts.ts: permission | conflict | not_found | validation | unknown.
-- Reversed by supabase/rollbacks/202610170005_bulk_rpcs.down.sql.

-- ── Shared helpers ─────────────────────────────────────────────────────

create or replace function public.app_bulk_table(entity text)
returns text
language sql
immutable
set search_path = public
as $$
  select case entity
    when 'campaign' then 'outbound_campaigns'
    when 'template' then 'outbound_templates'
    when 'asset' then 'outbound_assets'
    when 'folder' then 'outbound_folders'
  end;
$$;

-- SQLSTATE → AppErrorCode. The RPCs raise 42501 (permission), P0002 (not found), DGKCF (conflict)
-- and 22023 (validation) themselves; constraint and trigger errors fall into the same buckets.
create or replace function public.app_bulk_error_code(state text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when state = '42501' then 'permission'
    when state in ('P0002', '23503') then 'not_found'
    when state in ('DGKCF', '40001') then 'conflict'
    when state like '22%' or state like '23%' then 'validation'
    else 'unknown'
  end;
$$;

create or replace function public.app_bulk_error_message(state text, message text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when state = '23505' then 'Something with this name already exists here. Rename it first.'
    when state = '42501' and message like 'new row violates row-level security%'
      then 'You don''t have permission to put this item there.'
    else message
  end;
$$;

-- Same result row for every id: used for whole-request rejections (too many ids, bad entity, no access).
create or replace function public.app_bulk_reject(ids uuid[], p_code text, p_message text)
returns table (id uuid, ok boolean, error_code text, message text)
language sql
immutable
set search_path = public
as $$
  select u.id, false, p_code, p_message
  from unnest(coalesce(ids, '{}')) with ordinality as u(id, ord)
  where u.id is not null
  group by u.id
  order by min(u.ord);
$$;

-- Distinct ids in the order given.
create or replace function public.app_bulk_ids(ids uuid[])
returns setof uuid
language sql
immutable
set search_path = public
as $$
  select u.id
  from unnest(coalesce(ids, '{}')) with ordinality as u(id, ord)
  where u.id is not null
  group by u.id
  order by min(u.ord);
$$;

-- The row as the caller can see it (RLS applies), or null.
create or replace function public.app_bulk_row(entity text, item uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_row jsonb;
begin
  execute format('select to_jsonb(t) from public.%I t where t.id = $1', public.app_bulk_table(entity))
    into v_row using item;
  return v_row;
end;
$$;

-- "Sam (sam@dgk.au) at 2026-10-17 14:02 UTC": the last person who changed the item, for conflict messages.
-- security definer so it can read activity/profiles, but only answers for items the caller may see.
create or replace function public.app_last_editor(entity text, item uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select coalesce(nullif(btrim(p.display_name), ''), nullif(p.email, ''), 'someone else')
            || ' at ' || to_char(a.at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"')
     from public.activity_log a
     left join public.profiles p on p.user_id = a.actor
     where a.entity_type = entity and a.entity_id = item
       and (public.app_is_staff() or public.app_can_view_space(a.space_id)
            or (entity = 'template' and public.app_is_client_manager()))
     order by a.at desc, a.id desc
     limit 1),
    'someone else');
$$;

-- Appends one campaign status event the way pushHistory() in src/studio/campaign-status.ts does:
-- drops malformed entries, keeps the newest 50, oldest first.
create or replace function public.app_push_history(history jsonb, kind text, row_count integer)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
  from (
    select e, ord
    from (
      select h.e, h.ord
      from jsonb_array_elements(case when jsonb_typeof(history) = 'array' then history else '[]'::jsonb end)
           with ordinality as h(e, ord)
      where jsonb_typeof(h.e) = 'object'
        and jsonb_typeof(h.e->'at') = 'string'
        and h.e->>'kind' in ('generated', 'uploaded', 'exported', 'cleaned')
      union all
      select jsonb_build_object(
               'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'kind', kind,
               'rows', greatest(0, coalesce(row_count, 0))),
             9223372036854775807
    ) all_events
    order by ord desc
    limit 50
  ) newest;
$$;

-- Existing tags, then added ones, without duplicates or removed ones.
create or replace function public.app_merge_tags(tags text[], tags_add text[], tags_remove text[])
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(t order by ord), '{}')
  from (
    select u.t, min(u.ord) as ord
    from unnest(coalesce(tags, '{}') || coalesce(tags_add, '{}')) with ordinality as u(t, ord)
    where not (u.t = any(coalesce(tags_remove, '{}')))
    group by u.t
  ) merged;
$$;

-- Strings from a jsonb array, trimmed; null when the value is not an array of short non-empty strings.
create or replace function public.app_tag_list(value jsonb)
returns text[]
language sql
immutable
set search_path = public
as $$
  select case
    when value is null or jsonb_typeof(value) = 'null' then '{}'::text[]
    when jsonb_typeof(value) <> 'array' then null
    when exists (
      select 1 from jsonb_array_elements(value) e
      where jsonb_typeof(e) <> 'string' or char_length(btrim(e #>> '{}')) not between 1 and 40
    ) then null
    when jsonb_array_length(value) > 50 then null
    else (select coalesce(array_agg(btrim(e #>> '{}') order by ord), '{}')
          from jsonb_array_elements(value) with ordinality as x(e, ord))
  end;
$$;

-- ── bulk_trash ─────────────────────────────────────────────────────────

create or replace function public.bulk_trash(entity text, ids uuid[])
returns table (id uuid, ok boolean, error_code text, message text)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_table text := public.app_bulk_table(entity);
  v_id uuid;
  v_row jsonb;
  v_hit uuid;
begin
  if v_table is null then
    return query select * from public.app_bulk_reject(ids, 'validation', 'Unknown item type.');
    return;
  end if;
  if cardinality(ids) > 200 then
    return query select * from public.app_bulk_reject(ids, 'validation', 'Too many items in one request (200 max).');
    return;
  end if;

  for v_id in select * from public.app_bulk_ids(ids) loop
    id := v_id; ok := true; error_code := null; message := null;
    begin
      v_row := public.app_bulk_row(entity, v_id);
      if v_row is null then
        raise exception 'This item no longer exists.' using errcode = 'P0002';
      end if;
      if v_row->>'deleted_at' is not null then
        message := 'Already in Trash.';
      else
        execute format('update public.%I set deleted_at = now(), deleted_by = auth.uid() where id = $1 returning id', v_table)
          into v_hit using v_id;
        if v_hit is null then
          raise exception 'You don''t have permission to change this item.' using errcode = '42501';
        end if;
      end if;
    exception when others then
      ok := false;
      error_code := public.app_bulk_error_code(sqlstate);
      message := public.app_bulk_error_message(sqlstate, sqlerrm);
    end;
    return next;
  end loop;
end;
$$;

-- ── bulk_restore ───────────────────────────────────────────────────────

create or replace function public.bulk_restore(entity text, ids uuid[])
returns table (id uuid, ok boolean, error_code text, message text)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_table text := public.app_bulk_table(entity);
  v_id uuid;
  v_row jsonb;
  v_hit uuid;
  v_folder_ok boolean;
begin
  if v_table is null then
    return query select * from public.app_bulk_reject(ids, 'validation', 'Unknown item type.');
    return;
  end if;
  if cardinality(ids) > 200 then
    return query select * from public.app_bulk_reject(ids, 'validation', 'Too many items in one request (200 max).');
    return;
  end if;

  for v_id in select * from public.app_bulk_ids(ids) loop
    id := v_id; ok := true; error_code := null; message := null;
    begin
      v_row := public.app_bulk_row(entity, v_id);
      if v_row is null then
        raise exception 'This item no longer exists.' using errcode = 'P0002';
      end if;
      if v_row->>'deleted_at' is null then
        message := 'Not in Trash.';
      elsif entity = 'folder' then
        update public.outbound_folders set deleted_at = null, deleted_by = null where outbound_folders.id = v_id
          returning outbound_folders.id into v_hit;
        if v_hit is null then
          raise exception 'You don''t have permission to change this item.' using errcode = '42501';
        end if;
      else
        -- Restore into Root when the folder is gone (deleted or in Trash).
        v_folder_ok := v_row->>'folder_id' is null or exists (
          select 1 from public.outbound_folders f
          where f.id = (v_row->>'folder_id')::uuid and f.deleted_at is null
        );
        execute format(
          'update public.%I set deleted_at = null, deleted_by = null,
             folder_id = case when $2 then folder_id else null end
           where id = $1 returning id', v_table)
          into v_hit using v_id, v_folder_ok;
        if v_hit is null then
          raise exception 'You don''t have permission to change this item.' using errcode = '42501';
        end if;
        if not v_folder_ok then
          message := 'Restored to Root: its folder is gone.';
        end if;
      end if;
    exception when others then
      ok := false;
      error_code := public.app_bulk_error_code(sqlstate);
      message := public.app_bulk_error_message(sqlstate, sqlerrm);
    end;
    return next;
  end loop;
end;
$$;

-- ── bulk_move ──────────────────────────────────────────────────────────
-- target_folder null = Root. The space is the target folder's space, else target_space, else unchanged.
-- Campaigns take their assets along; folders take their contents along (triggers in 202610170002).

create or replace function public.bulk_move(entity text, ids uuid[], target_folder uuid, target_space uuid)
returns table (id uuid, ok boolean, error_code text, message text)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_table text := public.app_bulk_table(entity);
  v_space uuid := target_space;
  v_folder record;
  v_internal uuid;
  v_id uuid;
  v_row jsonb;
  v_hit uuid;
begin
  if v_table is null then
    return query select * from public.app_bulk_reject(ids, 'validation', 'Unknown item type.');
    return;
  end if;
  if cardinality(ids) > 200 then
    return query select * from public.app_bulk_reject(ids, 'validation', 'Too many items in one request (200 max).');
    return;
  end if;

  select s.id into v_internal from public.spaces s where s.kind = 'internal';

  if target_folder is not null then
    if entity = 'folder' then
      return query select * from public.app_bulk_reject(ids, 'validation', 'Folders cannot go inside other folders.');
      return;
    end if;
    select f.space_id, f.deleted_at into v_folder from public.outbound_folders f where f.id = target_folder;
    if not found then
      return query select * from public.app_bulk_reject(ids, 'not_found', 'The target folder no longer exists.');
      return;
    end if;
    if v_folder.deleted_at is not null then
      return query select * from public.app_bulk_reject(ids, 'validation', 'The target folder is in Trash.');
      return;
    end if;
    if target_space is not null and target_space <> v_folder.space_id then
      return query select * from public.app_bulk_reject(ids, 'validation', 'That folder belongs to a different space.');
      return;
    end if;
    v_space := v_folder.space_id;
  end if;

  if v_space is not null then
    if not exists (select 1 from public.spaces s where s.id = v_space) then
      return query select * from public.app_bulk_reject(ids, 'not_found', 'The target space no longer exists.');
      return;
    end if;
    if not public.app_can_edit_space(v_space) then
      return query select * from public.app_bulk_reject(ids, 'permission', 'You can''t move items into that space.');
      return;
    end if;
  end if;

  if entity = 'template' and v_space is distinct from v_internal and v_space is not null then
    return query select * from public.app_bulk_reject(ids, 'validation', 'Templates stay in the Internal space.');
    return;
  end if;
  if entity = 'folder' and v_space is null then
    return query select * from public.app_bulk_reject(ids, 'validation', 'Choose a space to move the folder to.');
    return;
  end if;

  for v_id in select * from public.app_bulk_ids(ids) loop
    id := v_id; ok := true; error_code := null; message := null;
    begin
      v_row := public.app_bulk_row(entity, v_id);
      if v_row is null then
        raise exception 'This item no longer exists.' using errcode = 'P0002';
      end if;
      if v_row->>'deleted_at' is not null then
        raise exception 'This item is in Trash. Restore it first.' using errcode = '22023';
      end if;

      if entity = 'folder' then
        update public.outbound_folders set space_id = v_space where outbound_folders.id = v_id
          returning outbound_folders.id into v_hit;
      elsif entity = 'template' then
        update public.outbound_templates set folder_id = target_folder where outbound_templates.id = v_id
          returning outbound_templates.id into v_hit;
      else
        execute format('update public.%I set folder_id = $2, space_id = coalesce($3, space_id) where id = $1 returning id', v_table)
          into v_hit using v_id, target_folder, v_space;
      end if;
      if v_hit is null then
        raise exception 'You don''t have permission to change this item.' using errcode = '42501';
      end if;
    exception when others then
      ok := false;
      error_code := public.app_bulk_error_code(sqlstate);
      message := public.app_bulk_error_message(sqlstate, sqlerrm);
    end;
    return next;
  end loop;
end;
$$;

-- ── bulk_update_campaigns ──────────────────────────────────────────────
-- patch: { status?: 'generated'|'uploaded'|'exported', tags_add?: string[], tags_remove?: string[] }.
-- status appends a history event to config (the status is derived from history; 'draft' means no events).

create or replace function public.bulk_update_campaigns(ids uuid[], patch jsonb)
returns table (id uuid, ok boolean, error_code text, message text)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_status text;
  v_add text[];
  v_remove text[];
  v_id uuid;
  v_row jsonb;
  v_hit uuid;
begin
  if cardinality(ids) > 200 then
    return query select * from public.app_bulk_reject(ids, 'validation', 'Too many items in one request (200 max).');
    return;
  end if;
  if patch is null or jsonb_typeof(patch) <> 'object' or patch = '{}'::jsonb
     or exists (select 1 from jsonb_object_keys(patch) k where k not in ('status', 'tags_add', 'tags_remove')) then
    return query select * from public.app_bulk_reject(ids, 'validation', 'Nothing valid to update.');
    return;
  end if;
  if patch ? 'status' and jsonb_typeof(patch->'status') <> 'null' then
    v_status := patch->>'status';
    if jsonb_typeof(patch->'status') <> 'string' or v_status not in ('generated', 'uploaded', 'exported') then
      return query select * from public.app_bulk_reject(ids, 'validation', 'Status must be Generated, Uploaded or Exported.');
      return;
    end if;
  end if;
  v_add := public.app_tag_list(patch->'tags_add');
  v_remove := public.app_tag_list(patch->'tags_remove');
  if v_add is null or v_remove is null then
    return query select * from public.app_bulk_reject(ids, 'validation', 'Tags must be a list of up to 50 names, each 1–40 characters.');
    return;
  end if;

  for v_id in select * from public.app_bulk_ids(ids) loop
    id := v_id; ok := true; error_code := null; message := null;
    begin
      v_row := public.app_bulk_row('campaign', v_id);
      if v_row is null then
        raise exception 'This item no longer exists.' using errcode = 'P0002';
      end if;
      if v_row->>'deleted_at' is not null then
        raise exception 'This item is in Trash. Restore it first.' using errcode = '22023';
      end if;
      if cardinality(public.app_merge_tags(
           array(select jsonb_array_elements_text(v_row->'tags')), v_add, v_remove)) > 50 then
        raise exception 'A campaign can have at most 50 tags.' using errcode = '22023';
      end if;

      update public.outbound_campaigns c
      set config = case
            when v_status is null then c.config
            else (case when jsonb_typeof(c.config) = 'object' then c.config else '{}'::jsonb end)
                 || jsonb_build_object('history', public.app_push_history(
                      c.config->'history', v_status,
                      case when jsonb_typeof(c.source_data) = 'array' then jsonb_array_length(c.source_data) else 0 end))
          end,
          tags = public.app_merge_tags(c.tags, v_add, v_remove)
      where c.id = v_id
      returning c.id into v_hit;
      if v_hit is null then
        raise exception 'You don''t have permission to change this item.' using errcode = '42501';
      end if;
    exception when others then
      ok := false;
      error_code := public.app_bulk_error_code(sqlstate);
      message := public.app_bulk_error_message(sqlstate, sqlerrm);
    end;
    return next;
  end loop;
end;
$$;

-- ── bulk_rename ────────────────────────────────────────────────────────
-- items: [{ id, name, version? }]. A version that no longer matches → conflict naming the last editor.

create or replace function public.bulk_rename(entity text, items jsonb)
returns table (id uuid, ok boolean, error_code text, message text)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_table text := public.app_bulk_table(entity);
  v_column text := case when entity = 'asset' then 'filename' else 'name' end;
  v_ids uuid[];
  v_item jsonb;
  v_id uuid;
  v_name text;
  v_version integer;
  v_row jsonb;
  v_hit uuid;
  v_seen uuid[] := '{}';
begin
  if items is null or jsonb_typeof(items) <> 'array' then
    return;
  end if;
  v_ids := array(
    select case when e->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then (e->>'id')::uuid end
    from jsonb_array_elements(items) e);
  if v_table is null then
    return query select * from public.app_bulk_reject(v_ids, 'validation', 'Unknown item type.');
    return;
  end if;
  if jsonb_array_length(items) > 200 then
    return query select * from public.app_bulk_reject(v_ids, 'validation', 'Too many items in one request (200 max).');
    return;
  end if;

  for v_item in select e from jsonb_array_elements(items) e loop
    id := null; ok := true; error_code := null; message := null;
    begin
      if jsonb_typeof(v_item) <> 'object'
         or coalesce(v_item->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Each item needs an id.' using errcode = '22023';
      end if;
      v_id := (v_item->>'id')::uuid;
      id := v_id;
      if v_id = any(v_seen) then
        continue;
      end if;
      v_seen := v_seen || v_id;

      v_name := btrim(coalesce(v_item->>'name', ''));
      if v_name = '' or char_length(v_name) > 200 then
        raise exception 'Names must be 1–200 characters.' using errcode = '22023';
      end if;
      v_version := case when jsonb_typeof(v_item->'version') = 'number' then (v_item->>'version')::integer end;

      v_row := public.app_bulk_row(entity, v_id);
      if v_row is null then
        raise exception 'This item no longer exists.' using errcode = 'P0002';
      end if;
      if v_row->>'deleted_at' is not null then
        raise exception 'This item is in Trash. Restore it first.' using errcode = '22023';
      end if;
      if v_version is not null and (v_row->>'version')::integer <> v_version then
        raise exception 'Changed by % since you loaded it. Reload to see their version.',
          public.app_last_editor(entity, v_id) using errcode = 'DGKCF';
      end if;

      if v_row->>v_column is distinct from v_name then
        execute format('update public.%I set %I = $2 where id = $1 and ($3 is null or version = $3) returning id', v_table, v_column)
          into v_hit using v_id, v_name, v_version;
        if v_hit is null then
          if v_version is not null and (public.app_bulk_row(entity, v_id)->>'version')::integer <> v_version then
            raise exception 'Changed by % since you loaded it. Reload to see their version.',
              public.app_last_editor(entity, v_id) using errcode = 'DGKCF';
          end if;
          raise exception 'You don''t have permission to change this item.' using errcode = '42501';
        end if;
      end if;
    exception when others then
      ok := false;
      error_code := public.app_bulk_error_code(sqlstate);
      message := public.app_bulk_error_message(sqlstate, sqlerrm);
    end;
    return next;
  end loop;
end;
$$;

-- ── bulk_purge ─────────────────────────────────────────────────────────
-- Staff only, items must already be in Trash. message = the storage_path the caller should remove
-- from the outbound-assets bucket (assets and templates), else null.

create or replace function public.bulk_purge(entity text, ids uuid[])
returns table (id uuid, ok boolean, error_code text, message text)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_table text := public.app_bulk_table(entity);
  v_id uuid;
  v_row jsonb;
  v_hit uuid;
begin
  if v_table is null then
    return query select * from public.app_bulk_reject(ids, 'validation', 'Unknown item type.');
    return;
  end if;
  if cardinality(ids) > 200 then
    return query select * from public.app_bulk_reject(ids, 'validation', 'Too many items in one request (200 max).');
    return;
  end if;
  if not public.app_is_staff() then
    return query select * from public.app_bulk_reject(ids, 'permission', 'Only the Owner and Team can delete forever.');
    return;
  end if;

  for v_id in select * from public.app_bulk_ids(ids) loop
    id := v_id; ok := true; error_code := null; message := null;
    begin
      v_row := public.app_bulk_row(entity, v_id);
      if v_row is null then
        raise exception 'This item no longer exists.' using errcode = 'P0002';
      end if;
      if v_row->>'deleted_at' is null then
        raise exception 'Move it to Trash first.' using errcode = '22023';
      end if;
      execute format('delete from public.%I where id = $1 returning id', v_table) into v_hit using v_id;
      if v_hit is null then
        raise exception 'You don''t have permission to delete this item.' using errcode = '42501';
      end if;
      message := nullif(v_row->>'storage_path', '');
    exception when others then
      ok := false;
      error_code := public.app_bulk_error_code(sqlstate);
      message := public.app_bulk_error_message(sqlstate, sqlerrm);
    end;
    return next;
  end loop;
end;
$$;

-- ── accept_invite ──────────────────────────────────────────────────────
-- Called by the app after every sign-in. Accepts each pending, unexpired invite for the caller's email:
-- creates or raises the profile (never lowers an org_role) and adds the space membership.
-- One row per invite handled (id = invite id); no rows when nothing is pending.

create or replace function public.accept_invite()
returns table (id uuid, ok boolean, error_code text, message text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_user record;
  v_invite record;
begin
  if v_uid is null then
    id := null; ok := false; error_code := 'permission'; message := 'Sign in first.';
    return next;
    return;
  end if;
  select u.email, u.raw_user_meta_data into v_user from auth.users u where u.id = v_uid;
  if v_user.email is null then
    return;
  end if;

  for v_invite in
    select i.* from public.invites i
    where lower(i.email) = lower(v_user.email)
      and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    order by i.created_at
  loop
    id := v_invite.id; ok := true; error_code := null; message := null;
    begin
      insert into public.profiles (user_id, email, display_name, org_role)
      values (
        v_uid, v_user.email,
        nullif(btrim(coalesce(v_user.raw_user_meta_data->>'full_name', v_user.raw_user_meta_data->>'name', '')), ''),
        v_invite.org_role)
      on conflict (user_id) do update
        set email = excluded.email,
            org_role = case
              when array_position(array['client', 'team', 'owner'], excluded.org_role)
                 > array_position(array['client', 'team', 'owner'], profiles.org_role)
              then excluded.org_role else profiles.org_role end;

      if v_invite.org_role = 'client' then
        insert into public.space_members (space_id, user_id, role)
        values (v_invite.space_id, v_uid, v_invite.role)
        on conflict (space_id, user_id) do update set role = excluded.role;
      end if;

      update public.invites set accepted_at = now() where invites.id = v_invite.id;
      message := v_invite.org_role;
    exception when others then
      ok := false;
      error_code := public.app_bulk_error_code(sqlstate);
      message := public.app_bulk_error_message(sqlstate, sqlerrm);
    end;
    return next;
  end loop;
end;
$$;

-- ── Grants ─────────────────────────────────────────────────────────────

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.app_bulk_table(text)',
    'public.app_bulk_error_code(text)',
    'public.app_bulk_error_message(text, text)',
    'public.app_bulk_reject(uuid[], text, text)',
    'public.app_bulk_ids(uuid[])',
    'public.app_bulk_row(text, uuid)',
    'public.app_last_editor(text, uuid)',
    'public.app_push_history(jsonb, text, integer)',
    'public.app_merge_tags(text[], text[], text[])',
    'public.app_tag_list(jsonb)',
    'public.bulk_trash(text, uuid[])',
    'public.bulk_restore(text, uuid[])',
    'public.bulk_move(text, uuid[], uuid, uuid)',
    'public.bulk_update_campaigns(uuid[], jsonb)',
    'public.bulk_rename(text, jsonb)',
    'public.bulk_purge(text, uuid[])',
    'public.accept_invite()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;

-- ===== 202610170006_purge_trash_schedule.sql =====
-- Daily purge of items in Trash for more than 30 days: pg_cron calls the purge-trash Edge Function via pg_net.
-- Only scheduled when both extensions are installed; otherwise this migration does nothing.
-- No secrets live here: the job reads them from Supabase Vault when it runs. Create them once (SQL editor):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<random token>', 'purge_trash_secret');   -- same value as the function's PURGE_TRASH_SECRET
-- Reversed by supabase/rollbacks/202610170006_purge_trash_schedule.down.sql.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    -- Re-scheduling under the same name replaces the job, so this is safe to re-run.
    perform cron.schedule(
      'purge-trash-daily',
      '17 3 * * *',
      $job$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
                 || '/functions/v1/purge-trash',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'purge_trash_secret')
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 60000
        );
      $job$
    );
  else
    raise notice 'pg_cron or pg_net not installed: purge-trash is not scheduled';
  end if;
end
$$;

-- ===== 202610170007_keep_work_when_user_removed.sql =====
-- Removing a person's login must not delete their work. user_id means "created by"; when that
-- account is deleted the column becomes null (the app shows "a removed user") and the campaign,
-- file, folder or template stays in its space.

do $$
declare
  t text;
  c record;
begin
  foreach t in array array['outbound_campaigns', 'outbound_templates', 'outbound_assets', 'outbound_folders'] loop
    -- Drop whatever foreign key points user_id at auth.users, whatever it is called.
    for c in
      select con.conname
      from pg_constraint con
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
      where con.conrelid = format('public.%I', t)::regclass
        and con.contype = 'f'
        and con.confrelid = 'auth.users'::regclass
        and att.attname = 'user_id'
    loop
      execute format('alter table public.%I drop constraint %I', t, c.conname);
    end loop;
    execute format('alter table public.%I alter column user_id drop not null', t);
    execute format(
      'alter table public.%I add constraint %I foreign key (user_id) references auth.users(id) on delete set null',
      t, t || '_user_id_fkey');
  end loop;
end $$;

