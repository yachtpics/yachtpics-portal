-- Oct 18, 2026 — Facebook & Instagram Reels publishing (admin only for now).
--
--   social_connections — a broker's connected Facebook Page (+ linked
--                        Instagram professional account) with its Page access
--                        token, AES-256-GCM encrypted by the app
--                        (SOCIAL_TOKEN_KEY). One row per broker per Page.
--   social_posts       — every post to Facebook / Instagram, scheduled or sent.
--
-- All writes go through server routes with the service role. The token column
-- is never readable from the browser: authenticated users get column-level
-- SELECT on every column EXCEPT page_token_enc, plus RLS to their own rows.
-- Additive only; safe to run twice.

create table if not exists public.social_connections (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references public.profiles(id) on delete cascade,
  fb_user_id text not null,
  page_id text not null,
  page_name text,
  page_token_enc text not null,
  ig_user_id text,
  ig_username text,
  token_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (broker_id, page_id)
);

create index if not exists social_connections_fb_user_idx on public.social_connections(fb_user_id);

alter table public.social_connections enable row level security;

drop policy if exists "social_connections admin all" on public.social_connections;
create policy "social_connections admin all" on public.social_connections
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "social_connections broker reads own" on public.social_connections;
create policy "social_connections broker reads own" on public.social_connections
  for select using (broker_id = auth.uid());

drop policy if exists "social_connections broker deletes own" on public.social_connections;
create policy "social_connections broker deletes own" on public.social_connections
  for delete using (broker_id = auth.uid());

-- Never expose the token to anon/authenticated (browser) roles — not even to
-- an admin's browser session. Server routes use the service role.
revoke all on public.social_connections from anon;
revoke all on public.social_connections from authenticated;
grant select (id, broker_id, fb_user_id, page_id, page_name, ig_user_id, ig_username,
              token_expires_at, connected_at, updated_at)
  on public.social_connections to authenticated;
grant delete on public.social_connections to authenticated;

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references public.profiles(id) on delete cascade,
  source_kind text not null default 'reel_service_job',
  source_id uuid not null,
  platform text not null check (platform in ('facebook', 'instagram')),
  page_id text not null,
  connection_id uuid references public.social_connections(id) on delete set null,
  caption text,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'posting', 'posted', 'failed', 'cancelled')),
  scheduled_for timestamptz,
  external_id text,   -- Facebook video id / Instagram media id (container id while processing)
  permalink text,
  error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists social_posts_due_idx on public.social_posts(status, scheduled_for);
create index if not exists social_posts_source_idx on public.social_posts(source_kind, source_id);
create index if not exists social_posts_broker_idx on public.social_posts(broker_id, created_at desc);

alter table public.social_posts enable row level security;

drop policy if exists "social_posts admin all" on public.social_posts;
create policy "social_posts admin all" on public.social_posts
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "social_posts broker reads own" on public.social_posts;
create policy "social_posts broker reads own" on public.social_posts
  for select using (broker_id = auth.uid());
