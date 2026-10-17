-- Reverses 202610170006_purge_trash_schedule.sql: removes the daily purge job if it was scheduled.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'purge-trash-daily') then
      perform cron.unschedule('purge-trash-daily');
    end if;
  end if;
end
$$;
