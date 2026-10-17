-- Reverses 202610170003_space_policies.sql: back to the owner-only policies.

do $$
declare
  t text;
begin
  foreach t in array array['outbound_campaigns', 'outbound_assets', 'outbound_folders'] loop
    execute format('drop policy if exists "space members read" on public.%I', t);
    execute format('drop policy if exists "space editors insert" on public.%I', t);
    execute format('drop policy if exists "space editors update" on public.%I', t);
    execute format('drop policy if exists "staff purge" on public.%I', t);
  end loop;
end
$$;

drop policy if exists "templates read" on public.outbound_templates;
drop policy if exists "templates insert" on public.outbound_templates;
drop policy if exists "templates update" on public.outbound_templates;
drop policy if exists "templates purge" on public.outbound_templates;

drop policy if exists "space editors upload outbound assets" on storage.objects;
drop policy if exists "space editors update outbound assets" on storage.objects;
drop policy if exists "space editors delete outbound assets" on storage.objects;
drop policy if exists "staff delete outbound assets" on storage.objects;
drop function if exists public.app_storage_space(text);

-- Original policies from 202609160001 and 202609240005.
drop policy if exists "campaign owners manage campaigns" on public.outbound_campaigns;
create policy "campaign owners manage campaigns"
  on public.outbound_campaigns for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "template owners manage templates" on public.outbound_templates;
create policy "template owners manage templates"
  on public.outbound_templates for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "asset owners manage assets" on public.outbound_assets;
create policy "asset owners manage assets"
  on public.outbound_assets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "folder owners manage folders" on public.outbound_folders;
create policy "folder owners manage folders"
  on public.outbound_folders
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
