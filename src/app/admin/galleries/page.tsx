import { createClient as createServiceClient } from "@supabase/supabase-js";
import Link from "next/link";

export const dynamic = "force-dynamic";

type Gallery = {
  id: string;
  title: string;
  gallery_type: string;
  slug: string;
  expires_at: string | null;
  created_at: string;
};

const TYPE_LABELS: Record<string, string> = {
  event: "Event",
  owner: "Owner",
  other: "Other",
};

export default async function AdminGalleriesPage() {
  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: galleriesRaw } = await supabase
    .from("galleries")
    .select("id, title, gallery_type, slug, expires_at, created_at")
    .order("created_at", { ascending: false });

  const galleries = (galleriesRaw ?? []) as Gallery[];
  const ids = galleries.map((g) => g.id);

  // Counts: photos, videos, recipients per gallery
  const photoCount = new Map<string, number>();
  const videoCount = new Map<string, number>();
  const recipientCount = new Map<string, number>();
  if (ids.length > 0) {
    const [{ data: ph }, { data: vd }, { data: ga }] = await Promise.all([
      supabase.from("photos").select("gallery_id").in("gallery_id", ids),
      supabase.from("videos").select("gallery_id").in("gallery_id", ids),
      supabase.from("gallery_access").select("gallery_id").in("gallery_id", ids),
    ]);
    for (const r of ph ?? []) if (r.gallery_id) photoCount.set(r.gallery_id, (photoCount.get(r.gallery_id) ?? 0) + 1);
    for (const r of vd ?? []) if (r.gallery_id) videoCount.set(r.gallery_id, (videoCount.get(r.gallery_id) ?? 0) + 1);
    for (const r of ga ?? []) recipientCount.set(r.gallery_id, (recipientCount.get(r.gallery_id) ?? 0) + 1);
  }

  const now = Date.now();
  function fmt(d: string) {
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Galleries</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Photo & video deliveries for events and owners — no broker login or billing.
          </p>
        </div>
        <Link
          href="/admin/galleries/new"
          className="bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors shrink-0"
        >
          + New Gallery
        </Link>
      </div>

      {galleries.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl py-16 text-center">
          <p className="text-gray-400 text-sm">No galleries yet. Create one to deliver event or owner photos.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Gallery</th>
                <th className="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Recipients</th>
                <th className="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Items</th>
                <th className="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Access</th>
                <th className="px-4 sm:px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {galleries.map((g) => {
                const expired = g.expires_at ? new Date(g.expires_at).getTime() < now : false;
                const photos = photoCount.get(g.id) ?? 0;
                const videos = videoCount.get(g.id) ?? 0;
                const recipients = recipientCount.get(g.id) ?? 0;
                return (
                  <tr key={g.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 sm:px-6 py-4">
                      <p className="font-medium text-gray-900">{g.title}</p>
                      <p className="text-xs text-gray-400">{TYPE_LABELS[g.gallery_type] ?? g.gallery_type}</p>
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-gray-600 hidden sm:table-cell">{recipients}</td>
                    <td className="px-4 sm:px-6 py-4 text-gray-600 hidden md:table-cell">
                      {photos} photo{photos !== 1 ? "s" : ""}{videos > 0 ? `, ${videos} video${videos !== 1 ? "s" : ""}` : ""}
                    </td>
                    <td className="px-4 sm:px-6 py-4">
                      {expired ? (
                        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">Expired</span>
                      ) : g.expires_at ? (
                        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-green-50 text-green-700">Until {fmt(g.expires_at)}</span>
                      ) : (
                        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-green-50 text-green-700">No expiry</span>
                      )}
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-right">
                      <Link href={`/admin/galleries/${g.id}`} className="text-[#c49a35] hover:text-[#b08c2a] text-xs font-medium transition-colors whitespace-nowrap">
                        Manage &rarr;
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
