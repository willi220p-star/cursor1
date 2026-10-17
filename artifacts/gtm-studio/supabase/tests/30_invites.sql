-- Invites and accept_invite(): creates the people the permission tests use (committed).

insert into public.invites (email, org_role, space_id, role, invited_by) values
  ('TEAM@dgk.test', 'team', null, null, tests.owner()),
  ('manager@acme.test', 'client', tests.space('acme'), 'client_manager', tests.owner()),
  ('viewer@acme.test', 'client', tests.space('acme'), 'client_viewer', tests.owner()),
  ('manager@beta.test', 'client', tests.space('Beta Co'), 'client_manager', tests.owner());
insert into public.invites (email, org_role, space_id, role, invited_by, expires_at) values
  ('nobody@else.test', 'client', tests.space('acme'), 'client_viewer', tests.owner(), now() - interval '1 day');

do $$
begin
  perform tests.ok(not exists (select 1 from public.invites where org_role = 'client' and space_id is null), 'invites: client invites carry a space');
  perform tests.throws($q$insert into public.invites (email, org_role) values ('x@y.test', 'client')$q$, '23514',
    'invites: client invite without space is rejected');
  perform tests.throws($q$insert into public.invites (email, org_role, space_id, role) values ('x@y.test', 'team', tests.space('acme'), 'client_viewer')$q$, '23514',
    'invites: staff invite with a space is rejected');
  perform tests.eq((select count(*) from public.activity_log where action = 'invited'), 5::bigint, 'activity: each invite logged as invited');
end
$$;

begin;
select tests.login(tests.team());
do $$
declare
  r record;
begin
  select * into r from public.accept_invite();
  perform tests.ok(r.ok and r.message = 'team', 'accept_invite: team invite accepted (email match is case-insensitive)');
  perform tests.eq(public.app_org_role(), 'team', 'accept_invite: team profile created');
  perform tests.eq((select display_name from public.profiles where user_id = auth.uid()), 'Tess Team', 'accept_invite: display name from auth metadata');
  perform tests.eq((select count(*) from public.accept_invite()), 0::bigint, 'accept_invite: second call finds nothing pending');
end
$$;
commit;

begin;
select tests.login(tests.cm_acme());
do $$
begin
  perform tests.eq((select count(*) from public.accept_invite() where ok), 1::bigint, 'accept_invite: Acme manager accepted');
  perform tests.eq(public.app_org_role(), 'client', 'accept_invite: client profile');
  perform tests.ok(public.app_can_edit_space(tests.space('acme')), 'accept_invite: manager can edit own space');
end
$$;
commit;

begin;
select tests.login(tests.cv_acme());
select count(*) from public.accept_invite();
commit;

begin;
select tests.login(tests.cm_beta());
select count(*) from public.accept_invite();
commit;

begin;
select tests.login(tests.nobody());
do $$
begin
  perform tests.eq((select count(*) from public.accept_invite()), 0::bigint, 'accept_invite: expired invite is ignored');
  perform tests.eq(public.app_org_role(), null::text, 'accept_invite: no profile without a valid invite');
end
$$;
commit;

begin;
select tests.anon();
do $$
begin
  perform tests.throws('select * from public.accept_invite()', '42501', 'accept_invite: anon cannot call it');
end
$$;
rollback;

do $$
begin
  perform tests.eq((select count(*) from public.space_members), 3::bigint, 'accept_invite: three client memberships');
  perform tests.eq((select role from public.space_members where user_id = tests.cv_acme()), 'client_viewer', 'accept_invite: viewer role kept');
  perform tests.eq((select count(*) from public.invites where accepted_at is not null), 4::bigint, 'accept_invite: invites marked accepted');
  perform tests.eq((select count(*) from public.activity_log where action = 'member_added'), 3::bigint, 'activity: member_added logged');
  perform tests.throws($q$insert into public.space_members (space_id, user_id, role) values (tests.space('acme'), tests.team(), 'client_viewer')$q$,
    '23514', 'space_members: staff cannot be space members');
end
$$;
