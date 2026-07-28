import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * CONCEPT DEMO — a personal broker website fed by the YachtPics portal.
 *
 * Built for the Brian Nopper conversation: his real listings and real
 * photography, rendered as the site we'd build and maintain for him. Photos
 * are signed server-side on every request, so nothing expires between now and
 * when Charlie shows it.
 *
 * Bio and contact copy are placeholders until Brian supplies his own — nothing
 * here claims a credential we haven't been given.
 */

const BROKER_ID = "9208dff2-3a9f-445e-89f1-479f04d2da24"; // Brian Nopper

type Boat = {
  id: string;
  vessel_name: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  length_ft: string | null;
  vessel_type: string | null;
  photo_count: number;
  video_count: number;
  cover: string | null;
};

function fmtTitle(b: Boat) {
  const bits = [b.length_ft ? `${b.length_ft}'` : null, b.make, b.model].filter(Boolean);
  return bits.join(" ");
}

export default async function BrianNopperDemoSite() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: listings } = await supabase
    .from("listings")
    .select("id, vessel_name, year, make, model, length_ft, vessel_type, hero_photo_id, created_at")
    .eq("broker_id", BROKER_ID)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (!listings || listings.length === 0) notFound();

  const ids = listings.map((l) => l.id);

  // Cover shot per boat — Profiles first, matching the canonical order used
  // everywhere else in the product.
  const { data: photos } = await supabase
    .from("photos")
    .select("id, listing_id, storage_path, category, display_order, created_at, is_visible")
    .in("listing_id", ids);

  // A starred (hero) photo always wins the cover — so Charlie can star a fresh
  // shot in the portal and this page picks it up on the next refresh. Otherwise
  // fall back to Profiles first, matching the canonical order used everywhere
  // else in the product. Newest profile wins ties, so a re-shoot shows through.
  const heroIds = new Set(
    (listings ?? []).map((l) => l.hero_photo_id).filter((x): x is string => !!x)
  );
  const counts = new Map<string, number>();
  const covers = new Map<string, string>();
  const ranked = (photos ?? [])
    .filter((p) => p.is_visible !== false)
    .sort((a, b) => {
      const ah = heroIds.has(a.id) ? 0 : 1;
      const bh = heroIds.has(b.id) ? 0 : 1;
      if (ah !== bh) return ah - bh;
      const ap = (a.category ?? "").trim().toLowerCase() === "profiles" ? 0 : 1;
      const bp = (b.category ?? "").trim().toLowerCase() === "profiles" ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return (a.display_order ?? 0) - (b.display_order ?? 0);
    });
  for (const p of ranked) {
    counts.set(p.listing_id, (counts.get(p.listing_id) ?? 0) + 1);
    if (!covers.has(p.listing_id)) covers.set(p.listing_id, p.storage_path);
  }

  const coverPaths = Array.from(covers.values());
  const { data: signed } = coverPaths.length
    ? await supabase.storage.from("listing-photos").createSignedUrls(coverPaths, 7200)
    : { data: [] };
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  const { data: vids } = await supabase.from("videos").select("listing_id").in("listing_id", ids);
  const vidCounts = new Map<string, number>();
  for (const v of vids ?? []) vidCounts.set(v.listing_id, (vidCounts.get(v.listing_id) ?? 0) + 1);

  const boats: Boat[] = listings.map((l) => {
    const path = covers.get(l.id);
    return {
      id: l.id,
      vessel_name: l.vessel_name,
      year: l.year,
      make: l.make,
      model: l.model,
      length_ft: l.length_ft,
      vessel_type: l.vessel_type,
      photo_count: counts.get(l.id) ?? 0,
      video_count: vidCounts.get(l.id) ?? 0,
      cover: path ? urlByPath.get(path) ?? null : null,
    };
  });

  const hero = boats.find((b) => b.cover) ?? boats[0];
  const rest = boats.filter((b) => b.id !== hero.id);
  const totalPhotos = boats.reduce((s, b) => s + b.photo_count, 0);
  const longest = boats.reduce((m, b) => Math.max(m, Number(b.length_ft ?? 0) || 0), 0);

  return (
    <div className="min-h-screen bg-white text-ink-900">
      {/* Preview ribbon — honest that this is a concept, easy to remove */}
      <div className="bg-ink-950 text-center py-2 px-4">
        <p className="text-[0.625rem] font-medium uppercase tracking-caps-wide text-accent-300/90">
          Concept preview · built by YachtPics
        </p>
      </div>

      {/* Nav */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-hairline">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div>
            <p className="text-[0.9375rem] font-light uppercase tracking-caps-wide leading-none">
              Brian Nopper
            </p>
            <p className="mt-1 text-[0.5625rem] font-medium uppercase tracking-caps-wide text-accent-700">
              Yacht Sales
            </p>
          </div>
          <nav className="hidden sm:flex items-center gap-8 text-sm text-ink-600">
            <a href="#fleet" className="hover:text-ink-900 transition-colors">Listings</a>
            <a href="#about" className="hover:text-ink-900 transition-colors">About</a>
            <a href="#contact" className="hover:text-ink-900 transition-colors">Contact</a>
          </nav>
          <a
            href="#contact"
            className="text-xs font-medium px-4 py-2 rounded-ctl bg-ink-950 text-white hover:bg-ink-800 transition-colors"
          >
            Get in touch
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="relative">
        <div className="relative h-[62vh] min-h-[420px] w-full overflow-hidden bg-ink-950">
          {hero.cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={hero.cover}
              alt={`${hero.vessel_name ?? "Yacht"} — yacht photography by YachtPics`}
              className="absolute inset-0 h-full w-full object-cover opacity-90"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950/85 via-ink-950/25 to-ink-950/40" />
          <div className="absolute inset-0 flex items-end">
            <div className="max-w-6xl mx-auto w-full px-6 pb-12">
              <p className="text-[0.625rem] font-medium uppercase tracking-caps-wide text-accent-300 mb-4">
                HMY Yachts
              </p>
              <h1 className="text-white text-4xl sm:text-5xl font-light leading-tight max-w-2xl">
                Yachts represented with photography that sells them.
              </h1>
              <p className="mt-5 text-white/70 text-base max-w-xl leading-relaxed">
                Motor yachts, sportfish and express boats from 50 to {longest || 100} feet —
                presented properly, so buyers see the boat before they ever step aboard.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href="#fleet"
                  className="text-sm font-medium px-6 py-3 rounded-ctl bg-accent-500 text-ink-950 hover:bg-accent-400 transition-colors"
                >
                  View current listings
                </a>
                <a
                  href="#contact"
                  className="text-sm font-medium px-6 py-3 rounded-ctl border border-white/25 text-white hover:bg-white/10 transition-colors"
                >
                  Contact Brian
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Stat band */}
        <div className="border-b border-hairline bg-ink-50">
          <div className="max-w-6xl mx-auto px-6 py-6 grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-light tabular-nums">{boats.length}</p>
              <p className="text-[11px] uppercase tracking-caps-wide text-ink-500 mt-1">Current listings</p>
            </div>
            <div>
              <p className="text-2xl font-light tabular-nums">{longest}&apos;</p>
              <p className="text-[11px] uppercase tracking-caps-wide text-ink-500 mt-1">Largest vessel</p>
            </div>
            <div>
              <p className="text-2xl font-light tabular-nums">{totalPhotos.toLocaleString()}</p>
              <p className="text-[11px] uppercase tracking-caps-wide text-ink-500 mt-1">Professional photos</p>
            </div>
          </div>
        </div>
      </section>

      {/* Fleet */}
      <section id="fleet" className="max-w-6xl mx-auto px-6 py-20">
        <div className="mb-10">
          <p className="text-[0.625rem] font-medium uppercase tracking-caps-wide text-accent-700 mb-3">
            Current Listings
          </p>
          <h2 className="text-3xl font-light">The fleet</h2>
          <p className="mt-3 text-ink-500 text-sm max-w-xl leading-relaxed">
            Every listing below is fed straight from the YachtPics portal — when a boat is added,
            updated, or sold, this page follows automatically.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[hero, ...rest].map((b) => (
            <article key={b.id} className="group">
              <div className="relative aspect-[4/3] overflow-hidden rounded-card bg-ink-100">
                {b.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={b.cover}
                    alt={`${b.vessel_name ?? "Yacht"} — ${fmtTitle(b)} yacht photography by YachtPics`}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-slow ease-quiet group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-ink-400 text-sm">
                    Photography coming soon
                  </div>
                )}
                {b.video_count > 0 && (
                  <span className="absolute top-3 left-3 bg-ink-950/75 text-white text-[10px] font-medium uppercase tracking-caps-wide px-2.5 py-1 rounded-full">
                    Video
                  </span>
                )}
              </div>
              <div className="pt-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-lg font-medium">{b.vessel_name ?? "Vessel"}</h3>
                  {b.year && <span className="text-sm text-ink-500 tabular-nums">{b.year}</span>}
                </div>
                <p className="text-sm text-ink-600 mt-0.5">{fmtTitle(b)}</p>
                <p className="text-xs text-ink-400 mt-2">
                  {b.vessel_type}
                  {b.photo_count > 0 && ` · ${b.photo_count} photos`}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* About */}
      <section id="about" className="bg-ink-50 border-y border-hairline">
        <div className="max-w-6xl mx-auto px-6 py-20 grid md:grid-cols-2 gap-12 items-start">
          <div>
            <p className="text-[0.625rem] font-medium uppercase tracking-caps-wide text-accent-700 mb-3">
              About
            </p>
            <h2 className="text-3xl font-light mb-5">Brian Nopper</h2>
            <div className="space-y-4 text-ink-600 leading-relaxed text-[15px]">
              <p>
                Yacht sales professional with HMY Yachts, representing motor yachts, sportfish and
                express boats along Florida&apos;s coast.
              </p>
              <p>
                Every vessel is presented with full professional photography and walkthrough video —
                because a buyer&apos;s first impression is made long before the sea trial.
              </p>
              <p className="text-ink-400 text-sm italic">
                [Brian&apos;s bio, background and credentials to be supplied.]
              </p>
            </div>
          </div>
          <div className="bg-white rounded-card border border-hairline p-8">
            <p className="text-[0.625rem] font-medium uppercase tracking-caps-wide text-accent-700 mb-4">
              Representation includes
            </p>
            <ul className="space-y-3 text-[15px] text-ink-700">
              {[
                "Full professional photography of every listing",
                "Walkthrough video for qualified vessels",
                "Listing syndication to major MLS platforms",
                "Buyer-ready galleries shared in a click",
                "Discreet handling of private sales",
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <span aria-hidden className="text-accent-600 mt-0.5">—</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="max-w-6xl mx-auto px-6 py-20">
        <div className="max-w-xl">
          <p className="text-[0.625rem] font-medium uppercase tracking-caps-wide text-accent-700 mb-3">
            Contact
          </p>
          <h2 className="text-3xl font-light mb-4">Talk about your next yacht</h2>
          <p className="text-ink-600 leading-relaxed mb-8">
            Buying, selling, or just weighing the market — a straight conversation costs nothing.
          </p>
          <div className="space-y-3 text-[15px]">
            <p>
              <span className="text-ink-500 w-20 inline-block">Email</span>
              <a href="mailto:bnopper@hmy.com" className="text-accent-700 hover:underline">
                bnopper@hmy.com
              </a>
            </p>
            <p>
              <span className="text-ink-500 w-20 inline-block">Phone</span>
              <span className="text-ink-400 italic">[phone to be supplied]</span>
            </p>
            <p>
              <span className="text-ink-500 w-20 inline-block">Office</span>
              <span>HMY Yachts</span>
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-ink-950 text-white/50">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-white text-sm font-light uppercase tracking-caps-wide">Brian Nopper</p>
            <p className="text-xs mt-1">HMY Yachts</p>
          </div>
          <p className="text-xs">
            Photography &amp; site by{" "}
            <a href="https://yachtpics.com" className="text-accent-300 hover:underline">
              YachtPics
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
