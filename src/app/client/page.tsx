import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import Link from "next/link";

export const dynamic = "force-dynamic";

type GalleryRow = { id: string; title: string; gallery_type: string; expires_at: string | null };

export default async function ClientGalleriesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: access } = await service
    .from("gallery_access")
    .select("galleries(id, title, gallery_type, expires_at)")
    .eq("user_id", user.id);

  const galleries: GalleryRow[] = (access ?? [])
    .map((a) => (a.galleries as unknown) as GalleryRow | null)
    .filter((g): g is GalleryRow => !!g);

  const now = Date.now();

  return (
    <div className="max-w-5xl mx-auto px-5 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Your galleries</h1>
      <p className="text-gray-500 text-sm mb-6">View the slideshow and download your photos and videos.</p>

      {galleries.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl py-16 text-center">
          <p className="text-gray-400 text-sm">You don&apos;t have any galleries yet.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {galleries.map((g) => {
            const expired = g.expires_at ? new Date(g.expires_at).getTime() < now : false;
            return (
              <Link
                key={g.id}
                href={`/client/${g.id}`}
                className="block bg-white border border-gray-200 rounded-xl p-5 hover:border-[#d4a843] transition-colors"
              >
                <p className="font-semibold text-gray-900">{g.title}</p>
                <p className="text-xs text-gray-400 mt-1 capitalize">{g.gallery_type}</p>
                <p className={`text-xs mt-3 ${expired ? "text-gray-400" : "text-green-600"}`}>
                  {expired
                    ? "Downloads closed — slideshow still available"
                    : g.expires_at
                    ? `Downloads open until ${new Date(g.expires_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
                    : "Downloads open"}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
