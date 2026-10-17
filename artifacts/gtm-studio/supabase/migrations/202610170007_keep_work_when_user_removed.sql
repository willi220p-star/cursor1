-- Removing a person's login must not delete their work. user_id means "created by"; when that
-- account is deleted the column becomes null (the app shows "a removed user") and the campaign,
-- file, folder or template stays in its space.

do $$
declare
  t text;
  c record;
begin
  foreach t in array array['outbound_campaigns', 'outbound_templates', 'outbound_assets', 'outbound_folders'] loop
    -- Drop whatever foreign key points user_id at auth.users, whatever it is called.
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
    execute format('alter table public.%I alter column user_id drop not null', t);
    execute format(
      'alter table public.%I add constraint %I foreign key (user_id) references auth.users(id) on delete set null',
      t, t || '_user_id_fkey');
  end loop;
end $$;
