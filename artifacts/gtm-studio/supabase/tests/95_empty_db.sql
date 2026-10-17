-- The migrations on a database with no rows: only the Internal space, no profiles, inserts still work.

do $$
begin
  perform tests.eq((select count(*) from public.spaces), 1::bigint, 'empty db: only the Internal space');
  perform tests.eq((select count(*) from public.profiles), 0::bigint, 'empty db: no profiles');
end
$$;

begin;
insert into auth.users (id, email) values (tests.owner(), 'owner@dgk.test');
insert into public.profiles (user_id, email, org_role) values (tests.owner(), 'owner@dgk.test', 'owner');
select tests.login(tests.owner());
do $$
begin
  -- An old client build sends no space_id: the row lands in Internal.
  insert into public.outbound_campaigns (user_id, name, mode) values (tests.owner(), 'First', 'handwritten');
  perform tests.eq((select space_id from public.outbound_campaigns where name = 'First'), tests.space('Internal (DGK)'),
    'empty db: insert without space_id defaults to Internal');
end
$$;
rollback;
