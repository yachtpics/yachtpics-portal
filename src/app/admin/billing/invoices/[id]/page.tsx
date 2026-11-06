import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/requireAdminPage";
import { booksServiceClient, canSeeItemBrand, lookupBillingStaff } from "@/lib/books/staff";
import { loadInvoice, publicInvoiceUrl } from "@/lib/books/invoices";
import { INVOICING_NOT_READY, type BillingItem } from "@/lib/books/types";
import { Card, CardBody } from "@/components/ui";
import InvoiceEditor, { type PickerClient } from "../../_components/InvoiceEditor";

export const dynamic = "force-dynamic";

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-4 sm:px-6 py-8 max-w-4xl mx-auto">
      <Link href="/admin/billing" className="text-small text-ink-500 hover:text-ink-900">← Billing</Link>
      <Card className="mt-3"><CardBody><h2 className="text-h2 text-ink-900">{title}</h2><p className="text-sm text-ink-500 mt-1">{body}</p></CardBody></Card>
    </div>
  );
}

export default async function InvoicePage({ params }: { params: { id: string } }) {
  // Role check lives in the page, not only the layout — see requireAdminPage.
  const { userId } = await requireAdminPage();
  const admin = booksServiceClient();
  const found = await lookupBillingStaff(admin, userId);
  if (found.state !== "ok") return <Notice title="Billing" body="This login doesn't keep a book in Billing, or Billing isn't switched on yet." />;
  const staff = found.staff;

  const r = await loadInvoice(admin, staff, params.id);
  if ("notReady" in r) return <Notice title="Not switched on yet" body={INVOICING_NOT_READY} />;
  if ("notFound" in r) notFound();
  if ("error" in r) return <Notice title="This invoice couldn't load" body={r.error} />;

  const [{ data: clientRows }, { data: itemRows }] = await Promise.all([
    admin.from("billing_clients").select("id, display_name, company_name, email, status").order("display_name").range(0, 4999),
    admin.from("billing_items").select("*").eq("active", true).order("sort_order").order("name").range(0, 4999),
  ]);
  const clients = (clientRows ?? []) as PickerClient[];
  // The invoice's client stays pickable even if it's been made inactive.
  const items = ((itemRows ?? []) as BillingItem[]).filter((i) => canSeeItemBrand(staff, i.brand)).map((i) => ({ ...i, rate: Number(i.rate) }));
  const b = r.bundle;

  return (
    <div className="px-4 sm:px-6 py-8 max-w-4xl mx-auto">
      <InvoiceEditor
        key={b.invoice.updated_at}
        invoice={b.invoice}
        lines={b.lines}
        payments={b.payments}
        clients={clients}
        items={items}
        isOwner={staff.isOwner}
        brands={staff.brands}
        publicUrl={publicInvoiceUrl(b.invoice.public_token)}
      />
    </div>
  );
}
