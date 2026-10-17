-- Daily purge of items in Trash for more than 30 days: pg_cron calls the purge-trash Edge Function via pg_net.
-- Only scheduled when both extensions are installed; otherwise this migration does nothing.
-- No secrets live here: the job reads them from Supabase Vault when it runs. Create them once (SQL editor):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<random token>', 'purge_trash_secret');   -- same value as the function's PURGE_TRASH_SECRET
-- Reversed by supabase/rollbacks/202610170006_purge_trash_schedule.down.sql.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    -- Re-scheduling under the same name replaces the job, so this is safe to re-run.
    perform cron.schedule(
      'purge-trash-daily',
      '17 3 * * *',
      $job$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
                 || '/functions/v1/purge-trash',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'purge_trash_secret')
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 60000
        );
      $job$
    );
  else
    raise notice 'pg_cron or pg_net not installed: purge-trash is not scheduled';
  end if;
end
$$;
