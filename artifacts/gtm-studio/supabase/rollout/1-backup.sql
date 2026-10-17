-- STEP 1 of 4. Run this first in the Supabase SQL editor. It copies your library tables into a
-- separate schema called backup_before_spaces. Nothing is changed or deleted.
-- To go back: see ROLLOUT.md ("If something looks wrong").

create schema if not exists backup_before_spaces;
create table backup_before_spaces.outbound_campaigns as select * from public.outbound_campaigns;
create table backup_before_spaces.outbound_templates as select * from public.outbound_templates;
create table backup_before_spaces.outbound_assets as select * from public.outbound_assets;
create table backup_before_spaces.outbound_folders as select * from public.outbound_folders;
create table backup_before_spaces.outbound_copy_templates as select * from public.outbound_copy_templates;

select 'campaigns' as what, count(*) from backup_before_spaces.outbound_campaigns
union all select 'templates', count(*) from backup_before_spaces.outbound_templates
union all select 'files', count(*) from backup_before_spaces.outbound_assets
union all select 'folders', count(*) from backup_before_spaces.outbound_folders
union all select 'copy templates', count(*) from backup_before_spaces.outbound_copy_templates;
