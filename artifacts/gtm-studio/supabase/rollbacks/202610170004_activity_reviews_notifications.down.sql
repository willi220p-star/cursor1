-- Reverses 202610170004_activity_reviews_notifications.sql. Activity, reviews, comments and
-- notifications are dropped (export them first if they matter).

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['notifications', 'reviews', 'comments'] loop
      if exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime drop table public.%I', t);
      end if;
    end loop;
  end if;
end
$$;

drop trigger if exists log_activity on public.outbound_campaigns;
drop trigger if exists log_activity on public.outbound_templates;
drop trigger if exists log_activity on public.outbound_assets;
drop trigger if exists log_activity on public.outbound_folders;
drop trigger if exists log_activity on public.space_members;
drop trigger if exists log_activity on public.invites;

drop table if exists public.notifications;
drop table if exists public.comments;
drop table if exists public.reviews;
drop table if exists public.activity_log;

drop function if exists public.notify_review_activity();
drop function if exists public.log_review_activity();
drop function if exists public.log_invite_activity();
drop function if exists public.log_member_activity();
drop function if exists public.log_library_activity();
drop function if exists public.comment_guard_update();
drop function if exists public.review_fill_space();
