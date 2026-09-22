create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists outbound_templates_set_updated_at on public.outbound_templates;
create trigger outbound_templates_set_updated_at
before update on public.outbound_templates
for each row execute function public.set_updated_at();

alter table public.outbound_templates replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'outbound_templates'
  ) then
    alter publication supabase_realtime add table public.outbound_templates;
  end if;
end
$$;
