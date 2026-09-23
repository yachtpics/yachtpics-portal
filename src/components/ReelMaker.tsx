"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Cormorant_Garamond } from "next/font/google";
import { createClient } from "@/lib/supabase/client";
import { uploadListingVideo, uploadVideoToPrivateBucket } from "@/lib/uploadListingVideo";
import QRCode from "qrcode";
import {
  ease,
  fillTrackedCentered,
  fillTrackedLeft,
  loadBitmap,
  wrapTracked,
  wrapSegments,
} from "@/lib/canvasText";
import {
  REEL_STYLES, STYLE_ORDER, isMarquee, isExterior, roomLabel, applyBrand, dominantColor, rgba,
  type StyleKey, type BrandColors,
} from "@/lib/reelStyles";
import {
  YACHTPICS_CARD, YACHTPICS_COLORS, YACHTPICS_PHONES,
  type BrokerCard, type YpPhone,
} from "@/lib/yachtpicsBrand";
import { reelPromoActive, reelPromoCountdown, reelPromoEndsOn } from "@/lib/reelPromo";
import { planStack, planSingles, planMarquee, rowState, whipEase, flashAlpha, type StackEvent, type PlacedPhoto } from "@/lib/reelStack";
import { drawTransition } from "@/lib/reelTransitions";
import RetryImg from "@/components/RetryImg";

/**
 * The Reel Maker
 * --------------
 * The renderer behind both the Listing Reel (/dashboard/listings/[id]/reel)
 * and the admin Reel Studio (/admin/reel-studio). It is handed a ReelSource —
 * a boat, a list of photographs that can each produce a bitmap, and a broker
 * card — and knows nothing about where any of it came from.
 *
 * One tap turns those photographs — on a listing, already in walk-through
 * order with the broker's cover shot first — into a finished video:
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
type Length = "short" | "full" | "long";

const SPEC: Record<Format, {
  w: number; h: number; label: string; hint: string;
  maxPhotos: number; hold: number; fade: number; titleHold: number; endHold: number; defaultFit: Fit;
}> = {
  // The reel's hold and photo cap are never read from here: the Length choice
  // below sets the cap, and the hold is worked out from its time budget and
  // the number of photos chosen. What's here is everything else the reel
  // shares between lengths — the frame, the fade, the title and end holds.
  //
  // The reel shows the WHOLE photograph by default. Most of what we shoot is
  // horizontal, and a horizontal frame cropped to 9:16 loses roughly two-thirds
  // of itself — the sheer line, the beam, the water either side of the boat.
  // We are in the business of delivering the media, so the default delivers all
  // of it; the crop is there for anyone who wants it.
  reel: {
    w: 1080, h: 1920, label: "Reel (9:16)", hint: "Instagram Reels, Stories, Facebook",
    maxPhotos: 10, hold: 1.7, fade: 0.55, titleHold: 4.2, endHold: 3.0, defaultFit: "whole",
  },
  // The film is a different job — it goes to one buyer who already asked, not to
  // a feed, so it can breathe. Nothing distributes it, so it is free to run over
  // a minute: 24 photographs at a 2.6s hold is roughly seventy-two seconds.
  film: {
    w: 1920, h: 1080, label: "Film (16:9)", hint: "Send to Client, slideshow, YouTube",
    maxPhotos: 24, hold: 2.6, fade: 0.6, titleHold: 5.0, endHold: 3.0, defaultFit: "whole",
  },
};

/**
 * How long a reel runs.
 *
 * Instagram's own 2026 numbers (Socialinsider, 140,000 reels) put the highest
 * reach squarely in the 30–60 second band — long enough for the feed to read
 * the post as worth distributing, short enough to be finished. So Full is the
 * default.
 *
 * A reel is budgeted by TIME, not by hold. Each length has a running time it
 * aims for; the title and end card take their fixed share of it, and what's
 * left is divided between the photographs chosen. Up to a point the hold
 * simply stays at its ceiling — Full with eighteen photos or fewer holds 1.9s,
 * exactly as it always has, and lands at about forty seconds. Past that, each
 * photo added tightens the hold instead of lengthening the reel, down to a
 * floor of 1.25s, below which the brochure looks feel rushed. The cap is
 * where that floor is reached: anyone who needs more photographs than the cap
 * should make a second reel rather than a longer or a faster one.
 *
 * `target` is the time budget, in seconds (title and end card included). It
 * reads a little over the chip's round number because the title photo holds
 * for the title, not for a photo beat — so a reel lands at about `target`
 * less one hold. `holdMax` is the length's own ceiling: Short keeps its old,
 * slightly quicker 1.7s so a ten-photo teaser feels as it always did.
 *
 *   Short — about 20s, up to 12 photos (1.7s at ten, 1.45s at twelve)
 *   Full  — about 40s, up to 27 photos (1.9s to eighteen, ~1.27s at 27)
 *   Long  — about 55s, up to 40 photos (1.9s to twenty-six, 1.25s at 40)
 *
 * Only the reel offers the choice; the film's single timing is unchanged.
 */
const LENGTH: Record<Length, { target: number; maxPhotos: number; holdMax: number }> = {
  short: { target: 24.6, maxPhotos: 12, holdMax: 1.7 },
  full: { target: 41.5, maxPhotos: 27, holdMax: 1.9 },
  long: { target: 57, maxPhotos: 40, holdMax: 1.9 },
};

/** Today's Full hold — the ceiling, so a reel of eighteen feels unchanged. */
const HOLD_MAX = 1.9;
/** Below this the brochure looks feel rushed. */
const HOLD_MIN = 1.25;

/**
 * The per-photo hold for a reel of `n` photographs at this length: the time
 * budget left after the title and end card, shared between the photos, held
 * between the floor and the length's ceiling.
 */
function reelHold(length: Length, n: number) {
  const L = LENGTH[length];
  const budget = L.target - SPEC.reel.titleHold - SPEC.reel.endHold;
  return Math.min(Math.min(L.holdMax, HOLD_MAX), Math.max(HOLD_MIN, budget / Math.max(1, n)));
}

const DEFAULT_LENGTH: Length = "full";

/** The photo cap actually in force: the length's on a reel, the film's own. */
function capFor(format: Format, length: Length) {
  return format === "reel" ? LENGTH[length].maxPhotos : SPEC.film.maxPhotos;
}

const FPS = 30;

/** A punch look cuts hard — a whisker of overlap so it never flashes black. */
function fadeFor(fmt: Format, key: StyleKey) {
  return REEL_STYLES[key].cut === "punch" ? 0.08 : SPEC[fmt].fade;
}

// Palette now lives with each look in @/lib/reelStyles — a 2D context can't
// read Tailwind, and the six styles need genuinely different grounds.

export type ListingData = {
  vessel_name: string | null; year: number | null; make: string | null; model: string | null;
  vessel_type: string | null; length_ft: number | null; location: string | null; asking_price: number | null;
  staterooms: number | null; broker_id: string; hero_photo_id: string | null; photo_order_manual: boolean | null;
  /**
   * Studio only. "free" = not a boat: draw `vessel_name` as the headline and
   * the optional `subtitle` / `detail` lines beneath it; skip every vessel
   * field. Absent (the listing) or "vessel" is the path this renderer has
   * always taken, unchanged.
   */
  subject?: "vessel" | "free";
  subtitle?: string | null;
  detail?: string | null;
};

// The YachtPics card, palette and numbers now live in @/lib/yachtpicsBrand, so
// the Social Post page signs a graphic from exactly the same source.

function safeName(s: string | null | undefined) {
  return (s ?? "listing").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "listing";
}

function fmtPrice(n: number | null) {
  return n ? `$${Number(n).toLocaleString("en-US")}` : null;
}


/**
 * One photograph offered to the reel.
 *
 * Where it comes from is the source's business — the listing signs a
 * transformed URL out of Supabase storage, the Studio decodes a file off the
 * phone — so all the renderer asks for is a thumbnail to show in the picker
 * and a bitmap sized for the frame when it comes to render.
 */
export type ReelPhoto = {
  id: string;
  /** For the picker's thumbnails. */
  previewUrl: string;
  /** Sized for the frame: the long edge the renderer wants, in pixels. */
  loadBitmap: (longEdge: number) => Promise<ImageBitmap>;
  category?: string | null;
  filename?: string | null;
};

/**
 * Everything the reel needs, whoever assembled it.
 *
 * The listing page builds one out of Supabase; the admin Reel Studio builds
 * one out of a form and a file picker. The renderer below can't tell the
 * difference, which is the point — one set of looks, one end card, one encoder.
 */
export type ReelSource = {
  listing: ListingData;
  photos: ReelPhoto[];
  /** The broker's card for the end card. Null in the Studio until one is picked. */
  broker: BrokerCard | null;
  /** Null when there's no listing behind the reel — the Studio. */
  listingId: string | null;
  isAdmin: boolean;
  isOwner: boolean;
  locked: boolean;
  /** The broker's remembered colours, where the source has them. */
  brand?: BrandColors;
  /** Videos already on the listing — the display order a new one takes. */
  videoCount?: number;
  /**
   * Whether the reel starts branded as YachtPics. The Studio sets it from its
   * own branding picker — ours by default, the broker's once one is chosen.
   * Left out (the listing), the admin chip starts off, exactly as before.
   */
  defaultYpBrand?: boolean;
  /**
   * A device budget. A phone has neither the memory nor the patience for
   * forty 2200px bitmaps, so the Studio lowers both the photo cap and the
   * size each photograph is decoded at. It can only ever lower them.
   */
  budget?: { maxPhotos: number; longEdgeScale: number };
};

/**
 * No broker behind the reel — the Studio, before one is picked. Every line of
 * the end card is optional, so a blank card simply draws nothing.
 */
const BLANK_CARD: BrokerCard = { name: "", brokerage: null, phone: null, email: null, website: null, logoUrl: null };

export default function ReelMaker({ source }: { source: ReelSource }) {
  const supabase = createClient();
  const { listing, photos, broker, listingId, isAdmin, isOwner, locked, budget } = source;
  /** Studio only: this reel is of something that isn't a boat. */
  const freeSubject = listing.subject === "free";
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [videoCount, setVideoCount] = useState(source.videoCount ?? 0);

  const [format, setFormat] = useState<Format>("reel");
  // Reels only — the film keeps its single timing.
  const [length, setLength] = useState<Length>(DEFAULT_LENGTH);
  const [fit, setFit] = useState<Fit>(SPEC.reel.defaultFit);
  const [styleKey, setStyleKey] = useState<StyleKey>("editorial");
  // The broker's own colours, remembered on their profile. Null = the look's.
  const [brand, setBrand] = useState<BrandColors>(source.brand ?? {});
  const [matching, setMatching] = useState(false);
  const [brandError, setBrandError] = useState("");
  // Admins only: brand the reel as YachtPics itself — our logo, our contact,
  // our colours, "Book a shoot" — so any boat we've photographed becomes our
  // own advertising. Brokers never see the switch.
  const [ypBrand, setYpBrand] = useState(source.defaultYpBrand ?? false);
  const [ypPhone, setYpPhone] = useState<YpPhone>("charlie");
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

  /**
   * A source that carries colours of its own — the listing broker's, or those
   * of the broker picked in the Studio — hands them over when they change. The
   * listing's are set once, so this never fights the colour pickers below.
   */
  useEffect(() => {
    if (source.brand) setBrand(source.brand);
  }, [source.brand]);

  /**
   * The Studio's branding picker owns the YachtPics switch while it is set; the
   * listing never passes one, so the chip there is the admin's alone.
   */
  useEffect(() => {
    if (source.defaultYpBrand === undefined) return;
    setYpBrand(source.defaultYpBrand);
    setResult(null);
    setPhase("idle");
  }, [source.defaultYpBrand]);

  /**
   * The opening selection: the source's own order, up to the cap. On a listing
   * this runs once, with the photos the loader handed over — cover first, then
   * the walk-through. In the Studio it runs again each time photos are added,
   * so a new one joins the end of the selection rather than sitting unused.
   */
  useEffect(() => {
    setChosen((prev) => {
      const ids = photos.map((p) => p.id);
      const kept = prev.filter((x) => ids.includes(x));
      const room = Math.min(capFor(format, length), budget?.maxPhotos ?? Infinity);
      if (kept.length >= room) return kept.slice(0, room);
      const add = photos.filter((p) => !kept.includes(p.id)).slice(0, room - kept.length).map((p) => p.id);
      return [...kept, ...add];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos]);

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
   * photo cap and the time budget, and the hold comes out of that budget and
   * the number of photographs chosen — so it re-derives on every tap, and the
   * timeline and the seconds readout below follow it. Everything else — the
   * frame size, the fade, the title and end holds — comes from the format.
   * The film is untouched.
   */
  const s = useMemo(
    () => (format === "reel"
      ? { ...SPEC.reel, maxPhotos: LENGTH[length].maxPhotos, hold: reelHold(length, chosen.length) }
      : SPEC.film),
    [format, length, chosen.length],
  );

  /**
   * The photo cap actually in force. The format and the length decide it; a
   * device budget — a phone in the Studio — can only bring it down.
   */
  const cap = useMemo(
    () => Math.min(capFor(format, length), budget?.maxPhotos ?? Infinity),
    [format, length, budget],
  );

  /**
   * Stack rearranges the frame itself — two and three photographs held at
   * once — and that composition only reads on a vertical reel. On the wide
   * film there is nothing to stack against: the name crowds the frame and the
   * photographs fall back to singles, which is Energy under another name. So
   * Stack isn't offered on film until it has a layout of its own.
   *
   * Marquee is the same story: three bands stacked down a 9:16 frame. On a
   * 16:9 film each band would be a sliver, so it's reels only too — and so
   * is Marquee Still, the same bands with the top one held.
   */
  const looks = useMemo(
    () => (format === "reel" ? STYLE_ORDER : STYLE_ORDER.filter((k) => k !== "stack" && !isMarquee(k))),
    [format],
  );

  // When the format changes, reset the fit and trim the selection to the cap.
  function chooseFormat(f: Format) {
    setFormat(f);
    // Stack is a reel look. Switching to film falls back to Energy — the
    // nearest thing in pace — rather than leaving a look that can't run.
    if (f === "film" && styleKey === "stack") setStyleKey("energy");
    // Marquee (and Marquee Still) is reel-only too; its nearest on a film is
    // the house look — serif, dissolves, the same unhurried pace.
    if (f === "film" && isMarquee(styleKey)) setStyleKey("editorial");
    setFit(SPEC[f].defaultFit);
    setResult(null);
    setPhase("idle");
    const nextCap = Math.min(capFor(f, length), budget?.maxPhotos ?? Infinity);
    setChosen((prev) => {
      // Keep the broker's order, just trimmed to the new format's cap.
      const kept = prev.slice(0, nextCap);
      return kept.length ? kept : photos.slice(0, nextCap).map((p) => p.id);
    });
  }

  // Switching length changes the cap, so a selection made for the long version
  // is trimmed — in the broker's own order — rather than silently over-filling.
  function chooseLength(next: Length) {
    setLength(next);
    setResult(null);
    setPhase("idle");
    const nextCap = Math.min(capFor(format, next), budget?.maxPhotos ?? Infinity);
    setChosen((prev) => (prev.length > nextCap ? prev.slice(0, nextCap) : prev));
  }

  function togglePhoto(pid: string) {
    setChosen((prev) => {
      // Tap to add at the end; tap again to remove and let the rest close up.
      if (prev.includes(pid)) return prev.filter((x) => x !== pid);
      if (prev.length >= cap) return prev;
      return [...prev, pid];
    });
    setResult(null);
    setPhase("idle");
  }

  const selectedPhotos = useMemo(() => {
    const byId = new Map(photos.map((p) => [p.id, p]));
    return chosen.map((pid) => byId.get(pid)).filter((p): p is ReelPhoto => !!p);
  }, [photos, chosen]);

  const timeline = useMemo(() => {
    const look = REEL_STYLES[styleKey];
    const scale = look.holdScale;
    const n = selectedPhotos.length;
    // Same boat, same photos → the same deal of transitions every time.
    const seed = n * 131 + styleKey.length * 17;
    // Our own ad's card carries more (the broker credit, the portal, us) —
    // it holds a beat and a half longer so it can be read.
    const endHold = s.endHold + (ypBrand && isAdmin ? 1.5 : 0);

    // The Stack look has its own clock — hero, then movements on the beat,
    // every photo once. Only on a 9:16 reel; a film has no vertical to stack into.
    if (look.layout === "stack" && format === "reel") {
      return planStack(n, { heroHold: s.titleHold * scale, beat: s.hold * scale, endHold, seed });
    }
    // The Marquee never cuts until the end card, but it runs exactly as long
    // as the quiet single-photo reel of the same photographs would — the
    // planner takes that length from planSingles and animates across it.
    if (look.layout === "marquee" && format === "reel") {
      return planMarquee(selectedPhotos.map((p) => p.category ?? null), {
        titleHold: s.titleHold * scale,
        hold: s.hold * scale,
        endHold,
        dissolve: fadeFor(format, styleKey),
        seed,
        still: !!look.heroStill,
      });
    }
    // Every other look: one photograph at a time. Every photo after the
    // title holds for exactly the same beat — varying it per photo is the
    // thing that makes a slideshow feel restless. The quiet looks dissolve;
    // a look with a vocabulary deals its cuts.
    // A Stack look on a film has no vertical to stack into, so it runs as a
    // single-photo film — but it keeps Stack's manners. Charlie took the
    // strobe out of the Stack deliberately ("we are delivering photos to be
    // seen"), so the film version gets neither the flash burst nor the flash
    // cuts that Energy deals: same punch, no strobe.
    const isStack = look.layout === "stack";
    return planSingles(n, {
      titleHold: s.titleHold * scale,
      hold: s.hold * scale,
      endHold,
      dissolve: fadeFor(format, styleKey),
      burst: look.hook === "burst" && !isStack,
      vocab: look.cut === "punch" ? (isStack ? "stack" : "energy") : null,
      // Reels only: three horizontal bands need the vertical a 9:16 frame has.
      thirds: format === "reel" ? look.thirds ?? null : null,
      seed,
    });
    // `s` carries the reel's hold — derived from the length's time budget and
    // the photo count — so the total redraws when Length or the selection changes.
  }, [selectedPhotos, s, format, styleKey, ypBrand, isAdmin]);

  // ── Render ──────────────────────────────────────────────────────────────
  /**
   * Metrics. The Reel went out to the whole portal as a two-week open house,
   * and the only honest measure of whether that landed is what got made — so
   * a row is filed when a film finishes, and another for each thing the broker
   * does with it afterwards. A render nobody downloads is a different signal
   * from one that got posted, and the gap between those two numbers is the
   * one worth watching.
   *
   * Deliberately fire-and-forget: no await, no error surfaced, no state. If
   * the beacon fails the broker must never know, because nothing they are
   * doing depends on it.
   */
  function track(kind: string, shape?: Record<string, unknown>) {
    // A Studio reel has no listing to file a row against, and the whole point
    // of the measure is what got made for which boat. So it files nothing.
    if (!listingId) return;
    try {
      void fetch("/api/reel-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, listingId, shape }),
        keepalive: true,
      }).catch(() => {});
    } catch { /* tracking never breaks the page */ }
  }

  async function render() {
    // The broker card is optional: a Studio reel branded as YachtPics has no
    // broker behind it at all.
    if (!listing || selectedPhotos.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    cancelRef.current = false;
    const startedAt = Date.now();
    setResult(null);
    setAdded(false);
    setPhone(null);
    setPhoneError("");
    setErrorMsg("");
    setPhase("loading");
    setProgress(0);

    // Whose film is this? The broker's, or — admin only — YachtPics' own ad.
    const yp = ypBrand && isAdmin;
    const card: BrokerCard = yp ? { ...YACHTPICS_CARD, phone: YACHTPICS_PHONES[ypPhone].phone } : broker ?? BLANK_CARD;
    const st = applyBrand(REEL_STYLES[styleKey], yp ? YACHTPICS_COLORS : brand);
    const fade = fadeFor(format, styleKey);
    // Letterbox is a vertical device — bars on an already-widescreen film just
    // shrink the picture, so the cinematic look keeps its type and its slow
    // motion there but drops back to a gradient.
    const backdrop = st.backdrop === "letterbox" && format === "film" ? "scrim" : st.backdrop;
    const W = s.w, H = s.h;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d", { alpha: false })!;

    // Everything the render decodes or builds, declared out here so the
    // finally below can release it however the render ends — finished,
    // cancelled or failed. Nothing is released mid-render: walls, Stack bands
    // and every transition read bitmaps after their own unit.
    const bitmaps: ImageBitmap[] = [];
    let logo: ImageBitmap | null = null;
    const backdropCache = new Map<number, HTMLCanvasElement>();
    const backdropOrder: number[] = []; // oldest first

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
      // The photo caps above are also a memory budget: every chosen photo is
      // held as a ~2200px bitmap for the whole render. The blurred backdrops
      // are NOT — they're built lazily, a handful at a time (see getBackdrop),
      // which is what lets Long run to forty photos.
      const longEdge = Math.max(W, H) * 1.15 * (budget?.longEdgeScale ?? 1); // headroom for the drift
      for (let i = 0; i < selectedPhotos.length; i++) {
        // Bail cleanly: leaving the phase as "loading" would keep the page in
        // its busy state with no way back but a reload.
        if (cancelRef.current) { setPhase("idle"); return; }
        const p = selectedPhotos[i];
        // The source decodes its own photograph at the size asked for — a
        // signed transform URL out of storage on a listing, a file off the
        // device in the Studio — and hands back a bitmap either way.
        const bmp = await p.loadBitmap(longEdge);
        bitmaps.push(bmp);
        setProgress(Math.round(((i + 1) / selectedPhotos.length) * 100));
      }

      if (card.logoUrl) { try { logo = await loadBitmap(card.logoUrl); } catch { logo = null; } }

      // The timeline: units (photos, stack runs, the end card) and the
      // transitions that join them.
      const { units, starts, transitions, total, flashes } = timeline;
      const stacked = units.some((u) => u.kind === "stack");

      // Soft backdrops for "whole photo" mode — blurred once per photo, not per
      // frame, and only when that photo comes on screen. Only the full-bleed
      // "whole photo" mode floats on a blurred plate. The inset and letterbox
      // looks have their own ground — a blur painted over the Gallery page (on
      // a dark brand ground) wiped it out. The Stack's full-frame singles
      // always show the whole photograph on a plate, whatever the framing chip
      // says.
      //
      // Built lazily and kept in a small cache: a backdrop is only needed
      // while its unit is on screen, plus the neighbour in a crossfade — so
      // six is plenty. Building all of them up front cost a frame-sized canvas
      // per photo (~320MB at forty photos) on top of the bitmaps.
      const wantsBackdrops = !st.light && backdrop === "scrim" && (fit === "whole" || stacked);
      const BACKDROP_CACHE = 6;
      const getBackdrop = (i: number): HTMLCanvasElement | null => {
        if (!wantsBackdrops) return null;
        const hit = backdropCache.get(i);
        if (hit) return hit;
        const bmp = bitmaps[i];
        if (!bmp) return null;
        const c = document.createElement("canvas");
        c.width = Math.round(W / 4); c.height = Math.round(H / 4);
        const bctx = c.getContext("2d")!;
        const scale = Math.max(c.width / bmp.width, c.height / bmp.height) * 1.1;
        const dw = bmp.width * scale, dh = bmp.height * scale;
        bctx.filter = "blur(14px) brightness(0.55) saturate(0.85)";
        bctx.drawImage(bmp, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
        bctx.filter = "none";
        backdropCache.set(i, c);
        backdropOrder.push(i);
        if (backdropOrder.length > BACKDROP_CACHE) {
          const old = backdropOrder.shift()!;
          const dead = backdropCache.get(old);
          // Zeroing the size releases the pixels now rather than at the next GC.
          if (dead) { dead.width = 0; dead.height = 0; }
          backdropCache.delete(old);
        }
        return c;
      };

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
      const totalFrames = Math.ceil(total * FPS);

      // Text prepared once.
      // A free subject is the Studio pointed at something that isn't a boat —
      // a product, a panel, an event. The headline is still `vessel_name`
      // (the Studio maps its Title field into it); everything under it comes
      // from `subtitle` and `detail`, and no vessel field is read at all.
      const free = listing.subject === "free";
      const name = listing.vessel_name ?? "Now Available";
      const builder = free
        ? (listing.subtitle ?? "").trim()
        : [listing.year, listing.make, listing.model].filter(Boolean).join(" ");
      // A written headline takes the line above the name; the builder doesn't
      // get dropped for it, it moves down into the spec row. The facts stay on
      // screen either way.
      // A YachtPics ad with no headline of its own leads with the byline.
      const usingHeadline = useHeadline && headline.trim().length > 0;
      const lead = usingHeadline ? headline.trim() : yp ? "Photographed by YachtPics" : null;
      const maker = lead ?? builder;
      const specBits = (free ? [
        // The second line sits where the builder would, the detail where the
        // length/type/price row would. Either blank simply isn't there.
        lead && builder ? builder : null,
        (listing.detail ?? "").trim() || null,
      ] : [
        lead && builder ? builder : null,
        listing.length_ft ? `${listing.length_ft}′` : null,
        listing.vessel_type,
        listing.staterooms ? `${listing.staterooms} Staterooms` : null,
        showPrice ? fmtPrice(listing.asking_price) : null,
      ]).filter(Boolean) as string[];
      const spec = specBits.join("   ·   ");
      // No boat, no port of lying: the "where" line is a vessel field.
      const where = free ? null : showLocation ? listing.location : null;

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
          return { x: 0, y: topType ? H * 0.42 : (H - bh) / 2 - H * 0.06, w: W, h: bh };
        }
        if (backdrop === "inset") {
          const m = 0.055 * W;
          if (topType) {
            // Name at the head of the page, the print below it.
            return { x: m, y: H * 0.42, w: W - m * 2, h: H * 0.44 };
          }
          // Film: the picture takes the top of the page and the type sits under
          // it for the WHOLE film, so the window has to leave the block real
          // room — it is not borrowing space back between photographs.
          // (0.45 was the reel's proportion carried over unchanged, which drew a
          // 3:2 photograph at a third of the frame width, marooned in cream.)
          //
          // A landscape photograph in a 16:9 window is limited by HEIGHT, never
          // width: at 0.54 a 3:2 frame drew 583px tall inside a window 1708
          // wide, so most of the page was cream either side of it. The block
          // below is now set tighter (see tightBlock) and the window takes what
          // that frees — a fifth larger on the long edge, better than a third
          // more picture, with the block's clearance unchanged.
          return { x: m, y: m * 0.45, w: W - m * 2, h: H * 0.63 };
        }
        return { x: 0, y: 0, w: W, h: H };
      })();

      // Where the photograph actually landed on the last drawPhoto call — the
      // window for a full-bleed crop, or the smaller rectangle a whole portrait
      // or landscape occupies inside it. The room caption anchors to this, so
      // it sits in the corner of the picture rather than the corner of the frame.
      let photoRect = { x: frame.x, y: frame.y, w: frame.w, h: frame.h };

      /**
       * The Marquee's three bands, fixed for the whole reel.
       *
       * The composition starts where Instagram's top overlay ends (14%, the
       * same line the title block never climbs past on the other looks) and
       * ends at 86% — the foot of Gallery's print, the lowest any reel look
       * sets a photograph with ground beneath it. The TYPE obeys the stricter
       * rule every look's type obeys: nothing below 65%, where the caption
       * and the action buttons sit. Ground above and below the bands.
       *
       *   top band    14%  → 42%    hero photographs, one at a time
       *   middle band 42%  → 66.5%  the title on the ground, accent hairlines
       *   strip       66.5% → 86%   the rest of the boat, sliding past
       */
      const marqueeOn = units.some((u) => u.kind === "marquee");
      const mq = {
        top: Math.round(H * 0.14),
        heroEnd: Math.round(H * 0.42),
        stripTop: Math.round(H * 0.665),
        bottom: Math.round(H * 0.86),
        typeFloor: H * 0.65,
      };
      /** Where drawTitle centres its block on a Marquee; null on every other look. */
      const titleBand = marqueeOn ? { top: mq.heroEnd, bottom: Math.min(mq.stripTop, mq.typeFloor) } : null;

      /**
       * The band a placed photograph occupies: the top, middle or bottom
       * third of the frame, inset by a margin so the ground reads as a page
       * rather than a gap. Instagram's own furniture is not dodged here on
       * purpose — that rule governs TYPE, and a photograph behind the caption
       * row is no worse off than a full-bleed one.
       */
      const slotRect = (slot: number) => {
        const bandH = H / 3;
        const mx = 0.055 * W;
        const my = 0.085 * bandH;
        return { x: mx, y: slot * bandH + my, w: W - mx * 2, h: bandH - my * 2 };
      };

      /**
       * One photograph of a WALL, drawn in its third.
       *
       * `t` is how long it has been on screen — `Infinity` for one that has
       * already settled, so the arrival maths collapses to "in place". The
       * newest slides in along `move` and fades up over WALL_ARRIVE; the
       * others sit perfectly still, which is the whole point of a wall.
       */
      const drawPlaced = (pp: { slot: number; index: number; move: string; arrive: number }, t: number, alpha: number, move: string, arrive: number) => {
        const bmp = bitmaps[pp.index];
        if (!bmp) return;
        const b = slotRect(pp.slot);
        const p = Math.min(1, Math.max(0, t / arrive));
        const e = whipEase(p);
        const base = Math.min(b.w / bmp.width, b.h / bmp.height);
        const dw = bmp.width * base, dh = bmp.height * base;
        const px = b.x + (b.w - dw) / 2;
        const py = b.y + (b.h - dh) / 2;
        // How far it still has to travel, along its own move.
        const back = 1 - e;
        let ox = 0, oy = 0;
        if (move === "left") ox = W * back;
        else if (move === "right") ox = -W * back;
        else if (move === "up") oy = b.h * 1.6 * back;
        else if (move === "down") oy = -b.h * 1.6 * back;
        ctx.save();
        ctx.globalAlpha = alpha * (move === "fade" || move === "wipe" ? e : 1);
        if (move === "wipe") {
          // Revealed from the left rather than moved.
          ctx.beginPath();
          ctx.rect(b.x, b.y, b.w * e, b.h);
          ctx.clip();
        }
        ctx.shadowColor = st.light ? "rgba(20,26,33,0.20)" : "rgba(0,0,0,0.50)";
        ctx.shadowBlur = (st.light ? 30 : 44) * sc;
        ctx.shadowOffsetY = (st.light ? 10 : 14) * sc;
        ctx.drawImage(bmp, px + ox, py + oy, dw, dh);
        ctx.restore();
        photoRect = { x: px, y: py, w: dw, h: dh };
      };

      const drawPhoto = (i: number, localT: number, hold: number, alpha: number, wholeOverride?: boolean, slot?: number | null) => {
        const bmp = bitmaps[i];
        // The drift runs to the end of the outgoing transition, so the
        // photograph never freezes while a dissolve or dip carries it out.
        // Dealt transitions run up to 0.44s; the quiet looks' crossfade is `fade`.
        const outDur = st.cut === "punch" ? 0.45 : fade;
        const drift = ease(localT / (hold + outDur));
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
          const snap = ease(Math.min(1, localT / 0.45));
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
        // The Stack's hero and burst are always full-bleed — the framing chips
        // are hidden for it, so a "whole photo" choice left over from another
        // look must not leak in.
        // A placed photograph: whole, complete, in its third of the frame,
        // with the look's own ground around it. One at a time — the empty
        // ground either side of it is the effect, not a shortfall.
        if (slot !== null && slot !== undefined) {
          const b = slotRect(slot);
          const base = Math.min(b.w / bmp.width, b.h / bmp.height);
          // A touch of the look's own motion, kept small: the photograph has
          // a border of ground to grow into and must never crop against it.
          const zoom = base * (1 + (k - 1) * 0.3);
          const dw = bmp.width * zoom, dh = bmp.height * zoom;
          ctx.shadowColor = st.light ? "rgba(20,26,33,0.20)" : "rgba(0,0,0,0.50)";
          ctx.shadowBlur = (st.light ? 30 : 44) * sc;
          ctx.shadowOffsetY = (st.light ? 10 : 14) * sc;
          const px = b.x + (b.w - dw) / 2;
          const py = b.y + (b.h - dh) / 2;
          ctx.drawImage(bmp, px, py, dw, dh);
          photoRect = { x: px, y: py, w: dw, h: dh };
          ctx.restore();
          return;
        }

        const showWhole = wholeOverride ?? (backdrop === "inset" || (fit === "whole" && backdrop !== "letterbox" && !stacked));
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
          const bd = getBackdrop(i);
          if (bd) ctx.drawImage(bd, 0, 0, W, H);
          // The inset window already carries its page margin; a second one
          // inside it shrank the photograph for nothing.
          const margin = backdrop === "inset" ? 0 : 0.055 * Math.min(frame.w, frame.h);
          // The title photo on a reel keeps the top band for the name: the
          // whole photograph sits below it, and a tall one is scaled to fit
          // the room that leaves.
          const titled = i === 0 && topType && backdrop === "scrim";
          const top = titled ? H * 0.40 : frame.y + margin;
          const availH = titled ? H - top - margin : frame.h - margin * 2;
          const base = Math.min((frame.w - margin * 2) / bmp.width, availH / bmp.height);
          const zoom = base * (1 + (k - 1) * 0.45);
          const dw = bmp.width * zoom, dh = bmp.height * zoom;
          ctx.shadowColor = st.light ? "rgba(20,26,33,0.20)" : "rgba(0,0,0,0.45)";
          ctx.shadowBlur = (st.light ? 30 : 40) * sc;
          ctx.shadowOffsetY = (st.light ? 10 : 12) * sc;
          const px = frame.x + (frame.w - dw) / 2;
          const py = titled ? top + (availH - dh) / 2 : frame.y + (frame.h - dh) / 2;
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
      const drawRoomLabel = (i: number, localT: number, _hold: number, alpha: number, placed = false) => {
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
          // On a reel it sits just ABOVE the picture, in the band the title
          // had — under the picture on a 9:16 frame is Instagram's caption,
          // not ours.
          ctx.fillStyle = st.soft;
          ctx.font = `500 ${size}px ${sans}`;
          fillTrackedCentered(ctx, label, r.x + r.w / 2, topType ? r.y - 44 * sc : r.y + r.h + 58 * sc, 8 * sc);
        } else {
          // Bottom-left corner of the PICTURE, wherever it landed — a portrait
          // floated in the frame gets its caption at its own foot, not the
          // frame's. A full-bleed reel puts it top-left instead, in the same
          // band the title uses: the foot of a reel is Instagram's, not ours.
          const fullBleed = fit === "fill";
          const x = r.x + 44 * sc;
          const y = placed
            // A placed photograph carries its caption at its own foot,
            // wherever in the frame it landed — a fixed band at the top would
            // leave the words stranded above a bottom-third picture.
            ? r.y + r.h - 34 * sc
            : topType
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

        // Gallery on film is the one composition where the type and the
        // photograph compete for the same page. Everywhere else the block
        // either sits ON the picture (scrim), or inside a bar the letterbox
        // was always going to leave empty, or — on a reel — in the top band
        // Instagram covers anyway. Here it is on screen for the whole film,
        // below the picture, so every pixel it takes is a pixel the
        // photograph never gets back. On that one layout alone the type is set
        // smaller and the gaps close up.
        const tightBlock = backdrop === "inset" && !topType;

        // A free subject with neither second line nor detail is a headline and
        // nothing else. The gap that would have carried the spec row — and the
        // rule that sits halfway along it — collapses in BOTH passes, so the
        // block measures as short as it draws instead of leaving a hole where
        // the boat's facts used to be.
        const collapseTrail = free && !spec && !where;

        // The block is measured once and drawn once, in two separate passes,
        // and the two have to agree: shrink a gap in the measure pass only and
        // the block is anchored as if it were short while it still draws long
        // — which walks the location line off the foot of the frame. So every
        // gap that differs between tight and loose lives here, read by both.
        // For a loose block each value is exactly what was hard-coded before,
        // so nothing moves on the other five looks.
        const gapNameToSpec = (tightBlock ? 56 : 84) * sc;  // name baseline to spec baseline
        const gapSpecTrail  = (tightBlock ? 18 : 26) * sc;  // spec baseline to location baseline
        const gapLeadToName = (tightBlock ? 12 : 20) * sc;  // lead-in to name
        const padLead       = (tightBlock ? 8 : 14) * sc;   // measure-pass allowances
        const padSpec       = (tightBlock ? 10 : 18) * sc;
        const padWhere      = (tightBlock ? 40 : 49) * sc;
        const footMargin    = (tightBlock ? 44 : 64) * sc;  // frame foot to block bottom

        const headFamily = st.serifHeadline ? `${serifFamily}, Georgia, serif` : sans;
        const headWeight = st.serifHeadline ? (st.headline === "caps" ? 400 : 600) : (st.headWeight ?? 600);

        // Long names step down rather than wrap into a wall of type.
        const nameSize = (name.length > 26 ? 76 : name.length > 16 ? 94 : 116) * sc
          * (tightBlock ? 0.82 : 1);
        const headText =
          st.headline === "caps" || st.headline === "editorial" ? name.toUpperCase()
          : st.headline === "title" ? name.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
          : name;

        // Ground the type — only where it's actually sitting on a photograph.
        if (backdrop === "scrim") {
          // Tinted to the ground, so a navy brand gets a navy scrim and the
          // Classic look keeps its warmth without a special case. Runs from
          // whichever edge the type sits against.
          // On a Stack the whole photograph starts at 40%; the scrim stops
          // short of it so the print isn't tinted.
          const g = topType
            ? ctx.createLinearGradient(0, 0, 0, H * (stacked ? 0.39 : 0.52))
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
        const leadH = maker ? leadLineH * leadLines.length + padLead : 0;
        const nameH = lines.length * nameSize * 0.94;
        // The same breath between the name and the spec row whether a look
        // draws a rule in it or not — Cinematic's spec was landing on the
        // name's baseline.
        const ruleH = collapseTrail ? 0 : gapNameToSpec;
        ctx.font = `600 ${capSize}px ${sans}`;
        // Breaks only between facts, never inside one — "Flybridge Motor
        // Yacht" stays on a line together.
        const specLines = spec ? wrapSegments(ctx, specBits.map((b) => b.toUpperCase()), "   ·   ", maxW, 6 * sc) : [];
        const specLineH = capSize + 12 * sc;
        const specH = spec ? specLineH * specLines.length + padSpec : 0;
        const whereH = where ? padWhere : 0;
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
        // On a film the off-frame block is anchored to the FOOT of the frame and
        // grows upward, rather than hanging from the picture's lower edge. Two
        // reasons: hanging from the picture let a two-line name over a three-line
        // spec row push the location clean off the bottom of the screen, and with
        // the block now persistent it would jump between photographs of different
        // heights. Anchored, it sits still and can never leave the frame.
        // The anchor is unconditional: staying inside the frame beats clearing
        // the picture, because a location line that falls off the screen is gone
        // while one that sits close to the photograph is merely close. The window
        // is sized so an ordinary block clears it with room; only an unusually
        // tall one (a three-line vessel name over a four-line spec row) reaches
        // up as far as the print.
        const filmFloor = H - footMargin - blockH + firstAscent;
        let y = topType
          ? topStart
          : offFrame
            ? filmFloor
            : H - 140 * sc - blockH + (maker ? 0 : nameSize * 0.82);

        // The Marquee: the block is centred in the middle band, clear of the
        // hairlines. A block too tall for the band (a three-line name over a
        // long spec row) is scaled down about its centre rather than allowed
        // to spill onto the photographs or below the type-safe line. The
        // measure pass above is untouched — measureText ignores the transform.
        if (titleBand) {
          const pad = 28 * sc;
          const bandTop = titleBand.top + pad;
          const bandBottom = titleBand.bottom - pad;
          const mid = (bandTop + bandBottom) / 2;
          const fitK = Math.min(1, Math.max(1, bandBottom - bandTop) / Math.max(1, blockH));
          if (fitK < 1) {
            ctx.translate(anchor, mid);
            ctx.scale(fitK, fitK);
            ctx.translate(-anchor, -mid);
          }
          y = mid - blockH / 2 + firstAscent;
        }

        if (maker) {
          // The lead-in above the name — italic for Editorial, tracked caps
          // for the rest — one line or several, never past the edge.
          ctx.fillStyle = st.accent;
          ctx.font = leadIsItalic ? `italic 400 ${leadSize}px ${serifFamily}, Georgia, serif` : `600 ${leadSize}px ${sans}`;
          leadLines.forEach((ln, li) => put(ln, anchor, y + li * leadLineH, leadTrack));
          y += leadLineH * (leadLines.length - 1) + (leadIsItalic ? 46 * sc : capSize) + gapLeadToName + nameSize * 0.82;
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

        // The same distance from the name's baseline to the spec's, rule or no
        // rule — the rule sits halfway along it. Nothing follows a collapsed
        // free card, so it draws neither (and measured neither, above).
        if (!collapseTrail) {
          if (st.rule !== "none") {
            y += gapNameToSpec / 2;
            drawRule(anchor, y, leftAligned ? 108 * sc : 96 * sc, alpha, leftAligned);
            y += gapNameToSpec / 2;
          } else {
            y += gapNameToSpec;
          }
        }

        if (spec) {
          ctx.fillStyle = st.quiet;
          ctx.font = `600 ${capSize}px ${sans}`;
          specLines.forEach((ln, li) => put(ln, anchor, y + li * specLineH, 6 * sc));
          y += specLineH * (specLines.length - 1) + capSize + gapSpecTrail;
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
          // A wide wordmark (the YachtPics mark is 6.5:1) gets the width it
          // needs; a squarer brokerage crest keeps the 360px column.
          let lw = (aspect > 3 ? W * 0.62 : 360 * sc), lh = lw / aspect;
          const maxLh = 150 * sc;
          if (lh > maxLh) { lh = maxLh; lw = lh * aspect; }
          items.push({ h: lh + 44 * sc, draw: (y) => { ctx.globalAlpha = alpha * 0.96; ctx.drawImage(logo!, cx - lw / 2, y, lw, lh); ctx.globalAlpha = alpha; } });
        }
        const nameSize = 48 * sc;
        const personLine = (text: string) => ({ h: nameSize + 16 * sc, draw: (y: number) => {
          ctx.fillStyle = st.text;
          ctx.font = `${st.serifHeadline ? 500 : 400} ${nameSize}px ${endFamily}`;
          ctx.textAlign = "center";
          ctx.fillText(text, cx, y + nameSize * 0.8); ctx.textAlign = "left";
        } });
        const capsLine = (text: string, colour: string, size = capSize - 3 * sc, gap = 22 * sc) => ({ h: size + gap, draw: (y: number) => {
          ctx.fillStyle = colour; ctx.font = `600 ${size}px ${sans}`;
          fillTrackedCentered(ctx, text.toUpperCase(), cx, y + size, 7 * sc);
        } });
        const contactLine = (text: string) => ({ h: capSize + 48 * sc, draw: (y: number) => {
          ctx.fillStyle = st.accent; ctx.font = `500 ${capSize}px ${sans}`;
          fillTrackedCentered(ctx, text, cx, y + capSize + 26 * sc, 3 * sc);
        } });
        const contactFor = (c: BrokerCard) => {
          // Phone and site if we have them; the email if we don't. A call to
          // action with nothing under it is a door with no handle.
          const bits = [c.phone, c.website?.replace(/^https?:\/\//, "").replace(/\/$/, "")].filter(Boolean) as string[];
          if (bits.length === 0 && c.email) bits.push(c.email);
          return bits.join("   ·   ");
        };

        if (yp) {
          // Our card credits the broker first — the way Samantha's Facebook
          // posts do ("another great boat shot for…"), which is where most of
          // her clients have come from. A broker who sees a peer credited
          // asks how to get the same. Then the portal, then us.
          // A Studio reel may have no broker behind it — photographs off the
          // phone, nobody to credit. Then the card goes straight to the portal.
          if (broker) {
            items.push(capsLine("Photographed for", st.quiet, 22 * sc, 14 * sc));
            items.push(personLine(broker.name));
            if (broker.brokerage) items.push(capsLine(broker.brokerage, st.soft));
            const brokerContact = [broker.phone, broker.email].filter(Boolean).join("   ·   ");
            if (brokerContact) items.push(contactLine(brokerContact));
            items.push({ h: 72 * sc, draw: (y) => {
              ctx.fillStyle = "rgba(255,255,255,0.40)";
              ctx.fillRect(cx - 48 * sc, y + 36 * sc, 96 * sc, Math.max(1.5, 2.2 * sc));
            } });
          }
          items.push(capsLine("Powered by the YachtPics Portal", st.accent, 25 * sc, 18 * sc));
          items.push(contactLine(contactFor(card)));
          // The hook. Not what the portal is — what it did, and could do for
          // the broker watching. That's the line that gets the question asked.
          items.push({ h: capSize + 44 * sc, draw: (y) => {
            ctx.fillStyle = st.text; ctx.font = `italic 400 ${34 * sc}px ${serifFamily}, Georgia, serif`;
            ctx.textAlign = "center";
            ctx.fillText("Your listings, delivered like this.", cx, y + capSize + 40 * sc);
            ctx.textAlign = "left";
          } });
        } else {
          // The person: clearly secondary to the boat. Regular weight, and in
          // the serif looks the serif at its book weight rather than bold.
          if (card.name) items.push(personLine(card.name));
          if (card.brokerage) items.push(capsLine(card.brokerage, st.soft));
          const contact = contactFor(card);
          if (contact) items.push(contactLine(contact));
          // The invitation, with real air above it — it closes the card, it
          // doesn't crowd the contact line.
          items.push({ h: capSize + 44 * sc, draw: (y) => {
            ctx.fillStyle = st.quiet; ctx.font = `500 ${22 * sc}px ${sans}`;
            fillTrackedCentered(ctx, "REQUEST A PRIVATE SHOWING", cx, y + capSize + 40 * sc, 7 * sc);
          } });
        }

        const stackH = items.reduce((a, b) => a + b.h, 0);
        let y = (H - stackH) / 2;
        for (const it of items) { it.draw(y); y += it.h; }

        // Quiet credit line — the portal's own mark, the way a good house
        // signs its work. Redundant on our own card.
        if (!yp) {
          ctx.fillStyle = st.light ? "rgba(20,26,33,0.32)" : "rgba(255,255,255,0.30)";
          ctx.font = `500 ${18 * sc}px ${sans}`;
          fillTrackedCentered(ctx, "MADE WITH THE YACHTPICS PORTAL", cx, H - 60 * sc, 6 * sc);
        }
        ctx.restore();
      };

      /**
       * The Stack: three horizontal bands, one swapping per beat with a whip.
       *
       * The bands fill the whole height. There's no type in this phase, so
       * Instagram's safe zone doesn't apply — and three 1.7:1 bands show a
       * 3:2 photograph with only a sliver off the top and bottom, which is as
       * close to whole as a vertical frame can get three landscapes.
       */
      const stackTop = 0;
      const stackBottom = H;
      const stackGap = 6 * sc;
      const rowH = (stackBottom - stackTop - stackGap * 2) / 3;
      const rowRect = (r: number) => ({ x: 0, y: stackTop + r * (rowH + stackGap), w: W, h: rowH });

      /** The whole stack's opacity while a transition is carrying it in or out. */
      let stackAlpha = 1;

      type Rect = { x: number; y: number; w: number; h: number };

      /**
       * One photograph covering a band, shifted by (dx, dy), zoomed, at
       * `alpha`, optionally smeared along the axis it's moving on, and
       * optionally clipped to a sub-rectangle (for the wipe).
       */
      const drawBand = (
        index: number, r: Rect, dx: number, dy: number, zoom: number, alpha: number,
        smear: number, axis: "x" | "y", clip?: Rect,
      ) => {
        const bmp = bitmaps[index];
        if (!bmp) return;
        const base = Math.max(r.w / bmp.width, r.h / bmp.height) * zoom;
        const dw = bmp.width * base, dh = bmp.height * base;
        const x = r.x + (r.w - dw) / 2 + dx, y = r.y + (r.h - dh) / 2 + dy;
        ctx.save();
        ctx.beginPath();
        const c = clip ?? r;
        ctx.rect(Math.max(r.x, c.x), Math.max(r.y, c.y), Math.min(r.w, c.w), Math.min(r.h, c.h));
        ctx.clip();
        const a = stackAlpha * alpha;
        if (smear > 0.5) {
          // A directional smear — the frame is moving too fast to resolve.
          // Three copies spread along the motion axis; cheap and convincing.
          const sx = axis === "x" ? smear : 0, sy = axis === "y" ? smear : 0;
          ctx.globalAlpha = a * 0.36;
          ctx.drawImage(bmp, x - sx, y - sy, dw, dh);
          ctx.drawImage(bmp, x + sx, y + sy, dw, dh);
          ctx.globalAlpha = a * 0.5;
          ctx.drawImage(bmp, x, y, dw, dh);
        } else {
          ctx.globalAlpha = a;
          ctx.drawImage(bmp, x, y, dw, dh);
        }
        ctx.restore();
      };

      /** A stack run at `t` seconds into the run; `runEnd` is its hold. */
      const drawStack = (events: StackEvent[], runEnd: number, t: number, alpha: number) => {
        stackAlpha = alpha;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = st.ground;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        for (let r = 0; r < 3; r++) {
          const state = rowState(events, r, t);
          if (!state) continue;
          const rect = rowRect(r);
          const p = state.progress;
          // Each band drifts in over its whole life — the same push every
          // time, finishing just as it leaves — so it reads as intent rather
          // than a shuffle.
          const life = Math.max(0.3, (state.until ?? runEnd) - state.since);
          const settle = Math.min(1, (t - state.since) / life);
          const zoom = 1 + 0.06 * settle;
          if (p >= 1) {
            drawBand(state.index, rect, 0, 0, zoom, 1, 0, "x");
            continue;
          }
          // The swap, in the move this event was dealt.
          const prev = state.prevIndex;
          const e = whipEase(p);
          switch (state.move) {
            case "fade": {
              if (prev !== null) drawBand(prev, rect, 0, 0, 1.06, 1, 0, "x");
              drawBand(state.index, rect, 0, 0, zoom, ease(p), 0, "x");
              break;
            }
            case "wipe": {
              // A hard edge sweeping across the band, with a light seam.
              if (prev !== null) drawBand(prev, rect, 0, 0, 1.06, 1, 0, "x");
              const wx = rect.w * ease(p);
              drawBand(state.index, rect, 0, 0, zoom, 1, 0, "x", { x: rect.x, y: rect.y, w: wx, h: rect.h });
              if (p > 0.02 && p < 0.98) {
                ctx.save(); ctx.globalAlpha = stackAlpha * 0.6; ctx.fillStyle = "#ffffff";
                ctx.fillRect(rect.x + wx - 1.2 * sc, rect.y, 2.4 * sc, rect.h); ctx.restore();
              }
              break;
            }
            case "up":
            case "down": {
              // A vertical push inside the band — no smear, the band is short.
              const sign = state.move === "up" ? -1 : 1;
              if (prev !== null) drawBand(prev, rect, 0, sign * rect.h * e, 1.06, 1, 0, "y");
              drawBand(state.index, rect, 0, sign * rect.h * (e - 1), zoom, 1, 0, "y");
              break;
            }
            default: {
              // The whip, left or right, under a motion smear.
              const sign = state.move === "left" ? -1 : 1;
              const smear = 90 * sc * Math.sin(Math.PI * p);
              if (prev !== null) drawBand(prev, rect, sign * W * e, 0, 1.06, 1, smear, "x");
              drawBand(state.index, rect, sign * W * (e - 1), 0, zoom, 1, smear, "x");
            }
          }
        }
        // Hairline seams between the bands — the ground shows through the gap,
        // and a thin light rule keeps the three from reading as one collage.
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        for (let r = 1; r < 3; r++) ctx.fillRect(0, rowRect(r).y - stackGap, W, stackGap);
        ctx.restore();
        stackAlpha = 1;
      };

      /**
       * The Marquee: a split screen that stays put while things move inside it.
       *
       * Top band — the hero photographs, one at a time, cropped to fill the
       * band, each held for an equal share of the reel under the same slow
       * drift the brochure looks use (exteriors pull out, interiors push in),
       * dissolving softly into the next. `still` (Marquee Still): the cover
       * alone, cropped the same way, with no drift, zoom or crossfade at all.
       *
       * Middle band — the ground, with the title block centred on it (drawn
       * by drawTitle, so the fonts, casing and brand colours are the look's
       * own) and an accent hairline on its top and bottom edges. Static; the
       * type fades up over the first 0.6s and stays.
       *
       * Strip — every other photograph as a 4:3 tile, cropped to fill, with a
       * thin accent gap between tiles, sliding right to left at one constant
       * speed: the whole strip passes exactly once over the photo portion of
       * the reel. It is a loop, so the band is full from the first frame and
       * nothing jumps. Only the tiles that intersect the band are drawn.
       */
      const MQ_HERO_FADE = 1.0;
      const mqGap = Math.max(4, 8 * sc);
      const mqStripH = mq.bottom - mq.stripTop;
      const mqTileW = Math.round((mqStripH * 4) / 3);
      const mqPitch = mqTileW + mqGap;
      // Each strip photograph's 4:3 source crop, worked out once on first use.
      const mqCrops: { sx: number; sy: number; sw: number; sh: number }[] = [];
      const mqCrop = (i: number) => {
        const hit = mqCrops[i];
        if (hit) return hit;
        const bmp = bitmaps[i];
        if (!bmp) return null;
        const want = mqTileW / mqStripH;
        let sw = bmp.width, sh = bmp.height;
        if (sw / sh > want) sw = sh * want; else sh = sw / want;
        const c = { sx: (bmp.width - sw) / 2, sy: (bmp.height - sh) / 2, sw, sh };
        mqCrops[i] = c;
        return c;
      };

      const drawMarquee = (hero: number[], strip: number[], hold: number, local: number, alpha: number, still: boolean) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = st.ground;
        ctx.fillRect(0, 0, W, H);

        // Top band.
        const bandH = mq.heroEnd - mq.top;
        const hN = hero.length;
        if (hN > 0 && bandH > 0) {
          const seg = hold / hN;
          const xf = Math.min(MQ_HERO_FADE, seg * 0.4);
          const drawHero = (slot: number, a: number) => {
            const i = hero[slot];
            const bmp = bitmaps[i];
            if (!bmp || a <= 0) return;
            // The drift runs on through the next dissolve, so the photograph
            // never freezes while it is being carried out. A still band has
            // no drift: the cover sits at its plain cover crop throughout.
            let k = 1;
            if (!still) {
              const drift = ease((local - slot * seg) / (seg + xf));
              const out = isExterior(selectedPhotos[i]?.category);
              const from = out ? 1 + st.zoom : 1;
              const to = out ? 1 : 1 + st.zoom;
              k = from + (to - from) * drift;
            }
            // Cover the band; the source rectangle does the cropping and the
            // zoom, so nothing needs a clip.
            const scale = Math.max(W / bmp.width, bandH / bmp.height) * k;
            const sw = W / scale, sh = bandH / scale;
            ctx.globalAlpha = alpha * a;
            ctx.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, mq.top, W, bandH);
          };
          const j = still ? 0 : Math.min(hN - 1, Math.max(0, Math.floor(local / seg)));
          const into = local - j * seg;
          if (!still && j > 0 && into < xf) {
            drawHero(j - 1, 1);
            drawHero(j, ease(into / xf));
          } else {
            drawHero(j, 1);
          }
        }

        // Strip.
        const m = strip.length;
        if (m > 0 && mqStripH > 0) {
          const loop = m * mqPitch;
          const speed = hold > 0 ? loop / hold : 0;
          let off = (local * speed) % loop;
          if (off < 0) off += loop;
          // The accent under the whole band is what shows in the gaps.
          ctx.globalAlpha = alpha;
          ctx.fillStyle = st.accent;
          ctx.fillRect(0, mq.stripTop, W, mqStripH);
          let n = Math.floor(off / mqPitch);
          let x = n * mqPitch - off;
          while (x < W) {
            if (x + mqTileW > 0) {
              const i = strip[n % m];
              const bmp = bitmaps[i];
              const c = mqCrop(i);
              if (bmp && c) ctx.drawImage(bmp, c.sx, c.sy, c.sw, c.sh, x, mq.stripTop, mqTileW, mqStripH);
            }
            x += mqPitch;
            n++;
          }
        }

        // The middle band's edges: accent hairlines at the title's rule
        // weight, so they survive the encode.
        const hl = Math.max(1.5, 2.2 * sc);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = st.accent;
        ctx.fillRect(0, mq.heroEnd - hl / 2, W, hl);
        ctx.fillRect(0, mq.stripTop - hl / 2, W, hl);
        ctx.restore();

        drawTitle(alpha * ease(local / 0.6));
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

      // The title: up quickly over the opening push, then held — a name
      // that's only legible for a second reads as a glitch, not a title.
      // Gone just before the cut. A punch look brings it in faster.
      const titleAlpha = (local: number, hold: number) => {
        const quick = st.cut === "punch";
        const tIn = ease((local - (quick ? 0.15 : 0.3)) / (quick ? 0.35 : 0.6));
        const tOut = 1 - ease((local - (hold - (quick ? 0.35 : 0.7))) / (quick ? 0.3 : 0.6));
        return Math.min(tIn, tOut);
      };

      /**
       * One unit of the film, whole-frame, at the opacity it's given. Every
       * transition is built from two of these — the outgoing and the incoming
       * — so a stack run, a photograph and the end card all cut the same way.
       */
      const drawUnit = (k: number, alpha: number, t: number) => {
        const u = units[k];
        const local = t - starts[k];
        if (u.kind === "photo") {
          // In a Stack, every full-frame photograph — hero included — is
          // shown whole: a horizontal floats complete on a soft plate, a
          // vertical fills the frame.
          const whole = stacked && !u.burst ? true : undefined;
          if (u.placed && u.placed.length > 0) {
            // A wall: every photograph that has landed so far stays put, and
            // only the newest one moves. Drawn oldest first so the arriving
            // one passes over the settled ones, never under.
            u.placed.forEach((pp: PlacedPhoto, idx: number) => {
              const arriving = idx === u.placed!.length - 1;
              drawPlaced(pp, arriving ? local : Infinity, alpha, arriving ? pp.move : "fade", pp.arrive);
            });
          } else {
            drawPhoto(u.index, local, u.hold, alpha, whole, u.slot);
          }
          // Where the type lives off the picture — Gallery's page, Cinematic's
          // bar — it stays up for the whole reel: every frame a captioned
          // print, rather than a name that leaves and a page left empty.
          // On a full-bleed look it belongs to the opening frame only.
          // Wherever the type lives OFF the picture — Gallery's page, Cinematic's
          // bar — it stays up for the whole film, on a reel and on a film alike.
          // It used to be reels only, which left a Gallery film showing its name
          // on frame one and then a third of the page empty for the rest.
          const persistent = backdrop === "inset" || backdrop === "letterbox";
          if (k === 0) {
            const a = persistent ? ease((local - 0.3) / 0.6) : titleAlpha(local, u.hold);
            drawTitle(a * alpha);
          } else if (persistent) {
            drawTitle(alpha);
          }
          // Burst frames are too quick to read a caption on.
          // A wall has three photographs on screen; one caption could only be
          // ambiguous, so the wall goes uncaptioned.
          else if (!u.burst && !stacked && !u.placed) drawRoomLabel(u.index, local, u.hold, alpha, u.slot !== null && u.slot !== undefined);
        } else if (u.kind === "stack") {
          drawStack(u.events, u.hold, local, alpha);
        } else if (u.kind === "marquee") {
          drawMarquee(u.hero, u.strip, u.hold, local, alpha, !!u.still);
        } else {
          drawEndCard(alpha);
        }
      };

      for (let f = 0; f < totalFrames; f++) {
        if (cancelRef.current) { await output.cancel(); setPhase("idle"); return; }
        const t = f / FPS;
        ctx.globalAlpha = 1;
        ctx.fillStyle = st.ground;
        ctx.fillRect(0, 0, W, H);

        // Which unit owns this instant — and are we inside the transition
        // that brought it in?
        let k = units.length - 1;
        while (k > 0 && t < starts[k]) k--;
        const tr = k > 0 ? transitions[k - 1] : null;
        if (tr && tr.dur > 0 && t < starts[k] + tr.dur) {
          const p = (t - starts[k]) / tr.dur;
          // Do the two frames cover the same pixels? A photograph placed in a
          // third does not, and the dissolve has to fade both at once when so.
          const placedAt = (j: number) => {
            const u = units[j];
            if (u.kind !== "photo") return false;
            if (u.placed && u.placed.length > 0) return true;
            return u.slot !== null && u.slot !== undefined;
          };
          const disjoint = placedAt(k) || placedAt(k - 1);
          drawTransition(ctx, W, H, tr, p, st.ground, (a) => drawUnit(k - 1, a, t), (a) => drawUnit(k, a, t), disjoint);
        } else {
          drawUnit(k, 1, t);
        }

        // The flash on a hard cut — white, a tenth of a second, gone.
        const flash = flashAlpha(t, flashes);
        if (flash > 0) {
          ctx.save();
          ctx.globalAlpha = flash;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, W, H);
          ctx.restore();
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
      // What was made, not what was selected: the look, the shape and the
      // running time of the film that actually exists.
      track("render", {
        format,
        look: styleKey,
        reelLength: format === "reel" ? length : null,
        fit,
        photoCount: selectedPhotos.length,
        seconds: Math.round(total),
        ypBrand,
        renderMs: Date.now() - startedAt,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong while rendering.");
      setPhase("error");
    } finally {
      // The render is over — the blob exists, or it was cancelled or failed.
      // Release the decoded photographs, the logo and the backdrop plates now
      // rather than whenever the collector gets round to half a gigabyte.
      for (let i = 0; i < bitmaps.length; i++) {
        try { bitmaps[i].close(); } catch { /* already released */ }
      }
      bitmaps.length = 0;
      if (logo) { try { logo.close(); } catch { /* already released */ } logo = null; }
      for (let i = 0; i < backdropOrder.length; i++) {
        const c = backdropCache.get(backdropOrder[i]);
        if (c) { c.width = 0; c.height = 0; }
      }
      backdropCache.clear();
      backdropOrder.length = 0;
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
    if (!listingId || selectedPhotos.length === 0) return;
    setWriting(true);
    setCopyError("");
    try {
      const res = await fetch(`/api/listings/${listingId}/reel-copy`, {
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
      track("copy_caption");
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
    if (!result || locked || !listing || !listingId) return;
    setSendingPhone(true);
    setPhoneError("");
    setPhone(null);
    setPhonePct(0);
    try {
      const filename = `${safeName(listing.vessel_name)}-${result.format}.mp4`;
      const file = new File([result.blob], filename, { type: "video/mp4" });
      const up = await uploadVideoToPrivateBucket({
        file,
        target: { listingId, share: true },
        onProgress: setPhonePct,
      });
      if (!up.ok) throw new Error(up.error);

      const res = await fetch(`/api/listings/${listingId}/reel-link`, {
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
      track("send_to_phone");
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : "Couldn't send it to your phone.");
    } finally {
      setSendingPhone(false);
    }
  }

  /**
   * Save it to the camera roll.
   *
   * A web page cannot write to the photo library, but the share sheet can:
   * on iOS, navigator.share with a video file offers "Save Video", which is
   * how a reel made on a phone gets onto the phone it will be posted from.
   * Feature-detected — on a desktop browser that can't share a file the
   * button never appears and Download does the job.
   */
  async function saveToCameraRoll() {
    if (!result || locked) return;
    const filename = `${safeName(listing.vessel_name)}-${result.format}.mp4`;
    try {
      await navigator.share({
        files: [new File([result.blob], filename, { type: result.blob.type || "video/mp4" })],
        title: listing.vessel_name ?? "Reel",
      });
      track("save_to_camera_roll");
    } catch { /* the sheet was dismissed — nothing to report */ }
  }

  function download() {
    if (!result || locked) return;
    const a = document.createElement("a");
    a.href = result.url;
    a.download = `${safeName(listing?.vessel_name)}-${result.format}.mp4`;
    a.click();
    track("download");
  }

  async function addToListing() {
    if (!result || locked || !listing || !listingId) return;
    setAdding(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const file = new File([result.blob], `${safeName(listing.vessel_name)}-film.mp4`, { type: "video/mp4" });
      const res = await uploadListingVideo({ supabase, file, listingId, uploadedBy: user.id, displayOrder: videoCount });
      if (!res.ok) throw new Error(res.error);
      await supabase.from("videos").update({ title: `${listing.vessel_name ?? "Listing"} — The Film` }).eq("id", res.video.id);
      setVideoCount((n) => n + 1);
      setAdded(true);
      track("added_to_listing");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Couldn't add the film to the listing.");
    } finally {
      setAdding(false);
    }
  }

  // ── UI ──────────────────────────────────────────────────────────────────

  const busy = phase === "loading" || phase === "rendering";
  // Whether this browser can hand a video file to the share sheet at all.
  const canSaveToCameraRoll =
    !!result && typeof navigator !== "undefined" && typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [new File([result.blob], "reel.mp4", { type: "video/mp4" })] });
  const seconds = Math.round(timeline.total);
  const promoOn = reelPromoActive();
  const style = applyBrand(REEL_STYLES[styleKey], brand);
  const brandOn = !!(brand.accent || brand.ground);
  // Nothing to caption if the photos were never categorised.
  const labelsPossible = selectedPhotos.some((p, i) => i > 0 && !!roomLabel(p.category));

  /**
   * Which looks can carry a room caption on a 9:16 reel.
   *
   * Cinematic and Gallery keep type off the photograph, so their caption
   * belongs in the ground — and on a reel that band is already holding the
   * title for the whole film (the picture's foot is Instagram's caption, not
   * ours). Two pieces of type, one band. Until that's resolved the honest
   * thing is to say so rather than show a switch that does nothing.
   *
   * Stack moves too fast to read one at all. Marquee (and Marquee Still) has
   * several photographs on screen and most of them moving, so a caption
   * couldn't say which.
   */
  const labelsUnavailable: string | null =
    format !== "reel"
      ? null
      : styleKey === "stack"
        ? "Stack moves too fast for room labels."
        : isMarquee(styleKey)
          ? `${REEL_STYLES[styleKey].name} keeps several photographs moving at once, so there are no room labels.`
        : styleKey === "cinematic" || styleKey === "gallery"
          ? `${REEL_STYLES[styleKey].name} keeps all type off the photograph, and on a reel that band is holding the title — so no room labels here.`
          : null;

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
      {/* The listing's own heading. The Studio writes its own above this. */}
      {listingId && (
        <div className="mb-6">
          <Link href={`/dashboard/listings/${listingId}`} className="text-ink-400 hover:text-ink-600 text-sm transition-colors">← Back to Listing</Link>
          <h1 className="text-display text-ink-900 mt-1">Listing Reel</h1>
          <p className="text-ink-500 mt-1 text-sm">
            Turn this listing&rsquo;s photos into a finished video — a vertical reel for Instagram and Facebook, or a widescreen film to send to a buyer. Nothing to edit.
          </p>
        </div>
      )}

      {locked && (
        <div className="mb-5 px-4 py-3 rounded-ctl text-sm bg-danger-50 border border-danger-200 text-danger-700">
          <span className="font-semibold">This is a preview.</span>{" "}
          Your plan has ended — subscribe to download clean, watermark-free video.{" "}
          <Link href="/dashboard/billing" className="font-semibold underline">Choose a plan →</Link>
        </div>
      )}

      {promoOn && listingId && (
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
      <p className="text-xs text-ink-400 mb-5">{s.hint} · up to {cap} photos · about {seconds} seconds</p>
      {format === "reel" && length === "full" && seconds < 30 && chosen.length < cap && (
        <p className="text-xs text-ink-400 -mt-4 mb-5">Reels reach furthest between 30 and 60 seconds — add a few more photos, or switch to Short.</p>
      )}

      {/* Look — complete points of view, not colour swaps. Eight on a reel,
          five on a film (Stack, Marquee and Marquee Still are reel-only). */}
      <div className="mb-5">
        <p className="label-caps text-ink-500 mb-2">Look</p>
        <div className={`grid grid-cols-2 sm:grid-cols-3 gap-2 ${looks.length >= 7 ? "lg:grid-cols-4" : looks.length === 6 ? "lg:grid-cols-6" : "lg:grid-cols-5"}`}>
          {looks.map((k) => {
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

      {/* Admin only: brand the film as YachtPics — our own advertising. */}
      {isAdmin && (
        <div className="mb-5 rounded-card border border-accent-500/40 bg-accent-500/5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <p className="label-caps text-ink-500">YachtPics ad</p>
            <button
              onClick={() => { setYpBrand((v) => !v); setResult(null); setPhase("idle"); }}
              disabled={busy}
              className={chip(ypBrand)}
            >
              {ypBrand ? "Branded as YachtPics" : "Brand as YachtPics"}
            </button>
            {ypBrand && (
              <>
                <span className="text-xs text-ink-400">Number on the card:</span>
                {(Object.keys(YACHTPICS_PHONES) as YpPhone[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => { setYpPhone(k); setResult(null); setPhase("idle"); }}
                    disabled={busy}
                    className={chip(ypPhone === k)}
                  >
                    {YACHTPICS_PHONES[k].label} · {YACHTPICS_PHONES[k].phone}
                  </button>
                ))}
              </>
            )}
          </div>
          <p className="text-xs text-ink-400 mt-1.5">
            Our logo and colours; &ldquo;Photographed by YachtPics&rdquo; over the opening frame unless you write a headline. The end card credits the broker first — name, brokerage, phone, email — then &ldquo;Powered by the YachtPics Portal&rdquo;, the number you pick, and &ldquo;Your listings, delivered like this.&rdquo; For our own Instagram and Facebook — download it or send it to your phone; it can&rsquo;t be added to the listing.
          </p>
        </div>
      )}

      {/* Options */}
      <div className="grid sm:grid-cols-2 gap-4 mb-5">
        {/* Length — the reel's call alone; the film has one timing. */}
        {format === "reel" && (
          <div>
            <p className="label-caps text-ink-500 mb-2">Length</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => chooseLength("full")} disabled={busy} className={chip(length === "full")}>Full — about 40s, up to 27 photos</button>
              <button onClick={() => chooseLength("long")} disabled={busy} className={chip(length === "long")}>Long — about 55s, up to 40 photos</button>
              <button onClick={() => chooseLength("short")} disabled={busy} className={chip(length === "short")}>Short — about 20s, up to 12 photos</button>
            </div>
            <p className="text-xs text-ink-400 mt-1.5">Reels between 30 and 60 seconds reach the furthest. Short suits a quick teaser.</p>
          </div>
        )}
        <div>
          <p className="label-caps text-ink-500 mb-2">Framing</p>
          {styleKey === "cinematic" && format === "reel" ? (
            // The letterbox IS the framing — the band is always filled.
            <p className="text-xs text-ink-400">Cinematic fills its letterbox band; there&rsquo;s nothing to choose here.</p>
          ) : styleKey === "stack" && format === "reel" ? (
            <p className="text-xs text-ink-400">Stack fills three bands, each with a whole photograph — nothing to choose here.</p>
          ) : isMarquee(styleKey) && format === "reel" ? (
            <p className="text-xs text-ink-400">{REEL_STYLES[styleKey].name} crops each photograph to fill its band — the hero across the top, the rest as tiles in the strip below. Nothing to choose here.</p>
          ) : styleKey === "gallery" ? (
            // The inset always shows the complete photograph.
            <p className="text-xs text-ink-400">Gallery shows every photograph complete, with a margin — nothing is cropped.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => { setFit("whole"); setResult(null); setPhase("idle"); }} disabled={busy} className={chip(fit === "whole")}>Show the whole photo</button>
                <button onClick={() => { setFit("fill"); setResult(null); setPhase("idle"); }} disabled={busy} className={chip(fit === "fill")}>Fill the frame</button>
              </div>
              <p className="text-xs text-ink-400 mt-1.5">
                {fit === "whole"
                  ? "Every photograph shown complete, on a soft backdrop \u2014 nothing cropped away."
                  : format === "reel"
                    ? "Cinematic crop with a slow push-in. On a vertical reel this cuts most of a horizontal frame."
                    : "Cinematic crop with a slow push-in."}
              </p>
            </>
          )}
        </div>
        <div>
          <p className="label-caps text-ink-500 mb-2">On the title card</p>
          <div className="flex flex-wrap gap-2">
            {/* Price and location are vessel fields — a free subject has neither. */}
            {!freeSubject && (
              <>
                <button onClick={() => { setShowPrice((v) => !v); setResult(null); setPhase("idle"); }} disabled={busy || !listing.asking_price} className={chip(showPrice && !!listing.asking_price)}>
                  {listing.asking_price ? `Price ${showPrice ? "on" : "off"}` : "No price set"}
                </button>
                <button onClick={() => { setShowLocation((v) => !v); setResult(null); setPhase("idle"); }} disabled={busy || !listing.location} className={chip(showLocation && !!listing.location)}>
                  {listing.location ? `Location ${showLocation ? "on" : "off"}` : "No location set"}
                </button>
              </>
            )}
            {!labelsUnavailable && (
              <button onClick={() => { setShowLabels((v) => !v); setResult(null); setPhase("idle"); }} disabled={busy || !labelsPossible} className={chip(showLabels && labelsPossible)}>
                {labelsPossible ? `Room labels ${showLabels ? "on" : "off"}` : "No categories set"}
              </button>
            )}
          </div>
          <p className="text-xs text-ink-400 mt-1.5">
            {freeSubject
              ? "The title and the two lines under it come from the form above."
              : "Year, builder, length and staterooms always appear when they\u2019re filled in."}
            {labelsPossible && !labelsUnavailable && " Room labels name each space in the corner of its photo."}
            {labelsUnavailable && ` ${labelsUnavailable}`}
          </p>
        </div>
      </div>

      {/* Photo picker */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <p className="label-caps text-ink-500">Photos · {chosen.length} of {cap}</p>
          <div className="flex gap-3">
            <button onClick={() => { setChosen(photos.slice(0, cap).map((p) => p.id)); setResult(null); setPhase("idle"); }} disabled={busy} className="text-xs font-semibold text-accent-700 hover:underline">First {cap}</button>
            <button onClick={() => { setChosen([]); setResult(null); setPhase("idle"); }} disabled={busy} className="text-xs font-semibold text-ink-400 hover:underline">Clear</button>
          </div>
        </div>
        <p className="text-xs text-ink-400 mt-1.5 mb-2">Tap photos in the order you want them to play — the number shows each one&rsquo;s place, and the first gets the title. Tap again to remove one. &ldquo;First {cap}&rdquo; takes them in slideshow order, cover first.</p>
        <div className="grid grid-cols-5 sm:grid-cols-8 gap-1.5">
          {photos.map((p) => {
            const on = chosen.includes(p.id);
            const idx = selectedPhotos.findIndex((q) => q.id === p.id);
            return (
              <button key={p.id} onClick={() => togglePhoto(p.id)} disabled={busy} title={p.category ?? p.filename ?? ""}
                className={`relative aspect-square overflow-hidden rounded-sm border-2 transition-colors bg-ink-100 ${on ? "border-accent-500" : "border-transparent opacity-55 hover:opacity-90"}`}>
                {p.previewUrl && <RetryImg src={p.previewUrl} alt="" loading="lazy" className="w-full h-full object-cover" />}
                {on && <span className="absolute top-0.5 left-0.5 text-[10px] font-semibold bg-ink-950/80 text-white rounded px-1">{idx + 1}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Words — written from the frames actually chosen. Both the writing and
          the caption come from the listing's own copy service, so a Studio reel
          — which has no listing behind it — does without them. */}
      {listingId && (
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
      )}

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
                  {/* Already on the phone that made it: the share sheet is the
                      only door to the camera roll, and only iOS opens it. */}
                  {canSaveToCameraRoll && (
                    <button onClick={saveToCameraRoll}
                      className="bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-6 py-2.5 rounded-ctl transition-colors">
                      📲 Save to camera roll
                    </button>
                  )}
                  {/* The pickup link is signed against the listing, so it only
                      exists where there is one. */}
                  {listingId && (
                    <button onClick={sendToPhone} disabled={sendingPhone}
                      className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold px-6 py-2.5 rounded-ctl transition-colors">
                      {sendingPhone ? `Sending… ${phonePct}%` : "📱 Send to my phone"}
                    </button>
                  )}
                  {listingId && result.format === "film" && !ypBrand && (
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

            {listingId && result.format === "film" && !added && !locked && (
              <p className="text-xs text-ink-400 text-center mt-2">Adding it puts the film at the front of your client slideshow and in Send to Client.</p>
            )}
            {result.format === "reel" && (
              <p className="text-xs text-ink-400 text-center mt-2">Post it from your phone: save the file, open Instagram → Reel, pick it, then add audio and your caption.</p>
            )}
          </>
        )}
      </div>

      {/* Caption helper — reuse the Social Post caption on the same listing */}
      {listingId && (
        <p className="text-xs text-ink-400 mt-4">
          Need a caption? <Link href={`/dashboard/listings/${listingId}/social`} className="text-accent-700 font-semibold hover:underline">Social Post</Link> writes one with hashtags for this listing.
        </p>
      )}
    </div>
  );
}