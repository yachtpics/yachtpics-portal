import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

const GOLD = "#d4a843";
const NAVY = "#050b14";

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

  const [{ data: heroPhoto }, { data: profile }, { data: details }] = await Promise.all([
    service.from("photos").select("storage_path, uploaded_by").eq("listing_id", params.id).eq("is_visible", true).order("display_order").limit(1).maybeSingle(),
    service.from("profiles").select("first_name, last_name, phone, display_email").eq("id", listing.broker_id).single(),
    service.from("broker_details").select("brokerage_name, brokerage_website, logo_url").eq("id", listing.broker_id).maybeSingle(),
  ]);

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
      width: 256, margin: 1, color: { dark: NAVY, light: "#ffffff" },
    }).catch(() => null);
  }

  const rows = specRows(listing as Record<string, unknown>);
  const brokerName = profile?.first_name ? `${profile.first_name} ${profile.last_name ?? ""}`.trim() : (profile?.display_email ?? "Broker");
  const price = listing.asking_price
    ? `$${Number(listing.asking_price).toLocaleString("en-US")}`
    : "Price on request";
  const subtitle = [listing.year, listing.make, listing.model].filter(Boolean).join(" ");

  return (
    <div style={{ background: "#e5e7eb", minHeight: "100vh", padding: "24px 0" }}>
      <style>{`
        @page { size: letter portrait; margin: 0; }
        @media print {
          html, body { background: #fff !important; }
          .flyer-wrap { padding: 0 !important; background: #fff !important; }
          .flyer { box-shadow: none !important; margin: 0 !important; }
        }
      `}</style>

      <div className="flyer-wrap" style={{ display: "flex", justifyContent: "center" }}>
        <div className="flyer" style={{ width: "8.5in", minHeight: "11in", background: "#fff", boxShadow: "0 2px 16px rgba(0,0,0,0.15)", display: "flex", flexDirection: "column", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color: "#1f2937" }}>

          {/* Top bar */}
          <div style={{ background: NAVY, padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {details?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={details.logo_url} alt="" style={{ maxHeight: 44, maxWidth: 200, objectFit: "contain" }} />
            ) : (
              <span style={{ color: "#fff", fontSize: 18, fontWeight: 600 }}>{details?.brokerage_name ?? brokerName}</span>
            )}
            <span style={{ color: GOLD, fontSize: 13, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase" }}>For Sale</span>
          </div>

          {/* Hero */}
          {heroUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={heroUrl} alt={listing.vessel_name ?? ""} style={{ width: "100%", height: "3.6in", objectFit: "cover", display: "block" }} />
          )}

          {/* Title + price */}
          <div style={{ padding: "24px 32px 8px", display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#111827" }}>{listing.vessel_name ?? "Untitled Vessel"}</h1>
              {subtitle && <p style={{ margin: "4px 0 0", fontSize: 15, color: "#6b7280" }}>{subtitle}{listing.vessel_type ? ` · ${listing.vessel_type}` : ""}</p>}
            </div>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: GOLD, whiteSpace: "nowrap" }}>{price}</p>
          </div>

          {/* Specs */}
          {rows.length > 0 && (
            <div style={{ padding: "12px 32px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px 24px" }}>
                {rows.map(([label, val]) => (
                  <div key={label} style={{ borderTop: `2px solid ${GOLD}`, paddingTop: 6 }}>
                    <p style={{ margin: 0, fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600 }}>{label}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 14, color: "#111827", fontWeight: 600 }}>{val}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          {listing.description && (
            <div style={{ padding: "12px 32px" }}>
              <p style={{ margin: 0, fontSize: 13, color: "#374151", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{listing.description}</p>
            </div>
          )}

          <div style={{ flex: 1 }} />

          {/* Footer: broker + QR */}
          <div style={{ borderTop: "1px solid #e5e7eb", padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <div>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#111827" }}>{brokerName}</p>
              {details?.brokerage_name && <p style={{ margin: "2px 0 0", fontSize: 13, color: "#6b7280" }}>{details.brokerage_name}</p>}
              <div style={{ marginTop: 6, fontSize: 13, color: "#374151" }}>
                {profile?.phone && <span style={{ marginRight: 14 }}>{profile.phone}</span>}
                {profile?.display_email && <span style={{ marginRight: 14 }}>{profile.display_email}</span>}
                {details?.brokerage_website && <span>{details.brokerage_website.replace(/^https?:\/\//, "")}</span>}
              </div>
            </div>
            {qrDataUrl && (
              <div style={{ textAlign: "center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} alt="Scan for gallery" style={{ width: 84, height: 84 }} />
                <p style={{ margin: "2px 0 0", fontSize: 9, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px" }}>Scan for full gallery</p>
              </div>
            )}
          </div>

          {heroByYachtPics && (
            <div style={{ background: NAVY, padding: "8px 32px", textAlign: "center" }}>
              <span style={{ color: "#c4c9d4", fontSize: 10 }}>Photography by YachtPics</span>
            </div>
          )}
        </div>
      </div>

      <PrintButton />
    </div>
  );
}
