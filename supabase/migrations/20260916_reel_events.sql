-- Sept 16, 2026 — Reel metrics.
--
-- One table, one row per thing a broker actually did on the Reel page. The
-- question it exists to answer is narrow and time-boxed: after the open-house
-- announcement went out, did anyone make a reel — and did the ones they made
-- go anywhere.
--
-- Two kinds of row:
--   'render'            a film finished rendering in the browser
--   everything else     what they did with it afterwards
-- A render with no follow-on event is a broker who made one and left it there;
-- that gap is the number worth watching.
--
-- Additive only; safe to run twice.

create table if not exists public.reel_events (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),

  kind         text not null check (kind in (
                 'render',            -- finished rendering
                 'download',          -- saved the mp4
                 'send_to_phone',     -- QR / emailed link
                 'copy_caption',      -- took the written caption
                 'added_to_listing'   -- attached the film to the listing
               )),

  -- Who clicked, and what they were at the time. Admin rows are kept rather
  -- than dropped — Charlie's own test renders are worth being able to see and
  -- worth being able to exclude, and you can't do either if they were never
  -- written down.
  user_id      uuid,
  role         text,                  -- broker | assistant | admin

  -- The listing's broker, not the clicker: an assistant's reel is the broker's
  -- uptake. No foreign keys on these two on purpose — deleting a broker should
  -- not quietly rewrite the history of what was made.
  broker_id    uuid,
  listing_id   uuid references public.listings(id) on delete set null,

  -- What was made. Null on the follow-on events, which carry the render's
  -- shape only through the listing they belong to.
  format       text,                  -- reel | film
  look         text,                  -- editorial | cinematic | gallery | classic | energy | stack
  reel_length  text,                  -- short | full  (reel only; "length" is a function name)
  fit          text,                  -- fill | whole
  photo_count  integer,
  seconds      integer,               -- finished running time
  yp_brand     boolean not null default false,
  render_ms    integer                -- how long the browser took, for spotting a slow look
);

-- The page reads newest-first and rolls up by broker; the announcement cut-off
-- is a range scan on created_at.
create index if not exists reel_events_created_idx on public.reel_events(created_at desc);
create index if not exists reel_events_broker_idx  on public.reel_events(broker_id);
create index if not exists reel_events_kind_idx    on public.reel_events(kind);

alter table public.reel_events enable row level security;

-- Deliberately no policies. Every write comes from the service role behind
-- /api/reel-events, and the only reader is the admin Reels page, which also
-- uses the service role. A broker can neither see this nor forge a row into it.
