-- Backfill sign-ins for the first Slideshow-ready send (Oct 29, ~16:00 UTC),
-- which went out before tracking existed. Opens/clicks can't be recovered;
-- a sign-in is the earliest of (a new auth session, last_sign_in_at) after
-- the email and within 7 days. Idempotent (one sign-in per email).
insert into public.email_events (email_log_id, broker_id, kind, ua, created_at)
select e.id, e.recipient_id, 'signin', 'backfill', s.first_at
from public.email_log e
join lateral (
  select min(t) as first_at from (
    select ss.created_at as t from auth.sessions ss
      where ss.user_id = e.recipient_id and ss.created_at > e.sent_at and ss.created_at <= e.sent_at + interval '7 days'
    union all
    select u.last_sign_in_at from auth.users u
      where u.id = e.recipient_id and u.last_sign_in_at > e.sent_at and u.last_sign_in_at <= e.sent_at + interval '7 days'
  ) x
) s on s.first_at is not null
where e.email_type = 'slideshow_ready_2026_10' and e.status = 'sent'
on conflict (email_log_id) where kind = 'signin' do nothing;
