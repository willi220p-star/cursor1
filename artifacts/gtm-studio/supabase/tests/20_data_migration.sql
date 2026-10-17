-- Data migration on the seeded legacy rows (run as postgres, no RLS).

do $$
declare
  v_internal uuid := tests.space('Internal (DGK)');
  v_acme uuid := tests.space('acme');
  v_beta uuid := tests.space('Beta Co');
begin
  perform tests.eq((select count(*) from public.spaces), 3::bigint, 'migration: Internal + one space per distinct client label');
  perform tests.eq((select kind from public.spaces where id = v_internal), 'internal', 'migration: Internal space is kind internal');
  perform tests.ok(v_acme is not null and (select kind from public.spaces where id = v_acme) = 'client',
    'migration: "Acme", "  acme  " and "ACME" share one client space');
  perform tests.ok(v_beta is not null, 'migration: "Beta   Co" is cleaned to "Beta Co"');

  perform tests.eq((select array_agg(id order by id) from public.outbound_campaigns where space_id = v_acme),
    array[tests.c(1), tests.c(2), tests.c(6)], 'migration: labelled Acme campaigns (both operators) land in Acme');
  perform tests.eq((select space_id from public.outbound_campaigns where id = tests.c(3)), v_beta, 'migration: Beta campaign in Beta');
  perform tests.eq((select array_agg(id order by id) from public.outbound_campaigns where space_id = v_internal),
    array[tests.c(4), tests.c(5)], 'migration: unlabelled and blank-label campaigns land in Internal');

  perform tests.eq((select array_agg(id order by id) from public.outbound_assets where space_id = v_acme),
    array[tests.a(1), tests.a(2), tests.a(7)], 'migration: assets follow their campaign');
  perform tests.eq((select space_id from public.outbound_assets where id = tests.a(4)), v_beta, 'migration: Beta asset follows campaign');
  perform tests.eq((select array_agg(id order by id) from public.outbound_assets where space_id = v_internal),
    array[tests.a(3), tests.a(5), tests.a(6)], 'migration: loose assets and Internal campaign assets land in Internal');

  perform tests.eq((select space_id from public.outbound_folders where id = tests.f(1)), v_acme, 'migration: folder goes to its majority space');
  perform tests.eq((select space_id from public.outbound_folders where id = tests.f(2)), v_internal, 'migration: empty folder goes to Internal');
  perform tests.eq((select space_id from public.outbound_folders where id = tests.f(3)), v_internal, 'migration: tie (template vs Beta campaign) prefers Internal');
  perform tests.eq((select space_id from public.outbound_folders where id = tests.f(4)), v_acme, 'migration: op2 folder goes to Acme');
  perform tests.eq((select folder_id from public.outbound_assets where id = tests.a(3)), null::uuid, 'migration: minority item leaves the folder for Root');
  perform tests.eq((select folder_id from public.outbound_campaigns where id = tests.c(3)), null::uuid, 'migration: Beta campaign leaves the Internal folder');
  perform tests.eq((select folder_id from public.outbound_campaigns where id = tests.c(1)), tests.f(1), 'migration: majority item keeps its folder');
  perform tests.eq((select folder_id from public.outbound_templates where id = tests.t(1)), tests.f(3), 'migration: template keeps its Internal folder');
  perform tests.eq((select name from public.outbound_folders where id = tests.f(1)), 'Shared', 'migration: older folder keeps its name');
  perform tests.eq((select name from public.outbound_folders where id = tests.f(4)), 'shared (2)', 'migration: folder name clash in one space gets a suffix');

  perform tests.eq((select count(*) from public.profiles), 2::bigint, 'migration: only users with rows get profiles');
  perform tests.eq((select array_agg(org_role order by user_id) from public.profiles), array['owner', 'owner'], 'migration: existing operators are Owners');
  perform tests.eq((select email from public.profiles where user_id = tests.owner()), 'owner@dgk.test', 'migration: profile email copied');

  perform tests.ok((select bool_and(attnotnull) from pg_attribute
                    where attname = 'space_id' and attrelid in ('public.outbound_campaigns'::regclass,
                      'public.outbound_assets'::regclass, 'public.outbound_folders'::regclass)),
    'migration: space_id is not null');
  perform tests.ok((select bool_and(version = 1 and deleted_at is null) from public.outbound_campaigns), 'migration: version 1, nothing in Trash');
  perform tests.eq((select tags from public.outbound_campaigns where id = tests.c(1)), '{}'::text[], 'migration: tags default empty');
  perform tests.ok(not exists (select 1 from pg_proc where proname = 'library_folder_same_owner'), 'migration: owner folder rule removed');
  perform tests.eq((select count(*) from pg_publication_tables where pubname = 'supabase_realtime'
                    and tablename in ('notifications', 'reviews', 'comments')), 3::bigint, 'migration: realtime publication has reviews/comments/notifications');
  perform tests.eq((select count(*) from public.activity_log), 0::bigint, 'migration: data migration writes no activity');
end
$$;
