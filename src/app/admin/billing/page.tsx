import Link from "next/link";
import { requireAdminPage } from "@/lib/requireAdminPage";
import { booksServiceClient, isMissingBillingTable, lookupBillingStaff, type BillingStaff } from "@/lib/books/staff";
import { findDupeGroups } from "@/lib/books/dupes";
import {
  BRAND_LABEL,
  type BillingBrand,
  type BillingClient,
  type BillingItem,
  type BillingStaffRow,
  type BrandKey,
  type StaffBrand,
  type StaffView,
} from "@/lib/books/types";
import { Card, CardBody } from "@/components/ui";
import ClientsPanel from "./_components/ClientsPanel";
import CatalogPanel from "./_components/CatalogPanel";
import SettingsPanel from "./_components/SettingsPanel";

export const dynamic = "force-dynamic";

/**
 * Billing (Portal) — phase 1. Admin-only, and only for logins in
 * billing_staff (Charlie: YachtPics + YPDesigns, owner; Samantha: YachtPics).
 * Not the broker subscription page (/dashboard/billing). Invoices arrive in
 * phase 2; until the migration is applied this page says so and stops.
 */

type Tab = "overview" | "clients" | "catalog" | "settings";
const TABS: { key: Tab; label: string; ownerOnly?: boolean }[] = [
  { key: "overview", label: "Overview" },
  { key: "clients", label: "Clients" },
  { key: "catalog", label: "Catalog" },
  { key: "settings", label: "Settings", ownerOnly: true },
];

function Shell({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <div className="px-4 sm:px-6 py-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-display text-ink-900">Billing</h1>
        <p className="text-ink-500 mt-1 text-sm">{subtitle ?? "Clients, items and brands for your invoices."}</p>
      </div>
      {children}
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <Card>
        <CardBody>
          <p className="label-caps mb-2">Billing</p>
          <h2 className="text-h2 text-ink-900">{title}</h2>
          <p className="text-sm text-ink-500 mt-1 max-w-xl">{body}</p>
        </CardBody>
      </Card>
    </Shell>
  );
}

export default async function BillingPage({ searchParams }: { searchParams: { tab?: string; brand?: string } }) {
  // Role check lives in the page, not only the layout — see requireAdminPage.
  const { userId } = await requireAdminPage();
  const admin = booksServiceClient();
  const found = await lookupBillingStaff(admin, userId);

  if (found.state === "not_ready") {
    return (
      <Notice
        title="Not switched on yet"
        body="Billing is built but its tables haven't been added to the database. Once the billing migration and the Zoho seed are run, your clients, items and brands appear here."
      />
    );
  }
  if (found.state === "not_staff") {
    return <Notice title="No book for this login" body="Billing is set up per login. Ask Charlie to add you if you raise invoices." />;
  }
  if (found.state === "error") {
    return <Notice title="Billing couldn't load" body={found.message} />;
  }

  const staff: BillingStaff = found.staff;
  const view: StaffView = { ...staff };
  const tabs = TABS.filter((t) => !t.ownerOnly || staff.isOwner);
  const tab: Tab = tabs.some((t) => t.key === searchParams.tab) ? (searchParams.tab as Tab) : "overview";
  const brand: BrandKey = staff.brands.indexOf(searchParams.brand as BrandKey) !== -1 ? (searchParams.brand as BrandKey) : staff.brands[0] ?? "yachtpics";
  const qs = (t: Tab) => `/admin/billing?tab=${t}${staff.brands.length > 1 ? `&brand=${brand}` : ""}`;

  let content: React.ReactNode = null;

  if (tab === "overview") {
    const [{ data: brandRows }, clientCount, itemRows] = await Promise.all([
      admin.from("billing_brands").select("*").in("key", staff.brands),
      admin.from("billing_clients").select("id", { count: "exact", head: true }).eq("status", "active"),
      admin.from("billing_items").select("brand, active, brand_confirmed").range(0, 4999),
    ]);
    const b = ((brandRows ?? []) as BillingBrand[]).filter((r) => r.key === brand)[0];
    const items = ((itemRows.data ?? []) as Pick<BillingItem, "brand" | "active" | "brand_confirmed">[]).filter(
      (i) => i.brand === "both" || staff.brands.indexOf(i.brand) !== -1
    );
    const brandItems = items.filter((i) => i.active && (i.brand === brand || i.brand === "both")).length;
    const unconfirmed = staff.isOwner ? items.filter((i) => i.active && !i.brand_confirmed).length : 0;

    content = (
      <div className="space-y-6">
        <Card>
          <CardBody className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-ctl bg-ink-950 flex items-center justify-center shrink-0 overflow-hidden">
                {b?.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.logo_url} alt="" className="max-h-8 max-w-[2.5rem] object-contain" />
                ) : (
                  <span className="text-white text-xs font-light tracking-caps-wide">{(b?.invoice_prefix ?? "").slice(0, 3)}</span>
                )}
              </div>
              <div className="min-w-0">
                <p className="label-caps">{b?.legal_name ?? "YachtPics Enterprises LLC"}</p>
                <h2 className="text-h1 text-ink-900">{b?.display_name ?? BRAND_LABEL[brand]}</h2>
                <p className="text-small text-ink-500">
                  {[b?.website, b?.phone].filter(Boolean).join(" · ")}
                  {b?.invoice_prefix ? ` · invoices ${b.invoice_prefix}-0001…` : ""}
                </p>
              </div>
            </div>
            <div className="rule" />
            <p className="text-sm text-ink-600">
              Invoicing arrives in the next phase. Your clients, items and brand details are being set up here first, so the first
              invoice starts from a clean list. Zoho stays in use until then; open Zoho balances finish there.
            </p>
          </CardBody>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-3 border border-hairline rounded-card bg-white shadow-elev-1 divide-y sm:divide-y-0 sm:divide-x divide-hairline">
          <Link href={qs("clients")} className="px-6 py-5 hover:bg-ink-50 transition-colors duration-base ease-quiet">
            <p className="label-caps">Active clients</p>
            <p className="text-3xl font-light tabular-nums text-ink-900 mt-1">{clientCount.count ?? 0}</p>
            <p className="text-small text-ink-500 mt-0.5">Shared by both logins</p>
          </Link>
          <Link href={qs("catalog")} className="px-6 py-5 hover:bg-ink-50 transition-colors duration-base ease-quiet">
            <p className="label-caps">{BRAND_LABEL[brand]} items</p>
            <p className="text-3xl font-light tabular-nums text-ink-900 mt-1">{brandItems}</p>
            <p className="text-small text-ink-500 mt-0.5">Including items for both brands</p>
          </Link>
          <div className="px-6 py-5">
            <p className="label-caps">Card fee on your invoices</p>
            <p className="text-3xl font-light tabular-nums text-ink-900 mt-1">{Math.round(staff.cardFeeRate * 1000) / 10}%</p>
            <p className="text-small text-ink-500 mt-0.5">
              {unconfirmed ? (
                <Link href={qs("catalog")} className="text-accent-700 hover:underline">{unconfirmed} items need their brand confirmed</Link>
              ) : (
                "Shown as its own line, as now"
              )}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (tab === "clients") {
    const [{ data: clientRows, error }, { data: dismissed }] = await Promise.all([
      admin
        .from("billing_clients")
        .select("id, display_name, company_name, first_name, last_name, email, phone, mobile, status, notes, broker_profile_id, zoho_contact_id, zoho_merged_ids, zoho_open_balance, created_at")
        .order("display_name")
        .range(0, 4999),
      admin.from("billing_client_dupe_dismissals").select("client_a, client_b").range(0, 9999),
    ]);
    if (error && !isMissingBillingTable(error)) content = <p className="text-sm text-danger-700">{error.message}</p>;
    const clients = (clientRows ?? []) as BillingClient[];
    const brokerIds: string[] = [];
    clients.forEach((c) => { if (c.broker_profile_id && brokerIds.indexOf(c.broker_profile_id) === -1) brokerIds.push(c.broker_profile_id); });
    const brokerNames: Record<string, string> = {};
    for (let i = 0; i < brokerIds.length; i += 150) {
      const { data } = await admin.from("profiles").select("id, first_name, last_name").in("id", brokerIds.slice(i, i + 150));
      (data ?? []).forEach((p: { id: string; first_name: string | null; last_name: string | null }) => {
        brokerNames[p.id] = [p.first_name, p.last_name].filter(Boolean).join(" ") || "Portal login";
      });
    }
    const groups = staff.isOwner ? findDupeGroups(clients, (dismissed ?? []) as { client_a: string; client_b: string }[]) : [];
    if (!content) content = <ClientsPanel clients={clients} brokerNames={brokerNames} dupeGroups={groups} staff={view} />;
  }

  if (tab === "catalog") {
    const [{ data: itemRows, error }, { data: taxRows }] = await Promise.all([
      admin
        .from("billing_items")
        .select("id, brand, name, description, rate, unit, kind, taxable, tax_exempt_reason, brand_confirmed, active, sort_order, zoho_item_id")
        .order("sort_order")
        .order("name")
        .range(0, 4999),
      admin.from("billing_tax_rates").select("name, rate, is_default").eq("active", true),
    ]);
    const items = ((itemRows ?? []) as BillingItem[])
      .filter((i) => i.brand === "both" || staff.brands.indexOf(i.brand) !== -1)
      .map((i) => ({ ...i, rate: Number(i.rate) }));
    const tax = ((taxRows ?? []) as { name: string; rate: number; is_default: boolean }[]).filter((t) => t.is_default)[0] ?? null;
    content = error ? (
      <p className="text-sm text-danger-700">{error.message}</p>
    ) : (
      <CatalogPanel
        key={brand}
        items={items}
        staff={view}
        initialBrand={staff.brands.length > 1 ? brand : "all"}
        taxRate={tax ? { name: tax.name, rate: Number(tax.rate) } : null}
      />
    );
  }

  if (tab === "settings" && staff.isOwner) {
    const [{ data: brandRows }, { data: staffRows }, { data: staffBrandRows }] = await Promise.all([
      admin.from("billing_brands").select("*").order("key"),
      admin.from("billing_staff").select("profile_id, display_name, is_owner, card_fee_rate, active").order("is_owner", { ascending: false }),
      admin.from("billing_staff_brands").select("profile_id, brand, from_name, reply_to_email, phone").order("brand"),
    ]);
    const sb = (staffBrandRows ?? []) as StaffBrand[];
    const people: BillingStaffRow[] = ((staffRows ?? []) as Omit<BillingStaffRow, "brands">[]).map((s) => ({
      ...s,
      card_fee_rate: Number(s.card_fee_rate),
      brands: sb.filter((x) => x.profile_id === s.profile_id),
    }));
    content = <SettingsPanel brands={(brandRows ?? []) as BillingBrand[]} people={people} />;
  }

  return (
    <Shell subtitle={`${staff.displayName}'s book · clients, items and brands for your invoices.`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <nav className="flex gap-1 overflow-x-auto -mx-1 px-1" aria-label="Billing sections">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={qs(t.key)}
              className={`px-3.5 py-2 rounded-ctl text-sm whitespace-nowrap transition-colors duration-base ease-quiet ${
                tab === t.key ? "bg-ink-950 text-white font-medium" : "text-ink-500 hover:text-ink-900 hover:bg-ink-950/[0.04]"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        {staff.brands.length > 1 && tab !== "settings" && (
          <div className="inline-flex rounded-ctl border border-hairline-strong bg-white p-0.5 self-start" role="group" aria-label="Brand">
            {staff.brands.map((k) => (
              <Link
                key={k}
                href={`/admin/billing?tab=${tab}&brand=${k}`}
                className={`px-3 py-1.5 rounded-[6px] text-xs font-semibold transition-colors duration-base ease-quiet ${
                  k === brand ? "bg-accent-500 text-ink-950" : "text-ink-500 hover:text-ink-900"
                }`}
              >
                {BRAND_LABEL[k]}
              </Link>
            ))}
          </div>
        )}
      </div>
      {content}
    </Shell>
  );
}
