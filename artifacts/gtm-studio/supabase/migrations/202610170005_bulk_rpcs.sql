-- Bulk library actions and invite acceptance.
-- Every bulk_* RPC is security invoker (RLS decides what the caller may touch), runs each item in its own
-- begin … exception block (one bad item never rolls back the rest) and returns one row per distinct id:
--   (id uuid, ok boolean, error_code text, message text)
-- error_code is an AppErrorCode from src/studio/contracts.ts: permission | conflict | not_found | validation | unknown.
-- Reversed by supabase/rollbacks/202610170005_bulk_rpcs.down.sql.

-- ── Shared helpers ─────────────────────────────────────────────────────

create or replace function public.app_bulk_table(entity text)
returns text
language sql
immutable
set search_path = public
as $$
  select case entity
    when 'campaign' then 'outbound_campaigns'
    when 'template' then 'outbound_templates'
    when 'asset' then 'outbound_assets'
    when 'folder' then 'outbound_folders'
  end;
$$;

-- SQLSTATE → AppErrorCode. The RPCs raise 42501 (permission), P0002 (not found), DGKCF (conflict)
-- and 22023 (validation) themselves; constraint and trigger errors fall into the same buckets.
create or replace function public.app_bulk_error_code(state text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when state = '42501' then 'permission'
    when state in ('P0002', '23503') then 'not_found'
    when state in ('DGKCF', '40001') then 'conflict'
    when state like '22%' or state like '23%' then 'validation'
    else 'unknown'
  end;
$$;

create or replace function public.app_bulk_error_message(state text, message text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when state = '23505' then 'Something with this name already exists here. Rename it first.'
    when state = '42501' and message like 'new row violates row-level security%'
      then 'You don''t have permission to put this item there.'
    else message
  end;
$$;

-- Same result row for every id: used for whole-request rejections (too many ids, bad entity, no access).
create or replace function public.app_bulk_reject(ids uuid[], p_code text, p_message text)
returns table (id uuid, ok boolean, error_code text, message text)
language sql
immutable
set search_path = public
as $$
  select u.id, false, p_code, p_message
  from unnest(coalesce(ids, '{}')) with ordinality as u(id, ord)
  where u.id is not null
  group by u.id
  order by min(u.ord);
$$;

-- Distinct ids in the order given.
create or replace function public.app_bulk_ids(ids uuid[])
returns setof uuid
language sql
immutable
set search_path = public
as $$
  select u.id
  from unnest(coalesce(ids, '{}')) with ordinality as u(id, ord)
  where u.id is not null
  group by u.id
  order by min(u.ord);
$$;

-- The row as the caller can see it (RLS applies), or null.
create or replace function public.app_bulk_row(entity text, item uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_row jsonb;
begin
  execute format('select to_jsonb(t) from public.%I t where t.id = $1', public.app_bulk_table(entity))
    into v_row using item;
  return v_row;
end;
$$;

-- "Sam (sam@dgk.au) at 2026-10-17 14:02 UTC": the last person who changed the item, for conflict messages.
-- security definer so it can read activity/profiles, but only answers for items the caller may see.
create or replace function public.app_last_editor(entity text, item uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select coalesce(nullif(btrim(p.display_name), ''), nullif(p.email, ''), 'someone else')
            || ' at ' || to_char(a.at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"')
     from public.activity_log a
     left join public.profiles p on p.user_id = a.actor
     where a.entity_type = entity and a.entity_id = item
       and (public.app_is_staff() or public.app_can_view_space(a.space_id)
            or (entity = 'template' and public.app_is_client_manager()))
     order by a.at desc, a.id desc
     limit 1),
    'someone else');
$$;

-- Appends one campaign status event the way pushHistory() in src/studio/campaign-status.ts does:
-- drops malformed entries, keeps the newest 50, oldest first.
create or replace function public.app_push_history(history jsonb, kind text, row_count integer)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
  from (
    select e, ord
    from (
      select h.e, h.ord
      from jsonb_array_elements(case when jsonb_typeof(history) = 'array' then history else '[]'::jsonb end)
           with ordinality as h(e, ord)
      where jsonb_typeof(h.e) = 'object'
        and jsonb_typeof(h.e->'at') = 'string'
        and h.e->>'kind' in ('generated', 'uploaded', 'exported', 'cleaned')
      union all
      select jsonb_build_object(
               'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'kind', kind,
               'rows', greatest(0, coalesce(row_count, 0))),
             9223372036854775807
    ) all_events
    order by ord desc
    limit 50
  ) newest;
$$;

-- Existing tags, then added ones, without duplicates or removed ones.
create or replace function public.app_merge_tags(tags text[], tags_add text[], tags_remove text[])
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(t order by ord), '{}')
  from (
    select u.t, min(u.ord) as ord
    from unnest(coalesce(tags, '{}') || coalesce(tags_add, '{}')) with ordinality as u(t, ord)
    where not (u.t = any(coalesce(tags_remove, '{}')))
    group by u.t
  ) merged;
$$;

-- Strings from a jsonb array, trimmed; null when the value is not an array of short non-empty strings.
create or replace function public.app_tag_list(value jsonb)
returns text[]
language sql
immutable
set search_path = public
as $$
  select case
    when value is null or jsonb_typeof(value) = 'null' then '{}'::text[]
    when jsonb_typeof(value) <> 'array' then null
    when exists (
      select 1 from jsonb_array_elements(value) e
      where jsonb_typeof(e) <> 'string' or char_length(btrim(e #>> '{}')) not between 1 and 40
    ) then null
    when jsonb_array_length(value) > 50 then null
    else (select coalesce(array_agg(btrim(e #>> '{}') order by ord), '{}')
          from jsonb_array_elements(value) with ordinality as x(e, ord))
  end;
$$;

-- ── bulk_trash ─────────────────────────────────────────────────────────

create or replace function public.bulk_trash(entity text, ids uuid[])
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

  for v_id in select * from public.app_bulk_ids(ids) loop
    id := v_id; ok := true; error_code := null; message := null;
    begin
      v_row := public.app_bulk_row(entity, v_id);
      if v_row is null then
        raise exception 'This item no longer exists.' using errcode = 'P0002';
      end if;
      if v_row->>'deleted_at' is not null then
        message := 'Already in Trash.';
      else
        execute format('update public.%I set deleted_at = now(), deleted_by = auth.uid() where id = $1 returning id', v_table)
          into v_hit using v_id;
        if v_hit is null then
          raise exception 'You don''t have permission to change this item.' using errcode = '42501';
        end if;
      end if;
    exception when others then
      ok := false;
      error_code := public.app_bulk_error_code(sqlstate);
      message := public.app_bulk_error_message(sqlstate, sqlerrm);
    end;
    return next;
  end loop;
end;
$$;

-- ── bulk_restore ───────────────────────────────────────────────────────

create or replace function public.bulk_restore(entity text, ids uuid[])
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
  v_folder_ok boolean;
begin
  if v_table is null then
    return query select * from public.app_bulk_reject(ids, 'validation', 'Unknown item type.');
    return;
  end if;
  if cardinality(ids) > 200 then
    return query select * from public.app_bulk_reject(ids, 'validation', 'Too many items in one request (200 max).');
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
        message := 'Not in Trash.';
      elsif entity = 'folder' then
        update public.outbound_folders set deleted_at = null, deleted_by = null where outbound_folders.id = v_id
          returning outbound_folders.id into v_hit;
        if v_hit is null then
          raise exception 'You don''t have permission to change this item.' using errcode = '42501';
        end if;
      else
        -- Restore into Root when the folder is gone (deleted or in Trash).
        v_folder_ok := v_row->>'folder_id' is null or exists (
          select 1 from public.outbound_folders f
          where f.id = (v_row->>'folder_id')::uuid and f.deleted_at is null
        );
        execute format(
          'update public.%I set deleted_at = null, deleted_by = null,
             folder_id = case when $2 then folder_id else null end
           where id = $1 returning id', v_table)
          into v_hit using v_id, v_folder_ok;
        if v_hit is null then
          raise exception 'You don''t have permission to change this item.' using errcode = '42501';
        end if;
        if not v_folder_ok then
          message := 'Restored to Root: its folder is gone.';
        end if;
      end if;
    exception when others then
      ok := false;
      error_code := public.app_bulk_error_code(sqlstate);
      message := public.app_bulk_error_message(sqlstate, sqlerrm);
    end;
    return next;
  end loop;
end;
$$;

-- ── bulk_move ──────────────────────────────────────────────────────────
-- target_folder null = Root. The space is the target folder's space, else target_space, else unchanged.
-- Campaigns take their assets along; folders take their contents along (triggers in 202610170002).

create or replace function public.bulk_move(entity text, ids uuid[], target_folder uuid, target_space uuid)
returns table (id uuid, ok boolean, error_code text, message text)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_table text := public.app_bulk_table(entity);
  v_space uuid := target_space;
  v_folder record;
  v_internal uuid;
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

  select s.id into v_internal from public.spaces s where s.kind = 'internal';

  if target_folder is not null then
    if entity = 'folder' then
      return query select * from public.app_bulk_reject(ids, 'validation', 'Folders cannot go inside other folders.');
      return;
    end if;
    select f.space_id, f.deleted_at into v_folder from public.outbound_folders f where f.id = target_folder;
    if not found then
      return query select * from public.app_bulk_reject(ids, 'not_found', 'The target folder no longer exists.');
      return;
    end if;
    if v_folder.deleted_at is not null then
      return query select * from public.app_bulk_reject(ids, 'validation', 'The target folder is in Trash.');
      return;
    end if;
    if target_space is not null and target_space <> v_folder.space_id then
      return query select * from public.app_bulk_reject(ids, 'validation', 'That folder belongs to a different space.');
      return;
    end if;
    v_space := v_folder.space_id;
  end if;

  if v_space is not null then
    if not exists (select 1 from public.spaces s where s.id = v_space) then
      return query select * from public.app_bulk_reject(ids, 'not_found', 'The target space no longer exists.');
      return;
    end if;
    if not public.app_can_edit_space(v_space) then
      return query select * from public.app_bulk_reject(ids, 'permission', 'You can''t move items into that space.');
      return;
    end if;
  end if;

  if entity = 'template' and v_space is distinct from v_internal and v_space is not null then
    return query select * from public.app_bulk_reject(ids, 'validation', 'Templates stay in the Internal space.');
    return;
  end if;
  if entity = 'folder' and v_space is null then
    return query select * from public.app_bulk_reject(ids, 'validation', 'Choose a space to move the folder to.');
    return;
  end if;

  for v_id in select * from public.app_bulk_ids(ids) loop
    id := v_id; ok := true; error_code := null; message := null;
    begin
      v_row := public.app_bulk_row(entity, v_id);
      if v_row is null then
        raise exception 'This item no longer exists.' using errcode = 'P0002';
      end if;
      if v_row->>'deleted_at' is not null then
        raise exception 'This item is in Trash. Restore it first.' using errcode = '22023';
      end if;

      if entity = 'folder' then
        update public.outbound_folders set space_id = v_space where outbound_folders.id = v_id
          returning outbound_folders.id into v_hit;
      elsif entity = 'template' then
        update public.outbound_templates set folder_id = target_folder where outbound_templates.id = v_id
          returning outbound_templates.id into v_hit;
      else
        execute format('update public.%I set folder_id = $2, space_id = coalesce($3, space_id) where id = $1 returning id', v_table)
          into v_hit using v_id, target_folder, v_space;
      end if;
      if v_hit is null then
        raise exception 'You don''t have permission to change this item.' using errcode = '42501';
      end if;
    exception when others then
      ok := false;
      error_code := public.app_bulk_error_code(sqlstate);
      message := public.app_bulk_error_message(sqlstate, sqlerrm);
    end;
    return next;
  end loop;
end;
$$;

-- ── bulk_update_campaigns ──────────────────────────────────────────────
-- patch: { status?: 'generated'|'uploaded'|'exported', tags_add?: string[], tags_remove?: string[] }.
-- status appends a history event to config (the status is derived from history; 'draft' means no events).

create or replace function public.bulk_update_campaigns(ids uuid[], patch jsonb)
returns table (id uuid, ok boolean, error_code text, message text)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_status text;
  v_add text[];
  v_remove text[];
  v_id uuid;
  v_row jsonb;
  v_hit uuid;
begin
  if cardinality(ids) > 200 then
    return query select * from public.app_bulk_reject(ids, 'validation', 'Too many items in one request (200 max).');
    return;
  end if;
  if patch is null or jsonb_typeof(patch) <> 'object' or patch = '{}'::jsonb
     or exists (select 1 from jsonb_object_keys(patch) k where k not in ('status', 'tags_add', 'tags_remove')) then
    return query select * from public.app_bulk_reject(ids, 'validation', 'Nothing valid to update.');
    return;
  end if;
  if patch ? 'status' and jsonb_typeof(patch->'status') <> 'null' then
    v_status := patch->>'status';
    if jsonb_typeof(patch->'status') <> 'string' or v_status not in ('generated', 'uploaded', 'exported') then
      return query select * from public.app_bulk_reject(ids, 'validation', 'Status must be Generated, Uploaded or Exported.');
      return;
    end if;
  end if;
  v_add := public.app_tag_list(patch->'tags_add');
  v_remove := public.app_tag_list(patch->'tags_remove');
  if v_add is null or v_remove is null then
    return query select * from public.app_bulk_reject(ids, 'validation', 'Tags must be a list of up to 50 names, each 1–40 characters.');
    return;
  end if;

  for v_id in select * from public.app_bulk_ids(ids) loop
    id := v_id; ok := true; error_code := null; message := null;
    begin
      v_row := public.app_bulk_row('campaign', v_id);
      if v_row is null then
        raise exception 'This item no longer exists.' using errcode = 'P0002';
      end if;
      if v_row->>'deleted_at' is not null then
        raise exception 'This item is in Trash. Restore it first.' using errcode = '22023';
      end if;
      if cardinality(public.app_merge_tags(
           array(select jsonb_array_elements_text(v_row->'tags')), v_add, v_remove)) > 50 then
        raise exception 'A campaign can have at most 50 tags.' using errcode = '22023';
      end if;

      update public.outbound_campaigns c
      set config = case
            when v_status is null then c.config
            else (case when jsonb_typeof(c.config) = 'object' then c.config else '{}'::jsonb end)
                 || jsonb_build_object('history', public.app_push_history(
                      c.config->'history', v_status,
                      case when jsonb_typeof(c.source_data) = 'array' then jsonb_array_length(c.source_data) else 0 end))
          end,
          tags = public.app_merge_tags(c.tags, v_add, v_remove)
      where c.id = v_id
      returning c.id into v_hit;
      if v_hit is null then
        raise exception 'You don''t have permission to change this item.' using errcode = '42501';
      end if;
    exception when others then
      ok := false;
      error_code := public.app_bulk_error_code(sqlstate);
      message := public.app_bulk_error_message(sqlstate, sqlerrm);
    end;
    return next;
  end loop;
end;
$$;

-- ── bulk_rename ────────────────────────────────────────────────────────
-- items: [{ id, name, version? }]. A version that no longer matches → conflict naming the last editor.

create or replace function public.bulk_rename(entity text, items jsonb)
returns table (id uuid, ok boolean, error_code text, message text)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_table text := public.app_bulk_table(entity);
  v_column text := case when entity = 'asset' then 'filename' else 'name' end;
  v_ids uuid[];
  v_item jsonb;
  v_id uuid;
  v_name text;
  v_version integer;
  v_row jsonb;
  v_hit uuid;
  v_seen uuid[] := '{}';
begin
  if items is null or jsonb_typeof(items) <> 'array' then
    return;
  end if;
  v_ids := array(
    select case when e->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then (e->>'id')::uuid end
    from jsonb_array_elements(items) e);
  if v_table is null then
    return query select * from public.app_bulk_reject(v_ids, 'validation', 'Unknown item type.');
    return;
  end if;
  if jsonb_array_length(items) > 200 then
    return query select * from public.app_bulk_reject(v_ids, 'validation', 'Too many items in one request (200 max).');
    return;
  end if;

  for v_item in select e from jsonb_array_elements(items) e loop
    id := null; ok := true; error_code := null; message := null;
    begin
      if jsonb_typeof(v_item) <> 'object'
         or coalesce(v_item->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Each item needs an id.' using errcode = '22023';
      end if;
      v_id := (v_item->>'id')::uuid;
      id := v_id;
      if v_id = any(v_seen) then
        continue;
      end if;
      v_seen := v_seen || v_id;

      v_name := btrim(coalesce(v_item->>'name', ''));
      if v_name = '' or char_length(v_name) > 200 then
        raise exception 'Names must be 1–200 characters.' using errcode = '22023';
      end if;
      v_version := case when jsonb_typeof(v_item->'version') = 'number' then (v_item->>'version')::integer end;

      v_row := public.app_bulk_row(entity, v_id);
      if v_row is null then
        raise exception 'This item no longer exists.' using errcode = 'P0002';
      end if;
      if v_row->>'deleted_at' is not null then
        raise exception 'This item is in Trash. Restore it first.' using errcode = '22023';
      end if;
      if v_version is not null and (v_row->>'version')::integer <> v_version then
        raise exception 'Changed by % since you loaded it. Reload to see their version.',
          public.app_last_editor(entity, v_id) using errcode = 'DGKCF';
      end if;

      if v_row->>v_column is distinct from v_name then
        execute format('update public.%I set %I = $2 where id = $1 and ($3 is null or version = $3) returning id', v_table, v_column)
          into v_hit using v_id, v_name, v_version;
        if v_hit is null then
          if v_version is not null and (public.app_bulk_row(entity, v_id)->>'version')::integer <> v_version then
            raise exception 'Changed by % since you loaded it. Reload to see their version.',
              public.app_last_editor(entity, v_id) using errcode = 'DGKCF';
          end if;
          raise exception 'You don''t have permission to change this item.' using errcode = '42501';
        end if;
      end if;
    exception when others then
      ok := false;
      error_code := public.app_bulk_error_code(sqlstate);
      message := public.app_bulk_error_message(sqlstate, sqlerrm);
    end;
    return next;
  end loop;
end;
$$;

-- ── bulk_purge ─────────────────────────────────────────────────────────
-- Staff only, items must already be in Trash. message = the storage_path the caller should remove
-- from the outbound-assets bucket (assets and templates), else null.

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

-- ── accept_invite ──────────────────────────────────────────────────────
-- Called by the app after every sign-in. Accepts each pending, unexpired invite for the caller's email:
-- creates or raises the profile (never lowers an org_role) and adds the space membership.
-- One row per invite handled (id = invite id); no rows when nothing is pending.

create or replace function public.accept_invite()
returns table (id uuid, ok boolean, error_code text, message text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_user record;
  v_invite record;
begin
  if v_uid is null then
    id := null; ok := false; error_code := 'permission'; message := 'Sign in first.';
    return next;
    return;
  end if;
  select u.email, u.raw_user_meta_data into v_user from auth.users u where u.id = v_uid;
  if v_user.email is null then
    return;
  end if;

  for v_invite in
    select i.* from public.invites i
    where lower(i.email) = lower(v_user.email)
      and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    order by i.created_at
  loop
    id := v_invite.id; ok := true; error_code := null; message := null;
    begin
      insert into public.profiles (user_id, email, display_name, org_role)
      values (
        v_uid, v_user.email,
        nullif(btrim(coalesce(v_user.raw_user_meta_data->>'full_name', v_user.raw_user_meta_data->>'name', '')), ''),
        v_invite.org_role)
      on conflict (user_id) do update
        set email = excluded.email,
            org_role = case
              when array_position(array['client', 'team', 'owner'], excluded.org_role)
                 > array_position(array['client', 'team', 'owner'], profiles.org_role)
              then excluded.org_role else profiles.org_role end;

      if v_invite.org_role = 'client' then
        insert into public.space_members (space_id, user_id, role)
        values (v_invite.space_id, v_uid, v_invite.role)
        on conflict (space_id, user_id) do update set role = excluded.role;
      end if;

      update public.invites set accepted_at = now() where invites.id = v_invite.id;
      message := v_invite.org_role;
    exception when others then
      ok := false;
      error_code := public.app_bulk_error_code(sqlstate);
      message := public.app_bulk_error_message(sqlstate, sqlerrm);
    end;
    return next;
  end loop;
end;
$$;

-- ── Grants ─────────────────────────────────────────────────────────────

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.app_bulk_table(text)',
    'public.app_bulk_error_code(text)',
    'public.app_bulk_error_message(text, text)',
    'public.app_bulk_reject(uuid[], text, text)',
    'public.app_bulk_ids(uuid[])',
    'public.app_bulk_row(text, uuid)',
    'public.app_last_editor(text, uuid)',
    'public.app_push_history(jsonb, text, integer)',
    'public.app_merge_tags(text[], text[], text[])',
    'public.app_tag_list(jsonb)',
    'public.bulk_trash(text, uuid[])',
    'public.bulk_restore(text, uuid[])',
    'public.bulk_move(text, uuid[], uuid, uuid)',
    'public.bulk_update_campaigns(uuid[], jsonb)',
    'public.bulk_rename(text, jsonb)',
    'public.bulk_purge(text, uuid[])',
    'public.accept_invite()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$$;
