-- Nov 12, 2026 — Billing: a richer boat snapshot on invoices (make, model,
-- year), so the PDF, the client page (/inv) and the editor can show
-- "Sylvia" / "2019 Marquis 650 · 65 ft". Run after
-- 20261112_demo_rw_filming_account.sql (order between the two doesn't matter).
--
-- Additive and re-runnable. No new table, no RLS change (nothing for
-- demo_apply_readonly_policies to do). Like boat_name / boat_length_ft these
-- are a SNAPSHOT taken when the boat is picked — editing the listing later
-- never changes an invoice.
--
--  1. billing_invoices.boat_make / boat_model (text) and boat_year (integer).
--  2. Backfill: invoices that are linked to a listing (listing_id set) and
--     have none of the three yet get them from that listing. Blank text
--     becomes null; a year outside 1900–2100 is left null. Rows whose listing
--     is gone are left alone.
--
-- The app tolerates the columns being missing until this is applied (they are
-- dropped from writes and read as null).

set local lock_timeout = '5s';

alter table public.billing_invoices
  add column if not exists boat_make text,
  add column if not exists boat_model text,
  add column if not exists boat_year integer;

update public.billing_invoices i
   set boat_make  = nullif(btrim(l.make), ''),
       boat_model = nullif(btrim(l.model), ''),
       boat_year  = case when l.year between 1900 and 2100 then l.year else null end
  from public.listings l
 where i.listing_id is not null
   and l.id = i.listing_id
   and i.boat_make is null
   and i.boat_model is null
   and i.boat_year is null
   and (nullif(btrim(l.make), '') is not null
        or nullif(btrim(l.model), '') is not null
        or l.year between 1900 and 2100);

do $$
declare n int;
begin
  select count(*) into n from public.billing_invoices
   where listing_id is not null and (boat_make is not null or boat_model is not null or boat_year is not null);
  raise notice 'billing: % linked invoice(s) now carry boat make / model / year', n;
end $$;
