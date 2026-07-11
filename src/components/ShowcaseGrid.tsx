import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

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
// dashboard shell (/dashboard/showcase) and the admin shell (/admin/showcase),
// so admins never get bounced out of their own layout.
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

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      <div className="mb-8 pb-6 border-b border-hairline">
        <p className="label-caps text-ink-500">The Dock</p>
        <h1 className="text-display text-ink-900 mt-1.5">Recently Photographed</h1>
        <p className="text-ink-500 mt-1.5 text-sm max-w-2xl">
          The latest boats through the YachtPics lens. See something a client would love? Reach out to the listing broker directly.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 py-16 text-center">
          <p className="text-ink-500 text-sm">No boats here yet.</p>
          <p className="text-ink-500 text-sm mt-1">New shoots will appear here as they&rsquo;re delivered.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
          {rows.map((r) => {
            const url = r.hero_storage_path ? heroUrls.get(r.hero_storage_path) : undefined;
            const subtitle = [r.year, r.make, r.model].filter(Boolean).join(" ");
            const meta = [
              r.length_ft ? `${r.length_ft}′` : null,
              r.vessel_type,
              r.location,
            ].filter(Boolean).join(" · ");
            return (
              <div key={r.listing_id}>
                <div className="aspect-[4/3] bg-white flex items-center justify-center overflow-hidden rounded-[2px] shadow-print">
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt={r.vessel_name ?? ""}
                      loading="lazy"
                      decoding="async"
                      className={`h-full w-full ${r.hero_fit === "fit" ? "object-contain" : "object-cover"}`}
                    />
                  ) : (
                    <span className="label-caps text-ink-300">No photo</span>
                  )}
                </div>

                <div className="mt-4">
                  {r.photographed_at && (
                    <p className="label-caps text-ink-400">Photographed {photographedLabel(r.photographed_at)}</p>
                  )}
                  <h2 className="text-ink-900 font-semibold text-lg mt-1.5 leading-tight">
                    {r.vessel_name ?? "Untitled Vessel"}
                  </h2>
                  {subtitle && <p className="text-ink-600 text-sm mt-0.5">{subtitle}</p>}
                  {meta && <p className="text-ink-500 text-xs mt-0.5">{meta}</p>}

                  <div className="mt-3 pt-3 border-t border-hairline">
                    {r.broker_name && <p className="text-ink-900 text-sm font-medium">{r.broker_name}</p>}
                    {r.brokerage_name && <p className="text-ink-500 text-xs mt-0.5">{r.brokerage_name}</p>}
                    <div className="mt-1.5 flex flex-col gap-0.5 text-xs">
                      {r.broker_phone && (
                        <a href={`tel:${r.broker_phone}`} className="text-accent-700 hover:text-accent-600 transition-colors duration-fast">
                          {r.broker_phone}
                        </a>
                      )}
                      {r.broker_email && (
                        <a href={`mailto:${r.broker_email}`} className="text-accent-700 hover:text-accent-600 transition-colors duration-fast truncate">
                          {r.broker_email}
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
