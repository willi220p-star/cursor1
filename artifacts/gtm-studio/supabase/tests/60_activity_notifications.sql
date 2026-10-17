-- Activity rows from triggers (actor = auth.uid(), action derived from old vs new) and notification fan-out.

begin;
select tests.login(tests.cm_acme());
do $$
declare
  v_acme uuid := tests.space('acme');
  v_id uuid;
  v_before bigint;
begin
  insert into public.outbound_campaigns (user_id, name, mode, space_id) values (auth.uid(), 'Logged', 'gif', v_acme) returning id into v_id;
  update public.outbound_campaigns set name = 'Logged 2' where id = v_id;
  update public.outbound_campaigns set folder_id = tests.f(1) where id = v_id;
  update public.outbound_campaigns set tags = array['x'] where id = v_id;
  update public.outbound_campaigns set deleted_at = now() where id = v_id;
  update public.outbound_campaigns set deleted_at = null where id = v_id;
  v_before := (select count(*) from public.activity_log where entity_id = v_id);
  update public.outbound_campaigns set name = name where id = v_id;
  perform tests.eq((select count(*) from public.activity_log where entity_id = v_id), v_before, 'activity: a no-op update logs nothing');

  perform tests.eq((select array_agg(action order by id) from public.activity_log where entity_id = v_id),
    array['created', 'renamed', 'moved', 'updated', 'trashed', 'restored'], 'activity: created/renamed/moved/updated/trashed/restored derived');
  perform tests.ok((select bool_and(actor = tests.cm_acme() and space_id = v_acme and entity_type = 'campaign')
                    from public.activity_log where entity_id = v_id), 'activity: actor, space and entity type recorded');
  perform tests.eq((select details from public.activity_log where entity_id = v_id and action = 'renamed'),
    '{"from": "Logged", "to": "Logged 2"}'::jsonb, 'activity: rename details from/to');
  perform tests.eq((select details->'fields' from public.activity_log where entity_id = v_id and action = 'updated'),
    '["tags"]'::jsonb, 'activity: updated lists changed fields');
  perform tests.eq((select details->>'to_folder' from public.activity_log where entity_id = v_id and action = 'moved'),
    tests.f(1)::text, 'activity: move details carry the folder');

  perform public.bulk_rename('asset', jsonb_build_array(jsonb_build_object('id', tests.a(7), 'name', 'renamed.png')));
  perform tests.eq((select details->>'to' from public.activity_log where entity_id = tests.a(7) and action = 'renamed'),
    'renamed.png', 'activity: assets log their filename');
end
$$;
rollback;

begin;
select tests.login(tests.team());
do $$
begin
  update public.outbound_templates set name = 'Card back' where id = tests.t(1);
  perform tests.ok(exists (select 1 from public.activity_log where entity_type = 'template' and entity_id = tests.t(1)
                           and action = 'renamed' and space_id is null and actor = tests.team()),
    'activity: template rename logged without a space');
  update public.space_members set role = 'client_manager' where user_id = tests.cv_acme();
  delete from public.space_members where user_id = tests.cv_acme();
  perform tests.eq((select array_agg(action order by id) from public.activity_log where entity_type = 'member' and entity_id = tests.cv_acme()
                    and actor = tests.team()), array['role_changed', 'member_removed'], 'activity: role_changed and member_removed');
end
$$;
rollback;

-- Notifications: a client's review/comment notifies every staff profile …
begin;
select tests.login(tests.cv_acme());
insert into public.reviews (campaign_id, asset_id, status, note) values (tests.c(1), tests.a(1), 'changes_requested', 'Logo too small');
insert into public.comments (campaign_id, body) values (tests.c(1), 'See note');
reset role;
do $$
begin
  perform tests.eq((select array_agg(recipient order by recipient) from public.notifications where kind = 'changes_requested'),
    array[tests.owner(), tests.op2(), tests.team()], 'notifications: client review → every staff member');
  perform tests.eq((select count(*) from public.notifications where kind = 'commented'), 3::bigint, 'notifications: client comment → staff');
  perform tests.eq((select summary from public.notifications where kind = 'changes_requested' and recipient = tests.team()),
    'Vic Viewer requested changes to an image in "Acme launch"', 'notifications: readable summary');
  perform tests.ok((select bool_and(actor = tests.cv_acme() and space_id = tests.space('acme') and campaign_id = tests.c(1))
                    from public.notifications), 'notifications: actor, space and campaign set');
  perform tests.eq((select array_agg(action order by id) from public.activity_log where actor = tests.cv_acme() and action in ('rejected', 'commented')),
    array['rejected', 'commented'], 'activity: review and comment logged');
end
$$;
rollback;

-- … and staff actions notify the client members of that space only.
begin;
select tests.login(tests.team());
insert into public.comments (campaign_id, body) values (tests.c(1), 'New round is ready');
insert into public.reviews (campaign_id, status) values (tests.c(1), 'approved');
select tests.login(tests.cm_acme());
do $$
begin
  perform tests.eq(tests.count('select 1 from public.notifications'), 2::bigint, 'notifications: Acme manager sees their two notifications');
  perform tests.eq((select array_agg(kind order by kind) from public.notifications), array['commented', 'signed_off'],
    'notifications: staff comment and sign-off reach the client');
  perform tests.eq(tests.affected('update public.notifications set read_at = now()'), 2, 'notifications: recipient marks read');
  perform tests.throws($q$update public.notifications set summary = 'x'$q$, '42501', 'notifications: only read_at is writable');
end
$$;
select tests.login(tests.cm_beta());
do $$
begin
  perform tests.eq(tests.count('select 1 from public.notifications'), 0::bigint, 'notifications: other space clients get nothing');
end
$$;
reset role;
do $$
begin
  perform tests.eq((select count(*) from public.notifications where recipient in (tests.owner(), tests.op2(), tests.team())), 0::bigint,
    'notifications: staff actions do not notify staff');
  perform tests.eq((select count(*) from public.notifications), 4::bigint, 'notifications: two clients × two actions');
end
$$;
rollback;
