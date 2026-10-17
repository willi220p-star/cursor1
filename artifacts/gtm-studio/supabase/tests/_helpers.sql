-- Test helpers. Assertions raise (psql stops on the first failure) and print "ok - …" notices that
-- scripts/sql-test.sh counts. Impersonation: tests.login(uid) inside a transaction switches to the
-- authenticated role with that user's JWT sub, exactly like PostgREST does.

drop schema if exists tests cascade;
create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

create function tests.owner() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000000a1'::uuid $$;
create function tests.op2() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000000a2'::uuid $$;
create function tests.team() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000000b1'::uuid $$;
create function tests.cm_acme() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000000c1'::uuid $$;
create function tests.cv_acme() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000000c2'::uuid $$;
create function tests.cm_beta() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000000c3'::uuid $$;
create function tests.nobody() returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-0000000000d1'::uuid $$;

-- Seeded rows: tests.c(1) = campaign 1, tests.a(3) = asset 3, tests.f(2) = folder 2, tests.t(1) = template 1.
create function tests.c(n int) returns uuid language sql immutable as $$ select ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function tests.f(n int) returns uuid language sql immutable as $$ select ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function tests.a(n int) returns uuid language sql immutable as $$ select ('30000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function tests.t(n int) returns uuid language sql immutable as $$ select ('40000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;

-- Space id by name, bypassing RLS.
create function tests.space(space_name text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.spaces where lower(name) = lower(space_name)
$$;

create function tests.login(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function tests.anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'anon', true);
end;
$$;

create function tests.ok(cond boolean, label text) returns void
language plpgsql as $$
begin
  if cond is distinct from true then
    raise exception 'FAILED: %', label;
  end if;
  raise notice 'ok - %', label;
end;
$$;

create function tests.eq(actual anyelement, expected anyelement, label text) returns void
language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAILED: % (expected %, got %)', label, expected, actual;
  end if;
  raise notice 'ok - %', label;
end;
$$;

-- Runs sql as the current role; passes when it fails with the given SQLSTATE.
create function tests.throws(sql text, state text, label text) returns void
language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlstate = state then
      raise notice 'ok - %', label;
      return;
    end if;
    raise exception 'FAILED: % (expected SQLSTATE %, got % %)', label, state, sqlstate, sqlerrm;
  end;
  raise exception 'FAILED: % (expected SQLSTATE %, but it succeeded)', label, state;
end;
$$;

-- Rows affected by a statement, as the current role (RLS silently skips rows it hides).
create function tests.affected(sql text) returns int
language plpgsql as $$
declare
  n int;
begin
  execute sql;
  get diagnostics n = row_count;
  return n;
end;
$$;

create function tests.count(sql text) returns bigint
language plpgsql as $$
declare
  n bigint;
begin
  execute format('select count(*) from (%s) q', sql) into n;
  return n;
end;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;
