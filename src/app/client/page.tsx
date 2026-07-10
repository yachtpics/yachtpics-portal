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
      <h1 className="text-display text-ink-900 mb-1">Your galleries</h1>
      <p className="text-ink-500 text-sm mb-6">View the slideshow and download your photos and videos.</p>

      {galleries.length === 0 ? (
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 py-16 text-center">
          <p className="text-ink-500 text-sm">You don&apos;t have any galleries yet.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {galleries.map((g) => {
            const expired = g.expires_at ? new Date(g.expires_at).getTime() < now : false;
            return (
              <Link
                key={g.id}
                href={`/client/${g.id}`}
                className="block bg-white border border-hairline rounded-card p-5 shadow-elev-1 hover:shadow-elev-2 hover:border-hairline-strong transition-all duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50"
              >
                <p className="font-semibold text-ink-900">{g.title}</p>
                <p className="label-caps mt-1.5">{g.gallery_type}</p>
                <p className={`text-xs mt-3 ${expired ? "text-ink-500" : "text-success-600"}`}>
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
