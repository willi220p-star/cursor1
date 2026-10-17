-- Legacy rows as they exist before team spaces: everything keyed by user_id, client label in config.
-- Users (fixed ids so tests can name them):
--   a1 op1 / a2 op2 (existing operators with rows), b1 team, c1 Acme manager, c2 Acme viewer,
--   c3 Beta manager, d1 nobody (expired invite only).

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@dgk.test', '{"full_name": "Olive Owner"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'op2@dgk.test', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', 'team@dgk.test', '{"full_name": "Tess Team"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'manager@acme.test', '{"full_name": "Mia Manager"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'viewer@acme.test', '{"full_name": "Vic Viewer"}'),
  ('00000000-0000-0000-0000-0000000000c3', 'manager@beta.test', '{}'),
  ('00000000-0000-0000-0000-0000000000d1', 'nobody@else.test', '{}');

insert into public.outbound_folders (id, user_id, name, created_at) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Shared', '2026-01-01'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'Empty', '2026-01-02'),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'Templates', '2026-01-03'),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a2', 'shared', '2026-02-01');

-- c1 carries 50 history events plus a malformed one (the status RPC must keep the newest 50).
insert into public.outbound_campaigns (id, user_id, name, mode, config, source_data, folder_id) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Acme launch', 'handwritten',
   jsonb_build_object('client', 'Acme', 'history',
     (select jsonb_agg(jsonb_build_object('at', '2026-09-01T00:00:00.000Z', 'kind', 'generated', 'rows', 3)) from generate_series(1, 50))
     || '[{"bad": true}]'::jsonb),
   '[{"name":"a"},{"name":"b"},{"name":"c"}]', '20000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'Acme follow-up', 'memes',
   '{"client": "  acme  "}', '[]', null),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'Beta intro', 'gif',
   '{"client": "Beta   Co"}', '[]', '20000000-0000-0000-0000-000000000003'),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1', 'Internal test', 'handwritten',
   '{}', '[]', null),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a1', 'Blank client', 'handwritten',
   '{"client": "   "}', '[]', null),
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000a2', 'Acme by op2', 'avatar',
   '{"client": "ACME"}', '[]', '20000000-0000-0000-0000-000000000004');

insert into public.outbound_assets (id, user_id, campaign_id, filename, storage_path, public_url, folder_id) values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001',
   'a1.png', '00000000-0000-0000-0000-0000000000a1/a1.png', 'https://x/a1.png', '20000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000002',
   'a2.png', '00000000-0000-0000-0000-0000000000a1/a2.png', 'https://x/a2.png', '20000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', null,
   'a3.png', '00000000-0000-0000-0000-0000000000a1/a3.png', 'https://x/a3.png', '20000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000003',
   'a4.png', '00000000-0000-0000-0000-0000000000a1/a4.png', 'https://x/a4.png', null),
  ('30000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000004',
   'a5.png', '00000000-0000-0000-0000-0000000000a1/a5.png', 'https://x/a5.png', null),
  ('30000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000a1', null,
   'a6.png', '00000000-0000-0000-0000-0000000000a1/a6.png', 'https://x/a6.png', null),
  ('30000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000006',
   'a7.png', '00000000-0000-0000-0000-0000000000a2/a7.png', 'https://x/a7.png', null);

insert into public.outbound_templates (id, user_id, name, mode, storage_path, folder_id) values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Card front', 'handwritten',
   '00000000-0000-0000-0000-0000000000a1/t1.png', '20000000-0000-0000-0000-000000000003'),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'Meme base', 'memes', null, null);

insert into storage.objects (bucket_id, name, owner)
select 'outbound-assets', storage_path, user_id from public.outbound_assets
union all
select 'outbound-assets', storage_path, user_id from public.outbound_templates where storage_path is not null;
