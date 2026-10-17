-- STEP 3 of 4. Run after step 2. Every row below should say ok = true.

select 'every campaign is in a space' as check, not exists (select 1 from public.outbound_campaigns where space_id is null) as ok
union all select 'every file is in a space', not exists (select 1 from public.outbound_assets where space_id is null)
union all select 'every folder is in a space', not exists (select 1 from public.outbound_folders where space_id is null)
union all select 'campaign count unchanged', (select count(*) from public.outbound_campaigns) = (select count(*) from backup_before_spaces.outbound_campaigns)
union all select 'file count unchanged', (select count(*) from public.outbound_assets) = (select count(*) from backup_before_spaces.outbound_assets)
union all select 'folder count unchanged', (select count(*) from public.outbound_folders) = (select count(*) from backup_before_spaces.outbound_folders)
union all select 'template count unchanged', (select count(*) from public.outbound_templates) = (select count(*) from backup_before_spaces.outbound_templates)
union all select 'you are an Owner', exists (select 1 from public.profiles where org_role = 'owner')
union all select 'Internal space exists', exists (select 1 from public.spaces where kind = 'internal');

-- And the spaces it created, with how many campaigns each holds:
select s.name, s.kind, count(c.id) as campaigns
from public.spaces s left join public.outbound_campaigns c on c.space_id = s.id
group by s.id order by s.kind, s.name;

-- The people who are Owners. Change anyone who should not be:
--   update public.profiles set org_role = 'client' where email = 'someone@example.com';
select email, org_role from public.profiles order by org_role, email;
