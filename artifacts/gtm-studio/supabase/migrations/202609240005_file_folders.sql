create table if not exists public.outbound_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint outbound_folders_name_len check (char_length(btrim(name)) between 1 and 80)
);

create unique index if not exists outbound_folders_user_lower_name
  on public.outbound_folders (user_id, lower(btrim(name)));

alter table public.outbound_assets
  add column if not exists folder_id uuid references public.outbound_folders(id) on delete set null;

create index if not exists outbound_assets_folder_id
  on public.outbound_assets (folder_id);

alter table public.outbound_folders enable row level security;

drop policy if exists "folder owners manage folders" on public.outbound_folders;
create policy "folder owners manage folders"
  on public.outbound_folders
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.outbound_folders to authenticated;
