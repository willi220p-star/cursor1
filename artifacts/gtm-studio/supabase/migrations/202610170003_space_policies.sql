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
