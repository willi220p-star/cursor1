-- bulk_* RPCs: per-item results, mixed batches, limits, conflicts, trash → restore → purge.

-- ── bulk_trash: mixed batch as the Acme manager ────────────────────────
begin;
select tests.login(tests.cm_acme());
create temp table res as
  select * from public.bulk_trash('asset', array[
    tests.a(1), tests.a(4), '99999999-0000-0000-0000-000000000000'::uuid, tests.a(1), tests.a(2)]);
do $$
begin
  perform tests.eq((select array_agg(id) from res), array[tests.a(1), tests.a(4), '99999999-0000-0000-0000-000000000000'::uuid, tests.a(2)],
    'bulk_trash: one row per distinct id, in order');
  perform tests.eq((select ok from res where id = tests.a(1)), true, 'bulk_trash: own-space item trashed');
  perform tests.eq((select error_code from res where id = tests.a(4)), 'not_found', 'bulk_trash: other-space item reads as not_found');
  perform tests.eq((select error_code from res where id = '99999999-0000-0000-0000-000000000000'), 'not_found', 'bulk_trash: missing id is not_found');
  perform tests.ok((select deleted_at is not null and deleted_by = tests.cm_acme() from public.outbound_assets where id = tests.a(1)),
    'bulk_trash: deleted_at and deleted_by set');
  perform tests.eq((select deleted_at from public.outbound_assets where id = tests.a(4)), null::timestamptz, 'bulk_trash: failed item untouched');
  perform tests.eq((select message from public.bulk_trash('asset', array[tests.a(1)])), 'Already in Trash.', 'bulk_trash: trashing twice is ok');
end
$$;
rollback;

begin;
select tests.login(tests.cv_acme());
do $$
begin
  perform tests.eq((select error_code from public.bulk_trash('asset', array[tests.a(1)])), 'permission',
    'bulk_trash: viewer gets permission for a visible item');
  perform tests.eq((select deleted_at from public.outbound_assets where id = tests.a(1)), null::timestamptz, 'bulk_trash: viewer changed nothing');
end
$$;
rollback;

begin;
select tests.login(tests.owner());
do $$
declare
  v_ids uuid[] := array(select gen_random_uuid() from generate_series(1, 201));
begin
  perform tests.eq((select count(*) from public.bulk_trash('asset', v_ids) where error_code = 'validation'), 201::bigint,
    'bulk_*: more than 200 ids → validation for every id');
  perform tests.eq((select count(*) from public.bulk_trash('asset', v_ids[1:200]) where error_code = 'not_found'), 200::bigint,
    'bulk_*: exactly 200 ids are processed');
  perform tests.eq((select error_code from public.bulk_trash('widget', array[tests.a(1)])), 'validation', 'bulk_*: unknown entity → validation');
  perform tests.eq((select count(*) from public.bulk_trash('asset', '{}')), 0::bigint, 'bulk_*: empty list → no rows');
end
$$;
rollback;

-- ── bulk_restore: back into Root when the folder is gone ───────────────
begin;
select tests.login(tests.team());
do $$
declare
  r record;
begin
  perform public.bulk_trash('asset', array[tests.a(1), tests.a(2)]);
  perform public.bulk_trash('folder', array[tests.f(1)]);
  select * into r from public.bulk_restore('asset', array[tests.a(1)]);
  perform tests.ok(r.ok and r.message like 'Restored to Root%', 'bulk_restore: folder in Trash → restored to Root');
  perform tests.eq((select folder_id from public.outbound_assets where id = tests.a(1)), null::uuid, 'bulk_restore: folder_id cleared');
  perform public.bulk_restore('folder', array[tests.f(1)]);
  select * into r from public.bulk_restore('asset', array[tests.a(2)]);
  perform tests.ok(r.ok and r.message is null, 'bulk_restore: folder back → item keeps its folder');
  perform tests.eq((select folder_id from public.outbound_assets where id = tests.a(2)), tests.f(1), 'bulk_restore: folder_id kept');
  perform tests.eq((select message from public.bulk_restore('asset', array[tests.a(3)])), 'Not in Trash.', 'bulk_restore: not in Trash is ok');

  -- Restoring a folder whose name was taken meanwhile → validation.
  perform public.bulk_trash('folder', array[tests.f(2)]);
  insert into public.outbound_folders (user_id, name, space_id) values (auth.uid(), 'Empty', tests.space('Internal (DGK)'));
  select * into r from public.bulk_restore('folder', array[tests.f(2)]);
  perform tests.ok(not r.ok and r.error_code = 'validation', 'bulk_restore: folder name clash → validation');
end
$$;
rollback;

-- Client manager restores in own space; mixed with another space's id.
begin;
select tests.login(tests.cm_acme());
do $$
begin
  perform public.bulk_trash('campaign', array[tests.c(2)]);
  perform tests.eq((select array_agg(coalesce(error_code, 'ok') order by error_code nulls first)
                    from public.bulk_restore('campaign', array[tests.c(2), tests.c(3)])),
    array['ok', 'not_found'], 'bulk_restore: client manager restores own, other space not_found');
end
$$;
rollback;

-- ── bulk_move ──────────────────────────────────────────────────────────
begin;
select tests.login(tests.cm_acme());
do $$
declare
  v_acme uuid := tests.space('acme');
begin
  perform tests.eq((select ok from public.bulk_move('asset', array[tests.a(2)], null, null)), true, 'bulk_move: to Root');
  perform tests.eq((select folder_id from public.outbound_assets where id = tests.a(2)), null::uuid, 'bulk_move: folder cleared');
  perform tests.eq((select array_agg(coalesce(error_code, 'ok')) from public.bulk_move('asset', array[tests.a(2), tests.a(4)], tests.f(4), null)),
    array['ok', 'not_found'], 'bulk_move: into own folder ok, other space item not_found');
  perform tests.eq((select folder_id from public.outbound_assets where id = tests.a(2)), tests.f(4), 'bulk_move: folder set');
  perform tests.eq((select error_code from public.bulk_move('campaign', array[tests.c(1)], null, tests.space('Beta Co'))), 'not_found',
    'bulk_move: invisible target space → not_found');
  perform tests.eq((select error_code from public.bulk_move('campaign', array[tests.c(1)], tests.f(3), null)), 'not_found',
    'bulk_move: invisible target folder → not_found');
end
$$;
rollback;

begin;
select tests.login(tests.cv_acme());
do $$
begin
  perform tests.eq((select error_code from public.bulk_move('asset', array[tests.a(2)], null, null)), 'permission',
    'bulk_move: viewer → permission');
  perform tests.eq((select error_code from public.bulk_move('asset', array[tests.a(2)], null, tests.space('acme'))), 'permission',
    'bulk_move: viewer cannot target own space');
end
$$;
rollback;

begin;
select tests.login(tests.team());
do $$
declare
  v_acme uuid := tests.space('acme');
  v_beta uuid := tests.space('Beta Co');
  v_internal uuid := tests.space('Internal (DGK)');
begin
  -- Campaign to another space: its assets follow and leave folders of the old space.
  perform tests.eq((select ok from public.bulk_move('campaign', array[tests.c(2)], null, v_beta)), true, 'bulk_move: campaign to client space');
  perform tests.eq((select space_id from public.outbound_campaigns where id = tests.c(2)), v_beta, 'bulk_move: campaign space set');
  perform tests.eq((select (space_id, folder_id)::text from public.outbound_assets where id = tests.a(2)), (v_beta, null::uuid)::text,
    'bulk_move: asset followed its campaign and left the Acme folder');

  perform tests.eq((select error_code from public.bulk_move('campaign', array[tests.c(1)], tests.f(1), v_beta)), 'validation',
    'bulk_move: folder and space disagree → validation');
  perform tests.eq((select error_code from public.bulk_move('template', array[tests.t(1)], tests.f(1), null)), 'validation',
    'bulk_move: templates stay in Internal');
  perform tests.eq((select ok from public.bulk_move('template', array[tests.t(2)], tests.f(2), null)), true, 'bulk_move: template into Internal folder');
  perform tests.eq((select error_code from public.bulk_move('folder', array[tests.f(3)], null, v_acme)), 'validation',
    'bulk_move: folder holding templates cannot leave Internal');
  perform tests.eq((select error_code from public.bulk_move('folder', array[tests.f(1)], tests.f(2), null)), 'validation',
    'bulk_move: no folders inside folders');

  -- Folder to another space takes its contents.
  perform tests.eq((select ok from public.bulk_move('folder', array[tests.f(1)], null, v_beta)), true, 'bulk_move: folder to another space');
  perform tests.eq((select space_id from public.outbound_campaigns where id = tests.c(1)), v_beta, 'bulk_move: folder''s campaign moved along');
  perform tests.eq((select space_id from public.outbound_assets where id = tests.a(1)), v_beta, 'bulk_move: campaign''s asset moved along');

  perform public.bulk_trash('folder', array[tests.f(2)]);
  perform tests.eq((select error_code from public.bulk_move('asset', array[tests.a(3)], tests.f(2), null)), 'validation',
    'bulk_move: target folder in Trash → validation');
  perform public.bulk_trash('asset', array[tests.a(6)]);
  perform tests.eq((select error_code from public.bulk_move('asset', array[tests.a(6)], null, null)), 'validation',
    'bulk_move: item in Trash → validation');
end
$$;
rollback;

-- ── bulk_update_campaigns ──────────────────────────────────────────────
begin;
select tests.login(tests.cm_acme());
do $$
declare
  v_history jsonb;
  r record;
begin
  perform tests.eq((select array_agg(coalesce(error_code, 'ok')) from public.bulk_update_campaigns(
      array[tests.c(1), tests.c(3), tests.c(2)], '{"status": "exported", "tags_add": ["q4", "vip"]}')),
    array['ok', 'not_found', 'ok'], 'bulk_update_campaigns: mixed batch');
  v_history := (select config->'history' from public.outbound_campaigns where id = tests.c(1));
  perform tests.eq(jsonb_array_length(v_history), 50, 'bulk_update_campaigns: history keeps the newest 50');
  perform tests.eq(v_history->-1->>'kind', 'exported', 'bulk_update_campaigns: status event appended last');
  perform tests.eq((v_history->-1->>'rows')::int, 3, 'bulk_update_campaigns: rows = list size');
  perform tests.ok(v_history->-1->>'at' ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$', 'bulk_update_campaigns: ISO timestamp like toISOString()');
  perform tests.ok(not exists (select 1 from jsonb_array_elements(v_history) e where not e ? 'kind'), 'bulk_update_campaigns: malformed entries dropped');
  perform tests.eq((select config->>'client' from public.outbound_campaigns where id = tests.c(1)), 'Acme', 'bulk_update_campaigns: rest of config kept');
  perform tests.eq((select tags from public.outbound_campaigns where id = tests.c(2)), array['q4', 'vip'], 'bulk_update_campaigns: tags added');

  perform public.bulk_update_campaigns(array[tests.c(2)], '{"tags_add": ["vip", "new"], "tags_remove": ["q4"]}');
  perform tests.eq((select tags from public.outbound_campaigns where id = tests.c(2)), array['vip', 'new'],
    'bulk_update_campaigns: tags_add dedupes, tags_remove removes');
  perform tests.eq((select jsonb_array_length(config->'history') from public.outbound_campaigns where id = tests.c(2)), 1,
    'bulk_update_campaigns: a tags-only patch adds no history event');

  perform tests.eq((select error_code from public.bulk_update_campaigns(array[tests.c(1)], '{"status": "draft"}')), 'validation',
    'bulk_update_campaigns: unknown status → validation');
  perform tests.eq((select error_code from public.bulk_update_campaigns(array[tests.c(1)], '{"colour": "red"}')), 'validation',
    'bulk_update_campaigns: unknown field → validation');
  perform tests.eq((select error_code from public.bulk_update_campaigns(array[tests.c(1)], '{"tags_add": [""]}')), 'validation',
    'bulk_update_campaigns: empty tag → validation');
end
$$;
rollback;

begin;
select tests.login(tests.cv_acme());
do $$
begin
  perform tests.eq((select error_code from public.bulk_update_campaigns(array[tests.c(1)], '{"tags_add": ["x"]}')), 'permission',
    'bulk_update_campaigns: viewer → permission');
end
$$;
rollback;

-- ── bulk_rename: conflict protection ───────────────────────────────────
begin;
select tests.login(tests.team());
update public.profiles set display_name = 'Tess Team' where user_id = tests.team();
-- Team renames campaign 1 (version 1 → 2) …
select * from public.bulk_rename('campaign', jsonb_build_array(jsonb_build_object('id', tests.c(1), 'name', 'Acme launch v2', 'version', 1)));
-- … then the Acme manager renames with the stale version 1.
select tests.login(tests.cm_acme());
do $$
declare
  r record;
begin
  select * into r from public.bulk_rename('campaign', jsonb_build_array(
    jsonb_build_object('id', tests.c(1), 'name', 'Stale', 'version', 1)));
  perform tests.eq(r.error_code, 'conflict', 'bulk_rename: stale version → conflict');
  perform tests.ok(r.message like 'Changed by Tess Team at %', 'bulk_rename: conflict names the last editor (' || r.message || ')');
  perform tests.eq((select name from public.outbound_campaigns where id = tests.c(1)), 'Acme launch v2', 'bulk_rename: conflict changes nothing');

  select * into r from public.bulk_rename('campaign', jsonb_build_array(
    jsonb_build_object('id', tests.c(1), 'name', '  Acme launch v3 ', 'version', 2)));
  perform tests.ok(r.ok, 'bulk_rename: current version → ok');
  perform tests.eq((select (name, version)::text from public.outbound_campaigns where id = tests.c(1)), ('Acme launch v3', 3)::text,
    'bulk_rename: name trimmed, version bumped');

  perform tests.eq((select array_agg(coalesce(error_code, 'ok')) from public.bulk_rename('asset', jsonb_build_array(
      jsonb_build_object('id', tests.a(1), 'name', 'one.png'),
      jsonb_build_object('id', tests.a(4), 'name', 'two.png'),
      jsonb_build_object('id', tests.a(2), 'name', '   '),
      jsonb_build_object('name', 'no id')))),
    array['ok', 'not_found', 'validation', 'validation'], 'bulk_rename: mixed batch (ok, other space, blank name, no id)');
  perform tests.eq((select filename from public.outbound_assets where id = tests.a(1)), 'one.png', 'bulk_rename: assets rename filename');

  perform tests.eq((select error_code from public.bulk_rename('folder', jsonb_build_array(
      jsonb_build_object('id', tests.f(4), 'name', 'SHARED')))), 'validation', 'bulk_rename: duplicate folder name in a space → validation');
end
$$;
rollback;

begin;
select tests.login(tests.cv_acme());
do $$
begin
  perform tests.eq((select error_code from public.bulk_rename('campaign', jsonb_build_array(jsonb_build_object('id', tests.c(1), 'name', 'x')))),
    'permission', 'bulk_rename: viewer → permission');
end
$$;
rollback;

-- ── Trash → restore → purge ────────────────────────────────────────────
begin;
select tests.login(tests.cm_acme());
do $$
begin
  perform tests.eq((select ok from public.bulk_trash('asset', array[tests.a(1)])), true, 'flow: manager trashes');
  perform tests.eq((select ok from public.bulk_restore('asset', array[tests.a(1)])), true, 'flow: manager restores');
  perform tests.eq((select ok from public.bulk_trash('asset', array[tests.a(1)])), true, 'flow: manager trashes again');
  perform tests.eq((select error_code from public.bulk_purge('asset', array[tests.a(1)])), 'permission', 'flow: manager cannot purge');
end
$$;
select tests.login(tests.team());
do $$
declare
  v_before bigint := (select count(*) from public.activity_log where action = 'purged');
begin
  perform tests.eq((select array_agg(coalesce(error_code, 'ok') || ':' || coalesce(message, '')) from public.bulk_purge('asset',
      array[tests.a(1), tests.a(2), '99999999-0000-0000-0000-000000000000'::uuid])),
    array['ok:00000000-0000-0000-0000-0000000000a1/a1.png', 'validation:Move it to Trash first.', 'not_found:This item no longer exists.'],
    'bulk_purge: trashed → ok with storage path; not trashed → validation; missing → not_found');
  perform tests.eq((select count(*) from public.outbound_assets where id = tests.a(1)), 0::bigint, 'bulk_purge: row deleted');
  perform tests.eq((select count(*) from public.activity_log where action = 'purged') - v_before, 1::bigint, 'bulk_purge: purged activity written');

  perform public.bulk_trash('campaign', array[tests.c(2)]);
  perform tests.eq((select (ok, message)::text from public.bulk_purge('campaign', array[tests.c(2)])), (true, null::text)::text,
    'bulk_purge: campaign purge has no storage path');
  perform tests.eq((select campaign_id from public.outbound_assets where id = tests.a(2)), null::uuid, 'bulk_purge: campaign''s assets stay, unlinked');
  perform public.bulk_trash('template', array[tests.t(1)]);
  perform tests.eq((select message from public.bulk_purge('template', array[tests.t(1)])), '00000000-0000-0000-0000-0000000000a1/t1.png',
    'bulk_purge: template returns its storage path');
end
$$;
rollback;
