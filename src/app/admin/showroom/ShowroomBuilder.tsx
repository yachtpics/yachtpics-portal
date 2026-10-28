"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Cormorant_Garamond } from "next/font/google";
import {
  DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createClient } from "@/lib/supabase/client";
import RetryImg from "@/components/RetryImg";
import { orderPhotos } from "@/lib/photoOrder";
import { MUSIC_BLURB, MUSIC_LABEL, seedFromString, type MusicMood } from "@/lib/reelMusic";
import {
  pickShowroomPhotos, showroomSpecLine, SHOWROOM_PICK_DEFAULT, SHOWROOM_PICK_MAX, SHOWROOM_PICK_MIN, type ShowroomPhoto,
} from "@/lib/showroomPick";
import {
  estimateShowroomBytes, FAT32_MAX_BYTES, fetchBitmap, formatBytes, formatRunTime, loadLogoBitmap, renderShowroom,
  showroomTimeline, SHOWROOM_SIZES, type BoatTransition, type LogoCorner, type ShowroomResolution, type ShowroomSlide,
} from "@/lib/showroomRender";
import { photoDrawUrls, signOriginalInBrowser } from "@/lib/photoStoreClient";

// The reel title face (ReelMaker's Cormorant Garamond).
const serif = Cormorant_Garamond({ subsets: ["latin"], weight: ["600"], display: "swap" });

export type ShowroomBrokerage = { id: string; name: string };
export type ShowroomBroker = {
  id: string;
  name: string;
  brokerageId: string | null;
  brokerageName: string | null;
  brokerageLogoUrl: string | null;
  logoUrl: string | null;
};

type Boat = {
  id: string;
  name: string;
  year: number | null;
  length_ft: string | number | null;
  make: string | null;
  model: string | null;
  brokerName: string;
  /** photographed_at, else created_at. */
  shotAt: string;
  heroId: string | null;
  manual: boolean;
  photos: ShowroomPhoto[]; // listing order
  count: number;
  picked: string[]; // play order
  included: boolean;
  open: boolean;
  /** The pick the add/swap panel will replace; null = add to the end. */
  swapId: string | null;
};

const RECENT_DAYS = 120;
// Calm, Elegant and Coastal suit a lobby; the rest are there if wanted.
const MUSIC_MENU: MusicMood[] = ["calm", "elegant", "coastal", "sail", "cinematic", "upbeat", "lift", "coastal_drive", "groove"];
const CORNERS: { key: LogoCorner; label: string }[] = [
  { key: "br", label: "Bottom right" }, { key: "bl", label: "Bottom left" },
  { key: "tr", label: "Top right" }, { key: "tl", label: "Top left" },
];

const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "Showroom";
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function ShowroomBuilder({ brokerages, brokers }: { brokerages: ShowroomBrokerage[]; brokers: ShowroomBroker[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [boats, setBoats] = useState<Boat[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [thumbsBig, setThumbsBig] = useState<Record<string, string>>({});
  const [holdSec, setHoldSec] = useState(5);
  const [resolution, setResolution] = useState<ShowroomResolution>("1080");
  const [transition, setTransition] = useState<BoatTransition>("dip");
  const [corner, setCorner] = useState<LogoCorner>("br");
  const [tagline, setTagline] = useState("");
  const [music, setMusic] = useState<"off" | MusicMood>("off");
  const [autoLogo, setAutoLogo] = useState<string | null>(null);
  const [brandName, setBrandName] = useState("");
  const [fileBase, setFileBase] = useState("Showroom");
  const [uploadedLogo, setUploadedLogo] = useState<File | null>(null);
  const [uploadedPreview, setUploadedPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "rendering" | "done" | "error">("idle");
  const [pct, setPct] = useState(0);
  const [stage, setStage] = useState("");
  const [result, setResult] = useState<{ url: string; filename: string; seconds: number; notes: string[] } | null>(null);
  const [renderError, setRenderError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cancelRef = useRef(false);
  const loadSeq = useRef(0);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  useEffect(() => () => { if (uploadedPreview) URL.revokeObjectURL(uploadedPreview); }, [uploadedPreview]);
  useEffect(() => {
    if (phase !== "rendering") return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [phase]);
  // Stop a render if the page goes away.
  useEffect(() => () => { cancelRef.current = true; }, []);

  const stale = () => { if (phase === "done" || phase === "error") setPhase("idle"); };

  async function loadSource(value: string) {
    const seq = ++loadSeq.current;
    setSource(value);
    setBoats([]); setThumbs({}); setThumbsBig({}); setLoadError(""); setAutoLogo(null); setPhase("idle");
    if (result) { URL.revokeObjectURL(result.url); setResult(null); }
    if (!value) return;
    const [kind, id] = value.split(":");
    const members = kind === "b" ? brokers.filter((b) => b.brokerageId === id) : brokers.filter((b) => b.id === id);
    const me = kind === "u" ? members[0] : null;
    const bkName = kind === "b" ? brokerages.find((b) => b.id === id)?.name ?? "Showroom" : me?.name ?? "Showroom";
    setBrandName(kind === "b" ? bkName : me?.brokerageName || me?.name || "");
    setFileBase(bkName);
    setAutoLogo(members.find((m) => m.brokerageLogoUrl)?.brokerageLogoUrl ?? members.find((m) => m.logoUrl)?.logoUrl ?? null);
    if (!members.length) { setLoadError(kind === "b" ? "No brokers in this brokerage yet." : "Broker not found."); return; }
    const nameOf: Record<string, string> = {};
    members.forEach((m) => { nameOf[m.id] = m.name; });
    setLoading(true);
    try {
      const { data: ls, error: lErr } = await supabase.from("listings")
        .select("id, broker_id, vessel_name, year, length_ft, make, model, photographed_at, created_at, hero_photo_id, photo_order_manual")
        .in("broker_id", members.map((m) => m.id)).eq("status", "active");
      if (lErr) throw new Error(lErr.message);
      type L = { id: string; broker_id: string; vessel_name: string | null; year: number | null; length_ft: string | number | null; make: string | null; model: string | null; photographed_at: string | null; created_at: string; hero_photo_id: string | null; photo_order_manual: boolean | null };
      const listings = ((ls ?? []) as L[])
        .map((l) => ({ l, shotAt: l.photographed_at || l.created_at }))
        .sort((a, b) => (Date.parse(b.shotAt) || 0) - (Date.parse(a.shotAt) || 0));
      // Photos per listing (separately — a brokerage's photos together pass Supabase's 1000-row page).
      const photoLists = await Promise.all(listings.map(({ l }) =>
        supabase.from("photos").select("id, storage_path, filename, category, display_order, storage_backend, derivatives_at")
          .eq("listing_id", l.id).eq("is_visible", true).order("display_order").limit(2000)
          .then((r) => (r.data ?? []) as ShowroomPhoto[])));
      if (seq !== loadSeq.current) return;
      const cutoff = Date.now() - RECENT_DAYS * 86400_000;
      const next: Boat[] = listings.map(({ l, shotAt }, i) => {
        const manual = l.photo_order_manual === true;
        const photos = orderPhotos(photoLists[i], { manual, heroId: l.hero_photo_id });
        return {
          id: l.id,
          name: l.vessel_name?.trim() || [l.year, l.make, l.model].filter(Boolean).join(" ") || "Untitled",
          year: l.year, length_ft: l.length_ft, make: l.make, model: l.model,
          brokerName: nameOf[l.broker_id] ?? "",
          shotAt,
          heroId: l.hero_photo_id,
          manual,
          photos,
          count: SHOWROOM_PICK_DEFAULT,
          picked: pickShowroomPhotos(photos, { count: SHOWROOM_PICK_DEFAULT, heroId: l.hero_photo_id, manual }),
          included: photos.length > 0 && (Date.parse(shotAt) || 0) >= cutoff,
          open: false,
          swapId: null,
        };
      });
      setBoats(next);
      setLoading(false);
      // Thumbnails: 200 px for the strips, 400 px as RetryImg's fallback — a few listings at a time.
      for (let i = 0; i < next.length; i += 3) {
        const batch = next.slice(i, i + 3);
        const get = (listingId: string, width: number) =>
          fetch("/api/thumbs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId, width }) })
            .then((r) => (r.ok ? r.json() : { urls: {} }))
            .then((j) => (j?.urls ?? {}) as Record<string, string>)
            .catch(() => ({} as Record<string, string>));
        const [small, big] = await Promise.all([
          Promise.all(batch.map((b) => get(b.id, 200))),
          Promise.all(batch.map((b) => get(b.id, 400))),
        ]);
        if (seq !== loadSeq.current) return;
        setThumbs((prev) => Object.assign({}, prev, ...small));
        setThumbsBig((prev) => Object.assign({}, prev, ...big));
      }
    } catch (e) {
      if (seq === loadSeq.current) setLoadError(e instanceof Error ? e.message : "Couldn’t load the listings.");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }

  const update = (id: string, patch: (b: Boat) => Partial<Boat>) => {
    setBoats((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch(b) } : b)));
    stale();
  };
  const moveBoat = (from: number, to: number) => {
    if (to < 0 || to >= boats.length) return;
    setBoats((bs) => arrayMove(bs, from, to));
    stale();
  };
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setBoats((bs) => arrayMove(bs, bs.findIndex((b) => b.id === active.id), bs.findIndex((b) => b.id === over.id)));
    stale();
  }

  const inPlay = boats.filter((b) => b.included && b.picked.length > 0);
  const photoCount = inPlay.reduce((n, b) => n + b.picked.length, 0);
  const estimate = photoCount ? showroomTimeline(inPlay.map((b) => b.picked.length), holdSec, transition).total : 0;
  const logoSrc = uploadedPreview ?? autoLogo;
  const spec = SHOWROOM_SIZES[resolution];
  const estBytes = estimateShowroomBytes(estimate, resolution, music !== "off");
  const tooBigForUsb = estBytes > FAT32_MAX_BYTES;
  const longLoop = estimate > spec.warnSec;

  async function render() {
    if (!photoCount || !canvasRef.current) return;
    if ((longLoop || tooBigForUsb) && !window.confirm([
      longLoop ? `This loop runs ${formatRunTime(estimate)} — over ${spec.warnSec / 60} minutes at ${spec.label}. It will take a long time to render.` : "",
      tooBigForUsb ? `The file could be up to ${formatBytes(estBytes)}. Many USB sticks (FAT32) can’t hold a file over 4 GB.` : "",
      "Start anyway?",
    ].filter(Boolean).join("\n\n"))) return;
    cancelRef.current = false;
    setPhase("rendering"); setPct(0); setStage("Preparing"); setRenderError("");
    if (result) { URL.revokeObjectURL(result.url); setResult(null); }
    const notes: string[] = [];
    let logo: ImageBitmap | null = null;
    try {
      if (uploadedLogo) logo = await loadLogoBitmap(uploadedLogo);
      else if (autoLogo) logo = await loadLogoBitmap(autoLogo);
    } catch {
      notes.push("The logo couldn’t be loaded, so the cards show the name instead and there’s no corner logo.");
      logo = null;
    }
    const slides: ShowroomSlide[] = [];
    const is4k = resolution === "4k";
    const photoEdge = spec.photoEdge;
    inPlay.forEach((b, bi) => {
      const byId: Record<string, ShowroomPhoto> = {};
      b.photos.forEach((p) => { byId[p.id] = p; });
      b.picked.forEach((pid, j) => {
        const p = byId[pid];
        if (!p) return;
        slides.push({
          boat: bi,
          title: j === 0 ? { name: b.name, line: showroomSpecLine(b) } : undefined,
          load: async () => {
            // 1080p, as ReelMaker does: a 2400 px rendition first (a fraction
            // of the download), the original if that fails. 4K: Supabase
            // transforms stop at 2500 px, so always the original (signed for
            // an hour), decoded down to 4400 px.
            // Originals on R2 (Oct 28): src/lib/photoStoreClient.ts picks the
            // links (resized first where possible, then the original).
            if (!is4k) {
              const candidates = await photoDrawUrls(supabase, p, 2400, { quality: 85 });
              for (let k = 0; k < candidates.length; k++) {
                try { return await fetchBitmap(candidates[k], photoEdge); } catch { /* next */ }
              }
              throw new Error("No link for a photo.");
            }
            const orig = await signOriginalInBrowser(supabase, p.storage_path, 3600);
            if (!orig) throw new Error("No link for a photo.");
            return fetchBitmap(orig, photoEdge);
          },
        });
      });
    });
    const brandSans = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim();
    const sans = `${brandSans ? `${brandSans}, ` : ""}Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    try {
      const out = await renderShowroom({
        canvas: canvasRef.current,
        resolution,
        slides,
        boats: inPlay.map((b) => b.picked.length),
        holdSec,
        transition,
        logo,
        corner,
        brandName,
        tagline: tagline.trim(),
        fonts: { serif: `${serif.style.fontFamily}, Georgia, serif`, sans },
        music: music === "off" ? null : { mood: music, seed: seedFromString(source) },
        cancelled: () => cancelRef.current,
        onProgress: (p) => { setPct(p.pct); setStage(p.phase === "rendering" ? "Rendering" : p.phase === "finishing" ? "Finishing" : "Preparing"); },
      });
      const filename = `${slug(fileBase)}-Showroom-${today()}${is4k ? "-4K" : ""}.mp4`;
      setResult({ url: URL.createObjectURL(out.file), filename, seconds: out.seconds, notes: notes.concat(out.notes) });
      setPhase("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "The render failed.";
      if (msg === "Cancelled.") setPhase("idle");
      else { setRenderError(msg); setPhase("error"); }
    } finally {
      if (logo) { try { logo.close(); } catch { /* closed */ } }
    }
  }

  const busy = phase === "rendering";
  const inputCls = "text-sm border border-hairline-strong rounded-ctl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent-500";
  const chip = (on: boolean) => `text-xs font-medium px-3 py-1.5 rounded-ctl border ${on ? "bg-accent-500 text-ink-950 border-accent-500" : "bg-white text-ink-600 border-hairline-strong hover:border-ink-400"}`;

  return (
    <div className="space-y-6">
      {/* 1. Source */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
        <p className="label-caps text-ink-500 mb-2">Brokerage or broker</p>
        <select value={source} disabled={busy} onChange={(e) => void loadSource(e.target.value)} className={`${inputCls} w-full sm:w-auto min-w-[18rem]`}>
          <option value="">Choose&hellip;</option>
          <optgroup label="Brokerages">
            {brokerages.map((b) => <option key={b.id} value={`b:${b.id}`}>{b.name}</option>)}
          </optgroup>
          <optgroup label="Brokers">
            {brokers.map((b) => <option key={b.id} value={`u:${b.id}`}>{b.name}{b.brokerageName ? ` — ${b.brokerageName}` : ""}</option>)}
          </optgroup>
        </select>
        {loading && <p className="text-xs text-ink-400 mt-2">Loading listings&hellip;</p>}
        {loadError && <p className="text-xs text-danger-700 mt-2">{loadError}</p>}
        {source && !loading && !loadError && boats.length === 0 && <p className="text-xs text-ink-400 mt-2">No active listings.</p>}
      </div>

      {boats.length > 0 && (
        <>
          {/* 2. Boats and photos */}
          <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
            <p className="text-sm font-semibold text-ink-900">{boats.length} active listing{boats.length === 1 ? "" : "s"}</p>
            <p className="text-xs text-ink-400 mb-3">
              Boats photographed in the last {RECENT_DAYS} days are ticked. Drag the grip (or use the arrows) to set the order.
              Photos are picked for you &mdash; click a photo to drop it, or open <em>Add / swap</em> to bring in others.
            </p>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={boats.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                <ul className="divide-y divide-hairline border border-hairline rounded-ctl">
                  {boats.map((b, i) => (
                    <BoatRow
                      key={b.id}
                      boat={b}
                      index={i}
                      last={i === boats.length - 1}
                      thumbs={thumbs}
                      thumbsBig={thumbsBig}
                      disabled={busy}
                      onMove={(to) => moveBoat(i, to)}
                      onUpdate={(patch) => update(b.id, patch)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          </div>

          {/* 3. Look, logo, music */}
          <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 grid sm:grid-cols-2 gap-5">
            <div className="text-xs text-ink-600 flex flex-col gap-1.5 sm:col-span-2">
              <span className="label-caps text-ink-500">Resolution</span>
              <div className="flex flex-wrap items-center gap-2">
                {(["1080", "4k"] as ShowroomResolution[]).map((r) => (
                  <button key={r} type="button" disabled={busy} onClick={() => { setResolution(r); stale(); }} className={chip(resolution === r)}>
                    {r === "4k" ? "4K (3840×2160)" : "1080p (1920×1080)"}
                  </button>
                ))}
                {photoCount > 0 && (
                  <span className={tooBigForUsb ? "text-danger-700 font-medium" : "text-ink-500"}>
                    File up to about {formatBytes(estBytes)}{tooBigForUsb ? " — over 4 GB: many USB sticks (FAT32) can’t hold it" : ""}
                  </span>
                )}
              </div>
              <span className="text-ink-400">
                {resolution === "4k"
                  ? "For a 4K monitor. Takes roughly 3–4× longer to render than 1080p and makes a file about 3× bigger; needs a recent computer that can encode 4K."
                  : "Right for most office TVs and monitors. Choose 4K only for a 4K screen."}
              </span>
            </div>
            <div className="text-xs text-ink-600 flex flex-col gap-1.5">
              <span className="label-caps text-ink-500">Seconds per photo</span>
              <div className="flex flex-wrap gap-2">
                {[3, 4, 5, 6, 7, 8].map((n) => (
                  <button key={n} type="button" disabled={busy} onClick={() => { setHoldSec(n); stale(); }} className={chip(holdSec === n)}>{n} s</button>
                ))}
              </div>
            </div>
            <div className="text-xs text-ink-600 flex flex-col gap-1.5">
              <span className="label-caps text-ink-500">Between boats</span>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => { setTransition("dip"); stale(); }} className={chip(transition === "dip")}>Dip to black</button>
                <button type="button" disabled={busy} onClick={() => { setTransition("crossfade"); stale(); }} className={chip(transition === "crossfade")}>Soft crossfade</button>
              </div>
            </div>
            <div className="text-xs text-ink-600 flex flex-col gap-1.5">
              <span className="label-caps text-ink-500">Logo</span>
              <div className="flex items-center gap-3 flex-wrap">
                {logoSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoSrc} alt="Logo" className="h-10 max-w-[10rem] object-contain bg-ink-950 rounded px-2 py-1" />
                ) : (
                  <span className="text-ink-400">No logo on file &mdash; the cards will show &ldquo;{brandName || "the name"}&rdquo; instead.</span>
                )}
                <label className="text-xs font-medium px-3 py-1.5 rounded-ctl border border-hairline-strong cursor-pointer hover:border-ink-400">
                  Use a logo file&hellip;
                  <input type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" className="hidden" disabled={busy} onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = "";
                    if (!f) return;
                    setUploadedLogo(f);
                    setUploadedPreview(URL.createObjectURL(f));
                    stale();
                  }} />
                </label>
                {uploadedLogo && (
                  <button type="button" disabled={busy} onClick={() => { setUploadedLogo(null); setUploadedPreview(null); stale(); }} className="text-xs text-ink-500 underline">
                    {autoLogo ? "Back to the logo on file" : "Remove"}
                  </button>
                )}
              </div>
              <span className="text-ink-400">A logo file stays in this browser only; it isn&rsquo;t saved. A PNG with a transparent background looks best.</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {CORNERS.map((c) => (
                  <button key={c.key} type="button" disabled={busy || !logoSrc} onClick={() => { setCorner(c.key); stale(); }} className={chip(corner === c.key)}>{c.label}</button>
                ))}
              </div>
            </div>
            <div className="text-xs text-ink-600 flex flex-col gap-1.5">
              <span className="label-caps text-ink-500">Line under the logo (optional)</span>
              <input value={tagline} disabled={busy} onChange={(e) => { setTagline(e.target.value); stale(); }} placeholder="e.g. Featured Listings" maxLength={40} className={inputCls} />
              <span className="text-ink-400">On the opening and closing cards. They&rsquo;re identical, so the video loops seamlessly on a monitor set to repeat.</span>
            </div>
            <div className="text-xs text-ink-600 flex flex-col gap-1.5 sm:col-span-2">
              <span className="label-caps text-ink-500">Music</span>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => { setMusic("off"); stale(); }} className={chip(music === "off")}>Off</button>
                {MUSIC_MENU.map((m) => (
                  <button key={m} type="button" disabled={busy} title={MUSIC_BLURB[m]} onClick={() => { setMusic(m); stale(); }} className={chip(music === m)}>{MUSIC_LABEL[m]}</button>
                ))}
              </div>
              <span className="text-ink-400">
                {music === "off"
                  ? "Off by default — office monitors are usually muted."
                  : `${MUSIC_LABEL[music]} — ${MUSIC_BLURB[music]}. Original YachtPics music: each boat gets its own short track, blended into the next.`}
              </span>
            </div>
          </div>

          {/* 4. Render */}
          <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-ink-900">
                  {photoCount ? `${inPlay.length} boat${inPlay.length === 1 ? "" : "s"} · ${photoCount} photos · ${formatRunTime(estimate)}` : "No boats ticked"}
                </p>
                <p className="text-xs text-ink-400 mt-0.5">
                  {spec.w}&times;{spec.h} MP4{photoCount ? `, up to about ${formatBytes(estBytes)}` : ""}, made in this browser (Chrome or Edge) &mdash; keep this tab open and in front until it finishes.
                  {longLoop ? ` Over ${spec.warnSec / 60} minutes at ${spec.label} — consider fewer photos.` : ""}
                  {tooBigForUsb ? " Over 4 GB — too big for many USB sticks." : ""}
                </p>
              </div>
              <div className="flex gap-2">
                {busy ? (
                  <button onClick={() => { cancelRef.current = true; }} className="text-sm font-medium px-4 py-2.5 rounded-ctl border border-hairline-strong text-ink-600">Cancel</button>
                ) : (
                  <button onClick={() => void render()} disabled={!photoCount}
                    className="bg-accent-500 hover:bg-accent-400 disabled:opacity-40 text-ink-950 text-sm font-semibold px-5 py-2.5 rounded-ctl">
                    {result ? "Render again" : "Render the loop"}
                  </button>
                )}
                {result && !busy && (
                  <a href={result.url} download={result.filename} className="bg-ink-950 hover:bg-ink-800 text-white text-sm font-semibold px-5 py-2.5 rounded-ctl">
                    Download
                  </a>
                )}
              </div>
            </div>
            {busy && (
              <div className="mt-4">
                <div className="bg-ink-100 rounded-full h-2"><div className="bg-accent-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} /></div>
                <p className="text-xs text-ink-500 mt-1">{stage} &middot; {pct}%</p>
              </div>
            )}
            {phase === "error" && <p className="text-xs text-danger-700 mt-3">{renderError}</p>}
            {result && !busy && (
              <div className="text-xs text-ink-500 mt-3">
                {result.filename} &middot; {formatRunTime(result.seconds)}
                {result.notes.map((n) => <span key={n} className="block text-ink-600">{n}</span>)}
                <video src={result.url} controls muted loop className="mt-3 w-full max-w-xl rounded-sm bg-ink-950 aspect-video" />
              </div>
            )}
            <canvas ref={canvasRef} className={`mt-4 w-full max-w-xl rounded-sm bg-ink-950 aspect-video ${busy ? "" : "hidden"}`} />
          </div>
        </>
      )}
    </div>
  );
}

function BoatRow({ boat, index, last, thumbs, thumbsBig, disabled, onMove, onUpdate }: {
  boat: Boat;
  index: number;
  last: boolean;
  thumbs: Record<string, string>;
  thumbsBig: Record<string, string>;
  disabled: boolean;
  onMove: (to: number) => void;
  onUpdate: (patch: (b: Boat) => Partial<Boat>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: boat.id, disabled });
  const coverId = boat.heroId && boat.photos.some((p) => p.id === boat.heroId) ? boat.heroId : boat.photos[0]?.id;
  const shot = new Date(boat.shotAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const byId: Record<string, ShowroomPhoto> = {};
  boat.photos.forEach((p) => { byId[p.id] = p; });
  const others = boat.photos.filter((p) => boat.picked.indexOf(p.id) < 0);
  const img = (id: string, cls: string, alt = "") =>
    thumbs[id] || thumbsBig[id]
      ? <RetryImg src={thumbs[id] ?? thumbsBig[id]} fallbackSrc={thumbsBig[id]} alt={alt} loading="lazy" className={cls} />
      : null;

  const shift = (i: number, d: number) => onUpdate((b) => {
    const p = b.picked.slice();
    const j = i + d;
    if (j < 0 || j >= p.length) return {};
    const t = p[i]; p[i] = p[j]; p[j] = t;
    return { picked: p };
  });
  const remove = (id: string) => onUpdate((b) => ({ picked: b.picked.filter((x) => x !== id), swapId: b.swapId === id ? null : b.swapId }));
  const addOrSwap = (id: string) => onUpdate((b) => {
    if (b.swapId && b.picked.indexOf(b.swapId) >= 0) return { picked: b.picked.map((x) => (x === b.swapId ? id : x)), swapId: null };
    return { picked: b.picked.concat(id) };
  });

  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.7 : 1, position: "relative", zIndex: isDragging ? 10 : undefined }} className="bg-white">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="flex flex-col items-center">
          <button type="button" disabled={disabled || index === 0} onClick={() => onMove(index - 1)} aria-label="Move up" className="text-ink-400 hover:text-ink-700 disabled:opacity-30 text-xs leading-none px-1">&#9650;</button>
          <button type="button" {...attributes} {...listeners} title="Drag to reorder" aria-label="Drag to reorder"
            className="text-ink-400 hover:text-ink-700 cursor-grab active:cursor-grabbing touch-none px-1 text-base leading-none">&#8942;&#8942;</button>
          <button type="button" disabled={disabled || last} onClick={() => onMove(index + 1)} aria-label="Move down" className="text-ink-400 hover:text-ink-700 disabled:opacity-30 text-xs leading-none px-1">&#9660;</button>
        </div>
        <input type="checkbox" checked={boat.included} disabled={disabled || boat.photos.length === 0} onChange={() => onUpdate((b) => ({ included: !b.included }))} className="h-4 w-4 accent-accent-500" aria-label={`Include ${boat.name}`} />
        <div className="w-24 aspect-[4/3] bg-ink-100 rounded-sm overflow-hidden shrink-0">
          {coverId && img(coverId, "w-full h-full object-cover")}
        </div>
        <div className={`flex-1 min-w-0 ${boat.included ? "" : "opacity-50"}`}>
          <p className="text-sm font-semibold text-ink-900 truncate">{boat.name}</p>
          <p className="text-xs text-ink-500 truncate">{showroomSpecLine(boat) || "—"}</p>
          <p className="text-xs text-ink-400 truncate">{boat.brokerName}{boat.brokerName ? " · " : ""}photographed {shot} · {boat.photos.length} photos</p>
        </div>
        {boat.included && (
          <label className="text-xs text-ink-600 flex items-center gap-1.5 whitespace-nowrap">
            Photos
            <select value={boat.count} disabled={disabled} onChange={(e) => {
              const n = Number(e.target.value);
              onUpdate((b) => ({ count: n, picked: pickShowroomPhotos(b.photos, { count: n, heroId: b.heroId, manual: b.manual }), swapId: null }));
            }} className="text-xs border border-hairline-strong rounded-ctl px-2 py-1 bg-white">
              {Array.from({ length: SHOWROOM_PICK_MAX - SHOWROOM_PICK_MIN + 1 }, (_, i) => SHOWROOM_PICK_MIN + i).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
      </div>

      {boat.included && (
        <div className="px-3 pb-3 pl-[3.25rem]">
          {/* The picks, in play order */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {boat.picked.map((id, i) => {
              const p = byId[id];
              const swapping = boat.swapId === id;
              return (
                <div key={id} className={`relative shrink-0 w-28 group rounded-sm overflow-hidden border-2 ${swapping ? "border-accent-500" : "border-transparent"}`}>
                  <button type="button" disabled={disabled} onClick={() => remove(id)} title="Click to remove" className="block w-full aspect-[4/3] bg-ink-100">
                    {img(id, "w-full h-full object-cover", p?.category ?? "")}
                  </button>
                  {i === 0 && <span className="absolute top-0.5 left-0.5 bg-ink-950/70 text-white text-[9px] font-semibold rounded px-1">TITLE</span>}
                  <span className="absolute bottom-0 left-0 right-0 bg-ink-950/60 text-white text-[9px] truncate px-1 pointer-events-none">{i + 1}. {p?.category ?? "Other"}</span>
                  <div className="absolute top-0.5 right-0.5 hidden group-hover:flex gap-0.5">
                    <button type="button" disabled={disabled || i === 0} onClick={() => shift(i, -1)} aria-label="Earlier" className="bg-white/90 text-ink-800 text-[10px] rounded px-1 disabled:opacity-30">&#9664;</button>
                    <button type="button" disabled={disabled || i === boat.picked.length - 1} onClick={() => shift(i, 1)} aria-label="Later" className="bg-white/90 text-ink-800 text-[10px] rounded px-1 disabled:opacity-30">&#9654;</button>
                    <button type="button" disabled={disabled} onClick={() => onUpdate((b) => ({ swapId: b.swapId === id ? null : id, open: true }))} title="Swap this photo" aria-label="Swap" className={`text-[10px] rounded px-1 ${swapping ? "bg-accent-500 text-ink-950" : "bg-white/90 text-ink-800"}`}>&#8644;</button>
                  </div>
                </div>
              );
            })}
            {boat.picked.length === 0 && <p className="text-xs text-ink-400 py-4">No photos picked &mdash; this boat will be skipped.</p>}
          </div>
          <div className="flex items-center gap-3 mt-1.5">
            <button type="button" disabled={disabled} onClick={() => onUpdate((b) => ({ open: !b.open, swapId: b.open ? null : b.swapId }))} className="text-xs font-medium px-2.5 py-1 rounded-ctl border border-hairline-strong text-ink-700">
              {boat.open ? "Close" : `Add / swap (${others.length} more)`}
            </button>
            <button type="button" disabled={disabled} onClick={() => onUpdate((b) => ({ picked: pickShowroomPhotos(b.photos, { count: b.count, heroId: b.heroId, manual: b.manual }), swapId: null }))} className="text-xs text-ink-500 underline">
              Re-pick automatically
            </button>
            <span className="text-xs text-ink-400">{boat.picked.length} picked</span>
          </div>
          {boat.open && (
            <div className="mt-2 border border-hairline rounded-ctl p-2 bg-ink-50">
              <p className="text-xs text-ink-500 mb-1.5">
                {boat.swapId ? "Click a photo to put it in place of the highlighted pick." : "Click a photo to add it to the end. (Use ⇄ on a pick to swap instead.)"}
              </p>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5 max-h-80 overflow-y-auto">
                {others.map((p) => (
                  <button key={p.id} type="button" disabled={disabled} onClick={() => addOrSwap(p.id)} title={p.category ?? ""}
                    className="relative aspect-[4/3] bg-ink-100 rounded-sm overflow-hidden hover:ring-2 hover:ring-accent-500">
                    {img(p.id, "w-full h-full object-cover", p.category ?? "")}
                    <span className="absolute bottom-0 left-0 right-0 bg-ink-950/60 text-white text-[9px] truncate px-1">{p.category ?? "Other"}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
