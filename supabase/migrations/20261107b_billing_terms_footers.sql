-- Nov 7, 2026 — Billing: due on receipt, three dates, Notes + Terms footer,
-- test invoices, void-only after send.
-- Run after 20261107_billing_invoicing.sql.
--
-- Additive and re-runnable. The code treats a missing column as "not
-- switched on yet" (due_date_manual / is_test / terms_text read as false /
-- empty until this runs).
set local lock_timeout = '5s';

-- ─── 1. Due on receipt — no net terms ─────────────────────────────────────
alter table public.billing_staff alter column default_terms_days set default 0;
update public.billing_staff set default_terms_days = 0, updated_at = now()
 where default_terms_days is distinct from 0;
alter table public.billing_invoices alter column terms_days set default 0;

-- ─── 2. Due date set by hand (else it is the sent date) ───────────────────
alter table public.billing_invoices add column if not exists due_date_manual boolean not null default false;

-- ─── 4. Test invoices: never numbered, kept out of every total ───────────
alter table public.billing_invoices add column if not exists is_test boolean not null default false;

-- ─── 3. Notes + Terms & Conditions footer ─────────────────────────────────
-- footer_note stays the "Notes" text; terms_text is the Terms block;
-- billing_staff_brands.payment_instructions are the per-login payment lines.
alter table public.billing_brands add column if not exists terms_text text;

update public.billing_brands
   set footer_note = 'Thanks for your business.',
       terms_text = E'Unlimited use license included when payment is received.\nYachtPics retains copyright ownership of all files.\nMay not resell photos/video.',
       updated_at = now()
 where key = 'yachtpics';

update public.billing_brands
   set footer_note = 'Thank you for your business. Every piece is made to order in North Palm Beach, FL.',
       terms_text = E'Custom orders go into production once payment, or the agreed deposit, is received.\nPlease check names, dates and artwork before approving. Items are engraved exactly as approved.\nPersonalized items cannot be returned, exchanged or refunded.\nDamaged or defective items: contact us within 2 days of delivery with a photo and your invoice number, and we will replace or refund the item.',
       updated_at = now()
 where key = 'ypdesigns';

-- Charlie (the owner), both brands. Checks are payable to "YachtPics" only.
update public.billing_staff_brands sb
   set payment_instructions = E'Make checks payable to: YachtPics\nZelle - charlie@yachtpics.com\nVenmo - @yachtpics',
       updated_at = now()
  from public.billing_staff s
 where s.profile_id = sb.profile_id and s.is_owner = true;

-- ─── 5. Totals: a void invoice owes nothing ───────────────────────────────
-- Same as 20261107 except balance_due is 0 once void (the void route now
-- recalculates after voiding, so totals stay consistent).
create or replace function public.billing_recalc_invoice(inv uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r billing_invoices%rowtype;
  v_sub numeric := 0; v_disc numeric := 0; v_taxbase numeric := 0; v_tax numeric := 0;
  v_fee numeric := 0; v_total numeric := 0; v_paid numeric := 0; v_waived numeric := 0;
  v_status text;
begin
  select * into r from billing_invoices where id = inv for update;
  if not found then return; end if;

  update billing_invoice_lines l set
    line_subtotal = case when l.kind = 'discount' then -abs(round(l.quantity * l.unit_price, 2))
                         else round(l.quantity * l.unit_price, 2) end,
    line_discount = case
      when l.kind in ('discount', 'card_fee') or l.discount_type is null or coalesce(l.discount_value, 0) = 0 then 0
      when l.discount_type = 'percent' then round(round(l.quantity * l.unit_price, 2) * least(greatest(l.discount_value, 0), 100) / 100, 2)
      else round(least(abs(l.discount_value), abs(round(l.quantity * l.unit_price, 2))) * sign(round(l.quantity * l.unit_price, 2)), 2)
    end
  where l.invoice_id = inv and l.kind <> 'card_fee';
  update billing_invoice_lines set line_total = line_subtotal - line_discount
   where invoice_id = inv and kind <> 'card_fee';

  select coalesce(sum(case when kind <> 'discount' then line_subtotal else 0 end), 0),
         coalesce(sum(case when kind = 'discount' then -line_subtotal else line_discount end), 0),
         coalesce(sum(case when taxable then line_total else 0 end), 0)
    into v_sub, v_disc, v_taxbase
    from billing_invoice_lines where invoice_id = inv and kind <> 'card_fee';

  v_tax := round(greatest(v_taxbase, 0) * r.tax_rate, 2);

  if exists (select 1 from billing_invoice_lines where invoice_id = inv and kind = 'card_fee') then
    v_fee := round(greatest(v_sub - v_disc + v_tax, 0) * r.card_fee_rate, 2);
    update billing_invoice_lines set
      quantity = 1, unit = 'each', unit_price = v_fee, taxable = false, discount_type = null, discount_value = null,
      line_subtotal = v_fee, line_discount = 0, line_total = v_fee
     where invoice_id = inv and kind = 'card_fee';
  end if;

  v_total := v_sub - v_disc + v_tax + v_fee;
  select coalesce(sum(amount), 0) into v_paid from billing_payments where invoice_id = inv;

  v_status := r.status;
  if r.status in ('sent', 'partial', 'paid') then
    if v_paid > 0 and v_paid >= v_total - v_fee - 0.005 then
      v_status := 'paid';
      v_waived := least(greatest(v_total - v_paid, 0), v_fee);
    elsif v_paid > 0 then
      v_status := 'partial';
    else
      v_status := 'sent';
    end if;
  end if;

  update billing_invoices set
    subtotal = v_sub,
    discount_total = v_disc,
    tax_total = v_tax,
    card_fee_total = v_fee,
    card_fee_waived = v_waived,
    total = v_total,
    amount_paid = v_paid,
    balance_due = case when v_status = 'void' then 0 else v_total - v_paid - v_waived end,
    status = v_status,
    paid_at = case when v_status = 'paid' then coalesce(r.paid_at, now()) else null end,
    updated_at = now()
  where id = inv;
end $$;

revoke all on function public.billing_recalc_invoice(uuid) from public, anon, authenticated;
grant execute on function public.billing_recalc_invoice(uuid) to service_role;
