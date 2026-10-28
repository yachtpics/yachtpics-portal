import { requireAdminPage } from "@/lib/requireAdminPage";
import StorageBoard from "./_components/StorageBoard";

export const dynamic = "force-dynamic";

export default async function StoragePage() {
  await requireAdminPage();
  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-display text-ink-900">Storage</h1>
        <p className="text-ink-500 mt-1 text-sm">
          Full-size photo originals are moving from Supabase to Cloudflare R2. Thumbnails and slide copies stay in
          Supabase. Copying never deletes anything; removing the Supabase copies is a separate step you confirm.
        </p>
      </div>
      <StorageBoard />
    </div>
  );
}
