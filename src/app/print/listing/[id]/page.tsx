import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import Link from "next/link";
import PrintButton from "./PrintButton";
import HeroImage from "./HeroImage";
import { getEffectiveAccessStatus } from "@/lib/brokerAccess";
import { hasAccess } from "@/lib/subscriptionAccess";

export const dynamic = "force-dynamic";

// Print palette — inline values mirroring the tokens in tailwind.config.ts.
// This page renders to paper, so colors must be literal and deterministic.
const INK = "#050b14"; // ink-950 — the wordmark ink
const BRASS = "#c39e4e"; // accent-500 — the single brass rule
const BRASS_LARGE = "#a58238"; // accent-600 — large accent text on white (≥3:1)
const CHAMPAGNE = "#dfc98a"; // accent-300 — accent text on ink

function specRows(l: Record<string, unknown>): [string, string][] {
  const rows: [string, string][] = [];
  const push = (label: string, val: unknown, suffix = "") => {
    if (val !== null && val !== undefined && val !== "") rows.push([label, `${val}${suffix}`]);
  };
  push("Year", l.year);
  push("Length", l.length_ft, "′");
  push("Beam", l.beam_ft, "′");
  push("Draft", l.draft_ft, "′");
  push("Staterooms", l.staterooms);
  push("Heads", l.heads);
  push("Engines", l.engines);
  push("Engine Hours", l.engine_hours ? Number(l.engine_hours).toLocaleString("en-US") : null);
  push("Fuel", l.fuel_type);
  push("Cruising Speed", l.cruising_speed_kn, " kn");
  push("Max Speed", l.max_speed_kn, " kn");
  push("Hull", l.hull_material);
  push("Location", l.location);
  return rows;
}

export default async function ListingFlyerPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // RLS lets the owner / assistant / co-broker / admin read it; otherwise null.
  const { data: access } = await supabase.from("listings").select("id").eq("id", params.id).single();
  if (!access) notFound();

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: listing } = await service
    .from("listings")
    .select("*")
    .eq("id", params.id)
    .single();
  if (!listing) notFound();

  // Spec sheet is a paid tool. If the owner's plan lapsed, still SHOW the flyer
  // (so they see what they're missing) but watermark it and block printing.
  const { status: ownerAccess } = await getEffectiveAccessStatus(service, listing.broker_id);
  const locked = !hasAccess(ownerAccess);

  const [{ data: profile }, { data: details }] = await Promise.all([
    service.from("profiles").select("first_name, last_name, phone, display_email").eq("id", listing.broker_id).single(),
    service.from("broker_details").select("brokerage_name, brokerage_website, logo_url").eq("id", listing.broker_id).maybeSingle(),
  ]);

  // Hero photo: the broker-chosen cover if set & still visible, otherwise the
  // first visible photo by display order.
  let heroPhoto: { storage_path: string; uploaded_by: string | null } | null = null;
  if (listing.hero_photo_id) {
    const { data: chosen } = await service.from("photos")
      .select("storage_path, uploaded_by, is_visible")
      .eq("id", listing.hero_photo_id).maybeSingle();
    if (chosen && chosen.is_visible) heroPhoto = { storage_path: chosen.storage_path, uploaded_by: chosen.uploaded_by };
  }
  if (!heroPhoto) {
    const { data: first } = await service.from("photos")
      .select("storage_path, uploaded_by")
      .eq("listing_id", params.id).eq("is_visible", true).order("display_order").limit(1).maybeSingle();
    heroPhoto = first ?? null;
  }

  let heroUrl: string | null = null;
  if (heroPhoto?.storage_path) {
    const { data: signed } = await service.storage.from("listing-photos").createSignedUrl(heroPhoto.storage_path, 3600);
    heroUrl = signed?.signedUrl ?? null;
  }

  // Only credit YachtPics when the hero photo is ours — delivered (no uploader)
  // or uploaded by an admin. A broker's own upload gets no credit.
  let heroByYachtPics = false;
  if (heroPhoto) {
    if (!heroPhoto.uploaded_by) {
      heroByYachtPics = true;
    } else {
      const { data: up } = await service.from("profiles").select("role").eq("id", heroPhoto.uploaded_by).single();
      heroByYachtPics = up?.role === "admin";
    }
  }

  let qrDataUrl: string | null = null;
  if (listing.slideshow_published && listing.slideshow_slug) {
    qrDataUrl = await QRCode.toDataURL(`https://portal.yachtpics.com/s/${listing.slideshow_slug}?src=flyer`, {
      width: 256, margin: 1, color: { dark: INK, light: "#ffffff" },
    }).catch(() => null);
  }

  const rows = specRows(listing as Record<string, unknown>);
  const brokerName = profile?.first_name ? `${profile.first_name} ${profile.last_name ?? ""}`.trim() : (profile?.display_email ?? "Broker");
  const price = listing.asking_price
    ? `$${Number(listing.asking_price).toLocaleString("en-US")}`
    : "Price on request";
  const subtitle = [listing.year, listing.make, listing.model].filter(Boolean).join(" ");

  return (
    <div style={{ background: "#eef0f2", minHeight: "100vh", padding: "24px 0" }}>
      <style>{`
        @page { size: letter portrait; margin: 0; }
        @media print {
          html, body { background: #fff !important; }
          .flyer-wrap { padding: 0 !important; background: #fff !important; }
          .flyer { box-shadow: none !important; margin: 0 !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="flyer-wrap" style={{ display: "flex", justifyContent: "center" }}>
        <div className="flyer" style={{ position: "relative", width: "8.5in", minHeight: "11in", background: "#fff", boxShadow: "0 2px 16px rgba(5,11,20,0.15)", display: "flex", flexDirection: "column", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", color: "#343d4a" }}>

          {locked && (
            <div style={{ position: "absolute", inset: 0, zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <div style={{ transform: "rotate(-30deg)", textAlign: "center", color: "rgba(195,158,78,0.30)", fontWeight: 800 }}>
                <div style={{ fontSize: 96, letterSpacing: 4 }}>PREVIEW</div>
                <div style={{ fontSize: 30, letterSpacing: 2, color: "rgba(5,11,20,0.30)" }}>Subscribe to unlock</div>
              </div>
            </div>
          )}

          {/* Top bar */}
          <div style={{ background: INK, padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {details?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={details.logo_url} alt="" style={{ maxHeight: 44, maxWidth: 200, objectFit: "contain" }} />
            ) : (
              <span style={{ color: "#fff", fontSize: 18, fontWeight: 600 }}>{details?.brokerage_name ?? brokerName}</span>
            )}
            <span style={{ color: CHAMPAGNE, fontSize: 12, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase" }}>For Sale</span>
          </div>

          {/* Hero */}
          {heroUrl && <HeroImage src={heroUrl} alt={listing.vessel_name ?? ""} fit={listing.hero_fit === "fill" ? "fill" : "fit"} />}

          {/* Title + price, closed by the flyer's single brass rule */}
          <div style={{ margin: "0 32px", padding: "24px 0 14px", borderBottom: `1px solid ${BRASS}`, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", color: "#0c1420" }}>{listing.vessel_name ?? "Untitled Vessel"}</h1>
              {subtitle && <p style={{ margin: "4px 0 0", fontSize: 15, color: "#6d7581" }}>{subtitle}{listing.vessel_type ? ` · ${listing.vessel_type}` : ""}</p>}
            </div>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 600, color: BRASS_LARGE, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{price}</p>
          </div>

          {/* Specs */}
          {rows.length > 0 && (
            <div style={{ padding: "14px 32px 12px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px 24px" }}>
                {rows.map(([label, val]) => (
                  <div key={label} style={{ borderTop: "1px solid #e0e3e7", paddingTop: 6 }}>
                    <p style={{ margin: 0, fontSize: 9, color: "#6d7581", textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 600 }}>{label}</p>
                    <p style={{ margin: "3px 0 0", fontSize: 14, color: "#0c1420", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{val}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          {listing.description && (
            <div style={{ padding: "12px 32px" }}>
              <p style={{ margin: 0, fontSize: 13, color: "#4c5560", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{listing.description}</p>
            </div>
          )}

          <div style={{ flex: 1 }} />

          {/* Footer: broker + QR */}
          <div style={{ borderTop: "1px solid #e0e3e7", padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <div>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#0c1420" }}>{brokerName}</p>
              {details?.brokerage_name && <p style={{ margin: "2px 0 0", fontSize: 13, color: "#6d7581" }}>{details.brokerage_name}</p>}
              <div style={{ marginTop: 6, fontSize: 13, color: "#4c5560" }}>
                {profile?.phone && <span style={{ marginRight: 14 }}>{profile.phone}</span>}
                {profile?.display_email && <span style={{ marginRight: 14 }}>{profile.display_email}</span>}
                {details?.brokerage_website && <span>{details.brokerage_website.replace(/^https?:\/\//, "")}</span>}
              </div>
            </div>
            {qrDataUrl && (
              <div style={{ textAlign: "center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} alt="Scan for gallery" style={{ width: 84, height: 84 }} />
                <p style={{ margin: "2px 0 0", fontSize: 8, color: "#6d7581", textTransform: "uppercase", letterSpacing: "0.14em" }}>Scan for full gallery</p>
              </div>
            )}
          </div>

          {heroByYachtPics && (
            <div style={{ background: INK, padding: "8px 32px", textAlign: "center" }}>
              <span style={{ color: "#c5cbd2", fontSize: 10 }}>Photography by YachtPics</span>
            </div>
          )}
        </div>
      </div>

      {locked ? (
        <div className="no-print" style={{ maxWidth: "8.5in", margin: "16px auto 0", textAlign: "center" }}>
          <div style={{ background: "#fdf1f0", border: "1px solid #f5cfca", borderRadius: 10, padding: "16px 20px" }}>
            <p style={{ margin: "0 0 10px", fontSize: 14, color: "#992f26" }}><strong>This is a preview.</strong> Your plan has ended — subscribe to print or email a clean, watermark-free spec sheet.</p>
            <Link href="/dashboard/billing" style={{ display: "inline-block", background: BRASS, color: INK, fontWeight: 600, fontSize: 14, textDecoration: "none", padding: "10px 22px", borderRadius: 8 }}>Choose a plan &rarr;</Link>
          </div>
        </div>
      ) : (
        <PrintButton />
      )}
    </div>
  );
}
