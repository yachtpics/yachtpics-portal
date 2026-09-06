"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Cormorant_Garamond } from "next/font/google";
import { createClient } from "@/lib/supabase/client";
import { hasAccess } from "@/lib/subscriptionAccess";
import { orderPhotos } from "@/lib/photoOrder";
import { uploadListingVideo } from "@/lib/uploadListingVideo";
import {
  ease,
  fillTrackedCentered,
  fillTrackedLeft,
  loadBitmap,
  trackedWidth,
  wrapLines,
} from "@/lib/canvasText";

/**
 * Listing Reel
 * ------------
 * One tap turns the listing's photographs — already in walk-through order,
 * with the broker's cover shot first — into a finished video:
 *
 *   • Reel  — 1080×1920 (9:16) for Instagram Reels / Stories / Facebook.
 *   • Film  — 1920×1080 (16:9) for Send to Client and the slideshow page.
 *
 * The whole thing renders in the broker's browser: frames are painted to a
 * canvas and encoded with WebCodecs (via mediabunny) straight to an MP4. No
 * server, no render service, no per-video cost. Reels are silent on purpose —
 * Instagram lets the broker add trending audio at post time, which also gets
 * the post more reach than any track we could license.
 */

const serif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
});

type Format = "reel" | "film";
type Fit = "fill" | "whole";

const SPEC: Record<Format, {
  w: number; h: number; label: string; hint: string;
  maxPhotos: number; hold: number; fade: number; titleHold: number; endHold: number; defaultFit: Fit;
}> = {
  reel: {
    w: 1080, h: 1920, label: "Reel (9:16)", hint: "Instagram Reels, Stories, Facebook",
    maxPhotos: 10, hold: 2.4, fade: 0.7, titleHold: 4.0, endHold: 3.0, defaultFit: "fill",
  },
  film: {
    w: 1920, h: 1080, label: "Film (16:9)", hint: "Send to Client, slideshow, YouTube",
    maxPhotos: 14, hold: 3.6, fade: 0.7, titleHold: 4.2, endHold: 3.2, defaultFit: "whole",
  },
};

const FPS = 30;

// Palette mirrors the design tokens (a 2D context can't read Tailwind).
const INK = "#050b14";
const BONE = "#ffffff";
const BONE_SOFT = "rgba(255,255,255,0.86)";
const BONE_QUIET = "rgba(255,255,255,0.66)";
const BRASS = "#dfc98a"; // accent-300 — brass on ink

type Photo = { id: string; storage_path: string; category: string | null; filename: string | null; display_order: number; thumb: string | null };

type ListingData = {
  vessel_name: string | null; year: number | null; make: string | null; model: string | null;
  vessel_type: string | null; length_ft: number | null; location: string | null; asking_price: number | null;
  staterooms: number | null; broker_id: string; hero_photo_id: string | null; photo_order_manual: boolean | null;
};

type BrokerCard = { name: string; brokerage: string | null; phone: string | null; website: string | null; logoUrl: string | null };

type Segment = { kind: "photo"; index: number; start: number; end: number } | { kind: "end"; start: number; end: number };

function safeName(s: string | null | undefined) {
  return (s ?? "listing").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "listing";
}

function fmtPrice(n: number | null) {
  return n ? `$${Number(n).toLocaleString("en-US")}` : null;
}

export default function ListingReelPage() {
  const supabase = createClient();
  const id = useParams().id as string;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [loading, setLoading] = useState(true);
  const [listing, setListing] = useState<ListingData | null>(null);
  const [broker, setBroker] = useState<BrokerCard | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [locked, setLocked] = useState(false);
  const [videoCount, setVideoCount] = useState(0);

  const [format, setFormat] = useState<Format>("reel");
  const [fit, setFit] = useState<Fit>("fill");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [showPrice, setShowPrice] = useState(true);
  const [showLocation, setShowLocation] = useState(true);

  const [supported, setSupported] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "rendering" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [result, setResult] = useState<{ url: string; blob: Blob; format: Format; seconds: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const cancelRef = useRef(false);

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: l } = await supabase.from("listings")
        .select("vessel_name, year, make, model, vessel_type, length_ft, location, asking_price, staterooms, broker_id, hero_photo_id, photo_order_manual")
        .eq("id", id).single();
      if (!l) { setLoading(false); return; }
      setListing(l as ListingData);

      try {
        const subRes = await fetch(`/api/subscription/status?brokerId=${l.broker_id}`);
        const subData = subRes.ok ? await subRes.json() : null;
        setLocked(!hasAccess(subData?.status));
      } catch { /* stay unlocked on a status hiccup */ }

      const [{ data: prof }, { data: det }, { data: ph }, { count }] = await Promise.all([
        supabase.from("profiles").select("first_name, last_name, phone").eq("id", l.broker_id).maybeSingle(),
        supabase.from("broker_details").select("brokerage_name, brokerage_website, logo_url").eq("id", l.broker_id).maybeSingle(),
        supabase.from("photos").select("id, storage_path, category, filename, display_order").eq("listing_id", id).eq("is_visible", true).order("display_order"),
        supabase.from("videos").select("id", { count: "exact", head: true }).eq("listing_id", id),
      ]);
      setVideoCount(count ?? 0);
      setBroker({
        name: [prof?.first_name, prof?.last_name].filter(Boolean).join(" ") || "Broker",
        brokerage: det?.brokerage_name ?? null,
        phone: prof?.phone ?? null,
        website: det?.brokerage_website ?? null,
        logoUrl: det?.logo_url ?? null,
      });

      // Same order the slideshow uses: cover first, then the walk-through.
      const ordered = orderPhotos(ph ?? [], { manual: l.photo_order_manual === true, heroId: l.hero_photo_id });
      // Small thumbnails for the picker (one signing call per photo, in parallel).
      const thumbs = await Promise.all(ordered.map(async (p) => {
        const { data } = await supabase.storage.from("listing-photos")
          .createSignedUrl(p.storage_path, 3600, { transform: { width: 240, height: 240, resize: "contain", quality: 70 } });
        return data?.signedUrl ?? null;
      }));
      const withThumbs: Photo[] = ordered.map((p, i) => ({ ...p, thumb: thumbs[i] }));
      setPhotos(withThumbs);
      setChosen(new Set(withThumbs.slice(0, SPEC.reel.maxPhotos).map((p) => p.id)));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Can this browser encode H.264 at all? (Chrome, Edge, Safari 16.4+; Firefox 130+.)
  useEffect(() => {
    (async () => {
      try {
        const mb = await import("mediabunny");
        const codec = await mb.getFirstEncodableVideoCodec(["avc"], { width: 1080, height: 1920 });
        setSupported(!!codec);
      } catch {
        setSupported(false);
      }
    })();
  }, []);

  // When the format changes, reset the fit and trim the selection to the cap.
  function chooseFormat(f: Format) {
    setFormat(f);
    setFit(SPEC[f].defaultFit);
    setResult(null);
    setPhase("idle");
    setChosen((prev) => {
      const inOrder = photos.filter((p) => prev.has(p.id)).slice(0, SPEC[f].maxPhotos);
      const base = inOrder.length ? inOrder : photos.slice(0, SPEC[f].maxPhotos);
      return new Set(base.map((p) => p.id));
    });
  }

  function togglePhoto(pid: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else if (next.size < SPEC[format].maxPhotos) next.add(pid);
      return next;
    });
    setResult(null);
    setPhase("idle");
  }

  const selectedPhotos = useMemo(() => photos.filter((p) => chosen.has(p.id)), [photos, chosen]);

  const timeline = useMemo(() => {
    const s = SPEC[format];
    const segs: Segment[] = [];
    let t = 0;
    selectedPhotos.forEach((_, i) => {
      const hold = i === 0 ? s.titleHold : s.hold;
      segs.push({ kind: "photo", index: i, start: t, end: t + hold + s.fade });
      t += hold;
    });
    segs.push({ kind: "end", start: t, end: t + s.endHold + s.fade });
    return { segs, total: t + s.endHold };
  }, [selectedPhotos, format]);

  // ── Render ──────────────────────────────────────────────────────────────
  async function render() {
    if (!listing || !broker || selectedPhotos.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    cancelRef.current = false;
    setResult(null);
    setAdded(false);
    setErrorMsg("");
    setPhase("loading");
    setProgress(0);

    const s = SPEC[format];
    const W = s.w, H = s.h;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d", { alpha: false })!;

    try {
      // Fonts first — otherwise the first frames silently fall back.
      const serifFamily = serif.style.fontFamily;
      try {
        await document.fonts.load(`600 100px ${serifFamily}`);
        await document.fonts.ready;
      } catch { /* older browser: fall through */ }

      // Photographs at a sensible size for the frame. Transform first (fast,
      // cheap on the wire); fall back to the original if transforms fail.
      const longEdge = Math.max(W, H) * 1.15; // headroom for the drift
      const bitmaps: ImageBitmap[] = [];
      for (let i = 0; i < selectedPhotos.length; i++) {
        if (cancelRef.current) return;
        const p = selectedPhotos[i];
        let url: string | null = null;
        const { data: t } = await supabase.storage.from("listing-photos")
          .createSignedUrl(p.storage_path, 3600, { transform: { width: Math.round(longEdge), height: Math.round(longEdge), resize: "contain", quality: 82 } });
        url = t?.signedUrl ?? null;
        let bmp: ImageBitmap | null = null;
        if (url) { try { bmp = await loadBitmap(url); } catch { bmp = null; } }
        if (!bmp) {
          const { data: o } = await supabase.storage.from("listing-photos").createSignedUrl(p.storage_path, 3600);
          if (!o?.signedUrl) throw new Error("A photo couldn't be loaded.");
          bmp = await loadBitmap(o.signedUrl);
        }
        bitmaps.push(bmp);
        setProgress(Math.round(((i + 1) / selectedPhotos.length) * 100));
      }

      let logo: ImageBitmap | null = null;
      if (broker.logoUrl) { try { logo = await loadBitmap(broker.logoUrl); } catch { logo = null; } }

      // Soft backdrops for "whole photo" mode — blurred once per photo, not per frame.
      const backdrops: (HTMLCanvasElement | null)[] = bitmaps.map((bmp) => {
        if (fit !== "whole") return null;
        const c = document.createElement("canvas");
        c.width = Math.round(W / 4); c.height = Math.round(H / 4);
        const bctx = c.getContext("2d")!;
        const scale = Math.max(c.width / bmp.width, c.height / bmp.height) * 1.1;
        const dw = bmp.width * scale, dh = bmp.height * scale;
        bctx.filter = "blur(14px) brightness(0.55) saturate(0.85)";
        bctx.drawImage(bmp, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
        bctx.filter = "none";
        return c;
      });

      // ── The encoder ───────────────────────────────────────────────────
      const mb = await import("mediabunny");
      const codec = await mb.getFirstEncodableVideoCodec(["avc"], { width: W, height: H });
      if (!codec) throw new Error("This browser can't encode video. Use Chrome, Edge, or Safari.");

      const output = new mb.Output({
        format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }),
        target: new mb.BufferTarget(),
      });
      const source = new mb.CanvasSource(canvas, { codec: "avc", quality: mb.QUALITY_HIGH, keyFrameInterval: 2 });
      output.addVideoTrack(source, { frameRate: FPS });
      await output.start();

      setPhase("rendering");
      setProgress(0);
      const { segs, total } = timeline;
      const totalFrames = Math.ceil(total * FPS);

      // Text prepared once.
      const name = listing.vessel_name ?? "Now Available";
      const maker = [listing.year, listing.make, listing.model].filter(Boolean).join(" ");
      const specBits = [
        listing.length_ft ? `${listing.length_ft}′` : null,
        listing.vessel_type,
        listing.staterooms ? `${listing.staterooms} Staterooms` : null,
        showPrice ? fmtPrice(listing.asking_price) : null,
      ].filter(Boolean) as string[];
      const spec = specBits.join("   ·   ");
      const where = showLocation ? listing.location : null;

      const sans = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Manrope, sans-serif";
      const sc = Math.min(W, H) / 1080; // scale off the short edge

      const drawPhoto = (i: number, localT: number, hold: number, alpha: number) => {
        const bmp = bitmaps[i];
        const drift = ease(localT / (hold + s.fade));
        ctx.save();
        ctx.globalAlpha = alpha;
        if (fit === "fill") {
          // Cover the frame; slow push-in with a gentle drift that alternates direction.
          const base = Math.max(W / bmp.width, H / bmp.height);
          const zoom = base * (1.0 + 0.08 * drift);
          const dw = bmp.width * zoom, dh = bmp.height * zoom;
          const dir = i % 2 === 0 ? 1 : -1;
          const panX = (dw - W) * (0.5 + dir * 0.18 * (drift - 0.5));
          const panY = (dh - H) * 0.5;
          ctx.drawImage(bmp, -panX, -panY, dw, dh);
        } else {
          // Whole photograph on a soft backdrop of itself.
          ctx.fillStyle = INK;
          ctx.fillRect(0, 0, W, H);
          const bd = backdrops[i];
          if (bd) ctx.drawImage(bd, 0, 0, W, H);
          const margin = 0.06 * Math.min(W, H);
          const base = Math.min((W - margin * 2) / bmp.width, (H - margin * 2) / bmp.height);
          const zoom = base * (1.0 + 0.035 * drift);
          const dw = bmp.width * zoom, dh = bmp.height * zoom;
          ctx.shadowColor = "rgba(0,0,0,0.45)";
          ctx.shadowBlur = 40 * sc;
          ctx.shadowOffsetY = 12 * sc;
          ctx.drawImage(bmp, (W - dw) / 2, (H - dh) / 2, dw, dh);
        }
        ctx.restore();
      };

      const drawTitle = (alpha: number) => {
        if (alpha <= 0) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        // Ground the type on a gradient, never on the hull.
        const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
        g.addColorStop(0, "rgba(5,11,20,0)");
        g.addColorStop(1, "rgba(5,11,20,0.82)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);

        const cx = W / 2;
        const capSize = 30 * sc;
        const nameSize = name.length > 22 ? 84 * sc : name.length > 14 ? 104 * sc : 124 * sc;
        const maxW = W - 140 * sc;
        ctx.textBaseline = "alphabetic";
        ctx.font = `600 ${nameSize}px ${serifFamily}, Georgia, serif`;
        const lines = wrapLines(ctx, name, maxW);

        // Stack from the bottom up so it sits in the gradient regardless of line count.
        let y = H - (format === "reel" ? 300 : 150) * sc;
        if (spec) {
          ctx.fillStyle = BONE_QUIET;
          ctx.font = `600 ${capSize}px ${sans}`;
          fillTrackedCentered(ctx, spec.toUpperCase(), cx, y, 6 * sc);
          y -= capSize + 34 * sc;
        }
        ctx.fillStyle = BONE;
        ctx.font = `600 ${nameSize}px ${serifFamily}, Georgia, serif`;
        ctx.textAlign = "center";
        for (let li = lines.length - 1; li >= 0; li--) {
          ctx.fillText(lines[li], cx, y);
          y -= nameSize * 0.96;
        }
        ctx.textAlign = "left";
        if (maker) {
          ctx.fillStyle = BRASS;
          ctx.font = `600 ${capSize}px ${sans}`;
          fillTrackedCentered(ctx, maker.toUpperCase(), cx, y + 6 * sc, 8 * sc);
        }
        // A hairline and the location, quietly, at the very bottom.
        if (where) {
          const ly = H - (format === "reel" ? 190 : 80) * sc;
          ctx.fillStyle = "rgba(255,255,255,0.28)";
          ctx.fillRect(cx - 40 * sc, ly - 44 * sc, 80 * sc, Math.max(1, 1.5 * sc));
          ctx.fillStyle = BONE_SOFT;
          ctx.font = `500 ${24 * sc}px ${sans}`;
          fillTrackedCentered(ctx, where.toUpperCase(), cx, ly, 5 * sc);
        }
        ctx.restore();
      };

      const drawEndCard = (alpha: number) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = INK;
        ctx.fillRect(0, 0, W, H);
        const cx = W / 2;
        const capSize = 28 * sc;
        const items: { h: number; draw: (y: number) => void }[] = [];

        if (logo) {
          const aspect = logo.width / logo.height;
          let lw = 360 * sc, lh = lw / aspect;
          const maxLh = 150 * sc;
          if (lh > maxLh) { lh = maxLh; lw = lh * aspect; }
          items.push({ h: lh + 44 * sc, draw: (y) => { ctx.globalAlpha = alpha * 0.96; ctx.drawImage(logo!, cx - lw / 2, y, lw, lh); ctx.globalAlpha = alpha; } });
        }
        const nameSize = 64 * sc;
        items.push({ h: nameSize + 18 * sc, draw: (y) => {
          ctx.fillStyle = BONE; ctx.font = `600 ${nameSize}px ${serifFamily}, Georgia, serif`; ctx.textAlign = "center";
          ctx.fillText(broker.name, cx, y + nameSize * 0.8); ctx.textAlign = "left";
        } });
        if (broker.brokerage) items.push({ h: capSize + 26 * sc, draw: (y) => {
          ctx.fillStyle = BONE_SOFT; ctx.font = `600 ${capSize}px ${sans}`;
          fillTrackedCentered(ctx, broker.brokerage!.toUpperCase(), cx, y + capSize, 7 * sc);
        } });
        const contact = [broker.phone, broker.website?.replace(/^https?:\/\//, "")].filter(Boolean).join("   ·   ");
        if (contact) items.push({ h: capSize + 60 * sc, draw: (y) => {
          ctx.fillStyle = BRASS; ctx.font = `500 ${capSize}px ${sans}`;
          fillTrackedCentered(ctx, contact, cx, y + capSize + 22 * sc, 3 * sc);
        } });
        items.push({ h: capSize, draw: (y) => {
          ctx.fillStyle = BONE_QUIET; ctx.font = `500 ${24 * sc}px ${sans}`;
          fillTrackedCentered(ctx, "REQUEST A PRIVATE SHOWING", cx, y + capSize, 6 * sc);
        } });

        const stackH = items.reduce((a, b) => a + b.h, 0);
        let y = (H - stackH) / 2;
        for (const it of items) { it.draw(y); y += it.h; }

        // Quiet credit line — the portal's own mark.
        ctx.fillStyle = "rgba(255,255,255,0.30)";
        ctx.font = `500 ${18 * sc}px ${sans}`;
        fillTrackedCentered(ctx, "YACHTPICS", cx, H - 60 * sc, 6 * sc);
        ctx.restore();
      };

      const drawWatermark = () => {
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.rotate(-Math.PI / 6);
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255,255,255,0.30)";
        ctx.font = `600 ${120 * sc}px ${serifFamily}, Georgia, serif`;
        ctx.fillText("Preview", 0, -24 * sc);
        ctx.font = `500 ${30 * sc}px ${sans}`;
        ctx.fillText("Subscribe to unlock", 0, 48 * sc);
        ctx.restore();
      };

      for (let f = 0; f < totalFrames; f++) {
        if (cancelRef.current) { await output.cancel(); setPhase("idle"); return; }
        const t = f / FPS;
        ctx.globalAlpha = 1;
        ctx.fillStyle = INK;
        ctx.fillRect(0, 0, W, H);

        // Which segments touch this instant? At most two during a crossfade.
        const active = segs.filter((sg) => t >= sg.start && t < sg.end);
        for (const sg of active) {
          const local = t - sg.start;
          const hold = sg.kind === "photo" ? (sg.index === 0 ? s.titleHold : s.hold) : s.endHold;
          // Fade in over s.fade (except the very first photo), fade out over the
          // last s.fade of the segment — the next segment is fading in beneath.
          const fadeIn = sg.start === 0 ? 1 : ease(local / s.fade);
          const fadeOut = sg.kind === "end" ? 1 : 1 - ease((local - hold) / s.fade);
          const alpha = Math.min(fadeIn, fadeOut);
          if (sg.kind === "photo") {
            drawPhoto(sg.index, local, hold, alpha);
            if (sg.index === 0) {
              const tIn = ease((local - 0.5) / 0.9);
              const tOut = 1 - ease((local - (hold - 0.9)) / 0.8);
              drawTitle(Math.min(tIn, tOut) * alpha);
            }
          } else {
            drawEndCard(alpha);
          }
        }
        if (locked) drawWatermark();

        await source.add(t, 1 / FPS);
        if (f % 6 === 0) setProgress(Math.round((f / totalFrames) * 100));
      }

      await output.finalize();
      const buffer = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
      if (!buffer) throw new Error("The video came back empty.");
      const blob = new Blob([buffer], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      setResult({ url, blob, format, seconds: Math.round(total) });
      setProgress(100);
      setPhase("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong while rendering.");
      setPhase("error");
    }
  }

  function download() {
    if (!result || locked) return;
    const a = document.createElement("a");
    a.href = result.url;
    a.download = `${safeName(listing?.vessel_name)}-${result.format}.mp4`;
    a.click();
  }

  async function addToListing() {
    if (!result || locked || !listing) return;
    setAdding(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const file = new File([result.blob], `${safeName(listing.vessel_name)}-film.mp4`, { type: "video/mp4" });
      const res = await uploadListingVideo({ supabase, file, listingId: id, uploadedBy: user.id, displayOrder: videoCount });
      if (!res.ok) throw new Error(res.error);
      await supabase.from("videos").update({ title: `${listing.vessel_name ?? "Listing"} — The Film` }).eq("id", res.video.id);
      setVideoCount((n) => n + 1);
      setAdded(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Couldn't add the film to the listing.");
    } finally {
      setAdding(false);
    }
  }

  // ── UI ──────────────────────────────────────────────────────────────────
  if (loading) return <div className="flex items-center justify-center h-64 text-ink-400 text-sm">Loading…</div>;
  if (!listing) return <div className="flex items-center justify-center h-64 text-ink-400 text-sm">Listing not found.</div>;

  const s = SPEC[format];
  const busy = phase === "loading" || phase === "rendering";
  const seconds = Math.round(timeline.total);

  const pill = (active: boolean) =>
    `text-sm font-medium px-4 py-2 rounded-ctl border transition-colors ${active ? "bg-ink-950 text-white border-ink-950" : "bg-white text-ink-600 border-hairline-strong hover:border-ink-300"}`;
  const chip = (active: boolean) =>
    `text-xs font-medium px-3 py-1.5 rounded-ctl border transition-colors ${active ? "bg-accent-500 text-ink-950 border-accent-500" : "bg-white text-ink-600 border-hairline-strong hover:border-ink-300"}`;

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href={`/dashboard/listings/${id}`} className="text-ink-400 hover:text-ink-600 text-sm transition-colors">← Back to Listing</Link>
        <h1 className="text-display text-ink-900 mt-1">Listing Reel</h1>
        <p className="text-ink-500 mt-1 text-sm">
          Turn this listing&rsquo;s photos into a finished video — a vertical reel for Instagram and Facebook, or a widescreen film to send to a buyer. Nothing to edit.
        </p>
      </div>

      {locked && (
        <div className="mb-5 px-4 py-3 rounded-ctl text-sm bg-danger-50 border border-danger-200 text-danger-700">
          <span className="font-semibold">This is a preview.</span>{" "}
          Your plan has ended — subscribe to download clean, watermark-free video.{" "}
          <Link href="/dashboard/billing" className="font-semibold underline">Choose a plan →</Link>
        </div>
      )}

      {supported === false && (
        <div className="mb-5 px-4 py-3 rounded-ctl text-sm bg-warn-50 border border-warn-200 text-warn-700">
          This browser can&rsquo;t make video. Open the portal in <span className="font-semibold">Chrome, Edge, or Safari</span> on a computer or phone and try again.
        </div>
      )}

      {/* Format */}
      <div className="flex gap-2 mb-2">
        {(["reel", "film"] as Format[]).map((f) => (
          <button key={f} onClick={() => chooseFormat(f)} disabled={busy} className={pill(format === f)}>{SPEC[f].label}</button>
        ))}
      </div>
      <p className="text-xs text-ink-400 mb-5">{s.hint} · up to {s.maxPhotos} photos · about {seconds} seconds</p>

      {/* Options */}
      <div className="grid sm:grid-cols-2 gap-4 mb-5">
        <div>
          <p className="label-caps text-ink-500 mb-2">Framing</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setFit("fill"); setResult(null); setPhase("idle"); }} disabled={busy} className={chip(fit === "fill")}>Fill the frame</button>
            <button onClick={() => { setFit("whole"); setResult(null); setPhase("idle"); }} disabled={busy} className={chip(fit === "whole")}>Show the whole photo</button>
          </div>
          <p className="text-xs text-ink-400 mt-1.5">{fit === "fill" ? "Cinematic crop with a slow push-in." : "Every photo shown complete, on a soft backdrop."}</p>
        </div>
        <div>
          <p className="label-caps text-ink-500 mb-2">On the title card</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setShowPrice((v) => !v); setResult(null); setPhase("idle"); }} disabled={busy || !listing.asking_price} className={chip(showPrice && !!listing.asking_price)}>
              {listing.asking_price ? `Price ${showPrice ? "on" : "off"}` : "No price set"}
            </button>
            <button onClick={() => { setShowLocation((v) => !v); setResult(null); setPhase("idle"); }} disabled={busy || !listing.location} className={chip(showLocation && !!listing.location)}>
              {listing.location ? `Location ${showLocation ? "on" : "off"}` : "No location set"}
            </button>
          </div>
          <p className="text-xs text-ink-400 mt-1.5">Year, builder, length and staterooms always appear when they&rsquo;re filled in.</p>
        </div>
      </div>

      {/* Photo picker */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <p className="label-caps text-ink-500">Photos · {chosen.size} of {s.maxPhotos}</p>
          <div className="flex gap-3">
            <button onClick={() => { setChosen(new Set(photos.slice(0, s.maxPhotos).map((p) => p.id))); setResult(null); setPhase("idle"); }} disabled={busy} className="text-xs font-semibold text-accent-700 hover:underline">First {s.maxPhotos}</button>
            <button onClick={() => { setChosen(new Set()); setResult(null); setPhase("idle"); }} disabled={busy} className="text-xs font-semibold text-ink-400 hover:underline">Clear</button>
          </div>
        </div>
        <p className="text-xs text-ink-400 mb-2">In slideshow order, cover first. Tap to include or leave out — the first photo you choose gets the title.</p>
        <div className="grid grid-cols-5 sm:grid-cols-8 gap-1.5">
          {photos.map((p) => {
            const on = chosen.has(p.id);
            const idx = selectedPhotos.findIndex((q) => q.id === p.id);
            return (
              <button key={p.id} onClick={() => togglePhoto(p.id)} disabled={busy} title={p.category ?? p.filename ?? ""}
                className={`relative aspect-square overflow-hidden rounded-sm border-2 transition-colors bg-ink-100 ${on ? "border-accent-500" : "border-transparent opacity-55 hover:opacity-90"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.thumb && <img src={p.thumb} alt="" loading="lazy" className="w-full h-full object-cover" />}
                {on && <span className="absolute top-0.5 left-0.5 text-[10px] font-semibold bg-ink-950/80 text-white rounded px-1">{idx + 1}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Render + preview */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-ink-900">{result ? "Your video is ready" : phase === "rendering" ? "Rendering…" : phase === "loading" ? "Loading photos…" : "Ready to make"}</p>
            <p className="text-xs text-ink-400 mt-0.5">
              {result ? `${SPEC[result.format].label} · ${result.seconds}s · silent (add trending audio when you post)` : "Renders right here in your browser — usually under a minute."}
            </p>
          </div>
          <div className="flex gap-2">
            {busy ? (
              <button onClick={() => { cancelRef.current = true; }} className="text-sm font-medium px-4 py-2.5 rounded-ctl border border-hairline-strong text-ink-600 hover:border-ink-400 transition-colors">Cancel</button>
            ) : (
              <button onClick={render} disabled={chosen.size === 0 || supported === false}
                className="bg-accent-500 hover:bg-accent-400 disabled:opacity-40 text-ink-950 text-sm font-semibold px-5 py-2.5 rounded-ctl transition-colors">
                {result ? "Make it again" : `Make the ${format === "reel" ? "reel" : "film"}`}
              </button>
            )}
          </div>
        </div>

        {busy && (
          <div className="mt-4">
            <div className="h-1.5 w-full bg-ink-100 rounded-full overflow-hidden">
              <div className="h-full bg-accent-500 transition-[width] duration-200" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs text-ink-400 mt-1.5">{phase === "loading" ? "Loading photos" : "Encoding frames"} · {progress}%</p>
          </div>
        )}

        {phase === "error" && errorMsg && (
          <p className="mt-4 text-sm text-danger-700">{errorMsg}</p>
        )}

        {/* The working canvas doubles as the live preview while rendering. */}
        <div className={`mt-5 flex justify-center ${result ? "hidden" : ""}`}>
          <canvas ref={canvasRef} className="rounded-sm shadow-print bg-ink-950 w-full" style={{ maxWidth: format === "reel" ? 300 : 560, aspectRatio: `${s.w} / ${s.h}` }} />
        </div>

        {result && (
          <>
            <div className="mt-5 flex justify-center">
              <video src={result.url} controls playsInline className="rounded-sm shadow-print bg-ink-950 w-full" style={{ maxWidth: result.format === "reel" ? 300 : 560 }} />
            </div>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {locked ? (
                <Link href="/dashboard/billing" className="bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-6 py-2.5 rounded-ctl transition-colors">🔒 Subscribe to Download</Link>
              ) : (
                <>
                  <button onClick={download} className="bg-ink-950 hover:bg-ink-800 text-white text-sm font-semibold px-6 py-2.5 rounded-ctl transition-colors">⬇ Download MP4</button>
                  {result.format === "film" && (
                    <button onClick={addToListing} disabled={adding || added}
                      className="text-sm font-semibold px-6 py-2.5 rounded-ctl border border-hairline-strong text-ink-700 hover:border-ink-400 disabled:opacity-50 transition-colors">
                      {added ? "✓ Added to this listing" : adding ? "Adding…" : "Add film to this listing"}
                    </button>
                  )}
                </>
              )}
            </div>
            {result.format === "film" && !added && !locked && (
              <p className="text-xs text-ink-400 text-center mt-2">Adding it puts the film at the front of your client slideshow and in Send to Client.</p>
            )}
            {result.format === "reel" && (
              <p className="text-xs text-ink-400 text-center mt-2">Post it from your phone: save the file, open Instagram → Reel, pick it, then add audio and your caption.</p>
            )}
          </>
        )}
      </div>

      {/* Caption helper — reuse the Social Post caption on the same listing */}
      <p className="text-xs text-ink-400 mt-4">
        Need a caption? <Link href={`/dashboard/listings/${id}/social`} className="text-accent-700 font-semibold hover:underline">Social Post</Link> writes one with hashtags for this listing.
      </p>
    </div>
  );
}
