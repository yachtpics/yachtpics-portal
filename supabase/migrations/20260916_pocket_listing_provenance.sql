-- Sept 16, 2026 — who made it a pocket listing.
--
-- `showcase_opt_out` has always been "the broker's veto", and the admin page
-- says so in as many words: "Broker kept this a pocket listing." That was true
-- while the broker was the only one who could set it. The admin listing page
-- now carries the same switch (Charlie: "everything a broker can do the admin
-- should be able to do as well"), which makes that sentence a guess the moment
-- it ships — and it is the wrong guess to make, because the one decision the
-- flag exists to inform is whether it is safe to override.
--
-- Overriding your own note is housekeeping. Overriding a broker's instruction
-- about their client's privacy is a different act, and the screen should be
-- able to tell you which one you are about to do.
--
-- Both nullable: every existing row predates the admin switch, so a null
-- `showcase_opt_out_by` on a listing that IS opted out means the broker set it,
-- which is exactly what was true before today.
--
-- Additive only; safe to run twice.

alter table public.listings
  add column if not exists showcase_opt_out_by uuid,
  add column if not exists showcase_opt_out_at timestamptz;
