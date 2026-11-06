"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardBody, CardHeader } from "@/components/ui";
import {
  BRAND_LABEL,
  ITEM_KINDS,
  KIND_LABEL,
  type BillingItem,
  type BrandKey,
  type ItemBrand,
  type ItemKind,
  type StaffView,
  type TaxExemptReason,
} from "@/lib/books/types";
import { booksCall, fieldClass, money } from "./booksApi";

/*
 * The item catalog. Editing an item here never changes an invoice already
 * raised: Phase 2 copies the item's details onto each invoice line.
 */

type Form = {
  name: string;
  description: string;
  rate: string;
  unit: "each" | "ft";
  kind: ItemKind;
  brand: ItemBrand;
  taxable: boolean;
  tax_exempt_reason: TaxExemptReason;
};

const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;

function canEdit(staff: StaffView, item: { brand: ItemBrand; kind: ItemKind }) {
  if (staff.isOwner) return true;
  if (item.brand === "both" || item.brand === "ypdesigns" || item.kind === "card_fee") return false;
  return staff.brands.indexOf(item.brand) !== -1;
}

export default function CatalogPanel({
  items,
  staff,
  initialBrand,
  taxRate,
}: {
  items: BillingItem[];
  staff: StaffView;
  initialBrand: BrandKey | "all";
  taxRate: { name: string; rate: number } | null;
}) {
  const router = useRouter();
  const [brand, setBrand] = useState<ItemBrand | "all">(initialBrand);
  const [state, setState] = useState<"active" | "retired">("active");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const brandChoices: ItemBrand[] = (staff.brands as ItemBrand[]).concat(["both"]);
  const ownBrand: ItemBrand = staff.brands[0] ?? "yachtpics";

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) => {
      if (brand !== "all" && i.brand !== brand) return false;
      if (state === "active" ? !i.active : i.active) return false;
      if (!needle) return true;
      return (i.name + " " + (i.description ?? "")).toLowerCase().indexOf(needle) !== -1;
    });
  }, [items, brand, state, q]);

  const unconfirmed = staff.isOwner ? items.filter((i) => i.active && !i.brand_confirmed) : [];

  const open = (i: BillingItem | null) => {
    setError(null);
    if (i) {
      setEditing(i.id);
      setForm({
        name: i.name,
        description: i.description ?? "",
        rate: String(i.rate),
        unit: i.unit,
        kind: i.kind,
        brand: i.brand,
        taxable: i.taxable,
        tax_exempt_reason: i.tax_exempt_reason ?? "Digital Download",
      });
    } else {
      setEditing("new");
      setForm({ name: "", description: "", rate: "", unit: "each", kind: "standard", brand: brand === "all" ? ownBrand : brand, taxable: false, tax_exempt_reason: "Digital Download" });
    }
  };

  const save = async (extra?: Record<string, unknown>) => {
    if (!form) return;
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { name: form.name, description: form.description, rate: form.rate, unit: form.unit, kind: form.kind };
    if (staff.isOwner) {
      body.brand = form.brand;
      body.taxable = form.taxable;
      body.tax_exempt_reason = form.taxable ? null : form.tax_exempt_reason;
    } else if (editing === "new") {
      body.brand = form.brand;
    }
    const { error: err } = editing === "new"
      ? await booksCall("/api/admin/books/items", "POST", body)
      : await booksCall(`/api/admin/books/items/${editing}`, "PATCH", { ...body, ...(extra ?? {}) });
    setBusy(false);
    if (err) { setError(err); return; }
    setEditing(null);
    router.refresh();
  };

  const setActive = async (i: BillingItem, active: boolean) => {
    setBusy(true);
    setError(null);
    const { error: err } = await booksCall(`/api/admin/books/items/${i.id}`, "PATCH", { active });
    setBusy(false);
    if (err) setError(err);
    else { setEditing(null); router.refresh(); }
  };

  const confirm = async (list: { id: string; brand: ItemBrand }[]) => {
    setBusy(true);
    setError(null);
    const { error: err } = await booksCall("/api/admin/books/items/confirm-brands", "POST", { items: list });
    setBusy(false);
    if (err) setError(err); else router.refresh();
  };

  const formView = form && (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
        <label className="block sm:col-span-4">
          <span className="label-caps">Item</span>
          <input className={fieldClass + " mt-1"} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="block sm:col-span-2">
          <span className="label-caps">Kind</span>
          <select className={fieldClass + " mt-1"} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ItemKind })}>
            {ITEM_KINDS.filter((k) => staff.isOwner || k !== "card_fee").map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="block sm:col-span-6">
          <span className="label-caps">Description on the invoice</span>
          <textarea className={fieldClass + " mt-1 min-h-[64px]"} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        <label className="block sm:col-span-2">
          <span className="label-caps">{form.kind === "card_fee" ? "Rate (not used)" : "Rate"}</span>
          <input className={fieldClass + " mt-1 tabular-nums"} inputMode="decimal" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="0.00" />
        </label>
        <label className="block sm:col-span-2">
          <span className="label-caps">Unit</span>
          <select className={fieldClass + " mt-1"} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as "each" | "ft" })}>
            <option value="each">Each</option>
            <option value="ft">Per foot</option>
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="label-caps">Brand</span>
          <select
            className={fieldClass + " mt-1"}
            value={form.brand}
            disabled={!staff.isOwner && editing !== "new"}
            onChange={(e) => setForm({ ...form, brand: e.target.value as ItemBrand })}
          >
            {(staff.isOwner ? brandChoices : (staff.brands as ItemBrand[])).map((b) => <option key={b} value={b}>{BRAND_LABEL[b]}</option>)}
          </select>
        </label>
      </div>

      {staff.isOwner ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={form.taxable}
            onClick={() => setForm({ ...form, taxable: !form.taxable })}
            className={`relative h-6 w-11 rounded-full transition-colors duration-base ease-quiet ${form.taxable ? "bg-accent-500" : "bg-ink-200"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-elev-1 transition-all duration-base ease-quiet ${form.taxable ? "left-[22px]" : "left-0.5"}`} />
          </button>
          <span className="text-sm text-ink-700">{form.taxable ? `Taxable${taxRate ? ` · ${pct(taxRate.rate)} ${taxRate.name}` : ""}` : "Tax exempt"}</span>
          {!form.taxable && (
            <select
              className={fieldClass + " w-auto"}
              value={form.tax_exempt_reason}
              onChange={(e) => setForm({ ...form, tax_exempt_reason: e.target.value as TaxExemptReason })}
            >
              <option value="Digital Download">Digital Download</option>
              <option value="Tax Exempt">Tax Exempt</option>
            </select>
          )}
        </div>
      ) : (
        <p className="text-small text-ink-500">Tax setting: {form.taxable ? "Taxable" : `Exempt · ${form.tax_exempt_reason}`} — Charlie sets this.</p>
      )}

      {form.kind === "card_fee" && (
        <p className="text-small text-ink-500">The card fee uses each login&apos;s own rate (yours: {pct(staff.cardFeeRate)}), not this item&apos;s rate. Change it in Settings.</p>
      )}
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => save()} disabled={busy}>{busy ? "Saving…" : editing === "new" ? "Add item" : "Save"}</Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {unconfirmed.length > 0 && (
        <Card>
          <CardHeader
            title="Confirm brand split"
            kicker={`${unconfirmed.length} from Zoho`}
            description="Zoho had one item list for both businesses; this is a first guess. Tap the right brand for any that are wrong, then confirm the rest."
            action={<Button size="sm" onClick={() => confirm(unconfirmed.map((i) => ({ id: i.id, brand: i.brand })))} disabled={busy}>Confirm all as shown</Button>}
          />
          <CardBody className="p-0">
            {error && !editing && <p className="text-sm text-danger-700 px-6 pt-4">{error}</p>}
            <ul className="divide-y divide-hairline">
              {unconfirmed.map((i) => (
                <li key={i.id} className="px-4 sm:px-6 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-ink-900 truncate">{i.name}</p>
                    <p className="text-small text-ink-500">{money(i.rate)}{i.unit === "ft" ? " / ft" : ""}</p>
                  </div>
                  <div className="inline-flex rounded-ctl border border-hairline-strong p-0.5 self-start sm:self-auto shrink-0">
                    {(["yachtpics", "ypdesigns", "both"] as ItemBrand[]).map((b) => (
                      <button
                        key={b}
                        type="button"
                        disabled={busy}
                        onClick={() => confirm([{ id: i.id, brand: b }])}
                        title={`Confirm as ${BRAND_LABEL[b]}`}
                        className={`px-2.5 py-1.5 rounded-[6px] text-xs font-semibold transition-colors duration-base ease-quiet ${
                          i.brand === b ? "bg-ink-950 text-white" : "text-ink-500 hover:text-ink-900"
                        }`}
                      >
                        {BRAND_LABEL[b]}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Item catalog"
          kicker={staff.isOwner ? "Both brands" : BRAND_LABEL[ownBrand]}
          description={taxRate ? `Taxable items use ${taxRate.name} (${pct(taxRate.rate)}).` : undefined}
          action={editing !== "new" && <Button size="sm" variant="secondary" onClick={() => open(null)}>Add item</Button>}
        />
        <CardBody className="space-y-4">
          {editing === "new" && <div className="border border-hairline rounded-card p-4 bg-ink-50">{formView}</div>}
          <div className="flex flex-col lg:flex-row gap-2">
            <input className={fieldClass + " lg:max-w-xs"} placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <div className="inline-flex rounded-ctl border border-hairline-strong p-0.5">
                {(["all"] as (ItemBrand | "all")[]).concat(brandChoices).map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBrand(b)}
                    className={`px-3 py-1.5 rounded-[6px] text-xs font-semibold transition-colors duration-base ease-quiet ${brand === b ? "bg-ink-950 text-white" : "text-ink-500 hover:text-ink-900"}`}
                  >
                    {b === "all" ? "All" : BRAND_LABEL[b]}
                  </button>
                ))}
              </div>
              <div className="inline-flex rounded-ctl border border-hairline-strong p-0.5">
                {(["active", "retired"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setState(s)}
                    className={`px-3 py-1.5 rounded-[6px] text-xs font-semibold capitalize transition-colors duration-base ease-quiet ${state === s ? "bg-ink-950 text-white" : "text-ink-500 hover:text-ink-900"}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {items.length === 0 ? (
            <p className="text-sm text-ink-500 py-6">No items yet. Run the Zoho seed, or add one above.</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-ink-500 py-6">Nothing matches.</p>
          ) : (
            <ul className="divide-y divide-hairline border-y border-hairline">
              {filtered.map((i) => (
                <li key={i.id} className="py-3">
                  {editing === i.id ? (
                    <div className="py-1 space-y-3">
                      {formView}
                      {staff.isOwner && (
                        <div className="pt-1">
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setActive(i, !i.active)}>
                            {i.active ? "Retire this item" : "Bring this item back"}
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-ink-900">{i.name}</span>
                          {staff.isOwner && <Badge tone={i.brand === "ypdesigns" ? "accent" : "neutral"}>{BRAND_LABEL[i.brand]}</Badge>}
                          {i.kind !== "standard" && <Badge tone="info">{KIND_LABEL[i.kind]}</Badge>}
                          {!i.active && <Badge>Retired</Badge>}
                        </div>
                        {i.description && <p className="text-small text-ink-500 mt-0.5 line-clamp-2">{i.description}</p>}
                        <p className="text-small text-ink-500 mt-0.5">
                          {i.taxable ? `Taxable${taxRate ? ` ${pct(taxRate.rate)}` : ""}` : `Exempt · ${i.tax_exempt_reason ?? "Tax Exempt"}`}
                        </p>
                      </div>
                      <div className="flex items-start gap-2 shrink-0">
                        <span className="text-sm tabular-nums text-ink-900 pt-1.5 text-right">
                          {i.kind === "card_fee" ? `${pct(staff.cardFeeRate)} (your rate)` : `${money(i.rate)}${i.unit === "ft" ? " / ft" : ""}`}
                        </span>
                        {canEdit(staff, i) && <Button size="sm" variant="ghost" onClick={() => open(i)}>Edit</Button>}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
