-- Oct 28, 2026 — once-a-minute heartbeat for background jobs (NOT APPLIED —
-- needs the secret below first).
--
-- The job worker chains itself by calling its own URL; Vercel can refuse that
-- with 508 (loop detection), leaving a job stalled until the daily cron. Vercel
-- Hobby only allows daily crons, so the minute tick comes from Supabase:
-- pg_cron runs every minute and pg_net POSTs https://portal.yachtpics.com/api/jobs/tick
-- with the CRON_SECRET. That route does one cheap query when idle and runs one
-- batch only when a job has no live worker.
--
-- BEFORE applying: store the SAME value as Vercel's CRON_SECRET in Supabase
-- Vault, named exactly 'jobs_cron_secret' (Dashboard → Project Settings →
-- Vault → Add new secret), or in the SQL editor:
--   select vault.create_secret('<JOBS_TICK_SECRET value>', 'jobs_cron_secret');
--
-- To stop it later:  select cron.unschedule('jobs-tick');
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('jobs-tick') where exists (select 1 from cron.job where jobname = 'jobs-tick');

select cron.schedule(
  'jobs-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://portal.yachtpics.com/api/jobs/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-jobs-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'jobs_cron_secret' limit 1), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  $$
);
