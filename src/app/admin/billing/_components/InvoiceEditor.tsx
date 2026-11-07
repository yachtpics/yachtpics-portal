"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardBody, CardHeader } from "@/components/ui";
import {
  BRAND_LABEL,
  LOCKED_MESSAGE,
  METHOD_LABEL,
  PAYMENT_METHODS,
  dateET,
  fmtDate,
  fmtMoney,
  fmtPct,
  isLockedInvoice,
  isOverdue,
  todayET,
  type BillingInvoice,
  type BillingItem,
  type BillingPayment,
  type BrandKey,
  type InvoiceLine,
  type PaymentMethod,
} from "@/lib/books/types";
import { calcInvoice, calcLine } from "@/lib/books/totals";
import { booksCall, fieldClass } from "./booksApi";
import StatusBadge from "./StatusBadge";

/*
 * The invoice editor. Lines are snapshots: picking a catalog item copies its
 * name, description, rate, unit and tax onto the line; editing the catalog
 * later never changes this invoice. Totals here are a live preview — the
 * server recalculates (billing_recalc_invoice) on every save.
 *
 * Void-only rule: once sent (sent / partial / paid / void) the invoice is
 * read-only — only the internal note and a by-hand due date can change. To
 * change anything else: Void, then Duplicate.
 *
 * Dates: Invoice date (issue_date) — editable on a draft, pre-filled from the
 * boat's shoot date when a listing is picked. Sent — stamped at first send.
 * Due — due on receipt: blank on a draft and set to the sent date at first
 * send, unless typed by hand (due_date_manual; "Reset to default" clears it).
 */

export type PickerClient = { id: string; display_name: string; company_name: string | null; email: string | null; status: string };

type EditLine = InvoiceLine & { key: string; saveToCatalog?: boolean; fromLength?: boolean };
type Header = {
  brand: BrandKey;
  client_id: string | null;
  listing_id: string | null;
  boat_name: string;
  boat_length_ft: string;
  issue_date: string;
  due_date: string;
  due_manual: boolean;
  note: string;
  internal_note: string;
  is_test: boolean;
};
type ListingHit = { id: string; name: string; lengthFt: number | null; detail: string; broker: string | null; suggestedClient: { id: string; display_name: string } | null; shootDate: string | null };

let seq = 0;
const k = () => `l${Date.now()}${seq++}`;

export default function InvoiceEditor({
  invoice,
  lines: initialLines,
  payments,
  clients: initialClients,
  items,
  isOwner,
  brands,
  publicUrl,
}: {
  invoice: BillingInvoice;
  lines: InvoiceLine[];
  payments: BillingPayment[];
  clients: PickerClient[];
  items: BillingItem[];
  isOwner: boolean;
  brands: BrandKey[];
  publicUrl: string;
}) {
  const router = useRouter();
  const inv = invoice;
  // Sent (or paid / void): read-only, void-only rule.
  const locked = isLockedInvoice(inv);
  const isVoid = inv.status === "void";
  const sentOnce = inv.status !== "draft";
  const numbered = !!inv.number;
  const [clients, setClients] = useState<PickerClient[]>(initialClients);
  const [h, setH] = useState<Header>({
    brand: inv.brand,
    client_id: inv.client_id,
    listing_id: inv.listing_id,
    boat_name: inv.boat_name ?? "",
    boat_length_ft: inv.boat_length_ft == null ? "" : String(inv.boat_length_ft),
    issue_date: inv.issue_date,
    due_date: inv.due_date ?? "",
    due_manual: !!inv.due_date_manual,
    note: inv.note ?? "",
    internal_note: inv.internal_note ?? "",
    is_test: !!inv.is_test,
  });
  // The due date is only sent to the server when it was changed or reset here.
  const [dueTouched, setDueTouched] = useState(false);
  const [issueFromShoot, setIssueFromShoot] = useState(false);
  const [lines, setLines] = useState<EditLine[]>(initialLines.map((l) => ({ ...l, key: l.id ?? k() })));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const setHeader = (patch: Partial<Header>) => { setH({ ...h, ...patch }); setDirty(true); };
  const setLine = (i: number, patch: Partial<EditLine>) => {
    const next = lines.slice();
    next[i] = { ...next[i], ...patch };
    setLines(next);
    setDirty(true);
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= lines.length) return;
    const next = lines.slice();
    const t = next[i]; next[i] = next[j]; next[j] = t;
    setLines(next);
    setDirty(true);
  };
  const remove = (i: number) => { setLines(lines.filter((_, x) => x !== i)); setDirty(true); };

  const hasFee = lines.some((l) => l.kind === "card_fee");
  const totals = useMemo(() => calcInvoice(lines, inv.tax_rate, inv.card_fee_rate), [lines, inv.tax_rate, inv.card_fee_rate]);
  const boatFt = Number(h.boat_length_ft) || 0;

  const toggleFee = () => {
    if (hasFee) setLines(lines.filter((l) => l.kind !== "card_fee"));
    else setLines(lines.concat([{ key: k(), position: lines.length, item_id: null, kind: "card_fee", name: `Credit card fee ${fmtPct(inv.card_fee_rate)}`, description: null, quantity: 1, unit: "each", unit_price: 0, discount_type: null, discount_value: null, taxable: false }]));
    setDirty(true);
  };

  const addItem = (it: BillingItem) => {
    if (it.kind === "card_fee") { if (!hasFee) toggleFee(); return; }
    const perFt = it.unit === "ft";
    const line: EditLine = {
      key: k(),
      position: lines.length,
      item_id: it.id,
      kind: it.kind,
      name: it.name,
      description: it.description,
      quantity: perFt && boatFt ? boatFt : 1,
      unit: it.unit,
      unit_price: Number(it.rate),
      discount_type: null,
      discount_value: null,
      taxable: it.taxable,
      fromLength: perFt && !!boatFt,
    };
    // Keep the card fee last.
    const fee = lines.filter((l) => l.kind === "card_fee");
    setLines(lines.filter((l) => l.kind !== "card_fee").concat([line], fee));
    setDirty(true);
  };
  const addCustom = () => {
    const fee = lines.filter((l) => l.kind === "card_fee");
    setLines(lines.filter((l) => l.kind !== "card_fee").concat([{ key: k(), position: 0, item_id: null, kind: "custom", name: "", description: null, quantity: 1, unit: "each", unit_price: 0, discount_type: null, discount_value: null, taxable: false, saveToCatalog: false }], fee));
    setDirty(true);
  };

  /** Save header + lines. Returns false on error. */
  const save = async (): Promise<boolean> => {
    setError(null);
    // "Save to catalog" custom lines become items first.
    const next = lines.slice();
    for (let i = 0; i < next.length; i++) {
      const l = next[i];
      if (l.kind === "custom" && l.saveToCatalog && !l.item_id && l.name.trim()) {
        const { error: err, data } = await booksCall("/api/admin/books/items", "POST", {
          name: l.name, description: l.description, rate: l.unit_price, unit: l.unit, kind: "standard", brand: h.brand,
          ...(isOwner ? { taxable: l.taxable, tax_exempt_reason: l.taxable ? null : "Digital Download" } : {}),
        });
        if (err) { setError(`Couldn't save "${l.name}" to the catalog: ${err}`); return false; }
        next[i] = { ...l, item_id: (data?.id as string) ?? null, kind: "standard", saveToCatalog: false };
      }
    }
    const due = dueTouched ? { due_date: h.due_manual && h.due_date ? h.due_date : null } : {};
    if (locked) {
      // After send only the internal note and a by-hand due date can change.
      const a = await booksCall(`/api/admin/books/invoices/${inv.id}`, "PATCH", { internal_note: h.internal_note, ...(isVoid ? {} : due) });
      if (a.error) { setError(a.error); return false; }
      setDirty(false);
      setDueTouched(false);
      return true;
    }
    const head: Record<string, unknown> = {
      client_id: h.client_id,
      listing_id: h.listing_id,
      boat_name: h.boat_name,
      boat_length_ft: h.boat_length_ft === "" ? null : h.boat_length_ft,
      issue_date: h.issue_date,
      note: h.note,
      internal_note: h.internal_note,
      ...due,
    };
    if (!numbered && h.brand !== inv.brand) head.brand = h.brand;
    if (!numbered && h.is_test !== !!inv.is_test) head.is_test = h.is_test;
    const a = await booksCall(`/api/admin/books/invoices/${inv.id}`, "PATCH", head);
    if (a.error) { setError(a.error); return false; }
    const b = await booksCall(`/api/admin/books/invoices/${inv.id}/lines`, "PUT", { lines: next });
    if (b.error) { setError(b.error); return false; }
    setDirty(false);
    setDueTouched(false);
    return true;
  };

  const run = async (label: string, fn: () => Promise<boolean | void>) => {
    setBusy(label);
    setNotice(null);
    const ok = await fn();
    setBusy(null);
    if (ok !== false) router.refresh();
  };

  const preview = async () => {
    // Open the tab first (pop-up blockers), then point it at the PDF once saved.
    const w = window.open("", "_blank");
    setBusy("preview");
    const ok = dirty ? await save() : true;
    setBusy(null);
    if (!ok) { w?.close(); return; }
    const url = `/api/admin/books/invoices/${inv.id}/pdf?t=${Date.now()}`;
    if (w) w.location.href = url; else window.location.href = url;
    if (dirty) router.refresh();
  };

  const duplicate = () => run("dup", async () => {
    const r = await booksCall(`/api/admin/books/invoices/${inv.id}/duplicate`, "POST", {});
    if (r.error) { setError(r.error); return false; }
    router.push(`/admin/billing/invoices/${r.data?.id as string}`);
    return false;
  });
  const voidIt = () => {
    if (!window.confirm(`Void ${inv.is_test ? "this test invoice" : inv.number ?? "this invoice"}? It keeps its number but no longer counts as owed.`)) return;
    run("void", async () => {
      const r = await booksCall(`/api/admin/books/invoices/${inv.id}/void`, "POST", {});
      if (r.error) { setError(r.error); return false; }
    });
  };
  const del = async () => {
    if (!window.confirm(inv.is_test ? "Delete this test invoice? Its lines and any payments go with it." : "Delete this draft?")) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/admin/books/invoices/${inv.id}`, { method: "DELETE" });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setError(d.error ?? "Couldn't delete."); setBusy(null); return; }
      router.push("/admin/billing?tab=invoices");
    } catch {
      setError("Couldn't reach the Portal.");
      setBusy(null);
    }
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(publicUrl); setNotice("Link copied."); } catch { window.prompt("Copy this link", publicUrl); }
  };
  const deletePayment = (p: BillingPayment) => {
    if (!window.confirm(`Remove the ${METHOD_LABEL[p.method]} payment of ${fmtMoney(p.amount)}?`)) return;
    run("pay-del", async () => {
      try {
        const res = await fetch(`/api/admin/books/invoices/${inv.id}/payments?paymentId=${p.id}`, { method: "DELETE" });
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) { setError(d.error ?? "Couldn't remove it."); return false; }
      } catch { setError("Couldn't reach the Portal."); return false; }
    });
  };

  const client = clients.filter((c) => c.id === h.client_id)[0] ?? null;
  const catalog = items.filter((i) => i.active && (i.brand === "both" || i.brand === h.brand));
  const overdue = isOverdue(inv);

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <Link href="/admin/billing?tab=invoices" className="text-small text-ink-500 hover:text-ink-900">← Invoices</Link>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <h1 className="text-display text-ink-900 tabular-nums">{inv.is_test ? "TEST invoice" : inv.number ?? "Draft invoice"}</h1>
            <StatusBadge status={inv.status} overdue={overdue} />
            {inv.is_test && <Badge>Test</Badge>}
            {brands.length > 1 && <Badge>{BRAND_LABEL[inv.brand]}</Badge>}
          </div>
          <p className="text-small text-ink-500 mt-1">
            {inv.sent_at ? `Sent ${fmtDate(inv.sent_at.slice(0, 10))}${inv.sent_to ? ` to ${inv.sent_to}` : ""}` : "Not sent yet"}
            {inv.view_count ? ` · Viewed ${inv.view_count}× · last ${fmtDate((inv.last_viewed_at ?? "").slice(0, 10))}` : inv.sent_at ? " · Not viewed yet" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => run("save", save)} disabled={!!busy || !dirty}>{busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}</Button>
          <Button size="sm" variant="secondary" onClick={preview} disabled={!!busy}>{busy === "preview" ? "Opening…" : "Preview PDF"}</Button>
          {!isVoid && <Button size="sm" onClick={() => { setError(null); setSendOpen(true); }} disabled={!!busy}>{sentOnce ? "Resend" : "Send"}</Button>}
        </div>
      </div>

      {locked && (
        <div className="rounded-card border border-hairline bg-ink-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-ink-700">{LOCKED_MESSAGE}{isVoid ? "" : " The internal note and the due date can still change."}</p>
          <div className="flex gap-2 shrink-0">
            {!isVoid && <Button size="sm" variant="secondary" onClick={voidIt} disabled={!!busy}>Void</Button>}
            <Button size="sm" variant="secondary" onClick={duplicate} disabled={!!busy}>{busy === "dup" ? "Copying…" : "Duplicate"}</Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-danger-700 bg-danger-50 border border-danger-200 rounded-ctl px-3 py-2">{error}</p>}
      {notice && <p className="text-sm text-success-700">{notice}</p>}

      {/* Payments (after send) */}
      {inv.status !== "draft" && (
        <Card>
          <CardHeader
            title={inv.status === "paid" ? "Paid" : `Balance due ${fmtMoney(inv.balance_due)}`}
            kicker="Payments"
            description={inv.due_date && inv.status !== "paid" && inv.status !== "void" ? `Due ${fmtDate(inv.due_date)}` : inv.card_fee_waived ? `Card fee of ${fmtMoney(inv.card_fee_waived)} not charged (paid another way)` : undefined}
            action={!isVoid && <Button size="sm" onClick={() => setPayOpen(true)}>Record payment</Button>}
          />
          <CardBody className="space-y-3">
            {payments.length === 0 ? (
              <p className="text-sm text-ink-500">No payments yet.</p>
            ) : (
              <ul className="divide-y divide-hairline border-y border-hairline">
                {payments.map((p) => (
                  <li key={p.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <span className="text-ink-900">{METHOD_LABEL[p.method]}</span>
                      <span className="text-ink-500"> · {fmtDate(p.paid_on)}{p.reference ? ` · ${p.reference}` : ""}{p.source !== "manual" ? ` · ${p.source}` : ""}</span>
                      {p.note && <span className="block text-small text-ink-500">{p.note}</span>}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="tabular-nums text-ink-900">{fmtMoney(p.amount)}</span>
                      {p.source === "manual" && <button type="button" className="text-small text-ink-400 hover:text-danger-700" onClick={() => deletePayment(p)} aria-label="Remove payment">Remove</button>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={copyLink}>Copy client link</Button>
              <a href={publicUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-ink-500 hover:text-ink-900 px-3 py-2">Open client view ↗</a>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Header */}
      <Card>
        <CardHeader title="Bill to" kicker={numbered || locked ? BRAND_LABEL[inv.brand] : undefined} />
        <CardBody className="space-y-4">
          {!numbered && !locked && brands.length > 1 && (
            <div className="inline-flex rounded-ctl border border-hairline-strong p-0.5">
              {brands.map((b) => (
                <button key={b} type="button" disabled={locked} onClick={() => setHeader({ brand: b })}
                  className={`px-3 py-1.5 rounded-[6px] text-xs font-semibold ${h.brand === b ? "bg-accent-500 text-ink-950" : "text-ink-500 hover:text-ink-900"}`}>
                  {BRAND_LABEL[b]}
                </button>
              ))}
            </div>
          )}
          <ClientPicker
            clients={clients}
            value={client}
            disabled={locked}
            onPick={(c) => setHeader({ client_id: c ? c.id : null })}
            onAdded={(c) => { setClients(clients.concat([c])); setHeader({ client_id: c.id }); }}
          />
          {h.brand === "yachtpics" && (
            <BoatPicker
              disabled={locked}
              boatName={h.boat_name}
              boatLength={h.boat_length_ft}
              onManual={(patch) => setHeader(patch)}
              onPick={(hit) => {
                const patch: Partial<Header> = { listing_id: hit.id, boat_name: hit.name, boat_length_ft: hit.lengthFt == null ? h.boat_length_ft : String(hit.lengthFt) };
                // A draft's invoice date follows the boat's shoot date (ET), when there is one.
                if (hit.shootDate && inv.status === "draft") { patch.issue_date = hit.shootDate; setIssueFromShoot(true); }
                if (!h.client_id && hit.suggestedClient) {
                  patch.client_id = hit.suggestedClient.id;
                  if (!clients.some((c) => c.id === hit.suggestedClient!.id)) {
                    setClients(clients.concat([{ id: hit.suggestedClient.id, display_name: hit.suggestedClient.display_name, company_name: null, email: null, status: "active" }]));
                  }
                }
                // Per-foot lines that came from the old length follow the new one.
                if (hit.lengthFt) setLines(lines.map((l) => (l.unit === "ft" && (l.fromLength || !l.quantity || l.quantity === 1) ? { ...l, quantity: hit.lengthFt as number, fromLength: true } : l)));
                setHeader(patch);
              }}
              onClear={() => setHeader({ listing_id: null })}
              linked={!!h.listing_id}
            />
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="label-caps">Invoice date{issueFromShoot && !locked ? <span className="normal-case tracking-normal font-normal text-ink-400"> · from shoot date</span> : null}</span>
              <input type="date" className={fieldClass + " mt-1"} disabled={locked} value={h.issue_date}
                onChange={(e) => { if (e.target.value) { setHeader({ issue_date: e.target.value }); setIssueFromShoot(false); } }} />
            </label>
            <div className="block">
              <span className="label-caps">Sent</span>
              <p className="text-sm text-ink-700 mt-1 leading-[2.5rem]">{inv.sent_at ? fmtDate(dateET(inv.sent_at)) : "Not sent yet"}</p>
            </div>
            <div className="block">
              <span className="label-caps">Due date</span>
              {h.due_manual ? (
                <>
                  <input type="date" className={fieldClass + " mt-1"} disabled={isVoid} value={h.due_date}
                    onChange={(e) => { setHeader({ due_date: e.target.value, due_manual: true }); setDueTouched(true); }} />
                  {!isVoid && (
                    <button type="button" className="text-small text-ink-500 hover:text-ink-900 mt-1"
                      onClick={() => { setHeader({ due_manual: false, due_date: inv.status === "draft" ? "" : dateET(inv.sent_at) ?? h.due_date }); setDueTouched(true); }}>
                      Reset to default (due on receipt)
                    </button>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm text-ink-700 mt-1 leading-[2.5rem]">
                    {inv.status === "draft" ? "Due on receipt (set when sent)" : `${fmtDate(h.due_date) || "—"} · due on receipt`}
                  </p>
                  {!isVoid && (
                    <button type="button" className="text-small text-ink-500 hover:text-ink-900"
                      onClick={() => { setHeader({ due_manual: true, due_date: h.due_date || todayET() }); setDueTouched(true); }}>
                      Set a due date by hand
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          {inv.status === "draft" && !numbered && (
            <label className="inline-flex items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" className="h-4 w-4 accent-[#c39e4e]" checked={h.is_test} onChange={(e) => setHeader({ is_test: e.target.checked })} />
              Test invoice
              <span className="text-small text-ink-500">— never numbered, left out of totals; emails only to staff or @yachtpics.com addresses.</span>
            </label>
          )}
        </CardBody>
      </Card>

      {/* Lines */}
      <Card>
        <CardHeader title="Lines" description={isOwner ? undefined : "Tax follows each catalog item's setting."} />
        <CardBody className="space-y-3">
          {lines.length === 0 && <p className="text-sm text-ink-500">No lines yet — add from the catalog or type a custom line.</p>}
          {lines.map((l, i) => (
            <LineRow key={l.key} line={l} index={i} count={lines.length} isOwner={isOwner} locked={locked} feeRate={inv.card_fee_rate} feeAmount={totals.cardFeeTotal}
              onChange={(p) => setLine(i, p)} onMove={(d) => move(i, d)} onRemove={() => remove(i)} />
          ))}
          {!locked && (
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <CatalogSearch items={catalog} onPick={addItem} />
              <Button size="sm" variant="secondary" onClick={addCustom}>Custom line</Button>
              <label className="inline-flex items-center gap-2 text-sm text-ink-700 sm:ml-auto">
                <input type="checkbox" checked={hasFee} onChange={toggleFee} className="h-4 w-4 accent-[#c39e4e]" />
                Add card fee ({fmtPct(inv.card_fee_rate)})
              </label>
            </div>
          )}

          <dl className="ml-auto max-w-xs text-sm space-y-1.5 tabular-nums pt-3">
            <TRow k="Subtotal" v={fmtMoney(totals.subtotal)} />
            {totals.discountTotal ? <TRow k="Discounts" v={"-" + fmtMoney(totals.discountTotal)} /> : null}
            {totals.taxTotal ? <TRow k={`Sales tax ${fmtPct(inv.tax_rate)}`} v={fmtMoney(totals.taxTotal)} /> : null}
            {totals.cardFeeTotal ? <TRow k={`Card fee ${fmtPct(inv.card_fee_rate)}`} v={fmtMoney(totals.cardFeeTotal)} /> : null}
            <TRow k="Total" v={fmtMoney(totals.total)} strong />
            {inv.amount_paid ? <TRow k="Paid" v={"-" + fmtMoney(inv.amount_paid)} /> : null}
          </dl>
        </CardBody>
      </Card>

      {/* Notes */}
      <Card>
        <CardBody className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="label-caps">Note on the invoice</span>
            <textarea className={fieldClass + " mt-1 min-h-[80px]"} disabled={locked} value={h.note} onChange={(e) => setHeader({ note: e.target.value })} />
          </label>
          <label className="block">
            <span className="label-caps">Internal note (never printed)</span>
            <textarea className={fieldClass + " mt-1 min-h-[80px]"} value={h.internal_note} onChange={(e) => setHeader({ internal_note: e.target.value })} />
          </label>
        </CardBody>
      </Card>

      {/* Secondary actions */}
      <div className="flex flex-wrap gap-2 pb-6">
        {!locked && <Button size="sm" variant="ghost" onClick={duplicate} disabled={!!busy}>Duplicate</Button>}
        {inv.is_test ? (
          <Button size="sm" variant="ghost" className="text-danger-700" onClick={del} disabled={!!busy}>Delete test invoice</Button>
        ) : !numbered && inv.status === "draft" ? (
          <Button size="sm" variant="ghost" className="text-danger-700" onClick={del} disabled={!!busy}>Delete draft</Button>
        ) : null}
        {sentOnce && <Button size="sm" variant="ghost" onClick={copyLink}>Copy client link</Button>}
      </div>

      {sendOpen && (
        <SendDialog
          defaultTo={inv.sent_to || (h.is_test ? "" : client?.email) || ""}
          resend={sentOnce}
          test={h.is_test}
          canMarkSent={inv.status === "draft"}
          busy={busy === "send"}
          onClose={() => setSendOpen(false)}
          onSend={async (to, email) => {
            setBusy("send");
            setError(null);
            if (dirty && !(await save())) { setBusy(null); return; }
            const r = await booksCall(`/api/admin/books/invoices/${inv.id}/send`, "POST", { to, email });
            setBusy(null);
            if (r.error) { setError(r.error); setSendOpen(false); router.refresh(); return; }
            setSendOpen(false);
            const label = h.is_test ? "Test invoice" : (r.data?.number as string);
            setNotice(email ? `Sent ${label} to ${to}.` : `${label} marked as sent.`);
            router.refresh();
          }}
        />
      )}
      {payOpen && (
        <PaymentSheet
          balance={Math.max(inv.balance_due, 0)}
          feeIncluded={inv.card_fee_total}
          onClose={() => setPayOpen(false)}
          onSave={async (body) => {
            const r = await booksCall(`/api/admin/books/invoices/${inv.id}/payments`, "POST", body);
            if (r.error) return r.error;
            setPayOpen(false);
            router.refresh();
            return null;
          }}
        />
      )}
    </div>
  );
}

function TRow({ k: label, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-6 ${strong ? "pt-1.5 border-t border-hairline font-semibold text-ink-900" : "text-ink-600"}`}>
      <dt>{label}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function LineRow({
  line: l, index, count, isOwner, locked, feeRate, feeAmount, onChange, onMove, onRemove,
}: {
  line: EditLine; index: number; count: number; isOwner: boolean; locked: boolean; feeRate: number; feeAmount: number;
  onChange: (p: Partial<EditLine>) => void; onMove: (d: number) => void; onRemove: () => void;
}) {
  const calc = calcLine(l);
  const ctl = (
    <div className="flex items-center gap-1 shrink-0">
      <button type="button" disabled={locked || index === 0} onClick={() => onMove(-1)} className="h-7 w-7 rounded-ctl text-ink-400 hover:text-ink-900 hover:bg-ink-100 disabled:opacity-30" aria-label="Move up">↑</button>
      <button type="button" disabled={locked || index === count - 1} onClick={() => onMove(1)} className="h-7 w-7 rounded-ctl text-ink-400 hover:text-ink-900 hover:bg-ink-100 disabled:opacity-30" aria-label="Move down">↓</button>
      <button type="button" disabled={locked} onClick={onRemove} className="h-7 w-7 rounded-ctl text-ink-400 hover:text-danger-700 hover:bg-danger-50 disabled:opacity-30" aria-label="Remove line">×</button>
    </div>
  );
  if (l.kind === "card_fee") {
    return (
      <div className="border border-hairline rounded-card px-4 py-3 flex items-center justify-between gap-3 bg-ink-50">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-900">Credit card fee {fmtPct(feeRate)}</p>
          <p className="text-small text-ink-500">Worked out on the total. The PDF tells the client to disregard it if paying by cash, check, Zelle or Venmo.</p>
        </div>
        <div className="flex items-center gap-2"><span className="text-sm tabular-nums">{fmtMoney(feeAmount)}</span>{ctl}</div>
      </div>
    );
  }
  return (
    <div className="border border-hairline rounded-card px-3 sm:px-4 py-3 space-y-2">
      <div className="flex items-start gap-2">
        <input className={fieldClass + " font-medium"} disabled={locked} placeholder="Description" value={l.name} onChange={(e) => onChange({ name: e.target.value })} />
        {ctl}
      </div>
      <textarea className={fieldClass + " text-small min-h-[38px]"} rows={1} disabled={locked} placeholder="Details (optional)" value={l.description ?? ""} onChange={(e) => onChange({ description: e.target.value })} />
      <div className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end">
        <label className="block sm:col-span-2">
          <span className="label-caps">Qty</span>
          <input className={fieldClass + " mt-1 tabular-nums"} inputMode="decimal" disabled={locked} value={String(l.quantity)}
            onChange={(e) => onChange({ quantity: (e.target.value === "" ? 0 : Number(e.target.value)) as number, fromLength: false })} />
        </label>
        <label className="block sm:col-span-2">
          <span className="label-caps">Unit</span>
          <select className={fieldClass + " mt-1"} disabled={locked} value={l.unit} onChange={(e) => onChange({ unit: e.target.value as "each" | "ft" })}>
            <option value="each">Each</option>
            <option value="ft">Per ft</option>
          </select>
        </label>
        <label className="block sm:col-span-3">
          <span className="label-caps">{l.kind === "discount" ? "Discount" : "Price"}</span>
          <input className={fieldClass + " mt-1 tabular-nums"} inputMode="decimal" disabled={locked} value={String(l.unit_price)}
            onChange={(e) => onChange({ unit_price: (e.target.value === "" ? 0 : Number(e.target.value.replace(/[$,]/g, ""))) as number })} />
        </label>
        {l.kind !== "discount" ? (
          <label className="block sm:col-span-3">
            <span className="label-caps">Line discount</span>
            <div className="flex gap-1 mt-1">
              <select className={fieldClass + " w-16 px-2"} disabled={locked} value={l.discount_type ?? ""} onChange={(e) => onChange({ discount_type: (e.target.value || null) as "amount" | "percent" | null })}>
                <option value="">—</option>
                <option value="amount">$</option>
                <option value="percent">%</option>
              </select>
              <input className={fieldClass + " tabular-nums"} inputMode="decimal" disabled={locked || !l.discount_type} value={l.discount_value == null ? "" : String(l.discount_value)}
                onChange={(e) => onChange({ discount_value: e.target.value === "" ? null : Number(e.target.value) })} />
            </div>
          </label>
        ) : <div className="sm:col-span-3" />}
        <div className="sm:col-span-2 text-right col-span-2">
          <span className="label-caps block">Amount</span>
          <span className="text-sm tabular-nums text-ink-900 leading-[2.5rem]">{fmtMoney(calc.total)}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-ink-500">
        {l.fromLength && <span>Qty from boat length</span>}
        {isOwner ? (
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" className="h-3.5 w-3.5 accent-[#c39e4e]" disabled={locked} checked={l.taxable} onChange={(e) => onChange({ taxable: e.target.checked })} />Taxable</label>
        ) : (
          <span>{l.taxable ? "Taxable" : "Tax exempt"}</span>
        )}
        {l.kind === "custom" && !l.item_id && (
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" className="h-3.5 w-3.5 accent-[#c39e4e]" disabled={locked} checked={!!l.saveToCatalog} onChange={(e) => onChange({ saveToCatalog: e.target.checked })} />Save to catalog</label>
        )}
        {l.kind !== "standard" && l.kind !== "custom" && <span className="capitalize">{l.kind}</span>}
      </div>
    </div>
  );
}

function CatalogSearch({ items, onPick }: { items: BillingItem[]; onPick: (i: BillingItem) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const needle = q.trim().toLowerCase();
  const hits = items.filter((i) => !needle || (i.name + " " + (i.description ?? "")).toLowerCase().indexOf(needle) !== -1).slice(0, 12);
  return (
    <div className="relative flex-1">
      <input className={fieldClass} placeholder="Add from catalog…" value={q} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
      {open && hits.length > 0 && (
        <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border border-hairline-strong rounded-card shadow-elev-2 max-h-72 overflow-auto">
          {hits.map((i) => (
            <li key={i.id}>
              <button type="button" className="w-full text-left px-3 py-2 hover:bg-ink-50 flex justify-between gap-3" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(i); setQ(""); setOpen(false); }}>
                <span className="text-sm text-ink-900 truncate">{i.name}</span>
                <span className="text-small text-ink-500 tabular-nums shrink-0">{i.kind === "card_fee" ? "card fee" : `${fmtMoney(Number(i.rate))}${i.unit === "ft" ? "/ft" : ""}`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ClientPicker({ clients, value, disabled, onPick, onAdded }: {
  clients: PickerClient[]; value: PickerClient | null; disabled: boolean;
  onPick: (c: PickerClient | null) => void; onAdded: (c: PickerClient) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needle = q.trim().toLowerCase();
  const hits = needle
    ? clients.filter((c) => [c.display_name, c.company_name, c.email].some((v) => (v ?? "").toLowerCase().indexOf(needle) !== -1)).slice(0, 12)
    : [];

  const add = async () => {
    setBusy(true);
    setErr(null);
    const r = await booksCall("/api/admin/books/clients", "POST", { display_name: name, email });
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    onAdded({ id: r.data?.id as string, display_name: name.trim(), company_name: null, email: email.trim().toLowerCase() || null, status: "active" });
    setAdding(false); setName(""); setEmail(""); setQ("");
  };

  if (value) {
    return (
      <div className="flex items-start justify-between gap-3 border border-hairline rounded-card px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-900">{value.display_name}</p>
          <p className="text-small text-ink-500 break-words">{[value.company_name, value.email].filter(Boolean).join(" · ") || "No email on file"}</p>
        </div>
        {!disabled && <Button size="sm" variant="ghost" onClick={() => onPick(null)}>Change</Button>}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="relative">
        <input className={fieldClass} disabled={disabled} placeholder="Search clients by name, company or email" value={q}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
        {open && hits.length > 0 && (
          <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border border-hairline-strong rounded-card shadow-elev-2 max-h-72 overflow-auto">
            {hits.map((c) => (
              <li key={c.id}>
                <button type="button" className="w-full text-left px-3 py-2 hover:bg-ink-50" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(c); setQ(""); }}>
                  <span className="block text-sm text-ink-900">{c.display_name}{c.status === "inactive" ? " · inactive" : ""}</span>
                  <span className="block text-small text-ink-500 truncate">{[c.company_name, c.email].filter(Boolean).join(" · ")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!adding ? (
        <button type="button" disabled={disabled} className="text-small text-accent-700 hover:underline" onClick={() => { setAdding(true); setName(q); }}>+ Add a new client</button>
      ) : (
        <div className="border border-hairline rounded-card p-3 bg-ink-50 grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
          <label className="block sm:col-span-2"><span className="label-caps">Name</span><input className={fieldClass + " mt-1"} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="block sm:col-span-2"><span className="label-caps">Email</span><input className={fieldClass + " mt-1"} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <div className="flex gap-1"><Button size="sm" onClick={add} disabled={busy}>{busy ? "…" : "Add"}</Button><Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button></div>
          {err && <p className="text-small text-danger-700 sm:col-span-5">{err}</p>}
        </div>
      )}
    </div>
  );
}

function BoatPicker({ disabled, boatName, boatLength, linked, onPick, onManual, onClear }: {
  disabled: boolean; boatName: string; boatLength: string; linked: boolean;
  onPick: (h: ListingHit) => void; onManual: (p: Partial<Header>) => void; onClear: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ListingHit[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const search = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 2) { setHits([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/books/listings/search?q=${encodeURIComponent(v.trim())}`);
        const d = (await res.json().catch(() => ({}))) as { listings?: ListingHit[] };
        setHits(d.listings ?? []);
        setOpen(true);
      } catch { setHits([]); }
    }, 250);
  };
  return (
    <div className="space-y-2">
      <span className="label-caps">Boat</span>
      <div className="relative">
        <input className={fieldClass} disabled={disabled} placeholder="Find a Portal listing by boat name…" value={q}
          onFocus={() => hits.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => search(e.target.value)} />
        {open && hits.length > 0 && (
          <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border border-hairline-strong rounded-card shadow-elev-2 max-h-72 overflow-auto">
            {hits.map((hit) => (
              <li key={hit.id}>
                <button type="button" className="w-full text-left px-3 py-2 hover:bg-ink-50" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(hit); setQ(""); setOpen(false); }}>
                  <span className="block text-sm text-ink-900">{hit.name}{hit.lengthFt ? ` · ${hit.lengthFt} ft` : ""}</span>
                  <span className="block text-small text-ink-500 truncate">{[hit.detail, hit.broker, hit.suggestedClient ? `bills to ${hit.suggestedClient.display_name}` : null].filter(Boolean).join(" · ")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <input className={fieldClass + " col-span-2"} disabled={disabled} placeholder="Boat name" value={boatName} onChange={(e) => onManual({ boat_name: e.target.value })} />
        <input className={fieldClass + " tabular-nums"} disabled={disabled} inputMode="decimal" placeholder="Length ft" value={boatLength} onChange={(e) => onManual({ boat_length_ft: e.target.value })} />
      </div>
      {linked && !disabled && <button type="button" className="text-small text-ink-500 hover:text-ink-900" onClick={onClear}>Linked to the Portal listing · unlink</button>}
    </div>
  );
}

function SendDialog({ defaultTo, resend, test, canMarkSent, busy, onClose, onSend }: {
  defaultTo: string; resend: boolean; test: boolean; canMarkSent: boolean; busy: boolean;
  onClose: () => void; onSend: (to: string, email: boolean) => void;
}) {
  const [to, setTo] = useState(defaultTo);
  return (
    <Overlay onClose={onClose}>
      <h2 className="text-h2 text-ink-900">{test ? (resend ? "Resend test invoice" : "Send test invoice") : resend ? "Resend invoice" : "Send invoice"}</h2>
      <p className="text-small text-ink-500 mt-1">
        {test
          ? "A test invoice gets no number. It can only go to a billing staff address or an @yachtpics.com address."
          : resend ? "Same number, a fresh email with the PDF attached." : "It gets its number now, and the client gets an email with a link and the PDF. It can't be edited after this — only voided."}
      </p>
      <label className="block mt-4">
        <span className="label-caps">To</span>
        <input className={fieldClass + " mt-1"} type="email" value={to} onChange={(e) => setTo(e.target.value)} autoFocus />
      </label>
      <div className="flex flex-wrap gap-2 mt-5">
        <Button onClick={() => onSend(to, true)} disabled={busy || !to.trim()}>{busy ? "Sending…" : "Send"}</Button>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        {canMarkSent && <Button variant="ghost" className="sm:ml-auto" onClick={() => onSend(to, false)} disabled={busy}>Mark as sent, no email</Button>}
      </div>
    </Overlay>
  );
}

function PaymentSheet({ balance, feeIncluded, onClose, onSave }: {
  balance: number; feeIncluded: number;
  onClose: () => void; onSave: (b: Record<string, unknown>) => Promise<string | null>;
}) {
  const [method, setMethod] = useState<PaymentMethod>("zelle");
  const noFee = method !== "card" && method !== "paypal";
  const suggested = noFee && feeIncluded ? Math.max(balance - feeIncluded, 0) : balance;
  const [amount, setAmount] = useState(suggested.toFixed(2));
  const [touched, setTouched] = useState(false);
  const [date, setDate] = useState(todayET());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pick = (m: PaymentMethod) => {
    setMethod(m);
    if (!touched) {
      const nf = m !== "card" && m !== "paypal";
      setAmount((nf && feeIncluded ? Math.max(balance - feeIncluded, 0) : balance).toFixed(2));
    }
  };
  return (
    <Overlay onClose={onClose} sheet>
      <h2 className="text-h2 text-ink-900">Record payment</h2>
      <div className="flex flex-wrap gap-1.5 mt-4">
        {PAYMENT_METHODS.map((m) => (
          <button key={m} type="button" onClick={() => pick(m)}
            className={`px-3 py-2 rounded-ctl text-sm border ${method === m ? "bg-ink-950 text-white border-ink-950" : "bg-white text-ink-700 border-hairline-strong"}`}>
            {METHOD_LABEL[m]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 mt-4">
        <label className="block">
          <span className="label-caps">Amount</span>
          <input className={fieldClass + " mt-1 text-lg tabular-nums"} inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setTouched(true); }} />
        </label>
        <label className="block">
          <span className="label-caps">Date</span>
          <input type="date" className={fieldClass + " mt-1"} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block col-span-2">
          <span className="label-caps">Reference (check #, Zelle id)</span>
          <input className={fieldClass + " mt-1"} value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
        <label className="block col-span-2">
          <span className="label-caps">Note</span>
          <input className={fieldClass + " mt-1"} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      {noFee && feeIncluded > 0 && <p className="text-small text-ink-500 mt-2">Paid by {METHOD_LABEL[method]}, so the {fmtMoney(feeIncluded)} card fee is left off — the invoice still shows as paid in full.</p>}
      {err && <p className="text-sm text-danger-700 mt-2">{err}</p>}
      <div className="flex gap-2 mt-5">
        <Button className="flex-1 sm:flex-none" disabled={busy} onClick={async () => {
          setBusy(true); setErr(null);
          const e = await onSave({ method, amount, paid_on: date, reference, note });
          setBusy(false);
          if (e) setErr(e);
        }}>{busy ? "Saving…" : "Save payment"}</Button>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      </div>
    </Overlay>
  );
}

function Overlay({ children, onClose, sheet }: { children: React.ReactNode; onClose: () => void; sheet?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-950/40" onClick={onClose}>
      <div
        className={`bg-white w-full sm:max-w-md shadow-elev-3 px-5 pt-5 pb-7 sm:p-6 ${sheet ? "rounded-t-surface sm:rounded-surface" : "rounded-t-surface sm:rounded-surface"} max-h-[92vh] overflow-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
