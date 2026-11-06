import { requireAdminPage } from "@/lib/requireAdminPage";
import AdminNav from "./_components/AdminNav";
import { booksServiceClient, lookupBillingStaff } from "@/lib/books/staff";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Same cached check every admin page runs itself. On a full page load the
  // layout and the page share one lookup; on client-side navigation Next skips
  // this layout, which is why the pages can't rely on it.
  const { userId } = await requireAdminPage();

  // Billing shows only for logins that keep a book. Before the billing
  // migration is applied it shows for every admin, so the page can say
  // "not switched on yet" instead of the link silently missing.
  const billing = await lookupBillingStaff(booksServiceClient(), userId).catch(() => null);
  const showBilling = !!billing && (billing.state === "ok" || billing.state === "not_ready");

  return (
    <div className="flex min-h-screen bg-ink-50">
      <AdminNav showBilling={showBilling} />
      <main className="flex-1 overflow-auto pb-20 md:pb-0 pt-12 md:pt-0">{children}</main>
    </div>
  );
}
