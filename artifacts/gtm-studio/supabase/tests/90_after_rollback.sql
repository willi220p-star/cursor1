-- After every rollback: the pre-spaces schema is back and behaves as before (self-contained, rolled back).

do $$
begin
  perform tests.ok(to_regclass('public.profiles') is null and to_regclass('public.spaces') is null
    and to_regclass('public.space_members') is null and to_regclass('public.invites') is null
    and to_regclass('public.activity_log') is null and to_regclass('public.reviews') is null
    and to_regclass('public.comments') is null and to_regclass('public.notifications') is null,
    'rollback: new tables dropped');
  perform tests.ok(not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('outbound_campaigns', 'outbound_assets', 'outbound_folders', 'outbound_templates')
      and column_name in ('space_id', 'version', 'deleted_at', 'deleted_by', 'tags')),
    'rollback: new columns dropped');
  perform tests.ok(not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name in ('outbound_assets', 'outbound_folders') and column_name = 'updated_at'),
    'rollback: added updated_at columns dropped');
  perform tests.ok(exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'outbound_campaigns' and column_name = 'updated_at'),
    'rollback: original updated_at kept');
  perform tests.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'app\_%' or p.proname like 'bulk\_%' or p.proname = 'accept_invite')),
    'rollback: helper functions and RPCs dropped');
  perform tests.eq((select array_agg(policyname::text order by policyname) from pg_policies where schemaname = 'public'
                    and tablename in ('outbound_campaigns', 'outbound_assets', 'outbound_folders', 'outbound_templates')),
    array['asset owners manage assets', 'campaign owners manage campaigns', 'folder owners manage folders', 'template owners manage templates'],
    'rollback: original owner-only policies restored');
  perform tests.eq((select array_agg(policyname::text order by policyname) from pg_policies where schemaname = 'storage'),
    array['public reads outbound assets', 'users delete outbound assets', 'users update outbound assets', 'users upload outbound assets'],
    'rollback: original storage policies only');
  perform tests.eq((select count(*) from pg_trigger where tgname like '%folder_owner'), 3::bigint, 'rollback: owner folder rule triggers restored');
  perform tests.ok(exists (select 1 from pg_indexes where indexname = 'outbound_folders_user_lower_name'), 'rollback: per-operator folder name index restored');
  perform tests.eq((select count(*) from pg_publication_tables where pubname = 'supabase_realtime'
                    and tablename in ('notifications', 'reviews', 'comments')), 0::bigint, 'rollback: realtime publication cleaned');
end
$$;

begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'r1@test'), ('00000000-0000-0000-0000-0000000000e2', 'r2@test')
on conflict (id) do nothing;
insert into public.outbound_folders (id, user_id, name)
values ('20000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e2', 'Theirs');
select tests.login('00000000-0000-0000-0000-0000000000e1');
do $$
declare
  v_id uuid;
begin
  insert into public.outbound_campaigns (user_id, name, mode) values (auth.uid(), 'After rollback', 'handwritten') returning id into v_id;
  perform tests.eq(tests.affected(format('update public.outbound_campaigns set name = %L where id = %L', 'Renamed', v_id)), 1,
    'rollback: owner can still save and rename campaigns');
  perform tests.eq(tests.count('select 1 from public.outbound_folders'), 0::bigint, 'rollback: other operators'' folders hidden again');
  perform tests.throws(format('update public.outbound_campaigns set folder_id = %L where id = %L', '20000000-0000-0000-0000-0000000000e2', v_id),
    '23514', 'rollback: folder must belong to the same operator again');
  perform tests.throws($q$insert into public.outbound_campaigns (user_id, name, mode) values ('00000000-0000-0000-0000-0000000000e2', 'x', 'gif')$q$,
    '42501', 'rollback: cannot write rows for another operator');
  perform tests.throws($q$insert into storage.objects (bucket_id, name) values ('outbound-assets', 'spaces/00000000-0000-0000-0000-000000000000/x.png')$q$,
    '42501', 'rollback: spaces/ upload policy gone');
  insert into storage.objects (bucket_id, name) values ('outbound-assets', auth.uid() || '/legacy.png');
  perform tests.ok(true, 'rollback: legacy <user_id>/ upload still works');
end
$$;
rollback;
