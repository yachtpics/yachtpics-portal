"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import { BRAND_LABEL, type BillingBrand, type BillingStaffRow, type StaffBrand } from "@/lib/books/types";
import { booksCall, fieldClass } from "./booksApi";

/** Owner-only: brands, logins and the Zoho re-pull. The page never renders this for anyone else. */
export default function SettingsPanel({ brands, people, invoicingReady }: { brands: BillingBrand[]; people: BillingStaffRow[]; invoicingReady: boolean }) {
  const missing: string[] = [];
  people.forEach((p) => p.brands.forEach((b) => {
    if (invoicingReady && !b.payment_instructions) missing.push(`${p.display_name}: no payment instructions yet for ${BRAND_LABEL[b.brand]}`);
  }));
  return (
    <div className="space-y-6">
      {missing.length > 0 && (
        <div className="rounded-card border border-warn-200 bg-warn-50 px-5 py-3 text-sm text-warn-700">
          {missing.map((m) => <p key={m}>{m} — the invoice&apos;s &ldquo;How to pay&rdquo; box and payment lines will be left off.</p>)}
        </div>
      )}
      {brands.map((b) => <BrandCard key={b.key} brand={b} />)}
      {people.map((p) => <PersonCard key={p.profile_id} person={p} invoicingReady={invoicingReady} />)}
      <BackupCard ready={invoicingReady} />
      <ImportCard />
    </div>
  );
}

function BackupCard({ ready }: { ready: boolean }) {
  return (
    <Card>
      <CardHeader
        title="Backups"
        kicker="Owner"
        description="Every Sunday the whole billing database (both books) is copied to private storage; the last 12 weeks are kept. Download a copy any time — a zip of spreadsheets with the shared lists and your own book."
      />
      <CardBody>
        <a
          href="/api/admin/books/backup"
          className={`inline-flex items-center justify-center rounded-ctl bg-white text-ink-700 border border-hairline-strong hover:border-ink-400 text-xs font-semibold px-3 py-2 ${ready ? "" : "opacity-40 pointer-events-none"}`}
        >
          Download backup (zip of CSVs)
        </a>
      </CardBody>
    </Card>
  );
}

function Field({ label, value, onChange, placeholder, wide }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; wide?: boolean }) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="label-caps">{label}</span>
      <input className={fieldClass + " mt-1"} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function useSaver() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (url: string, method: "POST" | "PATCH", body: unknown, okText = "Saved.") => {
    setBusy(true);
    setMsg(null);
    const res = await booksCall(url, method, body);
    setBusy(false);
    setMsg(res.error ? { ok: false, text: res.error } : { ok: true, text: okText });
    if (!res.error) router.refresh();
    return res;
  };
  return { busy, msg, run, setMsg };
}

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p className={`text-sm ${msg.ok ? "text-success-700" : "text-danger-700"}`}>{msg.text}</p>;
}

function BrandCard({ brand }: { brand: BillingBrand }) {
  const [f, setF] = useState({
    display_name: brand.display_name ?? "",
    legal_name: brand.legal_name ?? "",
    invoice_prefix: brand.invoice_prefix ?? "",
    logo_url: brand.logo_url ?? "",
    accent_color: brand.accent_color ?? "",
    address: brand.address ?? "",
    phone: brand.phone ?? "",
    email: brand.email ?? "",
    website: brand.website ?? "",
    footer_note: brand.footer_note ?? "",
    terms_text: brand.terms_text ?? "",
  });
  const { busy, msg, run } = useSaver();
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });

  return (
    <Card>
      <CardHeader title={brand.display_name || BRAND_LABEL[brand.key]} kicker="Brand" description="What prints on this brand's invoices." />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name" value={f.display_name} onChange={set("display_name")} />
          <Field label="Legal name" value={f.legal_name} onChange={set("legal_name")} />
          <Field label="Invoice prefix" value={f.invoice_prefix} onChange={set("invoice_prefix")} placeholder="YP" />
          <Field label="Accent colour" value={f.accent_color} onChange={set("accent_color")} placeholder="#c39e4e" />
          <Field label="Logo link" value={f.logo_url} onChange={set("logo_url")} placeholder="https://… or /brand/…" wide />
          <Field label="Address" value={f.address} onChange={set("address")} wide />
          <Field label="Phone" value={f.phone} onChange={set("phone")} />
          <Field label="Email" value={f.email} onChange={set("email")} />
          <Field label="Website" value={f.website} onChange={set("website")} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="label-caps">Notes (foot of every invoice)</span>
            <textarea className={fieldClass + " mt-1 min-h-[96px]"} value={f.footer_note} onChange={(e) => set("footer_note")(e.target.value)} />
          </label>
          <label className="block">
            <span className="label-caps">Terms &amp; Conditions (one per line)</span>
            <textarea className={fieldClass + " mt-1 min-h-[96px]"} value={f.terms_text} onChange={(e) => set("terms_text")(e.target.value)} />
          </label>
        </div>
        <p className="text-small text-ink-500">
          Printed at the bottom of the PDF, the client&apos;s invoice page and the email: Notes, then Terms &amp; Conditions —
          &ldquo;Payment due upon receipt.&rdquo;, the login&apos;s How to pay lines, then these terms.
        </p>
        {f.logo_url ? (
          <div className="flex items-center gap-3">
            <div className="h-12 px-3 rounded-ctl bg-white border border-hairline flex items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.logo_url} alt="" className="max-h-8 max-w-[10rem] object-contain" />
            </div>
            <p className="text-small text-ink-500">As it prints on the invoice (white paper) — use the dark-on-transparent version.</p>
          </div>
        ) : (
          <p className="text-small text-warn-700">No logo yet for this brand.</p>
        )}
        <Msg msg={msg} />
        <Button size="sm" onClick={() => run(`/api/admin/books/brands/${brand.key}`, "PATCH", f)} disabled={busy}>{busy ? "Saving…" : "Save brand"}</Button>
      </CardBody>
    </Card>
  );
}

function PersonCard({ person, invoicingReady }: { person: BillingStaffRow; invoicingReady: boolean }) {
  const [name, setName] = useState(person.display_name);
  const [fee, setFee] = useState(String(Math.round(person.card_fee_rate * 10000) / 100));
  const [note, setNote] = useState(person.default_note ?? "");
  const [rows, setRows] = useState<StaffBrand[]>(person.brands);
  const { busy, msg, run } = useSaver();

  const setRow = (i: number, k: "from_name" | "reply_to_email" | "phone" | "invoice_prefix" | "address" | "payment_instructions", v: string) => {
    const next = rows.slice();
    next[i] = { ...next[i], [k]: v };
    setRows(next);
  };

  return (
    <Card>
      <CardHeader
        title={person.display_name}
        kicker={person.is_owner ? "Login · owner" : "Login"}
        description={`Bills under ${person.brands.map((b) => BRAND_LABEL[b.brand]).join(" and ") || "no brand"}. This book is separate from every other login's.`}
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name" value={name} onChange={setName} />
          <label className="block">
            <span className="label-caps">Card fee on invoices (%)</span>
            <input className={fieldClass + " mt-1 tabular-nums"} inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
          </label>
          {invoicingReady && (
            <>
              <label className="block sm:col-span-2">
                <span className="label-caps">Default note (printed under the totals)</span>
                <textarea className={fieldClass + " mt-1 min-h-[60px]"} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            </>
          )}
        </div>
        {rows.map((r, i) => (
          <div key={r.brand} className="border border-hairline rounded-card p-4 space-y-3">
            <p className="label-caps">{BRAND_LABEL[r.brand]} emails</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="From name" value={r.from_name ?? ""} onChange={(v) => setRow(i, "from_name", v)} />
              <Field label="Reply-to" value={r.reply_to_email ?? ""} onChange={(v) => setRow(i, "reply_to_email", v)} />
              <Field label="Phone on invoices" value={r.phone ?? ""} onChange={(v) => setRow(i, "phone", v)} />
            </div>
            {invoicingReady && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Invoice prefix (blank = brand's)" value={r.invoice_prefix ?? ""} onChange={(v) => setRow(i, "invoice_prefix", v)} placeholder="YP" />
                <label className="block">
                  <span className="label-caps">Next number</span>
                  <input className={fieldClass + " mt-1 tabular-nums"} inputMode="numeric" value={String(r.next_number ?? 1001)}
                    onChange={(e) => { const next = rows.slice(); next[i] = { ...next[i], next_number: Number(e.target.value.replace(/\D/g, "")) || null }; setRows(next); }} />
                </label>
                <Field label="Address on invoices (blank = brand's)" value={r.address ?? ""} onChange={(v) => setRow(i, "address", v)} />
                <label className="block sm:col-span-3">
                  <span className="label-caps">How to pay (one per line — printed in the How to pay box and under Terms &amp; Conditions)</span>
                  <textarea className={fieldClass + " mt-1 min-h-[60px]"} value={r.payment_instructions ?? ""} onChange={(e) => setRow(i, "payment_instructions", e.target.value)} />
                </label>
              </div>
            )}
          </div>
        ))}
        <Msg msg={msg} />
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            run(`/api/admin/books/staff/${person.profile_id}`, "PATCH", {
              display_name: name,
              card_fee_rate: fee,
              ...(invoicingReady ? { default_note: note } : {}),
              brands: rows.map((r) => ({
                brand: r.brand, from_name: r.from_name, reply_to_email: r.reply_to_email, phone: r.phone,
                ...(invoicingReady ? { invoice_prefix: r.invoice_prefix ?? "", address: r.address ?? "", payment_instructions: r.payment_instructions ?? "", next_number: r.next_number } : {}),
              })),
            })
          }
        >
          {busy ? "Saving…" : "Save login"}
        </Button>
      </CardBody>
    </Card>
  );
}

function ImportCard() {
  const [items, setItems] = useState<File | null>(null);
  const [clients, setClients] = useState<File | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const { busy, msg, run, setMsg } = useSaver();

  const go = async () => {
    if (!items && !clients) { setMsg({ ok: false, text: "Choose at least one CSV." }); return; }
    const fd = new FormData();
    if (items) fd.append("items", items);
    if (clients) fd.append("clients", clients);
    setResult(null);
    const res = await run("/api/admin/books/import", "POST", fd, "Re-pull finished.");
    if (!res.error && res.data) {
      const parts: string[] = [];
      const it = res.data.items as Record<string, number> | undefined;
      const cl = res.data.clients as Record<string, number> | undefined;
      if (it) parts.push(`Items: ${it.inserted} new, ${it.updated} refreshed, ${it.kept_local} kept as edited here.`);
      if (cl) parts.push(`Clients: ${cl.inserted} new, ${cl.updated} refreshed, ${cl.exact_duplicates_merged + cl.skipped_merged} duplicates folded in, ${cl.broker_links_changed} broker links changed.`);
      setResult(parts.join(" "));
    }
  };

  return (
    <Card>
      <CardHeader
        title="Re-pull from Zoho CSV"
        kicker="Zoho wind-down"
        description="Upload a fresh Zoho export of rate items and/or contacts (same columns as the first import). Anything you've edited here keeps your version, confirmed brands stay, merged clients stay merged; Zoho open balances refresh."
      />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="label-caps">Rate items CSV</span>
            <input type="file" accept=".csv,text/csv" className="mt-1 block w-full text-sm text-ink-600" onChange={(e) => setItems(e.target.files?.[0] ?? null)} />
          </label>
          <label className="block">
            <span className="label-caps">Contacts CSV</span>
            <input type="file" accept=".csv,text/csv" className="mt-1 block w-full text-sm text-ink-600" onChange={(e) => setClients(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        <Msg msg={msg} />
        {result && <p className="text-sm text-ink-600">{result}</p>}
        <Button size="sm" variant="secondary" onClick={go} disabled={busy}>{busy ? "Importing…" : "Re-pull"}</Button>
      </CardBody>
    </Card>
  );
}
