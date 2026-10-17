-- The permission matrix from the spec, row by row, for Owner, Team, Client Manager (own vs other space)
-- and Client Viewer. Every block runs as the authenticated role and is rolled back.

-- ── Owner ──────────────────────────────────────────────────────────────
begin;
select tests.login(tests.owner());
do $$
declare
  v_acme uuid := tests.space('acme');
  v_beta uuid := tests.space('Beta Co');
begin
  perform tests.eq(tests.count('select 1 from public.spaces'), 3::bigint, 'owner: sees all spaces');
  perform tests.eq(tests.count('select 1 from public.outbound_campaigns'), 6::bigint, 'owner: sees every campaign');
  perform tests.eq(tests.count('select 1 from public.outbound_assets'), 7::bigint, 'owner: sees every asset (download)');
  insert into public.outbound_campaigns (user_id, name, mode, space_id) values (auth.uid(), 'Owner new', 'gif', v_beta);
  perform tests.ok(true, 'owner: generates/saves campaigns in any space');
  perform tests.eq(tests.affected(format('update public.outbound_campaigns set name = %L where id = %L', 'x', tests.c(6))), 1,
    'owner: edits another operator''s campaign');
  perform tests.eq(tests.affected(format('delete from public.outbound_assets where id = %L', tests.a(6))), 1, 'owner: can purge');
  perform tests.eq(tests.affected(format('update public.outbound_templates set name = %L where id = %L', 'T', tests.t(1))), 1, 'owner: edits templates');
  insert into public.spaces (name, kind) values ('Gamma', 'client');
  perform tests.ok(true, 'owner: creates spaces');
  insert into public.invites (email, org_role) values ('new-team@dgk.test', 'team');
  perform tests.ok(true, 'owner: invites Team members');
  perform tests.eq(tests.affected(format('update public.profiles set org_role = %L where user_id = %L', 'client', tests.team())), 1,
    'owner: changes a Team member''s role');
  perform tests.eq(tests.count('select 1 from public.profiles'), 6::bigint, 'owner: reads every profile');
  perform tests.ok(tests.count('select 1 from public.activity_log') > 0, 'owner: reads the activity log');
  perform tests.throws($q$insert into public.activity_log (entity_type, action) values ('x', 'created')$q$, '42501',
    'owner: cannot write the activity log directly');
end
$$;
rollback;

-- ── Team ───────────────────────────────────────────────────────────────
begin;
select tests.login(tests.team());
do $$
declare
  v_acme uuid := tests.space('acme');
begin
  perform tests.eq(tests.count('select 1 from public.spaces'), 3::bigint, 'team: sees all spaces');
  perform tests.eq(tests.count('select 1 from public.outbound_campaigns'), 6::bigint, 'team: sees every campaign');
  insert into public.outbound_campaigns (user_id, name, mode, space_id) values (auth.uid(), 'Team new', 'gif', v_acme);
  perform tests.ok(true, 'team: generates/saves campaigns in a client space');
  perform tests.eq(tests.affected(format('update public.outbound_assets set filename = %L where id = %L', 'r.png', tests.a(4))), 1,
    'team: renames in any space');
  perform tests.eq(tests.affected(format('delete from public.outbound_campaigns where id = %L', tests.c(5))), 1, 'team: can purge');
  perform tests.eq(tests.affected(format('update public.outbound_templates set name = %L where id = %L', 'T', tests.t(2))), 1, 'team: edits templates');
  insert into public.outbound_templates (user_id, name, mode) values (auth.uid(), 'Team template', 'memes');
  perform tests.ok(true, 'team: creates templates');
  insert into public.spaces (name, kind) values ('Delta', 'client');
  update public.spaces set name = 'Delta Ltd' where name = 'Delta';
  update public.spaces set archived_at = now() where name = 'Delta Ltd';
  perform tests.ok(true, 'team: creates, renames and archives spaces');
  insert into public.invites (email, org_role, space_id, role) values ('c@acme.test', 'client', v_acme, 'client_viewer');
  perform tests.ok(true, 'team: invites client users');
  perform tests.eq(tests.affected(format('update public.space_members set role = %L where user_id = %L', 'client_manager', tests.cv_acme())), 1,
    'team: changes a client''s space role');
  perform tests.throws($q$insert into public.invites (email, org_role) values ('t2@dgk.test', 'team')$q$, '42501',
    'team: cannot invite Team members');
  perform tests.throws(format('update public.profiles set org_role = %L where user_id = %L', 'team', tests.cm_acme()), '42501',
    'team: cannot promote a client to Team');
  perform tests.eq(tests.affected(format('update public.profiles set org_role = %L where user_id = %L', 'client', tests.owner())), 0,
    'team: cannot change the Owner');
  perform tests.throws(format('update public.profiles set org_role = %L where user_id = %L', 'owner', tests.team()), '42501',
    'team: cannot make themself Owner');
  perform tests.eq(tests.affected(format('update public.profiles set display_name = %L where user_id = %L', 'Mia M', tests.cm_acme())), 1,
    'team: manages client profiles');
  perform tests.ok(tests.count('select 1 from public.activity_log') > 0, 'team: reads all activity');
end
$$;
rollback;

-- ── Client Manager (Acme): own space vs other space ────────────────────
begin;
select tests.login(tests.cm_acme());
do $$
declare
  v_acme uuid := tests.space('acme');
  v_beta uuid := tests.space('Beta Co');
  v_internal uuid := tests.space('Internal (DGK)');
begin
  perform tests.eq((select array_agg(id) from public.spaces), array[v_acme], 'client manager: sees only own space');
  perform tests.eq(tests.count('select 1 from public.outbound_campaigns'), 3::bigint, 'client manager: sees only own campaigns');
  perform tests.eq(tests.count('select 1 from public.outbound_assets'), 3::bigint, 'client manager: downloads only own assets');
  perform tests.eq(tests.count('select 1 from public.outbound_folders'), 2::bigint, 'client manager: sees only own folders');
  perform tests.eq(tests.count(format('select 1 from public.outbound_campaigns where id = %L', tests.c(3))), 0::bigint,
    'client manager: other space campaign is invisible');

  insert into public.outbound_campaigns (user_id, name, mode, space_id) values (auth.uid(), 'Mine', 'handwritten', v_acme);
  perform tests.ok(true, 'client manager: generates/saves in own space');
  perform tests.throws(format($q$insert into public.outbound_campaigns (user_id, name, mode, space_id) values (auth.uid(), 'No', 'gif', %L)$q$, v_beta),
    '42501', 'client manager: cannot save in another space');
  perform tests.throws(format($q$insert into public.outbound_campaigns (user_id, name, mode, space_id) values (%L, 'No', 'gif', %L)$q$, tests.owner(), v_acme),
    '42501', 'client manager: cannot insert rows as someone else');

  perform tests.eq(tests.affected(format('update public.outbound_campaigns set name = %L where id = %L', 'Renamed', tests.c(1))), 1,
    'client manager: renames in own space');
  perform tests.eq(tests.affected(format('update public.outbound_campaigns set name = %L where id = %L', 'Nope', tests.c(3))), 0,
    'client manager: cannot rename in another space');
  perform tests.throws(format('update public.outbound_campaigns set space_id = %L, folder_id = null where id = %L', v_beta, tests.c(2)),
    '42501', 'client manager: cannot move into a space they cannot edit');
  perform tests.eq(tests.affected(format('update public.outbound_assets set deleted_at = now() where id = %L', tests.a(1))), 1,
    'client manager: trashes in own space');

  perform tests.eq(tests.affected(format('delete from public.outbound_campaigns where id = %L', tests.c(2))), 0,
    'client manager: cannot purge');

  perform tests.eq(tests.count('select 1 from public.outbound_templates'), 2::bigint, 'client manager: uses (reads) templates');
  perform tests.eq(tests.affected(format('update public.outbound_templates set name = %L where id = %L', 'x', tests.t(1))), 0,
    'client manager: cannot edit templates');
  perform tests.throws($q$insert into public.outbound_templates (user_id, name, mode) values (auth.uid(), 'x', 'gif')$q$, '42501',
    'client manager: cannot create templates');

  perform tests.throws($q$insert into public.spaces (name, kind) values ('Mine too', 'client')$q$, '42501', 'client manager: cannot create spaces');
  perform tests.eq(tests.affected(format('update public.spaces set name = %L where id = %L', 'Acme!', v_acme)), 0, 'client manager: cannot rename spaces');
  perform tests.throws(format($q$insert into public.invites (email, org_role, space_id, role) values ('z@acme.test', 'client', %L, 'client_viewer')$q$, v_acme),
    '42501', 'client manager: cannot invite');
  perform tests.eq(tests.affected(format('delete from public.space_members where user_id = %L', tests.cv_acme())), 0,
    'client manager: cannot remove members');
  perform tests.eq(tests.count('select 1 from public.space_members'), 2::bigint, 'client manager: sees own space members');
  perform tests.eq(tests.count('select 1 from public.profiles'), 1::bigint, 'client manager: reads only own profile');
  perform tests.eq(tests.affected(format('update public.profiles set display_name = %L where user_id = auth.uid()', 'Mia')), 1,
    'client manager: edits own display name');
  perform tests.throws($q$update public.profiles set org_role = 'owner' where user_id = auth.uid()$q$, '42501',
    'client manager: cannot change own role');

  perform tests.ok(tests.count('select 1 from public.activity_log') > 0, 'client manager: reads own space activity');
  perform tests.eq(tests.count(format('select 1 from public.activity_log where space_id is distinct from %L', v_acme)), 0::bigint,
    'client manager: no activity from other spaces');
end
$$;
rollback;

-- Client Manager (Beta) cannot see or touch Acme.
begin;
select tests.login(tests.cm_beta());
do $$
begin
  perform tests.eq((select array_agg(name) from public.spaces), array['Beta Co'], 'client manager (Beta): sees only Beta');
  perform tests.eq(tests.count('select 1 from public.outbound_campaigns'), 1::bigint, 'client manager (Beta): one campaign');
  perform tests.eq(tests.affected(format('update public.outbound_assets set filename = %L where id = %L', 'x', tests.a(1))), 0,
    'client manager (Beta): cannot edit Acme assets');
  perform tests.eq(tests.count('select 1 from public.space_members'), 1::bigint, 'client manager (Beta): sees only Beta members');
end
$$;
rollback;

-- ── Client Viewer (Acme) ───────────────────────────────────────────────
begin;
select tests.login(tests.cv_acme());
do $$
declare
  v_acme uuid := tests.space('acme');
begin
  perform tests.eq((select array_agg(id) from public.spaces), array[v_acme], 'client viewer: sees only own space');
  perform tests.eq(tests.count('select 1 from public.outbound_assets'), 3::bigint, 'client viewer: downloads own assets');
  perform tests.throws(format($q$insert into public.outbound_campaigns (user_id, name, mode, space_id) values (auth.uid(), 'No', 'gif', %L)$q$, v_acme),
    '42501', 'client viewer: cannot generate/save');
  perform tests.eq(tests.affected(format('update public.outbound_campaigns set name = %L where id = %L', 'x', tests.c(1))), 0,
    'client viewer: cannot rename');
  perform tests.eq(tests.affected(format('update public.outbound_assets set deleted_at = now() where id = %L', tests.a(1))), 0,
    'client viewer: cannot trash');
  perform tests.eq(tests.affected(format('delete from public.outbound_assets where id = %L', tests.a(1))), 0, 'client viewer: cannot purge');
  perform tests.eq(tests.count('select 1 from public.outbound_templates'), 0::bigint, 'client viewer: no templates');
  perform tests.eq(tests.count('select 1 from public.activity_log'), 0::bigint, 'client viewer: no activity log');
  perform tests.eq(tests.count('select 1 from public.invites'), 0::bigint, 'client viewer: no invites');

  insert into public.reviews (campaign_id, asset_id, status, note) values (tests.c(1), tests.a(1), 'approved', 'Looks good');
  insert into public.reviews (campaign_id, status) values (tests.c(1), 'approved');
  insert into public.comments (campaign_id, body) values (tests.c(1), 'Can we tweak the colour?');
  perform tests.ok(true, 'client viewer: approves, signs off and comments in own space');
  perform tests.eq((select reviewer from public.reviews where campaign_id = tests.c(1) and asset_id = tests.a(1)), tests.cv_acme(),
    'client viewer: reviewer is the signed-in user');
  perform tests.throws(format($q$insert into public.reviews (campaign_id, status) values (%L, 'approved')$q$, tests.c(3)), '42501',
    'client viewer: cannot review another space''s campaign');
  perform tests.throws(format($q$insert into public.comments (campaign_id, body, space_id) values (%L, 'hi', %L)$q$, tests.c(3), v_acme), '42501',
    'client viewer: a forged space_id does not help');
  perform tests.throws(format($q$insert into public.reviews (campaign_id, asset_id, status) values (%L, %L, 'approved')$q$, tests.c(1), tests.a(4)), '23514',
    'reviews: the image must belong to the campaign');
  perform tests.throws($q$insert into public.comments (campaign_id, body) values ('10000000-0000-0000-0000-000000000001', '')$q$, '23514',
    'comments: empty body rejected');
  perform tests.eq(tests.affected($q$update public.comments set body = 'Edited' where author = auth.uid()$q$), 1, 'client viewer: edits own comment');
  perform tests.ok((select edited_at is not null from public.comments where author = auth.uid()), 'comments: edit stamps edited_at');
  perform tests.throws($q$update public.reviews set status = 'changes_requested'$q$, '42501', 'reviews: append-only (no updates)');
end
$$;
rollback;

-- Comments: only the author edits or deletes.
begin;
select tests.login(tests.team());
insert into public.comments (campaign_id, body) values (tests.c(1), 'Staff note');
select tests.login(tests.cm_acme());
do $$
begin
  perform tests.eq(tests.count('select 1 from public.comments'), 1::bigint, 'comments: client sees staff comment in own space');
  perform tests.eq(tests.affected($q$update public.comments set body = 'hijack'$q$), 0, 'comments: cannot edit someone else''s comment');
  perform tests.eq(tests.affected($q$delete from public.comments$q$), 0, 'comments: cannot delete someone else''s comment');
end
$$;
select tests.login(tests.team());
do $$
begin
  perform tests.eq(tests.affected($q$update public.comments set deleted_at = now()$q$), 1, 'comments: author soft-deletes own comment');
end
$$;
rollback;

-- Anonymous visitors see nothing.
begin;
select tests.anon();
do $$
begin
  perform tests.throws('select 1 from public.spaces', '42501', 'anon: no access to spaces');
  perform tests.eq(tests.count('select 1 from public.outbound_campaigns'), 0::bigint, 'anon: no campaigns');
end
$$;
rollback;

-- Folder rule, version bump and the no-space_id compatibility default.
begin;
select tests.login(tests.owner());
do $$
declare
  v_id uuid;
begin
  perform tests.throws(format('update public.outbound_templates set folder_id = %L where id = %L', tests.f(1), tests.t(2)), '23514',
    'folder rule: template folders must be in Internal');
  perform tests.throws(format('update public.outbound_assets set folder_id = %L where id = %L', tests.f(1), tests.a(4)), '23514',
    'folder rule: item folder must be in the item''s space');
  perform tests.eq(tests.affected(format('update public.outbound_assets set folder_id = %L where id = %L', tests.f(4), tests.a(7))), 1,
    'folder rule: same-space folder accepted (any creator)');
  perform tests.eq((select version from public.outbound_assets where id = tests.a(7)), 2, 'version: every update bumps version');
  insert into public.outbound_assets (user_id, campaign_id, filename, storage_path, public_url)
  values (auth.uid(), tests.c(3), 'old-client.png', 'x/old.png', 'https://x/old.png') returning id into v_id;
  perform tests.eq((select space_id from public.outbound_assets where id = v_id), tests.space('Beta Co'),
    'compat: asset saved without space_id lands in its campaign''s space');
  insert into public.outbound_folders (user_id, name) values (auth.uid(), 'Shared') returning id into v_id;
  perform tests.eq((select space_id from public.outbound_folders where id = v_id), tests.space('Internal (DGK)'),
    'compat: folder saved without space_id lands in Internal (names unique per space only)');
end
$$;
rollback;
