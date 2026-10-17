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
