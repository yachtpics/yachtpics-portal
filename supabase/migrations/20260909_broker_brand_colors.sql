-- Applied live on 2026-09-09 via the Supabase MCP; kept here so the repo
-- matches the database.
--
-- A broker's brand colours for the Reel: the accent (rules, lead-in, contact
-- line) and the ground (letterbox bars, gallery page, end card). Both optional
-- hex strings; null means "use the look's own palette".
alter table public.broker_details
  add column if not exists brand_accent text,
  add column if not exists brand_ground text;
