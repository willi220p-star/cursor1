-- STEP 4 of 4. The last few statements, which contain DROP / DELETE and so need a human to run them.
-- Run in the Supabase SQL editor (Run, then confirm if it asks). Safe to run twice.
-- What it does: removes the four old owner-only access rules and the old per-person folder-name index,
-- adds "delete forever" for Trash, and makes removing a login keep that person's work.

-- Old owner-only rules (the new space-based rules are already in place)
drop policy if exists "campaign owners manage campaigns" on public.outbound_campaigns;
drop policy if exists "asset owners manage assets" on public.outbound_assets;
drop policy if exists "folder owners manage folders" on public.outbound_folders;
drop policy if exists "template owners manage templates" on public.outbound_templates;
drop index if exists public.outbound_folders_user_lower_name;

-- Delete forever (Trash)
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

revoke all on function public.bulk_purge(text, uuid[]) from public, anon;
grant execute on function public.bulk_purge(text, uuid[]) to authenticated, service_role;

-- Keep a person's work when their login is removed
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

do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values
      ('20261017000003', 'space_policies'),
      ('20261017000005', 'bulk_rpcs'),
      ('20261017000007', 'keep_work_when_user_removed')
    on conflict do nothing;
  end if;
end
$$;

-- Check: all three should be true.
select (select count(*) from pg_policies where schemaname = 'public' and policyname in ('campaign owners manage campaigns', 'asset owners manage assets', 'folder owners manage folders', 'template owners manage templates')) = 0 as old_rules_gone,
       exists (select 1 from pg_proc where proname = 'bulk_purge') as delete_forever_ready,
       (select is_nullable = 'YES' from information_schema.columns where table_schema = 'public' and table_name = 'outbound_campaigns' and column_name = 'user_id') as work_kept_when_login_removed;
