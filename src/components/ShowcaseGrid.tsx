import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import ShowcaseBoard, { type Boat } from "@/components/ShowcaseBoard";

type ShowcaseRow = {
  listing_id: string;
  vessel_name: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vessel_type: string | null;
  length_ft: number | null;
  location: string | null;
  photographed_at: string | null;
  broker_name: string | null;
  brokerage_name: string | null;
  broker_phone: string | null;
  broker_email: string | null;
  hero_storage_path: string | null;
  hero_fit: string | null;
};

function photographedLabel(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// Shared Recently Photographed showcase — rendered inside both the broker
// dashboard shell (/dashboard/showcase) and the admin shell (/admin/showcase).
export default async function ShowcaseGrid() {
  const supabase = await createClient();

  const { data } = await supabase.rpc("showcase_listings");
  const rows = (data ?? []) as ShowcaseRow[];

  const heroUrls = new Map<string, string>();
  if (rows.length > 0) {
    const service = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const paths = Array.from(new Set(rows.map((r) => r.hero_storage_path).filter(Boolean))) as string[];
    if (paths.length > 0) {
      const { data: signed } = await service.storage.from("listing-photos").createSignedUrls(paths, 3600);
      for (const s of signed ?? []) if (s.signedUrl && s.path) heroUrls.set(s.path, s.signedUrl);
    }
  }

  const boats: Boat[] = rows.map((r) => ({
    id: r.listing_id,
    vesselName: r.vessel_name ?? "Untitled Vessel",
    subtitle: [r.year, r.make, r.model].filter(Boolean).join(" "),
    meta: [r.length_ft ? `${r.length_ft}′` : null, r.vessel_type, r.location].filter(Boolean).join(" · "),
    photographedLabel: photographedLabel(r.photographed_at),
    heroUrl: r.hero_storage_path ? (heroUrls.get(r.hero_storage_path) ?? null) : null,
    heroFit: r.hero_fit === "fit" ? "fit" : "fill",
    brokerName: r.broker_name,
    brokerageName: r.brokerage_name,
    brokerPhone: r.broker_phone,
    brokerEmail: r.broker_email,
  }));

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      <div className="mb-8 pb-6 border-b border-hairline">
        <p className="label-caps text-ink-500">The Dock</p>
        <h1 className="text-display text-ink-900 mt-1.5">Recently Photographed</h1>
        <p className="text-ink-500 mt-1.5 text-sm max-w-2xl">
          The latest boats through the YachtPics lens. Tap any boat to see the full set of photos — then reach the listing broker directly.
        </p>
      </div>

      {boats.length === 0 ? (
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 py-16 text-center">
          <p className="text-ink-500 text-sm">No boats here yet.</p>
          <p className="text-ink-500 text-sm mt-1">New shoots will appear here as they&rsquo;re delivered.</p>
        </div>
      ) : (
        <ShowcaseBoard boats={boats} />
      )}
    </div>
  );
}
