-- Activity log (written only by triggers), reviews, comments and in-app notifications.
-- Reversed by supabase/rollbacks/202610170004_activity_reviews_notifications.down.sql.

-- ── Tables ─────────────────────────────────────────────────────────────

create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  space_id uuid references public.spaces(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null check (action in (
    'created', 'renamed', 'moved', 'updated', 'trashed', 'restored', 'purged', 'approved', 'rejected',
    'signed_off', 'commented', 'member_added', 'member_removed', 'role_changed', 'invited'
  )),
  details jsonb not null default '{}'::jsonb
);

create index if not exists activity_log_space_at on public.activity_log (space_id, at desc);
create index if not exists activity_log_at on public.activity_log (at desc);
create index if not exists activity_log_entity on public.activity_log (entity_type, entity_id, at desc);
create index if not exists activity_log_actor on public.activity_log (actor, at desc);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  campaign_id uuid not null references public.outbound_campaigns(id) on delete cascade,
  asset_id uuid references public.outbound_assets(id) on delete cascade,
  status text not null check (status in ('approved', 'changes_requested')),
  note text check (note is null or char_length(note) <= 4000),
  reviewer uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists reviews_campaign_asset_created on public.reviews (campaign_id, asset_id, created_at desc);
create index if not exists reviews_space on public.reviews (space_id);
create index if not exists reviews_asset on public.reviews (asset_id) where asset_id is not null;

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  campaign_id uuid not null references public.outbound_campaigns(id) on delete cascade,
  asset_id uuid references public.outbound_assets(id) on delete cascade,
  author uuid not null default auth.uid(),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index if not exists comments_campaign_asset_created on public.comments (campaign_id, asset_id, created_at);
create index if not exists comments_space on public.comments (space_id);
create index if not exists comments_asset on public.comments (asset_id) where asset_id is not null;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('approved', 'changes_requested', 'signed_off', 'commented', 'review_requested')),
  space_id uuid references public.spaces(id) on delete cascade,
  campaign_id uuid references public.outbound_campaigns(id) on delete cascade,
  asset_id uuid references public.outbound_assets(id) on delete cascade,
  actor uuid,
  summary text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists notifications_recipient_read on public.notifications (recipient, read_at);
create index if not exists notifications_recipient_created on public.notifications (recipient, created_at desc);
create index if not exists notifications_campaign on public.notifications (campaign_id);

-- ── Row level security ─────────────────────────────────────────────────

alter table public.activity_log enable row level security;
alter table public.reviews enable row level security;
alter table public.comments enable row level security;
alter table public.notifications enable row level security;

-- Activity: staff see all, client managers their own space (app_can_edit_space(null) is staff only).
drop policy if exists "activity read" on public.activity_log;
create policy "activity read" on public.activity_log for select to authenticated
  using ((select public.app_is_staff()) or public.app_can_edit_space(space_id));

drop policy if exists "reviews read" on public.reviews;
create policy "reviews read" on public.reviews for select to authenticated
  using ((select public.app_is_staff()) or public.app_can_view_space(space_id));

drop policy if exists "reviews insert" on public.reviews;
create policy "reviews insert" on public.reviews for insert to authenticated
  with check (reviewer = (select auth.uid()) and public.app_can_view_space(space_id));

drop policy if exists "comments read" on public.comments;
create policy "comments read" on public.comments for select to authenticated
  using ((select public.app_is_staff()) or public.app_can_view_space(space_id));

drop policy if exists "comments insert" on public.comments;
create policy "comments insert" on public.comments for insert to authenticated
  with check (author = (select auth.uid()) and public.app_can_view_space(space_id));

drop policy if exists "comments edit own" on public.comments;
create policy "comments edit own" on public.comments for update to authenticated
  using (author = (select auth.uid()))
  with check (author = (select auth.uid()));

drop policy if exists "comments delete own" on public.comments;
create policy "comments delete own" on public.comments for delete to authenticated
  using (author = (select auth.uid()));

drop policy if exists "notifications read" on public.notifications;
create policy "notifications read" on public.notifications for select to authenticated
  using (recipient = (select auth.uid()));

drop policy if exists "notifications mark read" on public.notifications;
create policy "notifications mark read" on public.notifications for update to authenticated
  using (recipient = (select auth.uid()))
  with check (recipient = (select auth.uid()));

drop policy if exists "notifications delete" on public.notifications;
create policy "notifications delete" on public.notifications for delete to authenticated
  using (recipient = (select auth.uid()));

revoke all on public.activity_log, public.reviews, public.comments, public.notifications from anon, authenticated;
grant select on public.activity_log to authenticated;
grant select, insert on public.reviews to authenticated;
grant select, insert, update (body, deleted_at), delete on public.comments to authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.activity_log, public.reviews, public.comments, public.notifications to service_role;

-- ── Review/comment integrity ───────────────────────────────────────────
-- space_id always comes from the campaign (never trusted from the client); the asset must belong to it;
-- the reviewer/author is the signed-in user.

create or replace function public.review_fill_space()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space uuid;
  v_row jsonb := to_jsonb(new);
begin
  select space_id into v_space from public.outbound_campaigns where id = new.campaign_id;
  if v_space is null then
    raise exception 'Campaign not found' using errcode = '23503';
  end if;
  if new.asset_id is not null and not exists (
    select 1 from public.outbound_assets where id = new.asset_id and campaign_id = new.campaign_id
  ) then
    raise exception 'That image is not part of this campaign' using errcode = '23514';
  end if;
  new.space_id := v_space;
  if auth.uid() is not null then
    if tg_table_name = 'reviews' then
      new.reviewer := auth.uid();
    else
      new.author := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.comment_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.review_fill_space() from public, anon, authenticated;
revoke all on function public.comment_guard_update() from public, anon, authenticated;

drop trigger if exists review_fill_space on public.reviews;
create trigger review_fill_space before insert on public.reviews
for each row execute function public.review_fill_space();

drop trigger if exists comment_fill_space on public.comments;
create trigger comment_fill_space before insert on public.comments
for each row execute function public.review_fill_space();

drop trigger if exists comment_guard_update on public.comments;
create trigger comment_guard_update before update on public.comments
for each row execute function public.comment_guard_update();

-- ── Activity triggers (security definer: clients cannot write the log directly) ──

create or replace function public.log_library_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity text := tg_argv[0];
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_name_key text := case when v_entity = 'asset' then 'filename' else 'name' end;
  v_space uuid := (v_row->>'space_id')::uuid;
  v_id uuid := (v_row->>'id')::uuid;
  v_ignored text[] := array['version', 'updated_at'];
  v_logged boolean := false;
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
    values (auth.uid(), v_space, v_entity, v_id, 'created', jsonb_build_object('name', v_new->>v_name_key));
    return null;
  end if;

  if tg_op = 'DELETE' then
    insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
    values (auth.uid(), v_space, v_entity, v_id, 'purged',
            jsonb_strip_nulls(jsonb_build_object('name', v_old->>v_name_key, 'storage_path', v_old->>'storage_path')));
    return null;
  end if;

  -- UPDATE: Trash moves win; otherwise rename and move are logged separately, anything else is 'updated'.
  if v_old->>'deleted_at' is null and v_new->>'deleted_at' is not null then
    insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
    values (auth.uid(), v_space, v_entity, v_id, 'trashed', jsonb_build_object('name', v_new->>v_name_key));
    return null;
  end if;
  if v_old->>'deleted_at' is not null and v_new->>'deleted_at' is null then
    insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
    values (auth.uid(), v_space, v_entity, v_id, 'restored', jsonb_build_object('name', v_new->>v_name_key));
    return null;
  end if;

  if v_new->>v_name_key is distinct from v_old->>v_name_key then
    insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
    values (auth.uid(), v_space, v_entity, v_id, 'renamed',
            jsonb_build_object('from', v_old->>v_name_key, 'to', v_new->>v_name_key));
    v_logged := true;
  end if;

  if v_new->>'folder_id' is distinct from v_old->>'folder_id'
     or v_new->>'space_id' is distinct from v_old->>'space_id' then
    insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
    values (auth.uid(), v_space, v_entity, v_id, 'moved', jsonb_build_object(
      'name', v_new->>v_name_key,
      'from_folder', v_old->'folder_id', 'to_folder', v_new->'folder_id',
      'from_space', v_old->'space_id', 'to_space', v_new->'space_id'));
    v_logged := true;
  end if;

  if not v_logged and (v_new - v_ignored) is distinct from (v_old - v_ignored) then
    insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
    values (auth.uid(), v_space, v_entity, v_id, 'updated', jsonb_build_object(
      'name', v_new->>v_name_key,
      'fields', (select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
                 from jsonb_each(v_new - v_ignored) n
                 where n.value is distinct from (v_old - v_ignored)->n.key)));
  end if;
  return null;
end;
$$;

create or replace function public.log_member_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
    values (auth.uid(), new.space_id, 'member', new.user_id, 'member_added', jsonb_build_object('role', new.role));
  elsif tg_op = 'DELETE' then
    insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
    values (auth.uid(), old.space_id, 'member', old.user_id, 'member_removed', jsonb_build_object('role', old.role));
  elsif new.role is distinct from old.role then
    insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
    values (auth.uid(), new.space_id, 'member', new.user_id, 'role_changed',
            jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  return null;
end;
$$;

create or replace function public.log_invite_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
  values (coalesce(auth.uid(), new.invited_by), new.space_id, 'invite', new.id, 'invited',
          jsonb_strip_nulls(jsonb_build_object('email', new.email, 'org_role', new.org_role, 'role', new.role)));
  return null;
end;
$$;

create or replace function public.log_review_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
begin
  if tg_table_name = 'comments' then
    v_action := 'commented';
  elsif new.status = 'changes_requested' then
    v_action := 'rejected';
  elsif new.asset_id is null then
    v_action := 'signed_off';
  else
    v_action := 'approved';
  end if;
  insert into public.activity_log (actor, space_id, entity_type, entity_id, action, details)
  values (
    auth.uid(), new.space_id,
    case when new.asset_id is null then 'campaign' else 'asset' end,
    coalesce(new.asset_id, new.campaign_id),
    v_action,
    jsonb_strip_nulls(jsonb_build_object(
      'campaign_id', new.campaign_id,
      case when tg_table_name = 'comments' then 'comment_id' else 'review_id' end, new.id,
      'note', case when tg_table_name = 'reviews' then to_jsonb(new)->>'note' end))
  );
  return null;
end;
$$;

-- ── Notifications: client actions notify staff; staff actions notify the space's client members ──

create or replace function public.notify_review_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := case when tg_table_name = 'reviews' then to_jsonb(new)->>'reviewer' else to_jsonb(new)->>'author' end;
  v_actor_role text;
  v_actor_name text;
  v_campaign text;
  v_kind text;
  v_verb text;
begin
  select org_role, coalesce(nullif(btrim(display_name), ''), nullif(email, ''), 'Someone')
  into v_actor_role, v_actor_name
  from public.profiles where user_id = v_actor;
  if v_actor_role is null then
    return null;
  end if;

  select name into v_campaign from public.outbound_campaigns where id = new.campaign_id;

  if tg_table_name = 'comments' then
    v_kind := 'commented';
    v_verb := case when new.asset_id is null then 'commented on' else 'commented on an image in' end;
  elsif to_jsonb(new)->>'status' = 'changes_requested' then
    v_kind := 'changes_requested';
    v_verb := case when new.asset_id is null then 'requested changes to' else 'requested changes to an image in' end;
  elsif new.asset_id is null then
    v_kind := 'signed_off';
    v_verb := 'signed off';
  else
    v_kind := 'approved';
    v_verb := 'approved an image in';
  end if;

  insert into public.notifications (recipient, kind, space_id, campaign_id, asset_id, actor, summary)
  select r.user_id, v_kind, new.space_id, new.campaign_id, new.asset_id, v_actor,
         left(v_actor_name || ' ' || v_verb || ' "' || coalesce(v_campaign, 'a campaign') || '"', 300)
  from (
    select p.user_id from public.profiles p
    where v_actor_role = 'client' and p.org_role in ('owner', 'team')
    union
    select m.user_id from public.space_members m
    where v_actor_role in ('owner', 'team') and m.space_id = new.space_id
  ) r
  where r.user_id <> v_actor;
  return null;
end;
$$;

revoke all on function public.log_library_activity() from public, anon, authenticated;
revoke all on function public.log_member_activity() from public, anon, authenticated;
revoke all on function public.log_invite_activity() from public, anon, authenticated;
revoke all on function public.log_review_activity() from public, anon, authenticated;
revoke all on function public.notify_review_activity() from public, anon, authenticated;

drop trigger if exists log_activity on public.outbound_campaigns;
create trigger log_activity after insert or update or delete on public.outbound_campaigns
for each row execute function public.log_library_activity('campaign');

drop trigger if exists log_activity on public.outbound_templates;
create trigger log_activity after insert or update or delete on public.outbound_templates
for each row execute function public.log_library_activity('template');

drop trigger if exists log_activity on public.outbound_assets;
create trigger log_activity after insert or update or delete on public.outbound_assets
for each row execute function public.log_library_activity('asset');

drop trigger if exists log_activity on public.outbound_folders;
create trigger log_activity after insert or update or delete on public.outbound_folders
for each row execute function public.log_library_activity('folder');

drop trigger if exists log_activity on public.space_members;
create trigger log_activity after insert or update or delete on public.space_members
for each row execute function public.log_member_activity();

drop trigger if exists log_activity on public.invites;
create trigger log_activity after insert on public.invites
for each row execute function public.log_invite_activity();

drop trigger if exists log_activity on public.reviews;
create trigger log_activity after insert on public.reviews
for each row execute function public.log_review_activity();

drop trigger if exists log_activity on public.comments;
create trigger log_activity after insert on public.comments
for each row execute function public.log_review_activity();

drop trigger if exists notify on public.reviews;
create trigger notify after insert on public.reviews
for each row execute function public.notify_review_activity();

drop trigger if exists notify on public.comments;
create trigger notify after insert on public.comments
for each row execute function public.notify_review_activity();

-- ── Realtime (only where the publication exists, e.g. on Supabase) ─────

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['notifications', 'reviews', 'comments'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end
$$;
