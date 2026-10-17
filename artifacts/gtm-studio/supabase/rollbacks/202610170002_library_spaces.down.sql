-- Reverses 202610170002_library_spaces.sql: drops the space/version/Trash columns and triggers and
-- restores the owner-only folder rule. Rows are kept; items that were in Trash become visible again.

drop trigger if exists folder_space_cascade on public.outbound_folders;
drop trigger if exists folder_space_guard on public.outbound_folders;
drop trigger if exists campaign_space_cascade on public.outbound_campaigns;
drop trigger if exists library_folder_same_space on public.outbound_templates;
drop trigger if exists library_folder_same_space on public.outbound_campaigns;
drop trigger if exists library_folder_same_space on public.outbound_assets;
drop trigger if exists library_default_space on public.outbound_campaigns;
drop trigger if exists library_default_space on public.outbound_assets;
drop trigger if exists library_default_space on public.outbound_folders;
drop trigger if exists library_bump_version on public.outbound_campaigns;
drop trigger if exists library_bump_version on public.outbound_assets;
drop trigger if exists library_bump_version on public.outbound_folders;
drop trigger if exists library_bump_version on public.outbound_templates;

drop function if exists public.folder_space_cascade();
drop function if exists public.folder_space_guard();
drop function if exists public.campaign_space_cascade();
drop function if exists public.library_folder_same_space();
drop function if exists public.library_default_space();
drop function if exists public.library_bump_version();
drop function if exists public.app_clean_client_label(text);

drop index if exists public.outbound_folders_space_lower_name;
drop index if exists public.outbound_campaigns_space;
drop index if exists public.outbound_assets_space;
drop index if exists public.outbound_folders_space;
drop index if exists public.outbound_assets_campaign;
drop index if exists public.outbound_campaigns_deleted_at;
drop index if exists public.outbound_assets_deleted_at;
drop index if exists public.outbound_folders_deleted_at;
drop index if exists public.outbound_templates_deleted_at;

-- Folder names were unique per space; the old index wants them unique per operator. Suffix clashes.
with numbered as (
  select id, row_number() over (partition by user_id, lower(btrim(name)) order by created_at, id) as rn
  from public.outbound_folders
)
update public.outbound_folders f
set name = left(btrim(f.name), 74) || ' (' || n.rn || ')'
from numbered n
where n.id = f.id and n.rn > 1;

create unique index if not exists outbound_folders_user_lower_name
  on public.outbound_folders (user_id, lower(btrim(name)));

alter table public.outbound_campaigns
  drop column if exists space_id,
  drop column if exists version,
  drop column if exists deleted_at,
  drop column if exists deleted_by,
  drop column if exists tags;

alter table public.outbound_assets
  drop column if exists space_id,
  drop column if exists version,
  drop column if exists updated_at,
  drop column if exists deleted_at,
  drop column if exists deleted_by;

alter table public.outbound_folders
  drop column if exists space_id,
  drop column if exists version,
  drop column if exists updated_at,
  drop column if exists deleted_at,
  drop column if exists deleted_by;

alter table public.outbound_templates
  drop column if exists version,
  drop column if exists deleted_at,
  drop column if exists deleted_by;

-- Original folder rule from 202609240006.
create or replace function public.library_folder_same_owner()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.folder_id is null then
    return new;
  end if;
  if not exists (
    select 1
    from public.outbound_folders
    where id = new.folder_id
      and user_id = new.user_id
  ) then
    raise exception 'Folder does not belong to this operator'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.library_folder_same_owner() from public, anon, authenticated;

drop trigger if exists outbound_templates_folder_owner on public.outbound_templates;
create trigger outbound_templates_folder_owner
before insert or update of folder_id, user_id on public.outbound_templates
for each row execute function public.library_folder_same_owner();

drop trigger if exists outbound_campaigns_folder_owner on public.outbound_campaigns;
create trigger outbound_campaigns_folder_owner
before insert or update of folder_id, user_id on public.outbound_campaigns
for each row execute function public.library_folder_same_owner();

drop trigger if exists outbound_assets_folder_owner on public.outbound_assets;
create trigger outbound_assets_folder_owner
before insert or update of folder_id, user_id on public.outbound_assets
for each row execute function public.library_folder_same_owner();
