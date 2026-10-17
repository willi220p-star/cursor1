-- Storage policies: spaces/<space_id>/… by space editors, legacy <user_id>/… owner-only, public reads.

begin;
select tests.login(tests.cm_acme());
do $$
declare
  v_acme uuid := tests.space('acme');
  v_beta uuid := tests.space('Beta Co');
begin
  insert into storage.objects (bucket_id, name) values ('outbound-assets', 'spaces/' || v_acme || '/c1/one.png');
  perform tests.ok(true, 'storage: manager uploads to own space path');
  perform tests.eq(tests.affected(format($q$update storage.objects set owner = auth.uid() where name = 'spaces/%s/c1/one.png'$q$, v_acme)), 1,
    'storage: manager updates own space object');
  perform tests.throws(format($q$insert into storage.objects (bucket_id, name) values ('outbound-assets', 'spaces/%s/x.png')$q$, v_beta),
    '42501', 'storage: manager cannot upload to another space');
  perform tests.throws($q$insert into storage.objects (bucket_id, name) values ('outbound-assets', 'spaces/not-a-uuid/x.png')$q$,
    '42501', 'storage: malformed space path rejected (no cast error)');
  perform tests.throws(format($q$insert into storage.objects (bucket_id, name) values ('other-bucket', 'spaces/%s/x.png')$q$, v_acme),
    '42501', 'storage: other buckets not covered');
  insert into storage.objects (bucket_id, name) values ('outbound-assets', auth.uid() || '/legacy.png');
  perform tests.ok(true, 'storage: legacy own <user_id>/ path still works');
  perform tests.eq(tests.affected(format($q$delete from storage.objects where name = 'spaces/%s/c1/one.png'$q$, v_acme)), 1,
    'storage: manager deletes own space object');
  perform tests.eq(tests.affected($q$delete from storage.objects where name = '00000000-0000-0000-0000-0000000000a1/a1.png'$q$), 0,
    'storage: client cannot delete legacy files of others');
end
$$;
rollback;

begin;
select tests.login(tests.cv_acme());
do $$
begin
  perform tests.throws(format($q$insert into storage.objects (bucket_id, name) values ('outbound-assets', 'spaces/%s/x.png')$q$, tests.space('acme')),
    '42501', 'storage: viewer cannot upload');
end
$$;
rollback;

begin;
select tests.login(tests.team());
do $$
begin
  insert into storage.objects (bucket_id, name) values ('outbound-assets', 'spaces/' || tests.space('Beta Co') || '/x.png');
  perform tests.ok(true, 'storage: team uploads to any space');
  perform tests.eq(tests.affected($q$delete from storage.objects where name = '00000000-0000-0000-0000-0000000000a1/a1.png'$q$), 1,
    'storage: staff can delete legacy files (purge)');
end
$$;
rollback;

begin;
select tests.anon();
do $$
begin
  perform tests.ok(tests.count($q$select 1 from storage.objects where bucket_id = 'outbound-assets'$q$) > 0, 'storage: public reads stay public');
  perform tests.throws(format($q$insert into storage.objects (bucket_id, name) values ('outbound-assets', 'spaces/%s/x.png')$q$, tests.space('acme')),
    '42501', 'storage: anon cannot upload');
end
$$;
rollback;
