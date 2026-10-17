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
