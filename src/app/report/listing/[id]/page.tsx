import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import PrintButton from "@/app/print/listing/[id]/PrintButton";
import { buildEngagement } from "@/lib/engagement";
import { getEffectiveAccessStatus } from "@/lib/brokerAccess";
import { hasAccess } from "@/lib/subscriptionAccess";

export const dynamic = "force-dynamic";

/**
 * Seller Report
 * -------------
 * The page a broker forwards to the owner when they ask "what's happening
 * with my boat?" — views, unique visitors, time spent, the photos buyers
 * linger on and save, who the broker has sent it to, inquiries. Printable to
 * a single letter page, branded with the broker's logo, no portal chrome.
 */

const INK = "#050b14";
const BRASS = "#c39e4e";
const CHAMPAGNE = "#dfc98a";

function fmtDuration(s: number | null) {
  if (!s) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}
function fmtDate(iso: string | null, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  return iso ? new Date(iso).toLocaleDateString("en-US", opts) : "—";
}

export default async function SellerReportPage({ params }: { params: { id: string } }) {
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

  const { data: listing } = await service.from("listings").select("*").eq("id", params.id).single();
  if (!listing) notFound();

  const { status: ownerAccess } = await getEffectiveAccessStatus(service, listing.broker_id);
  const locked = !hasAccess(ownerAccess);

  const [{ data: profile }, { data: details }, eng] = await Promise.all([
    service.from("profiles").select("first_name, last_name, phone, display_email").eq("id", listing.broker_id).single(),
    service.from("broker_details").select("brokerage_name, brokerage_website, logo_url").eq("id", listing.broker_id).maybeSingle(),
    buildEngagement(service, params.id),
  ]);

  // Thumbnails for the photos buyers linger on.
  const topWithUrls = await Promise.all(eng.topPhotos.slice(0, 6).map(async (tp) => {
    const { data: p } = await service.from("photos").select("storage_path").eq("id", tp.photo_id).maybeSingle();
    if (!p) return { ...tp, url: null as string | null };
    const { data: signed } = await service.storage.from("listing-photos").createSignedUrl(p.storage_path, 3600, {
      transform: { width: 400, height: 400, resize: "contain", quality: 72 },
    });
    return { ...tp, url: signed?.signedUrl ?? null };
  }));

  const brokerName = profile?.first_name ? `${profile.first_name} ${profile.last_name ?? ""}`.trim() : (profile?.display_email ?? "Broker");
  const subtitle = [listing.year, listing.make, listing.model].filter(Boolean).join(" ");
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const maxDay = Math.max(1, ...eng.byDay.map((d) => d.views));
  const sourceLabel: Record<string, string> = { send: "Emailed by broker", qr: "QR code", link: "Direct link", share: "Shared link", social: "Social media", flyer: "Spec sheet", site: "yachtpics.com", showcase: "Showcase" };

  const stat = (label: string, value: string, note?: string) => (
    <div style={{ borderTop: "1px solid #e0e3e7", paddingTop: 8 }}>
      <p style={{ margin: 0, fontSize: 9, color: "#6d7581", textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 600 }}>{label}</p>
      <p style={{ margin: "4px 0 0", fontSize: 26, color: "#0c1420", fontWeight: 300, letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{value}</p>
      {note && <p style={{ margin: "4px 0 0", fontSize: 11, color: "#6d7581" }}>{note}</p>}
    </div>
  );

  return (
    <div style={{ background: "#eef0f2", minHeight: "100vh", padding: "24px 0" }}>
      <style>{`
        @page { size: letter portrait; margin: 0; }
        @media print {
          html, body { background: #fff !important; }
          .report-wrap { padding: 0 !important; background: #fff !important; }
          .report { box-shadow: none !important; margin: 0 !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="report-wrap" style={{ display: "flex", justifyContent: "center" }}>
        <div className="report" style={{ position: "relative", width: "8.5in", minHeight: "11in", background: "#fff", boxShadow: "0 2px 16px rgba(5,11,20,0.15)", display: "flex", flexDirection: "column", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", color: "#343d4a" }}>

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
            <span style={{ color: CHAMPAGNE, fontSize: 12, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase" }}>Marketing Report</span>
          </div>

          {/* Title */}
          <div style={{ margin: "0 32px", padding: "24px 0 14px", borderBottom: `1px solid ${BRASS}`, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", color: "#0c1420" }}>{listing.vessel_name ?? "Untitled Vessel"}</h1>
              {subtitle && <p style={{ margin: "4px 0 0", fontSize: 15, color: "#6d7581" }}>{subtitle}{listing.vessel_type ? ` · ${listing.vessel_type}` : ""}</p>}
            </div>
            <p style={{ margin: 0, fontSize: 12, color: "#6d7581", whiteSpace: "nowrap", textAlign: "right" }}>
              As of {today}<br />
              {eng.firstViewAt ? <span>Online since {fmtDate(eng.firstViewAt, { month: "short", day: "numeric", year: "numeric" })}</span> : <span>Not yet viewed</span>}
            </p>
          </div>

          {/* Headline numbers */}
          <div style={{ padding: "18px 32px 8px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "10px 24px" }}>
              {stat("Gallery views", String(eng.views), `${eng.views30d} in the last 30 days`)}
              {stat("Unique visitors", String(eng.uniqueVisitors), `${eng.views7d} views this week`)}
              {stat("Time per visit", fmtDuration(eng.avgSeconds), eng.avgPhotosSeen ? `${eng.avgPhotosSeen} photos seen on average` : undefined)}
              {stat("Inquiries", String(eng.leads), eng.favoritesTotal ? `${eng.favoritesTotal} photos saved by buyers` : undefined)}
            </div>
          </div>

          {/* 30-day chart */}
          <div style={{ padding: "16px 32px 4px" }}>
            <p style={{ margin: "0 0 8px", fontSize: 9, color: "#6d7581", textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 600 }}>Views · last 30 days</p>
            <svg viewBox="0 0 600 90" width="100%" height="90" role="img" aria-label="Daily views over the last 30 days">
              <line x1="0" y1="80.5" x2="600" y2="80.5" stroke="#e0e3e7" strokeWidth="1" />
              {eng.byDay.map((d, i) => {
                const h = d.views ? Math.max(3, (d.views / maxDay) * 70) : 0;
                const x = i * 20 + 3;
                return (
                  <g key={d.day}>
                    <rect x={x} y={80 - h} width={14} height={h} fill={d.views ? BRASS : "#eef0f2"} rx="1" />
                    {(i === 0 || i === 29 || i === 15) && (
                      <text x={x + 7} y={89} fontSize="8" fill="#99a2ad" textAnchor="middle">{fmtDate(d.day)}</text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Two columns: what buyers look at / where views come from */}
          <div style={{ padding: "12px 32px 0", display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 28 }}>
            <div>
              <p style={{ margin: "0 0 8px", fontSize: 9, color: "#6d7581", textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 600 }}>What buyers linger on</p>
              {topWithUrls.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12, color: "#99a2ad" }}>Photo-level detail appears once buyers have spent time in the gallery.</p>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  {topWithUrls.map((tp) => (
                    <div key={tp.photo_id}>
                      <div style={{ aspectRatio: "4 / 3", background: "#eef0f2", overflow: "hidden", borderRadius: 2 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {tp.url && <img src={tp.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                      </div>
                      <p style={{ margin: "5px 0 0", fontSize: 11, fontWeight: 600, color: "#0c1420" }}>{tp.category ?? "Photo"}</p>
                      <p style={{ margin: "1px 0 0", fontSize: 10, color: "#6d7581", fontVariantNumeric: "tabular-nums" }}>
                        {fmtDuration(tp.dwellSeconds)} across {tp.looks} {tp.looks === 1 ? "look" : "looks"}{tp.favorites ? ` · ${tp.favorites} saved` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p style={{ margin: "0 0 8px", fontSize: 9, color: "#6d7581", textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 600 }}>Where views come from</p>
              {eng.bySource.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12, color: "#99a2ad" }}>No views yet.</p>
              ) : eng.bySource.map((s) => (
                <div key={s.source} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 0", borderBottom: "1px solid #eef0f2" }}>
                  <span style={{ color: "#343d4a" }}>{sourceLabel[s.source] ?? s.source}</span>
                  <span style={{ color: "#0c1420", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{s.views}</span>
                </div>
              ))}
              <div style={{ marginTop: 14, fontSize: 12, color: "#343d4a", lineHeight: 1.7 }}>
                {eng.videoPlays > 0 && <div>Video played <strong>{eng.videoPlays}</strong> {eng.videoPlays === 1 ? "time" : "times"}</div>}
                {eng.tourClicks > 0 && <div>360° tour opened <strong>{eng.tourClicks}</strong> {eng.tourClicks === 1 ? "time" : "times"}</div>}
                {eng.detailsViews > 0 && <div>Specifications read <strong>{eng.detailsViews}</strong> {eng.detailsViews === 1 ? "time" : "times"}</div>}
              </div>
            </div>
          </div>

          {/* Sent to */}
          <div style={{ padding: "18px 32px 0" }}>
            <p style={{ margin: "0 0 6px", fontSize: 9, color: "#6d7581", textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 600 }}>Presented to buyers</p>
            {eng.sends.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: "#99a2ad" }}>No direct sends yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <tbody>
                  {eng.sends.slice(0, 10).map((s) => (
                    <tr key={s.id} style={{ borderBottom: "1px solid #eef0f2" }}>
                      <td style={{ padding: "5px 0", color: "#0c1420", fontWeight: 600 }}>{s.client_name ?? s.client_email.split("@")[0]}</td>
                      <td style={{ padding: "5px 0", color: "#6d7581" }}>{fmtDate(s.sent_at)}</td>
                      <td style={{ padding: "5px 0", color: s.open_count ? "#2f7a3e" : "#99a2ad", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {s.open_count ? `Opened ${s.open_count}× · last ${fmtDate(s.last_opened_at)}` : s.included_slideshow ? "Not yet opened" : "Documents only"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {eng.sends.length > 10 && <p style={{ margin: "6px 0 0", fontSize: 11, color: "#99a2ad" }}>+ {eng.sends.length - 10} more</p>}
          </div>

          <div style={{ flex: 1 }} />

          {/* Footer */}
          <div style={{ borderTop: "1px solid #e0e3e7", padding: "18px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <div>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#0c1420" }}>{brokerName}</p>
              {details?.brokerage_name && <p style={{ margin: "2px 0 0", fontSize: 13, color: "#6d7581" }}>{details.brokerage_name}</p>}
              <div style={{ marginTop: 6, fontSize: 13, color: "#4c5560" }}>
                {profile?.phone && <span style={{ marginRight: 14 }}>{profile.phone}</span>}
                {profile?.display_email && <span style={{ marginRight: 14 }}>{profile.display_email}</span>}
                {details?.brokerage_website && <span>{details.brokerage_website.replace(/^https?:\/\//, "")}</span>}
              </div>
            </div>
            <p style={{ margin: 0, fontSize: 9, color: "#99a2ad", textTransform: "uppercase", letterSpacing: "0.14em", textAlign: "right" }}>
              Marketing by {details?.brokerage_name ?? brokerName}<br />Presentation by YachtPics
            </p>
          </div>
        </div>
      </div>

      {locked ? (
        <div className="no-print" style={{ maxWidth: "8.5in", margin: "16px auto 0", textAlign: "center" }}>
          <div style={{ background: "#fdf1f0", border: "1px solid #f5cfca", borderRadius: 10, padding: "16px 20px" }}>
            <p style={{ margin: "0 0 10px", fontSize: 14, color: "#992f26" }}><strong>This is a preview.</strong> Your plan has ended — subscribe to print or send a clean seller report.</p>
            <Link href="/dashboard/billing" style={{ display: "inline-block", background: BRASS, color: INK, fontWeight: 600, fontSize: 14, textDecoration: "none", padding: "10px 22px", borderRadius: 8 }}>Choose a plan &rarr;</Link>
          </div>
        </div>
      ) : (
        <PrintButton />
      )}
      <p className="no-print" style={{ textAlign: "center", fontSize: 12, color: "#6d7581", margin: "14px 0 0" }}>
        Print or save as PDF, then forward it to the owner. Numbers update every time you open this page.
      </p>
    </div>
  );
}
