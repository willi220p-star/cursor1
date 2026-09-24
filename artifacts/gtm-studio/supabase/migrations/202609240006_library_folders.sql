alter table public.outbound_templates
  add column if not exists folder_id uuid references public.outbound_folders(id) on delete set null;

create index if not exists outbound_templates_folder_id
  on public.outbound_templates (folder_id);

alter table public.outbound_campaigns
  add column if not exists folder_id uuid references public.outbound_folders(id) on delete set null;

create index if not exists outbound_campaigns_folder_id
  on public.outbound_campaigns (folder_id);

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
