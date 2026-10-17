-- Reverses 202610170001_spaces_and_profiles.sql. Run after the later rollbacks (they drop the
-- policies and columns that depend on these tables and helpers).

drop table if exists public.invites;
drop table if exists public.space_members;
drop table if exists public.spaces;
drop table if exists public.profiles;

drop function if exists public.space_members_client_only();
drop function if exists public.profiles_guard_org_role();
drop function if exists public.app_is_client_manager();
drop function if exists public.app_can_edit_space(uuid);
drop function if exists public.app_can_view_space(uuid);
drop function if exists public.app_is_owner();
drop function if exists public.app_is_staff();
drop function if exists public.app_org_role();
