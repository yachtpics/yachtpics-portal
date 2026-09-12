"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Cormorant_Garamond } from "next/font/google";
import { createClient } from "@/lib/supabase/client";
import { hasAccess } from "@/lib/subscriptionAccess";
import { orderPhotos } from "@/lib/photoOrder";
import { uploadListingVideo, uploadVideoToPrivateBucket } from "@/lib/uploadListingVideo";
import QRCode from "qrcode";
import {
  ease,
  fillTrackedCentered,
  fillTrackedLeft,
  loadBitmap,
  wrapTracked,
} from "@/lib/canvasText";
import {
  REEL_STYLES, STYLE_ORDER, isExterior, roomLabel, applyBrand, dominantColor, normalizeHex, rgba,
  type StyleKey, type BrandColors,
} from "@/lib/reelStyles";
import { reelPromoActive, reelPromoCountdown, reelPromoEndsOn } from "@/lib/reelPromo";
import RetryImg from "@/components/RetryImg";

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
  // The Editorial lead-in is set in italic. Without the italic face loaded, the
  // browser fakes one by slanting the roman — visibly wrong at 44px.
  style: ["normal", "italic"],
  display: "swap",
});

type Format = "reel" | "film";
type Fit = "fill" | "whole";
type Length = "short" | "full";

const SPEC: Record<Format, {
  w: number; h: number; label: string; hint: string;
  maxPhotos: number; hold: number; fade: number; titleHold: number; endHold: number; defaultFit: Fit;
}> = {
  // The reel's hold and photo cap are set by the Length choice below — what's
  // here is the short version's numbers, and everything else the reel shares
  // between lengths.
  reel: {
    w: 1080, h: 1920, label: "Reel (9:16)", hint: "Instagram Reels, Stories, Facebook",
    maxPhotos: 10, hold: 1.7, fade: 0.55, titleHold: 4.2, endHold: 3.0, defaultFit: "fill",
  },
  // The film is a different job — it goes to one buyer who already asked, not to
  // a feed, so it can breathe.
  film: {
    w: 1920, h: 1080, label: "Film (16:9)", hint: "Send to Client, slideshow, YouTube",
    maxPhotos: 14, hold: 2.6, fade: 0.6, titleHold: 5.0, endHold: 3.0, defaultFit: "whole",
  },
};

/**
 * How long a reel runs.
 *
 * Instagram's own 2026 numbers (Socialinsider, 140,000 reels) put the highest
 * reach squarely in the 30–60 second band — long enough for the feed to read
 * the post as worth distributing, short enough to be finished. So Full is the
 * default: eighteen photos at a 1.9s hold lands at about forty seconds.
 *
 * Short keeps the old timing — ten photos, ~20s — for a teaser, a second post
 * on the same boat, or a listing that simply hasn't got eighteen good frames.
 *
 * Only the reel offers the choice; the film's single timing is unchanged.
 */
const LENGTH: Record<Length, { hold: number; maxPhotos: number }> = {
  short: { hold: 1.7, maxPhotos: 10 },
  full: { hold: 1.9, maxPhotos: 18 },
};

const DEFAULT_LENGTH: Length = "full";

/** The photo cap actually in force: the length's on a reel, the film's own. */
function capFor(format: Format, length: Length) {
  return format === "reel" ? LENGTH[length].maxPhotos : SPEC.film.maxPhotos;
}

const FPS = 30;

// Palette now lives with each look in @/lib/reelStyles — a 2D context can't
// read Tailwind, and the four styles need genuinely different grounds.

type Photo = { id: string; storage_path: string; category: string | null; filename: string | null; display_order: number; thumb: string | null };

type ListingData = {
  vessel_name: string | null; year: number | null; make: string | null; model: string | null;
  vessel_type: string | null; length_ft: number | null; location: string | null; asking_price: number | null;
  staterooms: number | null; broker_id: string; hero_photo_id: string | null; photo_order_manual: boolean | null;
};

type BrokerCard = { name: string; brokerage: string | null; phone: string | null; email: string | null; website: string | null; logoUrl: string | null };

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
  // Reels only — the film keeps its single timing.
  const [length, setLength] = useState<Length>(DEFAULT_LENGTH);
  const [fit, setFit] = useState<Fit>("fill");
  const [styleKey, setStyleKey] = useState<StyleKey>("editorial");
  // The broker's own colours, remembered on their profile. Null = the look's.
  const [brand, setBrand] = useState<BrandColors>({});
  const [matching, setMatching] = useState(false);
  const [brandError, setBrandError] = useState("");
  // Whether the viewer IS the listing's broker. Only they get their colour
  // choices remembered — an admin or assistant trying colours on someone
  // else's boat must not rewrite that broker's brand.
  const [isOwner, setIsOwner] = useState(false);
  const brandSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // An ORDERED list, not a set: the order the broker taps is the order the
  // reel plays. The number on each thumbnail is its place in the film.
  const [chosen, setChosen] = useState<string[]>([]);
  const [showPrice, setShowPrice] = useState(true);
  const [showLocation, setShowLocation] = useState(true);
  // Room captions — the broker's call, off until they turn it on.
  const [showLabels, setShowLabels] = useState(false);

  // Words for the reel, written from the frames actually chosen. The headline
  // goes on the opening frame; the caption is the broker's to copy and post.
  const [headline, setHeadline] = useState("");
  const [useHeadline, setUseHeadline] = useState(false);
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [writing, setWriting] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [copied, setCopied] = useState(false);

  // "Send to my phone": the reel goes to the bucket for a day, comes back as a
  // link, and the link becomes a QR code on screen + an email as backup.
  const [phone, setPhone] = useState<{ qr: string; url: string; emailedTo: string | null } | null>(null);
  const [sendingPhone, setSendingPhone] = useState(false);
  const [phonePct, setPhonePct] = useState(0);
  const [phoneError, setPhoneError] = useState("");

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
      const { data: { user: me } } = await supabase.auth.getUser();
      setIsOwner(!!me && me.id === l.broker_id);

      // During the open house the Reel is unlocked for everyone — subscribed,
      // trialling or lapsed. Every other paid tool keeps its own gate.
      if (reelPromoActive()) {
        setLocked(false);
      } else {
        try {
          const subRes = await fetch(`/api/subscription/status?brokerId=${l.broker_id}`);
          // A server hiccup is not a lapsed plan. Only a real answer can lock.
          if (subRes.ok) {
            const subData = await subRes.json();
            setLocked(!hasAccess(subData?.status));
          }
        } catch { /* stay unlocked on a status hiccup */ }
      }

      const [{ data: prof }, { data: det }, { data: ph }, { count }] = await Promise.all([
        supabase.from("profiles").select("first_name, last_name, phone, display_email").eq("id", l.broker_id).maybeSingle(),
        supabase.from("broker_details").select("brokerage_name, brokerage_website, logo_url, brand_accent, brand_ground").eq("id", l.broker_id).maybeSingle(),
        supabase.from("photos").select("id, storage_path, category, filename, display_order").eq("listing_id", id).eq("is_visible", true).order("display_order"),
        supabase.from("videos").select("id", { count: "exact", head: true }).eq("listing_id", id),
      ]);
      setVideoCount(count ?? 0);
      setBroker({
        name: [prof?.first_name, prof?.last_name].filter(Boolean).join(" ") || "Broker",
        brokerage: det?.brokerage_name ?? null,
        phone: prof?.phone ?? null,
        email: prof?.display_email ?? null,
        website: det?.brokerage_website ?? null,
        logoUrl: det?.logo_url ?? null,
      });
      setBrand({ accent: normalizeHex(det?.brand_accent), ground: normalizeHex(det?.brand_ground) });

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
      setChosen(withThumbs.slice(0, capFor("reel", DEFAULT_LENGTH)).map((p) => p.id));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Each finished video is tens of megabytes held under an object URL. Release
  // the previous one when a new result replaces it, and on leaving the page —
  // otherwise "Make it again" a few times quietly eats a few hundred MB.
  useEffect(() => {
    const url = result?.url;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [result]);

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

  /**
   * The numbers actually in force. On a reel the Length choice supplies the
   * hold and the photo cap; everything else — the frame size, the fade, the
   * title and end holds — comes from the format. The film is untouched.
   */
  const s = useMemo(
    () => (format === "reel" ? { ...SPEC.reel, ...LENGTH[length] } : SPEC.film),
    [format, length],
  );

  // When the format changes, reset the fit and trim the selection to the cap.
  function chooseFormat(f: Format) {
    setFormat(f);
    setFit(SPEC[f].defaultFit);
    setResult(null);
    setPhase("idle");
    const cap = capFor(f, length);
    setChosen((prev) => {
      // Keep the broker's order, just trimmed to the new format's cap.
      const kept = prev.slice(0, cap);
      return kept.length ? kept : photos.slice(0, cap).map((p) => p.id);
    });
  }

  // Switching length changes the cap, so a selection made for the long version
  // is trimmed — in the broker's own order — rather than silently over-filling.
  function chooseLength(next: Length) {
    setLength(next);
    setResult(null);
    setPhase("idle");
    const cap = capFor(format, next);
    setChosen((prev) => (prev.length > cap ? prev.slice(0, cap) : prev));
  }

  function togglePhoto(pid: string) {
    setChosen((prev) => {
      // Tap to add at the end; tap again to remove and let the rest close up.
      if (prev.includes(pid)) return prev.filter((x) => x !== pid);
      if (prev.length >= s.maxPhotos) return prev;
      return [...prev, pid];
    });
    setResult(null);
    setPhase("idle");
  }

  const selectedPhotos = useMemo(() => {
    const byId = new Map(photos.map((p) => [p.id, p]));
    return chosen.map((id) => byId.get(id)).filter((p): p is Photo => !!p);
  }, [photos, chosen]);

  /** A punch look cuts hard — a whisker of overlap so it never flashes black. */
  const fadeFor = (fmt: Format, key: StyleKey) =>
    REEL_STYLES[key].cut === "punch" ? 0.08 : SPEC[fmt].fade;

  const timeline = useMemo(() => {
    const scale = REEL_STYLES[styleKey].holdScale;
    const fade = fadeFor(format, styleKey);
    const segs: Segment[] = [];
    let t = 0;
    selectedPhotos.forEach((_, i) => {
      // Every photo after the title holds for exactly the same beat. Varying it
      // per photo is the thing that makes a slideshow feel restless.
      const hold = (i === 0 ? s.titleHold : s.hold) * scale;
      segs.push({ kind: "photo", index: i, start: t, end: t + hold + fade });
      t += hold;
    });
    segs.push({ kind: "end", start: t, end: t + s.endHold + fade });
    return { segs, total: t + s.endHold };
    // `s` carries the length's hold, so the total redraws when Length changes.
  }, [selectedPhotos, s, format, styleKey]);

  // ── Render ──────────────────────────────────────────────────────────────
  async function render() {
    if (!listing || !broker || selectedPhotos.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    cancelRef.current = false;
    setResult(null);
    setAdded(false);
    setPhone(null);
    setPhoneError("");
    setErrorMsg("");
    setPhase("loading");
    setProgress(0);

    const st = applyBrand(REEL_STYLES[styleKey], brand);
    const fade = fadeFor(format, styleKey);
    // Letterbox is a vertical device — bars on an already-widescreen film just
    // shrink the picture, so the cinematic look keeps its type and its slow
    // motion there but drops back to a gradient.
    const backdrop = st.backdrop === "letterbox" && format === "film" ? "scrim" : st.backdrop;
    const W = s.w, H = s.h;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d", { alpha: false })!;

    try {
      // Fonts first — otherwise the first frames silently fall back.
      const serifFamily = serif.style.fontFamily;
      // The portal's own sans (Manrope, self-hosted by the root layout as
      // --font-sans). It goes FIRST: a reel typeset in whatever the machine
      // happens to have — Segoe on Windows, Roboto on Android — looks like a
      // template. The system stack is only the fallback.
      const brandSans = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim();
      const sans = `${brandSans ? `${brandSans}, ` : ""}Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
      try {
        await Promise.all([
          document.fonts.load(`600 100px ${serifFamily}`),
          document.fonts.load(`400 100px ${serifFamily}`),
          document.fonts.load(`italic 400 44px ${serifFamily}`),
          ...[300, 500, 600, 800].map((w) => document.fonts.load(`${w} 40px ${sans}`)),
        ]);
        await document.fonts.ready;
      } catch { /* older browser: fall through */ }

      // Photographs at a sensible size for the frame. Transform first (fast,
      // cheap on the wire); fall back to the original if transforms fail.
      const longEdge = Math.max(W, H) * 1.15; // headroom for the drift
      const bitmaps: ImageBitmap[] = [];
      for (let i = 0; i < selectedPhotos.length; i++) {
        // Bail cleanly: leaving the phase as "loading" would keep the page in
        // its busy state with no way back but a reload.
        if (cancelRef.current) { setPhase("idle"); return; }
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
        // Only the full-bleed "whole photo" mode floats on a blurred plate.
        // The inset and letterbox looks have their own ground — a blur
        // painted over the Gallery page (on a dark brand ground) wiped it out.
        if (fit !== "whole" || st.light || backdrop !== "scrim") return null;
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
      const builder = [listing.year, listing.make, listing.model].filter(Boolean).join(" ");
      // A written headline takes the line above the name; the builder doesn't
      // get dropped for it, it moves down into the spec row. The facts stay on
      // screen either way.
      const usingHeadline = useHeadline && headline.trim().length > 0;
      const maker = usingHeadline ? headline.trim() : builder;
      const specBits = [
        usingHeadline && builder ? builder : null,
        listing.length_ft ? `${listing.length_ft}′` : null,
        listing.vessel_type,
        listing.staterooms ? `${listing.staterooms} Staterooms` : null,
        showPrice ? fmtPrice(listing.asking_price) : null,
      ].filter(Boolean) as string[];
      const spec = specBits.join("   ·   ");
      const where = showLocation ? listing.location : null;

      const sc = Math.min(W, H) / 1080; // scale off the short edge

      // The window the photograph lives in. Everything else — title, captions,
      // end card — positions itself against this box, so a style change moves
      // the whole composition together instead of piece by piece.
      // On a 9:16 reel, Instagram lays its own furniture over the top 14% and
      // the bottom 35% of the frame — profile row, caption, audio tag, the
      // action buttons. Type that lands there may as well not have been drawn.
      // So on reels the TYPE lives in the band just under the top edge and the
      // PICTURE sits below it; on a 16:9 film the type stays at the foot.
      const topType = format === "reel";
      const frame = (() => {
        if (backdrop === "letterbox") {
          // 1.66:1 — European widescreen. True 2.39 anamorphic leaves a 9:16
          // frame three-quarters black and 1.85 still shaved a 3:2 photograph
          // hard; this shows nearly the whole frame the photographer composed
          // while still reading unmistakably as a letterbox.
          const bh = Math.min(H * 0.60, W / 1.66);
          // The top bar holds the name; the window sits beneath it.
          return { x: 0, y: topType ? H * 0.40 : (H - bh) / 2 - H * 0.06, w: W, h: bh };
        }
        if (backdrop === "inset") {
          const m = 0.055 * W;
          if (topType) {
            // Name at the head of the page, the print below it.
            return { x: m, y: H * 0.38, w: W - m * 2, h: H * 0.44 };
          }
          return { x: m, y: m, w: W - m * 2, h: H * 0.45 };
        }
        return { x: 0, y: 0, w: W, h: H };
      })();

      // Where the photograph actually landed on the last drawPhoto call — the
      // window for a full-bleed crop, or the smaller rectangle a whole portrait
      // or landscape occupies inside it. The room caption anchors to this, so
      // it sits in the corner of the picture rather than the corner of the frame.
      let photoRect = { x: frame.x, y: frame.y, w: frame.w, h: frame.h };

      const drawPhoto = (i: number, localT: number, hold: number, alpha: number) => {
        const bmp = bitmaps[i];
        const drift = ease(localT / (hold + fade));
        ctx.save();
        ctx.globalAlpha = alpha;

        // Ground first — the bars, the plate, or the light page.
        if (backdrop !== "scrim") {
          ctx.fillStyle = st.ground;
          ctx.fillRect(0, 0, W, H);
        }

        // Exteriors pull out to reveal where she sits; interiors push in to draw
        // you aboard. The move answers the subject rather than rotating at
        // random — that difference is most of what separates a film from a
        // slideshow.
        const out = isExterior(selectedPhotos[i]?.category);
        let k: number;
        if (st.cut === "punch") {
          // The punch: land tight, snap back most of the way in a third of a
          // second, then drift the rest. Reads as a cut with impact rather
          // than a slide — the grammar of a fast boat.
          const snap = ease(Math.min(1, localT / 0.32));
          const settle = 1 + st.zoom * 0.35 * (1 - drift);
          k = (1 + st.zoom) + (settle - (1 + st.zoom)) * snap;
        } else {
          const from = out ? 1 + st.zoom : 1;
          const to = out ? 1 : 1 + st.zoom;
          k = from + (to - from) * drift;
        }

        // An inset look always shows the complete photograph — cropping a
        // 121-footer to a square to fill the window loses her bow and stern,
        // which is the opposite of what a gallery is for.
        const showWhole = backdrop === "inset" || (fit === "whole" && backdrop !== "letterbox");
        if (!showWhole) {
          // Cover the window.
          const base = Math.max(frame.w / bmp.width, frame.h / bmp.height);
          const zoom = base * k;
          const dw = bmp.width * zoom, dh = bmp.height * zoom;
          ctx.save();
          if (backdrop !== "scrim") {
            ctx.beginPath();
            ctx.rect(frame.x, frame.y, frame.w, frame.h);
            ctx.clip();
          }
          ctx.drawImage(bmp, frame.x + (frame.w - dw) / 2, frame.y + (frame.h - dh) / 2, dw, dh);
          ctx.restore();
          photoRect = { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
        } else {
          // The whole photograph, complete, floated in the window.
          const bd = backdrops[i];
          if (bd) ctx.drawImage(bd, 0, 0, W, H);
          // The inset window already carries its page margin; a second one
          // inside it shrank the photograph for nothing.
          const margin = backdrop === "inset" ? 0 : 0.055 * Math.min(frame.w, frame.h);
          const base = Math.min((frame.w - margin * 2) / bmp.width, (frame.h - margin * 2) / bmp.height);
          const zoom = base * (1 + (k - 1) * 0.45);
          const dw = bmp.width * zoom, dh = bmp.height * zoom;
          ctx.shadowColor = st.light ? "rgba(20,26,33,0.20)" : "rgba(0,0,0,0.45)";
          ctx.shadowBlur = (st.light ? 30 : 40) * sc;
          ctx.shadowOffsetY = (st.light ? 10 : 12) * sc;
          const px = frame.x + (frame.w - dw) / 2, py = frame.y + (frame.h - dh) / 2;
          ctx.drawImage(bmp, px, py, dw, dh);
          photoRect = { x: px, y: py, w: dw, h: dh };
        }
        ctx.restore();
      };

      /**
       * The room caption.
       *
       * Bottom-left corner, small, wide-tracked, and on screen for as long as
       * the photograph is — it arrives with the photo and leaves with it,
       * riding the same crossfade. Skipped on the title photo, which already
       * has a name on it.
       */
      const drawRoomLabel = (i: number, localT: number, _hold: number, alpha: number) => {
        if (!showLabels || i === 0) return;
        const label = roomLabel(selectedPhotos[i]?.category);
        if (!label) return;
        const a = alpha;
        if (a <= 0.01) return;

        // Big enough to read on a phone held at arm's length — 25px was not.
        const size = 38 * sc;
        const r = photoRect;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.textBaseline = "alphabetic";

        if (backdrop === "letterbox" || backdrop === "inset") {
          // The looks whose photograph never carries type keep that promise
          // for the caption too: it sits in the ground beneath the picture,
          // centred under it like a plate under a print, in the look's own
          // quiet colour. No shadow — there's nothing to lift it off.
          // On a reel it takes the band the title had — under the picture on
          // a 9:16 frame is Instagram's caption, not ours.
          ctx.fillStyle = st.soft;
          ctx.font = `500 ${size}px ${sans}`;
          fillTrackedCentered(ctx, label, r.x + r.w / 2, topType ? H * 0.16 + size : r.y + r.h + 58 * sc, 8 * sc);
        } else {
          // Bottom-left corner of the PICTURE, wherever it landed — a portrait
          // floated in the frame gets its caption at its own foot, not the
          // frame's. A full-bleed reel puts it top-left instead, in the same
          // band the title uses: the foot of a reel is Instagram's, not ours.
          const fullBleed = fit === "fill";
          const x = r.x + 44 * sc;
          const y = topType
            ? H * 0.16 + size
            : fullBleed ? H - 78 * sc : r.y + r.h - 40 * sc;
          // Just the words, on a soft shadow — no panel, no gradient. A tint
          // fading in and out under every photo pulled the eye off the boat.
          ctx.shadowColor = "rgba(0,0,0,0.8)";
          ctx.shadowBlur = 14 * sc;
          ctx.shadowOffsetY = 3 * sc;
          ctx.fillStyle = "#ffffff";
          ctx.font = `600 ${size}px ${sans}`;
          fillTrackedLeft(ctx, label, x, y, 6 * sc);
        }
        ctx.restore();
      };

      /** A hairline — one line, or two with a hair between them. */
      const drawRule = (cx: number, y: number, width: number, alpha: number, leftAligned: boolean) => {
        if (st.rule === "none") return;
        const x = leftAligned ? cx : cx - width / 2;
        // 2px, not a hair: H.264 at phone bitrates ate the 1.4px version and
        // every look that had a rule showed nothing.
        const h = Math.max(1.5, 2.2 * sc);
        ctx.globalAlpha = alpha * 0.7;
        ctx.fillStyle = st.light ? st.text : "#ffffff";
        ctx.fillRect(x, y, width, h);
        if (st.rule === "double") ctx.fillRect(x, y + 7 * sc, width, h);
        ctx.globalAlpha = alpha;
      };

      /**
       * The title.
       *
       * It is an overlay on a moving photograph, never a card of its own — the
       * seconds that decide whether a reel gets watched are too expensive to
       * spend on a logo. The boat is on screen from the first frame; the name
       * fades up over it.
       *
       * Each style sets the name differently:
       *   editorial — an italic lowercase lead-in against the name in caps,
       *               closed with a full stop. Reads as a statement.
       *   cinematic — caps, very wide, very light, down in the bar.
       *   gallery   — sentence case in a tight sans, under the photograph.
       *   classic   — title case, lower-left, over a double hairline.
       */
      const drawTitle = (alpha: number) => {
        if (alpha <= 0) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textBaseline = "alphabetic";

        const leftAligned = st.align === "left";
        const pad = (leftAligned ? 76 : 70) * sc;
        const anchor = leftAligned ? frame.x + pad : W / 2;
        const maxW = W - pad * 2;
        const capSize = 27 * sc;
        const headFamily = st.serifHeadline ? `${serifFamily}, Georgia, serif` : sans;
        const headWeight = st.serifHeadline ? (st.headline === "caps" ? 400 : 600) : (st.headWeight ?? 600);

        // Long names step down rather than wrap into a wall of type.
        const nameSize = (name.length > 26 ? 76 : name.length > 16 ? 94 : 116) * sc;
        const headText =
          st.headline === "caps" || st.headline === "editorial" ? name.toUpperCase()
          : st.headline === "title" ? name.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
          : name;

        // Ground the type — only where it's actually sitting on a photograph.
        if (backdrop === "scrim") {
          // Tinted to the ground, so a navy brand gets a navy scrim and the
          // Classic look keeps its warmth without a special case. Runs from
          // whichever edge the type sits against.
          const g = topType
            ? ctx.createLinearGradient(0, 0, 0, H * 0.52)
            : ctx.createLinearGradient(0, H * 0.42, 0, H);
          g.addColorStop(0, rgba(st.ground, topType ? 0.78 : 0));
          g.addColorStop(1, rgba(st.ground, topType ? 0 : 0.84));
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
        }

        const put = (text: string, x: number, y: number, track: number) => {
          if (leftAligned) fillTrackedLeft(ctx, text, x, y, track);
          else fillTrackedCentered(ctx, text, x, y, track);
        };

        ctx.font = `${headWeight} ${nameSize}px ${headFamily}`;
        // Measured with its tracking — Cinematic's wide caps grow a good 150px
        // on the way from measure to draw. Editorial's closing full stop is
        // reserved for too.
        const nameRoom = maxW - (st.headline === "editorial" ? nameSize * 0.3 : 0);
        const lines = wrapTracked(ctx, headText, nameRoom, st.headTrack * sc);

        // The block is measured before it's drawn, then placed as a whole. On a
        // photograph it sits against the bottom; where the type lives off the
        // picture — in a letterbox bar or under an inset — it hangs from the
        // frame's lower edge. Measuring first is what keeps a two-line name from
        // climbing back into the photograph.
        // The lead-in wraps like everything else — measured with its own
        // tracking so a long builder line can't spill off the frame.
        const leadIsItalic = st.headline === "editorial";
        const leadSize = leadIsItalic ? 44 * sc : capSize;
        const leadTrack = leadIsItalic ? 1 * sc : 8 * sc;
        ctx.font = leadIsItalic ? `italic 400 ${leadSize}px ${serifFamily}, Georgia, serif` : `600 ${leadSize}px ${sans}`;
        const leadLines = maker ? wrapTracked(ctx, leadIsItalic ? maker : maker.toUpperCase(), maxW, leadTrack) : [];
        const leadLineH = (leadIsItalic ? 46 * sc : capSize) + (leadIsItalic ? 6 : 10) * sc;
        const leadH = maker ? leadLineH * leadLines.length + 14 * sc : 0;
        const nameH = lines.length * nameSize * 0.94;
        // The same breath between the name and the spec row whether a look
        // draws a rule in it or not — Cinematic's spec was landing on the
        // name's baseline.
        const ruleH = 84 * sc;
        ctx.font = `600 ${capSize}px ${sans}`;
        const specLines = spec ? wrapTracked(ctx, spec.toUpperCase(), maxW, 6 * sc) : [];
        const specLineH = capSize + 12 * sc;
        const specH = spec ? specLineH * specLines.length + 18 * sc : 0;
        const whereH = where ? 49 * sc : 0;
        const blockH = leadH + nameH + ruleH + specH + whereH;
        const offFrame = backdrop === "letterbox" || backdrop === "inset";
        // Every branch gives the FIRST baseline: the lead-in's if there is one,
        // otherwise the name's. The step from lead-in to name happens once,
        // below — not here as well. Two placements:
        //   reel — the block sits in the band under the top edge, from 16%
        //          down (Instagram's own overlay ends at 14%). Same for every
        //          look: over the sky on a full-bleed photo, in the top bar of
        //          a letterbox, at the head of the Gallery page.
        //   film — the foot, as before: against the photograph's bottom for a
        //          scrim, or hanging from the picture's lower edge when the
        //          type lives off the picture.
        const firstAscent = maker ? leadSize * 0.78 : nameSize * 0.82;
        const under = backdrop === "inset" ? photoRect.y + photoRect.h : frame.y + frame.h;
        // On a reel the block may never run into the picture: a three-line
        // name or a long builder line slides the whole block up as far as
        // Instagram's top overlay allows, and no further.
        const topCeiling = H * 0.14 + firstAscent;
        const topWanted = H * 0.16 + firstAscent;
        const topFloor = offFrame ? frame.y - 56 * sc : H; // window top, or no limit
        const topStart = Math.max(topCeiling, Math.min(topWanted, topFloor - blockH + firstAscent));
        let y = topType
          ? topStart
          : offFrame
            ? under + 96 * sc + (maker ? 0 : nameSize * 0.82)
            : H - 140 * sc - blockH + (maker ? 0 : nameSize * 0.82);

        if (maker) {
          // The lead-in above the name — italic for Editorial, tracked caps
          // for the rest — one line or several, never past the edge.
          ctx.fillStyle = st.accent;
          ctx.font = leadIsItalic ? `italic 400 ${leadSize}px ${serifFamily}, Georgia, serif` : `600 ${leadSize}px ${sans}`;
          leadLines.forEach((ln, li) => put(ln, anchor, y + li * leadLineH, leadTrack));
          y += leadLineH * (leadLines.length - 1) + (leadIsItalic ? 46 * sc : capSize) + 20 * sc + nameSize * 0.82;
        }

        ctx.fillStyle = st.text;
        ctx.font = `${headWeight} ${nameSize}px ${headFamily}`;
        for (let li = 0; li < lines.length; li++) {
          const isLast = li === lines.length - 1;
          // Editorial closes the name with a full stop — the detail that turns a
          // label into a statement.
          const line = st.headline === "editorial" && isLast ? `${lines[li]}.` : lines[li];
          put(line, anchor, y, st.headTrack * sc);
          if (!isLast) y += nameSize * 0.94;
        }

        // 84px from the name's baseline to the spec's, rule or no rule.
        if (st.rule !== "none") {
          y += 42 * sc;
          drawRule(anchor, y, leftAligned ? 108 * sc : 96 * sc, alpha, leftAligned);
          y += 42 * sc;
        } else {
          y += 84 * sc;
        }

        if (spec) {
          ctx.fillStyle = st.quiet;
          ctx.font = `600 ${capSize}px ${sans}`;
          specLines.forEach((ln, li) => put(ln, anchor, y + li * specLineH, 6 * sc));
          y += specLineH * (specLines.length - 1) + capSize + 26 * sc;
        }

        if (where) {
          ctx.fillStyle = st.soft;
          ctx.font = `500 ${23 * sc}px ${sans}`;
          put(where.toUpperCase(), anchor, y, 5 * sc);
        }
        ctx.restore();
      };

      const drawEndCard = (alpha: number) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = st.ground;
        ctx.fillRect(0, 0, W, H);
        const cx = W / 2;
        const capSize = 28 * sc;
        const items: { h: number; draw: (y: number) => void }[] = [];

        // The boat first, then the person. The last frame is the one a buyer
        // screenshots — it should carry the name, the essentials and the way
        // to reach the broker, so it works on its own.
        //
        // It is set in the LOOK's own voice: Cinematic's wide light caps,
        // Gallery's light sans, Editorial's serif. One generic card at the
        // end undid the choice the broker made at the start.
        const endFamily = st.serifHeadline ? `${serifFamily}, Georgia, serif` : sans;
        const endWeight = st.serifHeadline ? (st.headline === "caps" ? 400 : 600) : (st.headWeight ?? 600);
        // Cased exactly as the title frame cased it.
        const endText =
          st.headline === "caps" || st.headline === "editorial" ? name.toUpperCase()
          : st.headline === "title" ? name.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
          : name;
        // The vessel is the largest thing on the card by a clear margin — the
        // broker's name used to be set nearly as big, which read as a business
        // card with a boat on it.
        const endName = (name.length > 22 ? 68 : name.length > 14 ? 82 : 96) * sc;
        ctx.font = `${endWeight} ${endName}px ${endFamily}`;
        const endLines = wrapTracked(ctx, endText, W - 120 * sc, st.headTrack * sc);
        items.push({ h: endName * 0.94 * endLines.length + 16 * sc, draw: (y) => {
          ctx.fillStyle = st.text;
          ctx.font = `${endWeight} ${endName}px ${endFamily}`;
          endLines.forEach((ln, li) => fillTrackedCentered(ctx, ln, cx, y + endName * 0.8 + li * endName * 0.94, st.headTrack * sc));
        } });
        // Just the year, builder and model under the name. The specs already
        // had their moment on the opening frame; the last frame is the boat's
        // name and the person to call.
        if (builder) {
          // Measured with its tracking and wrapped if it must — "2023 HATTERAS
          // 105 RAISED PILOTHOUSE MOTORYACHT" is wider than the frame.
          ctx.font = `600 ${25 * sc}px ${sans}`;
          const bLines = wrapTracked(ctx, builder.toUpperCase(), W - 140 * sc, 7 * sc);
          const lineH = capSize + 10 * sc;
          items.push({ h: lineH * bLines.length + 2 * sc, draw: (y) => {
            ctx.fillStyle = st.accent; ctx.font = `600 ${25 * sc}px ${sans}`;
            bLines.forEach((ln, li) => fillTrackedCentered(ctx, ln, cx, y + capSize + li * lineH, 7 * sc));
          } });
        }
        // A hairline between the boat and the broker — the same weight as the
        // title's, so it survives the encode.
        items.push({ h: 84 * sc, draw: (y) => {
          ctx.fillStyle = st.light ? "rgba(20,26,33,0.35)" : "rgba(255,255,255,0.40)";
          ctx.fillRect(cx - 48 * sc, y + 42 * sc, 96 * sc, Math.max(1.5, 2.2 * sc));
        } });

        if (logo) {
          const aspect = logo.width / logo.height;
          let lw = 360 * sc, lh = lw / aspect;
          const maxLh = 150 * sc;
          if (lh > maxLh) { lh = maxLh; lw = lh * aspect; }
          items.push({ h: lh + 44 * sc, draw: (y) => { ctx.globalAlpha = alpha * 0.96; ctx.drawImage(logo!, cx - lw / 2, y, lw, lh); ctx.globalAlpha = alpha; } });
        }
        // The person: clearly secondary to the boat. Regular weight, and in
        // the serif looks the serif at its book weight rather than bold.
        const nameSize = 48 * sc;
        items.push({ h: nameSize + 16 * sc, draw: (y) => {
          ctx.fillStyle = st.text;
          ctx.font = `${st.serifHeadline ? 500 : 400} ${nameSize}px ${endFamily}`;
          ctx.textAlign = "center";
          ctx.fillText(broker.name, cx, y + nameSize * 0.8); ctx.textAlign = "left";
        } });
        if (broker.brokerage) items.push({ h: capSize + 22 * sc, draw: (y) => {
          ctx.fillStyle = st.soft; ctx.font = `600 ${capSize - 3 * sc}px ${sans}`;
          fillTrackedCentered(ctx, broker.brokerage!.toUpperCase(), cx, y + capSize, 7 * sc);
        } });
        // Phone and site if we have them; the broker's email if we don't. A
        // "request a private showing" with nothing under it is a door with
        // no handle.
        const contactBits = [broker.phone, broker.website?.replace(/^https?:\/\//, "").replace(/\/$/, "")].filter(Boolean) as string[];
        if (contactBits.length === 0 && broker.email) contactBits.push(broker.email);
        const contact = contactBits.join("   ·   ");
        if (contact) items.push({ h: capSize + 48 * sc, draw: (y) => {
          ctx.fillStyle = st.accent; ctx.font = `500 ${capSize}px ${sans}`;
          fillTrackedCentered(ctx, contact, cx, y + capSize + 26 * sc, 3 * sc);
        } });
        // The invitation, with real air above it — it closes the card, it
        // doesn't crowd the contact line.
        items.push({ h: capSize + 44 * sc, draw: (y) => {
          ctx.fillStyle = st.quiet; ctx.font = `500 ${22 * sc}px ${sans}`;
          fillTrackedCentered(ctx, "REQUEST A PRIVATE SHOWING", cx, y + capSize + 40 * sc, 7 * sc);
        } });

        const stackH = items.reduce((a, b) => a + b.h, 0);
        let y = (H - stackH) / 2;
        for (const it of items) { it.draw(y); y += it.h; }

        // Quiet credit line — the portal's own mark.
        ctx.fillStyle = st.light ? "rgba(20,26,33,0.32)" : "rgba(255,255,255,0.30)";
        ctx.font = `500 ${18 * sc}px ${sans}`;
        fillTrackedCentered(ctx, "YACHTPICS", cx, H - 60 * sc, 6 * sc);
        ctx.restore();
      };

      const drawWatermark = () => {
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.rotate(-Math.PI / 6);
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = st.light ? "rgba(20,26,33,0.26)" : "rgba(255,255,255,0.30)";
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
        ctx.fillStyle = st.ground;
        ctx.fillRect(0, 0, W, H);

        // Which segments touch this instant? At most two during a crossfade.
        const active = segs.filter((sg) => t >= sg.start && t < sg.end);
        for (const sg of active) {
          const local = t - sg.start;
          const hold = sg.kind === "photo"
            ? (sg.index === 0 ? s.titleHold : s.hold) * st.holdScale
            : s.endHold;
          // Fade in over `fade` (except the very first photo), fade out over the
          // last `fade` of the segment — the next segment is fading in beneath.
          // For a punch look `fade` is a few frames: effectively a hard cut.
          const fadeIn = sg.start === 0 ? 1 : ease(local / fade);
          const fadeOut = sg.kind === "end" ? 1 : 1 - ease((local - hold) / fade);
          const alpha = Math.min(fadeIn, fadeOut);
          if (sg.kind === "photo") {
            drawPhoto(sg.index, local, hold, alpha);
            if (sg.index === 0) {
              // Up quickly over the opening push, then held — a name that's only
              // legible for a second reads as a glitch, not a title. Gone just
              // before the photo changes.
              // A punch look has a shorter title hold, so the name arrives
              // quicker and stays until the cut.
              const quick = st.cut === "punch";
              const tIn = ease((local - (quick ? 0.15 : 0.3)) / (quick ? 0.35 : 0.6));
              const tOut = 1 - ease((local - (hold - (quick ? 0.35 : 0.7))) / (quick ? 0.3 : 0.6));
              drawTitle(Math.min(tIn, tOut) * alpha);
            } else {
              drawRoomLabel(sg.index, local, hold, alpha);
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

  /**
   * Brand colours: applied to the preview at once, saved to the broker's
   * profile a moment later so every future reel on every listing remembers
   * them. Saving is best-effort — a viewer without rights to the row (an admin
   * on a broker's boat) still gets the colours for this session.
   */
  function setBrandColor(next: BrandColors) {
    setBrand(next);
    setResult(null);
    setPhase("idle");
    // Only the broker's own hand writes to their profile.
    if (!listing || !isOwner) return;
    if (brandSaveRef.current) clearTimeout(brandSaveRef.current);
    brandSaveRef.current = setTimeout(() => {
      supabase.from("broker_details")
        .update({ brand_accent: next.accent ?? null, brand_ground: next.ground ?? null })
        .eq("id", listing.broker_id)
        .then(() => { /* best effort */ });
    }, 600);
  }

  /** Pull the brand colour out of the logo itself. */
  async function matchLogo() {
    if (!broker?.logoUrl) return;
    setMatching(true);
    try {
      const bmp = await loadBitmap(broker.logoUrl);
      const hex = dominantColor(bmp);
      if (!hex) throw new Error("Couldn't find a strong colour in the logo — it may be mostly black, white or grey. Pick one by hand instead.");
      setBrandColor({ ...brand, accent: hex });
      setBrandError("");
    } catch (err) {
      setBrandError(err instanceof Error ? err.message : "Couldn't read the logo.");
    } finally {
      setMatching(false);
    }
  }

  /** Ask the model to write from the frames actually chosen. */
  async function writeCopy() {
    if (selectedPhotos.length === 0) return;
    setWriting(true);
    setCopyError("");
    try {
      const res = await fetch(`/api/listings/${id}/reel-copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds: selectedPhotos.map((p) => p.id) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Couldn't write the copy (${res.status}).`);
      if (data.configured === false) {
        setCopyError("Writing isn't switched on for this portal yet — ask YachtPics to enable it.");
        return;
      }
      setHeadline(data.headline ?? "");
      setCaption(data.caption ?? "");
      setHashtags(Array.isArray(data.hashtags) ? data.hashtags : []);
      // A headline only reaches the film once the broker has actually looked at
      // it — nothing goes out under their name that they haven't seen.
      setUseHeadline(false);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : "Couldn't write the copy.");
    } finally {
      setWriting(false);
    }
  }

  async function copyCaption() {
    const text = [caption, hashtags.join(" ")].filter(Boolean).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the text is on screen to select */ }
  }

  /**
   * Get the finished reel onto the phone it'll be posted from. Uploads the
   * rendered file to the private bucket under a short-lived prefix, signs a
   * 24-hour link, shows it as a QR code and emails it as a backup.
   */
  async function sendToPhone() {
    if (!result || locked || !listing) return;
    setSendingPhone(true);
    setPhoneError("");
    setPhone(null);
    setPhonePct(0);
    try {
      const filename = `${safeName(listing.vessel_name)}-${result.format}.mp4`;
      const file = new File([result.blob], filename, { type: "video/mp4" });
      const up = await uploadVideoToPrivateBucket({
        file,
        target: { listingId: id, share: true },
        onProgress: setPhonePct,
      });
      if (!up.ok) throw new Error(up.error);

      const res = await fetch(`/api/listings/${id}/reel-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: up.path, filename, email: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error ?? "Couldn't make the link.");

      // A signed link is ~700 characters — a dense code. Lowest error correction
      // keeps the module count down so a phone can read it from arm's length.
      const qr = await QRCode.toDataURL(data.url, {
        width: 640, margin: 2, errorCorrectionLevel: "L",
        color: { dark: "#050b14", light: "#ffffff" },
      });
      setPhone({ qr, url: data.url, emailedTo: data.emailedTo ?? null });
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : "Couldn't send it to your phone.");
    } finally {
      setSendingPhone(false);
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

  const busy = phase === "loading" || phase === "rendering";
  const seconds = Math.round(timeline.total);
  const promoOn = reelPromoActive();
  const style = applyBrand(REEL_STYLES[styleKey], brand);
  const brandOn = !!(brand.accent || brand.ground);
  // Nothing to caption if the photos were never categorised.
  const labelsPossible = selectedPhotos.some((p, i) => i > 0 && !!roomLabel(p.category));

  function pick<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setResult(null); setPhase("idle"); };
  }
  const chooseStyle = pick<StyleKey>(setStyleKey);

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

      {promoOn && (
        <div className="mb-5 px-4 py-3 rounded-ctl text-sm bg-accent-50 border border-accent-200 text-ink-800">
          <span className="font-semibold">The Reel is open to everyone until {reelPromoEndsOn()}.</span>{" "}
          Make as many as you like, for any listing — yours to download and post, no watermark.
          <span className="text-ink-500"> · {reelPromoCountdown()}</span>
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
      {format === "reel" && length === "full" && seconds < 30 && chosen.length < s.maxPhotos && (
        <p className="text-xs text-ink-400 -mt-4 mb-5">Reels reach furthest between 30 and 60 seconds — add a few more photos, or switch to Short.</p>
      )}

      {/* Look — four complete points of view, not colour swaps. */}
      <div className="mb-5">
        <p className="label-caps text-ink-500 mb-2">Look</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {STYLE_ORDER.map((k) => {
            const stl = REEL_STYLES[k];
            const on = styleKey === k;
            return (
              <button
                key={k}
                onClick={() => chooseStyle(k)}
                disabled={busy}
                className={`text-left rounded-ctl border p-3 transition-colors ${on ? "border-accent-500 bg-accent-50" : "border-hairline-strong bg-white hover:border-ink-300"}`}
              >
                {/* A swatch of the actual ground and accent — you can see the
                    difference before you spend a minute rendering it. */}
                <span className="flex items-center gap-1.5 mb-1.5">
                  <span className="h-4 w-4 rounded-sm border border-black/10" style={{ background: stl.ground }} />
                  <span className="h-4 w-4 rounded-sm border border-black/10" style={{ background: stl.accent }} />
                </span>
                <span className={`block text-sm font-semibold ${on ? "text-ink-900" : "text-ink-700"}`}>{stl.name}</span>
                <span className="block text-[11px] text-ink-500 leading-snug mt-0.5">{stl.blurb}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Brand colours — the look's palette, or the broker's own. */}
      <div className="mb-5">
        <p className="label-caps text-ink-500 mb-2">Your colours</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-ink-700 cursor-pointer">
            <input
              type="color"
              value={brand.accent ?? REEL_STYLES[styleKey].accent}
              onChange={(e) => setBrandColor({ ...brand, accent: e.target.value })}
              disabled={busy}
              className="h-8 w-10 rounded-sm border border-hairline-strong bg-white cursor-pointer"
            />
            Accent
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-ink-700 cursor-pointer">
            <input
              type="color"
              value={brand.ground ?? REEL_STYLES[styleKey].ground}
              onChange={(e) => setBrandColor({ ...brand, ground: e.target.value })}
              disabled={busy}
              className="h-8 w-10 rounded-sm border border-hairline-strong bg-white cursor-pointer"
            />
            Background
          </label>
          {broker?.logoUrl && (
            <button onClick={matchLogo} disabled={busy || matching} className={chip(false)}>
              {matching ? "Reading logo…" : "Match my logo"}
            </button>
          )}
          {brandOn && (
            <button onClick={() => setBrandColor({})} disabled={busy} className="text-xs font-semibold text-ink-400 hover:underline">
              Back to the look&rsquo;s colours
            </button>
          )}
        </div>
        <p className="text-xs text-ink-400 mt-1.5">
          Accent is the fine lines and the lead-in; background is the bars, the end card and the page behind the photo.
          {broker?.logoUrl ? " Match my logo pulls the main colour out of your logo." : ""}
          {isOwner ? " Your choice is remembered for every listing." : " Colours chosen here apply to this session only — the broker's own settings are untouched."}
        </p>
        {brandError && <p className="mt-1.5 text-xs text-danger-700">{brandError}</p>}
      </div>

      {/* Options */}
      <div className="grid sm:grid-cols-2 gap-4 mb-5">
        {/* Length — the reel's call alone; the film has one timing. */}
        {format === "reel" && (
          <div>
            <p className="label-caps text-ink-500 mb-2">Length</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => chooseLength("full")} disabled={busy} className={chip(length === "full")}>Full — about 40s, up to 18 photos</button>
              <button onClick={() => chooseLength("short")} disabled={busy} className={chip(length === "short")}>Short — about 20s, up to 10 photos</button>
            </div>
            <p className="text-xs text-ink-400 mt-1.5">Reels between 30 and 60 seconds reach the furthest. Short suits a quick teaser.</p>
          </div>
        )}
        <div>
          <p className="label-caps text-ink-500 mb-2">Framing</p>
          {styleKey === "cinematic" && format === "reel" ? (
            // The letterbox IS the framing — the band is always filled.
            <p className="text-xs text-ink-400">Cinematic fills its letterbox band; there&rsquo;s nothing to choose here.</p>
          ) : styleKey === "gallery" ? (
            // The inset always shows the complete photograph.
            <p className="text-xs text-ink-400">Gallery shows every photograph complete, with a margin — nothing is cropped.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => { setFit("fill"); setResult(null); setPhase("idle"); }} disabled={busy} className={chip(fit === "fill")}>Fill the frame</button>
                <button onClick={() => { setFit("whole"); setResult(null); setPhase("idle"); }} disabled={busy} className={chip(fit === "whole")}>Show the whole photo</button>
              </div>
              <p className="text-xs text-ink-400 mt-1.5">{fit === "fill" ? "Cinematic crop with a slow push-in." : "Every photo shown complete, on a soft backdrop."}</p>
            </>
          )}
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
            <button onClick={() => { setShowLabels((v) => !v); setResult(null); setPhase("idle"); }} disabled={busy || !labelsPossible} className={chip(showLabels && labelsPossible)}>
              {labelsPossible ? `Room labels ${showLabels ? "on" : "off"}` : "No categories set"}
            </button>
          </div>
          <p className="text-xs text-ink-400 mt-1.5">
            Year, builder, length and staterooms always appear when they&rsquo;re filled in.
            {labelsPossible && " Room labels name each space in the corner of its photo."}
          </p>
        </div>
      </div>

      {/* Photo picker */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <p className="label-caps text-ink-500">Photos · {chosen.length} of {s.maxPhotos}</p>
          <div className="flex gap-3">
            <button onClick={() => { setChosen(photos.slice(0, s.maxPhotos).map((p) => p.id)); setResult(null); setPhase("idle"); }} disabled={busy} className="text-xs font-semibold text-accent-700 hover:underline">First {s.maxPhotos}</button>
            <button onClick={() => { setChosen([]); setResult(null); setPhase("idle"); }} disabled={busy} className="text-xs font-semibold text-ink-400 hover:underline">Clear</button>
          </div>
        </div>
        <p className="text-xs text-ink-400 mt-1.5 mb-2">Tap photos in the order you want them to play — the number shows each one&rsquo;s place, and the first gets the title. Tap again to remove one. &ldquo;First {s.maxPhotos}&rdquo; takes them in slideshow order, cover first.</p>
        <div className="grid grid-cols-5 sm:grid-cols-8 gap-1.5">
          {photos.map((p) => {
            const on = chosen.includes(p.id);
            const idx = selectedPhotos.findIndex((q) => q.id === p.id);
            return (
              <button key={p.id} onClick={() => togglePhoto(p.id)} disabled={busy} title={p.category ?? p.filename ?? ""}
                className={`relative aspect-square overflow-hidden rounded-sm border-2 transition-colors bg-ink-100 ${on ? "border-accent-500" : "border-transparent opacity-55 hover:opacity-90"}`}>
                {p.thumb && <RetryImg src={p.thumb} alt="" loading="lazy" className="w-full h-full object-cover" />}
                {on && <span className="absolute top-0.5 left-0.5 text-[10px] font-semibold bg-ink-950/80 text-white rounded px-1">{idx + 1}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Words — written from the frames actually chosen. */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 mb-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-ink-900">Generate your headline &amp; caption</p>
            <p className="text-xs text-ink-400 mt-0.5">
              Click the button and we&rsquo;ll look at the photos you picked and write a headline for the opening frame plus a caption and hashtags for your post. Edit anything, then copy and go.
            </p>
          </div>
          <button
            onClick={writeCopy}
            disabled={writing || busy || selectedPhotos.length === 0}
            className="text-sm font-semibold px-5 py-2.5 rounded-ctl border border-hairline-strong text-ink-700 hover:border-ink-400 disabled:opacity-40 transition-colors"
          >
            {writing ? "Reading the photos…" : caption ? "Write it again" : "Write with AI"}
          </button>
        </div>

        {copyError && <p className="mt-3 text-sm text-danger-700">{copyError}</p>}

        {(caption || headline) && (
          <div className="mt-4 space-y-4">
            <div>
              <label className="label-caps text-ink-500 block mb-1.5">Headline on the opening frame</label>
              <input
                value={headline}
                onChange={(e) => { setHeadline(e.target.value); setResult(null); setPhase("idle"); }}
                placeholder="(none)"
                className="w-full text-sm border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
              <label className="mt-2 flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useHeadline}
                  disabled={!headline.trim()}
                  onChange={(e) => { setUseHeadline(e.target.checked); setResult(null); setPhase("idle"); }}
                  className="mt-0.5 h-4 w-4 rounded border-hairline-strong text-accent-600 focus:ring-accent-500 disabled:opacity-40"
                />
                <span className="text-xs text-ink-600">
                  Put this on the film. The year and builder move down to the spec line, so nothing is lost —
                  <span className="text-ink-400"> read it first; it goes out under your name.</span>
                </span>
              </label>
            </div>

            {caption && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="label-caps text-ink-500">Caption</span>
                  <button onClick={copyCaption} className="text-xs font-semibold text-accent-700 hover:underline">
                    {copied ? "Copied" : "Copy caption + hashtags"}
                  </button>
                </div>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={4}
                  className="w-full text-sm border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
                />
                {hashtags.length > 0 && (
                  <p className="text-xs text-ink-500 mt-1.5 break-words">{hashtags.join(" ")}</p>
                )}
              </div>
            )}
          </div>
        )}
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
              <button onClick={render} disabled={chosen.length === 0 || supported === false}
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
          <canvas ref={canvasRef} className="rounded-sm shadow-print w-full" style={{ maxWidth: format === "reel" ? 300 : 560, aspectRatio: `${s.w} / ${s.h}`, background: style.ground }} />
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
                  <button onClick={sendToPhone} disabled={sendingPhone}
                    className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold px-6 py-2.5 rounded-ctl transition-colors">
                    {sendingPhone ? `Sending… ${phonePct}%` : "📱 Send to my phone"}
                  </button>
                  {result.format === "film" && (
                    <button onClick={addToListing} disabled={adding || added}
                      className="text-sm font-semibold px-6 py-2.5 rounded-ctl border border-hairline-strong text-ink-700 hover:border-ink-400 disabled:opacity-50 transition-colors">
                      {added ? "✓ Added to this listing" : adding ? "Adding…" : "Add film to this listing"}
                    </button>
                  )}
                </>
              )}
            </div>
            {phoneError && <p className="mt-3 text-sm text-danger-700 text-center">{phoneError}</p>}

            {phone && (
              <div className="mt-5 bg-ink-50 border border-hairline rounded-ctl p-5 flex flex-col sm:flex-row items-center gap-5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={phone.qr} alt="Scan to save the reel" className="w-56 h-56 sm:w-64 sm:h-64 rounded-sm border border-hairline-strong bg-white shrink-0" />
                <div className="text-sm text-ink-700">
                  <p className="font-semibold text-ink-900">Point your phone&rsquo;s camera at the code</p>
                  <p className="text-ink-600 mt-1">Tap the link that pops up and the reel saves to your camera roll. Then open Instagram, choose it, add your audio and caption.</p>
                  <p className="text-xs text-ink-400 mt-2">
                    {phone.emailedTo ? `Also emailed to ${phone.emailedTo} as a backup. ` : ""}This pickup link works for 24 hours — once the reel is on your phone it&rsquo;s yours to keep, and you can make it again here any time.
                    {" "}<a href={phone.url} className="text-accent-700 font-semibold hover:underline" target="_blank" rel="noopener noreferrer">Open it here</a>
                  </p>
                </div>
              </div>
            )}

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
