create table if not exists public.outbound_copy_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbound_copy_templates_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint outbound_copy_templates_body_len check (char_length(body) between 1 and 8000),
  constraint outbound_copy_templates_user_name unique (user_id, name)
);

create index if not exists outbound_copy_templates_user_updated
  on public.outbound_copy_templates (user_id, updated_at desc);

alter table public.outbound_copy_templates enable row level security;

create policy "copy template owners manage rows"
  on public.outbound_copy_templates
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop trigger if exists outbound_copy_templates_set_updated_at on public.outbound_copy_templates;
create trigger outbound_copy_templates_set_updated_at
before update on public.outbound_copy_templates
for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.outbound_copy_templates to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'outbound_copy_templates'
  ) then
    alter publication supabase_realtime add table public.outbound_copy_templates;
  end if;
end
$$;
