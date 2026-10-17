-- Deleting a login keeps the work: user_id goes null, nothing is deleted.

do $$
declare
  v_campaigns bigint := (select count(*) from public.outbound_campaigns);
  v_assets bigint := (select count(*) from public.outbound_assets);
  v_folders bigint := (select count(*) from public.outbound_folders);
  v_templates bigint := (select count(*) from public.outbound_templates);
  v_creator uuid := (select user_id from public.outbound_campaigns where id = tests.c(3));
begin
  perform tests.ok(v_creator is not null, 'removed user: seeded campaign has a creator');
  delete from auth.users where id = v_creator;
  perform tests.eq((select count(*) from public.outbound_campaigns), v_campaigns, 'removed user: no campaign deleted');
  perform tests.eq((select count(*) from public.outbound_assets), v_assets, 'removed user: no file deleted');
  perform tests.eq((select count(*) from public.outbound_folders), v_folders, 'removed user: no folder deleted');
  perform tests.eq((select count(*) from public.outbound_templates), v_templates, 'removed user: no template deleted');
  perform tests.eq((select user_id from public.outbound_campaigns where id = tests.c(3)), null::uuid, 'removed user: creator cleared');
end
$$;
