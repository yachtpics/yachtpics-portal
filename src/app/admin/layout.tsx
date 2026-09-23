import { requireAdminPage } from "@/lib/requireAdminPage";
import AdminNav from "./_components/AdminNav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Same cached check every admin page runs itself. On a full page load the
  // layout and the page share one lookup; on client-side navigation Next skips
  // this layout, which is why the pages can't rely on it.
  await requireAdminPage();

  return (
    <div className="flex min-h-screen bg-ink-50">
      <AdminNav />
      <main className="flex-1 overflow-auto pb-20 md:pb-0 pt-12 md:pt-0">{children}</main>
    </div>
  );
}
