"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { hasAccess } from "@/lib/subscriptionAccess";

type Photo = { id: string; url: string | null };
type Format = "square" | "story";
const DIMS: Record<Format, { w: number; h: number }> = {
  square: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 },
};
const GOLD = "#d4a843";

// Load an image robustly: fetch as blob → object URL → <img>, which keeps the
// canvas untainted so we can export it (signed Supabase URLs send CORS for GET).
function loadImage(url: string): Promise<HTMLImageElement> {
  return fetch(url)
    .then((r) => r.blob())
    .then((blob) => new Promise<HTMLImageElement>((resolve, reject) => {
      const objUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = objUrl;
    }));
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

const BADGES = ["For Sale", "Just Listed", "Price Reduced", "Open House", "Sold"];

type ListingData = {
  vessel_name: string | null; year: number | null; make: string | null; model: string | null;
  vessel_type: string | null; length_ft: number | null; location: string | null; asking_price: number | null;
};

function buildCaption(l: ListingData): string {
  const title = [l.year, l.make, l.model, l.vessel_name].filter(Boolean).join(" ");
  const lines: string[] = [];
  lines.push(`🛥️ ${title || l.vessel_name || "Now Available"}`);
  const spec = [l.length_ft ? `${l.length_ft}′` : null, l.vessel_type].filter(Boolean).join(" · ");
  if (spec) lines.push(spec);
  if (l.location) lines.push(`📍 ${l.location}`);
  if (l.asking_price) lines.push(`💰 $${Number(l.asking_price).toLocaleString("en-US")}`);
  lines.push("");
  lines.push("Now available — message or call for full details, more photos, or a private showing.");
  lines.push("");
  const tags = new Set<string>();
  if (l.make) tags.add(`#${l.make.replace(/[^a-z0-9]/gi, "").toLowerCase()}`);
  ["#yachtsforsale", "#yachtlife", "#yachting", "#boatsforsale", "#luxuryyachts", "#yachtbroker", "#boatlife", "#forsale"].forEach((t) => tags.add(t));
  if (l.location) { const loc = l.location.split(",")[0].replace(/[^a-z0-9]/gi, "").toLowerCase(); if (loc) tags.add(`#${loc}`); }
  lines.push(Array.from(tags).join(" "));
  return lines.join("\n");
}

export default function SocialGraphicPage() {
  const supabase = createClient();
  const id = useParams().id as string;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [format, setFormat] = useState<Format>("square");
  const [listing, setListing] = useState<ListingData | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [badge, setBadge] = useState("For Sale");
  const [caption, setCaption] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: l } = await supabase.from("listings")
        .select("vessel_name, year, make, model, vessel_type, length_ft, location, asking_price, broker_id, hero_photo_id")
        .eq("id", id).single();
      if (!l) { setLoading(false); return; }
      // Paid tool: if the owner's plan lapsed, still show the generator + live
      // preview (watermarked) so they see what they're missing — only the
      // download is blocked.
      try {
        const subRes = await fetch(`/api/subscription/status?brokerId=${l.broker_id}`);
        const subData = subRes.ok ? await subRes.json() : null;
        setLocked(!hasAccess(subData?.status));
      } catch { /* leave unlocked on a status hiccup */ }
      setListing(l);
      setCaption(buildCaption(l));
      const { data: det } = await supabase.from("broker_details").select("logo_url").eq("id", l.broker_id).maybeSingle();
      setLogoUrl(det?.logo_url ?? null);
      const { data: ph } = await supabase.from("photos")
        .select("id, storage_path").eq("listing_id", id).eq("is_visible", true).order("display_order");
      const paths = (ph ?? []).map((p) => p.storage_path);
      const { data: signed } = paths.length ? await supabase.storage.from("listing-photos").createSignedUrls(paths, 7200) : { data: [] };
      const withUrls: Photo[] = (ph ?? []).map((p, i) => ({ id: p.id, url: signed?.[i]?.signedUrl ?? null }));
      setPhotos(withUrls);
      // Default to the broker-chosen cover photo if set & visible, else the first photo.
      const hero = l.hero_photo_id ? withUrls.find((p) => p.id === l.hero_photo_id && p.url) : null;
      setSelected(hero?.url ?? withUrls.find((p) => p.url)?.url ?? null);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const render = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !selected || !listing) return;
    setRendering(true);
    const { w, h } = DIMS[format];
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#050b14";
    ctx.fillRect(0, 0, w, h);

    try {
      const img = await loadImage(selected);
      drawCover(ctx, img, w, h);
    } catch { /* leave navy bg */ }

    // Bottom gradient for legibility
    const gradH = h * 0.5;
    const grad = ctx.createLinearGradient(0, h - gradH, 0, h);
    grad.addColorStop(0, "rgba(5,11,20,0)");
    grad.addColorStop(1, "rgba(5,11,20,0.92)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, h - gradH, w, gradH);

    // Status tag (top-left)
    ctx.fillStyle = GOLD;
    ctx.font = "700 34px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(badge.toUpperCase(), 64, 60);

    // Vessel name + details + price (bottom-left)
    const pad = 64;
    let y = h - pad;
    if (listing.asking_price) {
      ctx.fillStyle = GOLD;
      ctx.font = "800 56px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(`$${Number(listing.asking_price).toLocaleString("en-US")}`, pad, y);
      y -= 70;
    }
    const sub = [listing.year, listing.make, listing.length_ft ? `${listing.length_ft}′` : null].filter(Boolean).join("  ·  ");
    if (sub) {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "500 34px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(sub, pad, y);
      y -= 56;
    }
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 68px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    const name = listing.vessel_name ?? "Now Available";
    // simple wrap if too wide
    const maxW = w - pad * 2;
    if (ctx.measureText(name).width > maxW) {
      const words = name.split(" ");
      let line = "", lines: string[] = [];
      for (const word of words) {
        if (ctx.measureText(line + word).width > maxW && line) { lines.push(line.trim()); line = ""; }
        line += word + " ";
      }
      if (line) lines.push(line.trim());
      for (let i = lines.length - 1; i >= 0; i--) { ctx.fillText(lines[i], pad, y); y -= 76; }
    } else {
      ctx.fillText(name, pad, y);
    }

    // Broker logo (bottom-right)
    if (logoUrl) {
      try {
        const logo = await loadImage(logoUrl);
        const lw = 220, lh = (logo.height / logo.width) * lw;
        ctx.drawImage(logo, w - lw - pad, h - lh - pad, lw, lh);
      } catch { /* skip logo */ }
    }

    // Watermark for expired brokers — they see the design, but the output is
    // unusable until they subscribe.
    if (locked) {
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-Math.PI / 6);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.30)";
      ctx.font = "800 96px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText("PREVIEW", 0, -28);
      ctx.font = "700 36px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText("Subscribe to unlock", 0, 44);
      ctx.restore();
    }

    setRendering(false);
  }, [selected, listing, format, logoUrl, badge, locked]);

  useEffect(() => { render(); }, [render]);

  function download() {
    if (locked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const safe = (listing?.vessel_name ?? "listing").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
      a.download = `${safe || "listing"}-${format}.png`;
      a.click();
    }, "image/png");
  }

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>;
  if (!listing) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Listing not found.</div>;

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href={`/dashboard/listings/${id}`} className="text-gray-400 hover:text-gray-600 text-sm transition-colors">← Back to Listing</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Social Post</h1>
        <p className="text-gray-500 mt-1 text-sm">Make a branded, post-ready image for Instagram, Facebook, or Stories — pick a photo, choose a tag, and grab the matching caption.</p>
      </div>

      {locked && (
        <div className="mb-5 px-4 py-3 rounded-lg text-sm bg-red-50 border border-red-200 text-red-800">
          <span className="font-semibold">This is a preview.</span>{" "}
          Your plan has ended — subscribe to download clean, watermark-free social posts.{" "}
          <Link href="/dashboard/billing" className="font-semibold underline">Choose a plan →</Link>
        </div>
      )}

      {/* Format toggle */}
      <div className="flex gap-2 mb-5">
        {(["square", "story"] as Format[]).map((f) => (
          <button key={f} onClick={() => setFormat(f)}
            className={`text-sm font-medium px-4 py-2 rounded-lg border transition-colors ${format === f ? "bg-[#050b14] text-white border-[#050b14]" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"}`}>
            {f === "square" ? "Square (feed)" : "Story (9:16)"}
          </button>
        ))}
      </div>

      {/* Status tag */}
      <div className="mb-5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Tag</p>
        <div className="flex flex-wrap gap-2">
          {BADGES.map((b) => (
            <button key={b} onClick={() => setBadge(b)}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${badge === b ? "bg-[#d4a843] text-[#050b14] border-[#d4a843]" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"}`}>
              {b}
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div className="flex justify-center mb-5">
        <canvas ref={canvasRef} className="rounded-xl shadow-lg border border-gray-200 w-full" style={{ maxWidth: format === "square" ? 360 : 280 }} />
      </div>

      <div className="flex justify-center mb-6">
        {locked ? (
          <Link href="/dashboard/billing"
            className="bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors">
            🔒 Subscribe to Download
          </Link>
        ) : (
          <button onClick={download} disabled={rendering || !selected}
            className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors">
            {rendering ? "Rendering…" : "⬇ Download Image"}
          </button>
        )}
      </div>

      {/* Photo picker */}
      {photos.length > 0 && (
        <>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Background photo</p>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {photos.filter((p) => p.url).map((p) => (
              <button key={p.id} onClick={() => setSelected(p.url)}
                className={`shrink-0 rounded-lg overflow-hidden border-2 transition-colors ${selected === p.url ? "border-[#d4a843]" : "border-transparent"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url!} alt="" className="w-16 h-16 object-cover" />
              </button>
            ))}
          </div>
        </>
      )}

      {/* Caption + hashtags */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Caption &amp; hashtags</p>
          <button onClick={copyCaption} className="text-xs font-semibold text-[#c49a35] hover:underline">
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={9}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#d4a843] resize-y leading-relaxed"
        />
        <p className="text-xs text-gray-400 mt-1.5">Tweak it however you like, then copy and paste into your post.</p>
      </div>
    </div>
  );
}
