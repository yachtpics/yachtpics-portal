/**
 * Invoice totals — the browser's live preview. The database function
 * billing_recalc_invoice (migration 20261107) is the source of truth and is
 * run after every save; keep the two formulas identical.
 *
 *  line subtotal = qty × unit price (discount-kind lines are always negative)
 *  line discount = amount, or percent of the line subtotal
 *  subtotal      = Σ subtotal of non-discount lines
 *  discounts     = Σ line discounts + Σ |discount-kind lines|
 *  tax           = rate × Σ line totals of taxable lines
 *  card fee      = fee rate × (subtotal − discounts + tax), when a card-fee line is on
 *  total         = subtotal − discounts + tax + card fee
 */
import type { InvoiceLine } from "./types";

const r2 = (n: number) => Math.round((n + (n >= 0 ? 1e-9 : -1e-9)) * 100) / 100;

export type LineCalc = { subtotal: number; discount: number; total: number };

export function calcLine(l: Pick<InvoiceLine, "kind" | "quantity" | "unit_price" | "discount_type" | "discount_value">): LineCalc {
  const raw = r2((Number(l.quantity) || 0) * (Number(l.unit_price) || 0));
  if (l.kind === "card_fee") return { subtotal: raw, discount: 0, total: raw };
  if (l.kind === "discount") {
    const s = -Math.abs(raw);
    return { subtotal: s, discount: 0, total: s };
  }
  let discount = 0;
  const v = Number(l.discount_value) || 0;
  if (l.discount_type === "percent" && v) discount = r2((raw * Math.min(Math.max(v, 0), 100)) / 100);
  else if (l.discount_type === "amount" && v) discount = r2(Math.min(Math.abs(v), Math.abs(raw)) * (raw < 0 ? -1 : 1));
  return { subtotal: raw, discount, total: r2(raw - discount) };
}

export type InvoiceCalc = {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  cardFeeTotal: number;
  total: number;
};

export function calcInvoice(lines: InvoiceLine[], taxRate: number, cardFeeRate: number): InvoiceCalc {
  let sub = 0;
  let disc = 0;
  let taxBase = 0;
  let hasFee = false;
  lines.forEach((l) => {
    if (l.kind === "card_fee") { hasFee = true; return; }
    const c = calcLine(l);
    if (l.kind === "discount") disc += -c.subtotal;
    else { sub += c.subtotal; disc += c.discount; }
    if (l.taxable) taxBase += c.total;
  });
  sub = r2(sub);
  disc = r2(disc);
  const tax = r2(Math.max(taxBase, 0) * (Number(taxRate) || 0));
  const fee = hasFee ? r2(Math.max(sub - disc + tax, 0) * (Number(cardFeeRate) || 0)) : 0;
  return { subtotal: sub, discountTotal: disc, taxTotal: tax, cardFeeTotal: fee, total: r2(sub - disc + tax + fee) };
}
