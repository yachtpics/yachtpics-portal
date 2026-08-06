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

/**
 * Fit the whole photograph inside the area — never crop it. Most boat shots are
 * horizontal, and cropping one into a square cuts the bow or stern off the thing
 * we're actually selling. Letterboxing costs a little space and keeps the frame
 * the photographer composed.
 */
function drawContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number, y: number, w: number, h: number
) {
  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
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

    // Layout: photograph in its entirety up top, a solid band beneath it for the
    // type. Nothing is written over the boat — white text on a white hull or a
    // bright sky is unreadable — and a horizontal shot never gets cropped to
    // fit a square.
    const bandH = format === "story" ? h * 0.30 : h * 0.34;
    const photoH = h - bandH;

    try {
      const img = await loadImage(selected);
      drawContain(ctx, img, 0, 0, w, photoH);
    } catch { /* leave ink bg */ }

    // The band.
    ctx.fillStyle = INK;
    ctx.fillRect(0, photoH, w, bandH);
    // A hairline where the photograph meets it — the rule from the wordmark.
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fillRect(0, photoH, w, Math.max(1, 1.5 * (Math.min(w, h) / 1080)));

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

    ctx.textAlign = "left"; // fillTracked centres manually
    ctx.textBaseline = "alphabetic";

    // Status tag — small, top-left, over the photo's own ground rather than the
    // boat, so it never sits on the hull.
    // NOTE ON SIZES: Instagram renders a 1080px card at roughly 400px wide, so
    // anything under ~30px here is unreadable in-feed. Sizes are set for that,
    // not for how they look zoomed-in on a desktop.
    if (badge) {
      const bs = 26 * s;
      ctx.font = `600 ${bs}px ${sans}`;
      const tw = trackedWidth(ctx, badge.toUpperCase(), 7 * s);
      const bx = 44 * s, by = 44 * s;
      ctx.fillStyle = "rgba(5,11,20,0.72)";
      ctx.fillRect(bx, by, tw + 44 * s, bs + 34 * s);
      ctx.fillStyle = BONE;
      fillTracked(ctx, badge.toUpperCase(), bx + (tw + 44 * s) / 2, by + bs + 12 * s, 7 * s);
    }

    // ── The band ────────────────────────────────────────────────────────
    // Everything below lives on solid ink, so legibility never depends on
    // what the photograph happens to be doing behind it. The stack is
    // measured first, then centred in the band.
    const name = listing.vessel_name ?? "Now Available";
    const maker = [listing.make, listing.model].filter(Boolean).join(" ");
    const specBits = [
      listing.length_ft ? `${listing.length_ft} FEET` : null,
      listing.year ? String(listing.year) : null,
      listing.asking_price ? `$${Number(listing.asking_price).toLocaleString("en-US")}` : null,
    ].filter(Boolean) as string[];
    const spec = specBits.join("   ·   ");

    const capSize = 29 * s;
    const nameSize = name.length > 22 ? 88 * s : name.length > 14 ? 108 * s : 124 * s;
    const maxW = w - 130 * s;

    // Wrap the name if it's long.
    ctx.font = `600 ${nameSize}px ${serifFamily}, Georgia, serif`;
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

    // Logo height, so it can be centred into the stack rather than floated.
    let logo: HTMLImageElement | null = null;
    let logoW = 0, logoH = 0;
    if (logoUrl) {
      try {
        logo = await loadImage(logoUrl);
        logoW = 200 * s;
        logoH = (logo.height / logo.width) * logoW;
      } catch { logo = null; }
    }

    // Measure the whole stack, then centre it vertically in the band.
    const gapCapName = 26 * s;
    const gapNameSpec = 30 * s;
    const gapSpecLogo = 30 * s;
    const nameBlock = lines.length * nameSize * 0.96;
    const stackH =
      (maker ? capSize + gapCapName : 0) +
      nameBlock +
      (spec ? gapNameSpec + capSize : 0) +
      (logo ? gapSpecLogo + logoH : 0);

    let y = photoH + (bandH - stackH) / 2;

    if (maker) {
      ctx.fillStyle = BONE_SOFT;
      ctx.font = `600 ${capSize}px ${sans}`;
      y += capSize;
      fillTracked(ctx, maker.toUpperCase(), cx, y, 9 * s);
      y += gapCapName;
    }

    ctx.fillStyle = BONE;
    ctx.font = `600 ${nameSize}px ${serifFamily}, Georgia, serif`;
    ctx.textAlign = "center";
    for (const line of lines) {
      y += nameSize * 0.76;
      ctx.fillText(line, cx, y);
      y += nameSize * 0.20;
    }
    ctx.textAlign = "left";

    if (spec) {
      y += gapNameSpec + capSize * 0.8;
      ctx.fillStyle = BONE_QUIET;
      ctx.font = `600 ${capSize}px ${sans}`;
      fillTracked(ctx, spec, cx, y, 7 * s);
    }

    if (logo) {
      y += gapSpecLogo;
      ctx.globalAlpha = 0.95;
      ctx.drawImage(logo, cx - logoW / 2, y, logoW, logoH);
      ctx.globalAlpha = 1;
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
