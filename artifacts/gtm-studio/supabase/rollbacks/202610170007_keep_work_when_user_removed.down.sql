-- Reverses 202610170007: user_id is required again and deleting the account deletes the work.
-- Rows whose creator was removed are given to the first Owner so the column can be NOT NULL again.

do $$
declare
  t text;
  c record;
  fallback uuid;
begin
  select user_id into fallback from public.profiles where org_role = 'owner' order by created_at limit 1;
  foreach t in array array['outbound_campaigns', 'outbound_templates', 'outbound_assets', 'outbound_folders'] loop
    if fallback is not null then
      execute format('update public.%I set user_id = $1 where user_id is null', t) using fallback;
    end if;
    for c in
      select con.conname
      from pg_constraint con
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
      where con.conrelid = format('public.%I', t)::regclass
        and con.contype = 'f'
        and con.confrelid = 'auth.users'::regclass
        and att.attname = 'user_id'
    loop
      execute format('alter table public.%I drop constraint %I', t, c.conname);
    end loop;
    execute format('alter table public.%I alter column user_id set not null', t);
    execute format(
      'alter table public.%I add constraint %I foreign key (user_id) references auth.users(id) on delete cascade',
      t, t || '_user_id_fkey');
  end loop;
end $$;
