"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Cormorant_Garamond } from "next/font/google";
import { createClient } from "@/lib/supabase/client";
import { hasAccess } from "@/lib/subscriptionAccess";

/**
 * Editorial serif for the vessel name. High-contrast garamond — the register
 * luxury brokerages use, and a deliberate move away from the heavy system-UI
 * bold that made these cards read like every other listing post.
 */
const serif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
});

type Photo = { id: string; url: string | null };
type Format = "square" | "story";
const DIMS: Record<Format, { w: number; h: number }> = {
  square: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 },
};
// Canvas palette — monochrome by design. The boat supplies the only colour on
// the card; charcoal and bone carry everything else. (A 2D context can't read
// Tailwind classes, so these mirror the tokens literally.)
const INK = "#050b14";       // ink-950 — fallback ground
const BONE = "#ffffff";      // vessel name
const BONE_SOFT = "rgba(255,255,255,0.86)"; // caps above the name
const BONE_QUIET = "rgba(255,255,255,0.66)"; // spec line
const KEYLINE = "rgba(255,255,255,0.22)";

/**
 * Canvas has no reliable letter-spacing across browsers, so draw tracked caps
 * a glyph at a time. Returns the total width so callers can centre it.
 */
function trackedWidth(ctx: CanvasRenderingContext2D, text: string, track: number) {
  let total = 0;
  for (const ch of text) total += ctx.measureText(ch).width + track;
  return total - track;
}
function fillTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  track: number
) {
  let x = cx - trackedWidth(ctx, text, track) / 2;
  for (const ch of text) {
    ctx.fillText(ch, x, y);
    x += ctx.measureText(ch).width + track;
  }
}

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
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, w, h);

    try {
      const img = await loadImage(selected);
      drawCover(ctx, img, w, h);
    } catch { /* leave ink bg */ }

    // ── Cinematic monochrome composition ────────────────────────────────
    // Everything below is centred and scaled off the short edge, so the square
    // and the story crop read identically.
    const s = Math.min(w, h) / 1080;
    const cx = w / 2;

    // Make sure the serif is actually rasterised before we measure or draw
    // with it — otherwise the first paint silently falls back to a system font.
    try { await document.fonts.ready; } catch { /* older browser: fall through */ }
    const serifFamily = serif.style.fontFamily;
    const sans = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

    // A soft vignette top and bottom: enough to seat the type, not so much
    // that it flattens the photograph.
    const topGrad = ctx.createLinearGradient(0, 0, 0, h * 0.34);
    topGrad.addColorStop(0, "rgba(10,13,17,0.52)");
    topGrad.addColorStop(1, "rgba(10,13,17,0)");
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, w, h * 0.34);

    const botGrad = ctx.createLinearGradient(0, h * 0.42, 0, h);
    botGrad.addColorStop(0, "rgba(10,13,17,0)");
    botGrad.addColorStop(1, "rgba(10,13,17,0.90)");
    ctx.fillStyle = botGrad;
    ctx.fillRect(0, h * 0.42, w, h * 0.58);

    // Inset keyline — the frame that makes it read as a composed piece.
    const inset = 44 * s;
    ctx.strokeStyle = KEYLINE;
    ctx.lineWidth = Math.max(1, 1.5 * s);
    ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);

    ctx.textAlign = "left"; // fillTracked centres manually
    ctx.textBaseline = "alphabetic";

    // Status, centred at the top.
    if (badge) {
      ctx.fillStyle = BONE_SOFT;
      ctx.font = `500 ${22 * s}px ${sans}`;
      fillTracked(ctx, badge.toUpperCase(), cx, inset + 58 * s, 6 * s);
    }

    // Broker logo sits centred just inside the lower keyline; draw it first so
    // the text stack knows how much room is left above it.
    let logoBlock = 0;
    if (logoUrl) {
      try {
        const logo = await loadImage(logoUrl);
        const lw = 150 * s, lh = (logo.height / logo.width) * lw;
        ctx.globalAlpha = 0.92;
        ctx.drawImage(logo, cx - lw / 2, h - inset - 34 * s - lh, lw, lh);
        ctx.globalAlpha = 1;
        logoBlock = lh + 30 * s;
      } catch { /* skip logo */ }
    }

    // Bottom stack, built upward from the baseline so it always sits right.
    let y = h - inset - 60 * s - logoBlock;

    // Spec line: length · year · price — monochrome, quiet, wide-tracked.
    const specBits = [
      listing.length_ft ? `${listing.length_ft} FEET` : null,
      listing.year ? String(listing.year) : null,
      listing.asking_price ? `$${Number(listing.asking_price).toLocaleString("en-US")}` : null,
    ].filter(Boolean) as string[];
    if (specBits.length) {
      ctx.fillStyle = BONE_QUIET;
      ctx.font = `500 ${21 * s}px ${sans}`;
      fillTracked(ctx, specBits.join("   ·   "), cx, y, 5.5 * s);
      y -= 46 * s;
    }

    // Vessel name — the editorial serif, centred, wrapping if it must.
    const name = listing.vessel_name ?? "Now Available";
    const nameSize = name.length > 18 ? 68 * s : name.length > 12 ? 82 * s : 96 * s;
    ctx.fillStyle = BONE;
    ctx.font = `600 ${nameSize}px ${serifFamily}, Georgia, serif`;
    const maxW = w - inset * 2 - 56 * s;
    const lines: string[] = [];
    if (ctx.measureText(name).width > maxW) {
      let line = "";
      for (const word of name.split(" ")) {
        if (line && ctx.measureText(`${line} ${word}`).width > maxW) { lines.push(line); line = word; }
        else line = line ? `${line} ${word}` : word;
      }
      if (line) lines.push(line);
    } else {
      lines.push(name);
    }
    ctx.textAlign = "center";
    for (let i = lines.length - 1; i >= 0; i--) {
      ctx.fillText(lines[i], cx, y);
      y -= nameSize * 1.02;
    }
    ctx.textAlign = "left";
    y -= 6 * s;

    // Make + model above the name, in tracked caps.
    const maker = [listing.make, listing.model].filter(Boolean).join(" ");
    if (maker) {
      ctx.fillStyle = BONE_SOFT;
      ctx.font = `500 ${21 * s}px ${sans}`;
      fillTracked(ctx, maker.toUpperCase(), cx, y, 7 * s);
      y -= 34 * s;
    }


    // Watermark for expired brokers — they see the design, but the output is
    // unusable until they subscribe.
    if (locked) {
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-Math.PI / 6);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.32)";
      ctx.font = `600 ${112 * s}px ${serifFamily}, Georgia, serif`;
      ctx.fillText("Preview", 0, -24 * s);
      ctx.font = `500 ${30 * s}px ${sans}`;
      ctx.fillText("Subscribe to unlock", 0, 46 * s);
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

  if (loading) return <div className="flex items-center justify-center h-64 text-ink-400 text-sm">Loading…</div>;
  if (!listing) return <div className="flex items-center justify-center h-64 text-ink-400 text-sm">Listing not found.</div>;

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href={`/dashboard/listings/${id}`} className="text-ink-400 hover:text-ink-600 text-sm transition-colors">← Back to Listing</Link>
        <h1 className="text-display text-ink-900 mt-1">Social Post</h1>
        <p className="text-ink-500 mt-1 text-sm">Make a branded, post-ready image for Instagram, Facebook, or Stories — pick a photo, choose a tag, and grab the matching caption.</p>
      </div>

      {locked && (
        <div className="mb-5 px-4 py-3 rounded-ctl text-sm bg-danger-50 border border-danger-200 text-danger-700">
          <span className="font-semibold">This is a preview.</span>{" "}
          Your plan has ended — subscribe to download clean, watermark-free social posts.{" "}
          <Link href="/dashboard/billing" className="font-semibold underline">Choose a plan →</Link>
        </div>
      )}

      {/* Format toggle */}
      <div className="flex gap-2 mb-5">
        {(["square", "story"] as Format[]).map((f) => (
          <button key={f} onClick={() => setFormat(f)}
            className={`text-sm font-medium px-4 py-2 rounded-ctl border transition-colors ${format === f ? "bg-ink-950 text-white border-ink-950" : "bg-white text-ink-600 border-hairline-strong hover:border-ink-300"}`}>
            {f === "square" ? "Square (feed)" : "Story (9:16)"}
          </button>
        ))}
      </div>

      {/* Status tag */}
      <div className="mb-5">
        <p className="label-caps text-ink-500 mb-2">Tag</p>
        <div className="flex flex-wrap gap-2">
          {BADGES.map((b) => (
            <button key={b} onClick={() => setBadge(b)}
              className={`text-xs font-medium px-3 py-1.5 rounded-ctl border transition-colors ${badge === b ? "bg-accent-500 text-ink-950 border-accent-500" : "bg-white text-ink-600 border-hairline-strong hover:border-ink-300"}`}>
              {b}
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div className="flex justify-center mb-5">
        <canvas ref={canvasRef} className="rounded-sm shadow-print w-full" style={{ maxWidth: format === "square" ? 360 : 280 }} />
      </div>

      <div className="flex justify-center mb-6">
        {locked ? (
          <Link href="/dashboard/billing"
            className="bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-6 py-2.5 rounded-ctl transition-colors">
            🔒 Subscribe to Download
          </Link>
        ) : (
          <button onClick={download} disabled={rendering || !selected}
            className="bg-accent-500 hover:bg-accent-400 disabled:opacity-40 text-ink-950 text-sm font-semibold px-6 py-2.5 rounded-ctl transition-colors">
            {rendering ? "Rendering…" : "⬇ Download Image"}
          </button>
        )}
      </div>

      {/* Photo picker */}
      {photos.length > 0 && (
        <>
          <p className="label-caps text-ink-500 mb-2">Background photo</p>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {photos.filter((p) => p.url).map((p) => (
              <button key={p.id} onClick={() => setSelected(p.url)}
                className={`shrink-0 rounded-sm overflow-hidden border-2 transition-colors ${selected === p.url ? "border-accent-500" : "border-transparent"}`}>
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
          <p className="label-caps text-ink-500">Caption &amp; hashtags</p>
          <button onClick={copyCaption} className="text-xs font-semibold text-accent-700 hover:underline">
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={9}
          className="w-full text-sm border border-hairline-strong rounded-ctl px-3 py-2.5 focus:outline-none focus:border-accent-500 resize-y leading-relaxed"
        />
        <p className="text-xs text-ink-400 mt-1.5">Tweak it however you like, then copy and paste into your post.</p>
      </div>
    </div>
  );
}
