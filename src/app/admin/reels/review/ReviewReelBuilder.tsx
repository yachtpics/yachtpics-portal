"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cormorant_Garamond } from "next/font/google";
import QRCode from "qrcode";
import {
  DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import RetryImg from "@/components/RetryImg";
import {
  MUSIC_BLURB, MUSIC_CHOICES, MUSIC_LABEL, isMusicChoice, nextMusicSeed, resolveMood, seedFromString, type MusicChoice,
} from "@/lib/reelMusic";
import { YACHTPICS_PHONES, type YpPhone } from "@/lib/yachtpicsBrand";
import { fetchBitmap } from "@/lib/showroomRender";
import { uploadVideoToPrivateBucket } from "@/lib/uploadListingVideo";
import { drawReviewOpenCard, renderReviewReel, type ReviewSlide } from "@/lib/reviewReelRender";
import {
  PRESETS, REVIEW_FRAMES, SEC_PER_BOAT_MAX, SEC_PER_BOAT_MIN,
  boatsLine, defaultSecPerBoat, formatRunTime, presetRange, reviewCaption, reviewDuration, reviewFileName, reviewTitle, todayET,
  type PresetKey, type ReviewBoat, type ReviewFormat, type ReviewFraming, type ReviewPhotoOption, type ReviewReelSettings,
  type ReviewTransition, type SavedReviewReel,
} from "@/lib/reviewReel";

// ReelMaker's title face — the end card's hook line is set in its italic.
const serif = Cormorant_Garamond({ subsets: ["latin"], weight: ["400", "600"], style: ["normal", "italic"], display: "swap" });

type Boat = ReviewBoat & { included: boolean };
type Result = { url: string; blob: Blob; filename: string; seconds: number; notes: string[]; withMusic: boolean };

const MUSIC_KEY = "yp.review.music";
/** Facebook / Instagram API reels: 3–90 s (ReelMaker's SOCIAL_MAX_SEC). */
const SOCIAL_MAX_SEC = 90;

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

/** Late in a month, "This month" is the one he means; early on, last month. */
function defaultPreset(): Exclude<PresetKey, "custom"> {
  return Number(todayET().slice(8, 10)) >= 20 ? "this_month" : "last_month";
}

export default function ReviewReelBuilder() {
  const initial = useMemo(() => { const k = defaultPreset(); return { k, ...presetRange(k) }; }, []);
  const [preset, setPreset] = useState<PresetKey>(initial.k);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [boats, setBoats] = useState<Boat[]>([]);
  const [excluded, setExcluded] = useState<{ pocket: number; test: number; noPhotos: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const loadSeq = useRef(0);

  const [format, setFormat] = useState<ReviewFormat>("vertical");
  const [secPerBoat, setSecPerBoat] = useState(1.0);
  const [secManual, setSecManual] = useState(false);
  const [transition, setTransition] = useState<ReviewTransition>("crossfade");
  const [framing, setFraming] = useState<ReviewFraming>("fill");
  const [music, setMusic] = useState<MusicChoice>("off");
  const [seed, setSeed] = useState(() => seedFromString(initial.from + initial.to));
  const [phone, setPhone] = useState<YpPhone>("charlie");
  const [line1, setLine1] = useState("");
  const [line1Edited, setLine1Edited] = useState(false);
  const [line2, setLine2] = useState("");
  const [line2Edited, setLine2Edited] = useState(false);

  const [swapFor, setSwapFor] = useState<string | null>(null);
  const [options, setOptions] = useState<Record<string, ReviewPhotoOption[]>>({});
  const [optionsError, setOptionsError] = useState("");

  const [phase, setPhase] = useState<"idle" | "rendering" | "done" | "error">("idle");
  const [pct, setPct] = useState(0);
  const [stage, setStage] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [renderError, setRenderError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const cancelRef = useRef(false);

  const [sending, setSending] = useState(false);
  const [sendPct, setSendPct] = useState(0);
  const [qr, setQr] = useState<{ img: string; url: string } | null>(null);
  const [sendError, setSendError] = useState("");
  const [copied, setCopied] = useState(false);

  const [savedId, setSavedId] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedReviewReel[]>([]);
  const [savedNote, setSavedNote] = useState("");
  const [saveMsg, setSaveMsg] = useState("");

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const inPlay = boats.filter((b) => b.included);
  const n = inPlay.length;
  const autoLine1 = reviewTitle(from, to);
  const autoLine2 = boatsLine(n);
  const title = line1Edited ? line1 : autoLine1;
  const sub = line2Edited ? line2 : autoLine2;
  const duration = n ? reviewDuration(n, secPerBoat) : 0;
  const caption = reviewCaption(title, n);
  const mood = resolveMood(music, "editorial");
  const busy = phase === "rendering";

  // Seconds per boat follows the count until it's moved by hand.
  useEffect(() => { if (!secManual) setSecPerBoat(defaultSecPerBoat(n)); }, [n, secManual]);

  // Music choice, remembered in this browser.
  useEffect(() => {
    try { const v = window.localStorage.getItem(MUSIC_KEY); if (isMusicChoice(v)) setMusic(v); } catch { /* fine */ }
  }, []);
  const pickMusic = (v: MusicChoice) => {
    setMusic(v); stale();
    try { window.localStorage.setItem(MUSIC_KEY, v); } catch { /* fine */ }
  };

  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  useEffect(() => {
    if (phase !== "rendering") return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [phase]);
  useEffect(() => () => { cancelRef.current = true; }, []);

  const brandSans = useCallback(() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim();
    return `${v ? `${v}, ` : ""}Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  }, []);

  // The opening card, small, as it will render.
  useEffect(() => {
    const c = previewRef.current;
    if (!c) return;
    const fr = REVIEW_FRAMES[format];
    const k = 270 / Math.min(fr.w, fr.h);
    c.width = Math.round(fr.w * k); c.height = Math.round(fr.h * k);
    const draw = () => drawReviewOpenCard(c.getContext("2d")!, c.width, c.height, { line1: title, line2: sub, fonts: { serif: serif.style.fontFamily, sans: brandSans() } });
    draw();
    let alive = true;
    document.fonts?.ready.then(() => { if (alive) draw(); }).catch(() => { /* fine */ });
    return () => { alive = false; };
  }, [format, title, sub, brandSans]);

  function stale() {
    if (phase === "done" || phase === "error") setPhase("idle");
    setQr(null); setSendError("");
  }

  // ── Boats ──
  const loadBoats = useCallback(async (f: string, t: string, apply?: SavedReviewReel) => {
    const seq = ++loadSeq.current;
    setLoading(true); setLoadError(""); setBoats([]); setExcluded(null); setSwapFor(null);
    try {
      const res = await fetch(`/api/admin/reels/review?from=${f}&to=${t}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Couldn’t load the boats.");
      if (seq !== loadSeq.current) return;
      let list: Boat[] = ((j.boats ?? []) as ReviewBoat[]).map((b) => ({ ...b, included: true }));
      if (apply) {
        // A saved reel: its order, its ticks and its photo choices; boats added
        // to the period since come last, unticked.
        const by: Record<string, Boat> = {};
        list.forEach((b) => { by[b.listingId] = b; });
        const ordered: Boat[] = [];
        const swapped: string[] = [];
        apply.items.forEach((it) => {
          const b = by[it.listingId];
          if (!b) return;
          delete by[it.listingId];
          if (it.photoId !== b.photo.id) { swapped.push(b.listingId); b.photo = { id: it.photoId, category: null, thumb: null }; }
          ordered.push({ ...b, included: it.included });
        });
        list.forEach((b) => { if (by[b.listingId]) ordered.push({ ...b, included: false }); });
        list = ordered;
        // Tiles (and categories) for the photos chosen by hand.
        void Promise.all(swapped.map((id) => fetchOptions(id).then((opts) => {
          if (seq !== loadSeq.current || !opts) return;
          setBoats((bs) => bs.map((b) => {
            if (b.listingId !== id) return b;
            const o = opts.find((p) => p.id === b.photo.id);
            return o ? { ...b, photo: { id: o.id, category: o.category, thumb: o.thumb } } : b;
          }));
        })));
      }
      setBoats(list);
      setExcluded(j.excluded ?? null);
    } catch (e) {
      if (seq === loadSeq.current) setLoadError(e instanceof Error ? e.message : "Couldn’t load the boats.");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
    // fetchOptions is stable enough (only reads the cache through setState).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void loadBoats(initial.from, initial.to); }, [loadBoats, initial]);

  async function refreshSaved() {
    try {
      const res = await fetch("/api/admin/reels/review/saved");
      const j = await res.json().catch(() => ({}));
      setSaved((j.reels ?? []) as SavedReviewReel[]);
      setSavedNote(j.notReady ?? "");
    } catch { /* the list is a convenience */ }
  }
  useEffect(() => { void refreshSaved(); }, []);

  function choosePreset(k: Exclude<PresetKey, "custom">) {
    const r = presetRange(k);
    setPreset(k); setFrom(r.from); setTo(r.to);
    setSavedId(null); setSeed(seedFromString(r.from + r.to));
    if (result) { URL.revokeObjectURL(result.url); setResult(null); }
    setPhase("idle"); setQr(null);
    void loadBoats(r.from, r.to);
  }
  function loadCustom() {
    setPreset("custom"); setSavedId(null); setSeed(seedFromString(from + to));
    if (result) { URL.revokeObjectURL(result.url); setResult(null); }
    setPhase("idle"); setQr(null);
    void loadBoats(from, to);
  }

  function openSaved(r: SavedReviewReel) {
    const s = r.settings;
    const pk = PRESETS.find((p) => p.key === r.preset);
    const same = pk ? presetRange(pk.key) : null;
    setPreset(pk && same && same.from === r.period_from && same.to === r.period_to ? pk.key : "custom");
    setFrom(r.period_from); setTo(r.period_to);
    setSavedId(r.id);
    if (s) {
      if (s.format === "vertical" || s.format === "wide") setFormat(s.format);
      if (typeof s.secPerBoat === "number") { setSecPerBoat(s.secPerBoat); setSecManual(!!s.secManual); }
      if (s.transition === "cut" || s.transition === "crossfade") setTransition(s.transition);
      if (s.framing === "fill" || s.framing === "whole") setFraming(s.framing);
      if (s.music && isMusicChoice(s.music.mood)) { setMusic(s.music.mood); setSeed(Number(s.music.seed) || 1); }
      const a1 = reviewTitle(r.period_from, r.period_to);
      setLine1(s.line1 ?? a1); setLine1Edited(!!s.line1 && s.line1 !== a1);
      setLine2(s.line2 ?? ""); setLine2Edited(!!s.line2 && !/^\d+ boats? photographed$/.test(s.line2));
    }
    if (result) { URL.revokeObjectURL(result.url); setResult(null); }
    setPhase("idle"); setQr(null);
    void loadBoats(r.period_from, r.period_to, r);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteSaved(id: string) {
    if (!window.confirm("Delete this saved In Review reel? (Only the saved settings — any video you downloaded stays.)")) return;
    await fetch(`/api/admin/reels/review/saved?id=${id}`, { method: "DELETE" }).catch(() => null);
    if (savedId === id) setSavedId(null);
    void refreshSaved();
  }

  async function save(rendered = false): Promise<void> {
    setSaveMsg("");
    const settings: ReviewReelSettings = {
      format, secPerBoat, secManual, transition, framing,
      music: { mood: music, seed },
      line1: title, line2: sub,
    };
    try {
      const res = await fetch("/api/admin/reels/review/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: savedId, title, period_from: from, period_to: to, preset, settings,
          items: boats.map((b) => ({ listingId: b.listingId, photoId: b.photo.id, included: b.included })),
          boat_count: n, caption, rendered,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Couldn’t save.");
      setSavedId(j.id);
      setSaveMsg(rendered ? "Saved — open it from Saved reels to make it again." : "Saved.");
      void refreshSaved();
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Couldn’t save.");
    }
  }

  // ── Per-boat edits ──
  const update = (id: string, patch: Partial<Boat>) => { setBoats((bs) => bs.map((b) => (b.listingId === id ? { ...b, ...patch } : b))); stale(); };
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setBoats((bs) => arrayMove(bs, bs.findIndex((b) => b.listingId === active.id), bs.findIndex((b) => b.listingId === over.id)));
    stale();
  }
  const chronological = () => {
    setBoats((bs) => bs.slice().sort((a, b) => (Date.parse(a.shotAt) || 0) - (Date.parse(b.shotAt) || 0) || a.name.localeCompare(b.name)));
    stale();
  };
  const setAll = (on: boolean) => { setBoats((bs) => bs.map((b) => ({ ...b, included: on }))); stale(); };

  async function fetchOptions(listingId: string): Promise<ReviewPhotoOption[] | null> {
    try {
      const res = await fetch(`/api/admin/reels/review/photos?listingId=${listingId}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Couldn’t load the photos.");
      const list = (j.photos ?? []) as ReviewPhotoOption[];
      setOptions((o) => ({ ...o, [listingId]: list }));
      return list;
    } catch (e) {
      setOptionsError(e instanceof Error ? e.message : "Couldn’t load the photos.");
      return null;
    }
  }
  function openSwap(id: string) {
    setSwapFor(id); setOptionsError("");
    if (!options[id]) void fetchOptions(id);
  }

  // ── Render ──
  async function render() {
    if (!n || !canvasRef.current) return;
    cancelRef.current = false;
    setPhase("rendering"); setPct(0); setStage("Signing photos"); setRenderError(""); setQr(null); setSendError("");
    if (result) { URL.revokeObjectURL(result.url); setResult(null); }
    try {
      const res = await fetch("/api/admin/reels/review/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds: inPlay.map((b) => b.photo.id) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Couldn’t get links to the photos.");
      const urls = (j.urls ?? {}) as Record<string, string>;
      const fr = REVIEW_FRAMES[format];
      const edge = Math.round(Math.max(fr.w, fr.h) * 1.15);
      const slides: ReviewSlide[] = inPlay.map((b) => ({
        category: b.photo.category,
        load: () => {
          const u = urls[b.photo.id];
          return u ? fetchBitmap(u, edge) : Promise.reject(new Error("No link"));
        },
      }));
      const out = await renderReviewReel({
        canvas: canvasRef.current,
        format, slides, secPerBoat, transition, framing,
        line1: title, line2: sub,
        fonts: { serif: serif.style.fontFamily, sans: brandSans() },
        music: mood ? { mood, seed } : null,
        phone,
        cancelled: () => cancelRef.current,
        onProgress: (p) => { setPct(p.pct); setStage(p.phase === "rendering" ? "Rendering" : p.phase === "finishing" ? "Finishing" : "Preparing"); },
      });
      const filename = reviewFileName(title, format);
      setResult({ url: URL.createObjectURL(out.file), blob: out.file, filename, seconds: out.seconds, notes: out.notes, withMusic: out.withMusic });
      setPhase("done");
      void save(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "The render failed.";
      if (msg === "Cancelled.") setPhase("idle");
      else { setRenderError(msg); setPhase("error"); }
    }
  }

  async function sendToPhone() {
    if (!result) return;
    setSending(true); setSendError(""); setQr(null); setSendPct(0);
    try {
      const file = new File([result.blob], result.filename, { type: "video/mp4" });
      const up = await uploadVideoToPrivateBucket({ file, target: { reviewShare: true }, onProgress: setSendPct });
      if (!up.ok) throw new Error(up.error);
      const res = await fetch("/api/admin/reels/review/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: up.path, filename: result.filename }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.url) throw new Error(j?.error ?? "Couldn’t make the link.");
      const img = await QRCode.toDataURL(j.url, { width: 640, margin: 2, errorCorrectionLevel: "L", color: { dark: "#050b14", light: "#ffffff" } });
      setQr({ img, url: j.url });
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Couldn’t send it to your phone.");
    } finally {
      setSending(false);
    }
  }

  async function copyCaption() {
    try { await navigator.clipboard.writeText(caption); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* select it by hand */ }
  }

  const inputCls = "text-sm border border-hairline-strong rounded-ctl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent-500";
  const chip = (on: boolean) => `text-xs font-medium px-3 py-1.5 rounded-ctl border ${on ? "bg-accent-500 text-ink-950 border-accent-500" : "bg-white text-ink-600 border-hairline-strong hover:border-ink-400"}`;
  const card = "bg-white border border-hairline rounded-card shadow-elev-1 p-5";
  const swapBoat = swapFor ? boats.find((b) => b.listingId === swapFor) ?? null : null;
  const fr = REVIEW_FRAMES[format];

  return (
    <div className="space-y-6">
      {/* 1. Period */}
      <div className={card}>
        <p className="label-caps text-ink-500 mb-2">Period</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" disabled={busy} onClick={() => choosePreset(p.key)} className={chip(preset === p.key)}>{p.label}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3 mt-3">
          <label className="text-xs text-ink-500 flex flex-col gap-1">From
            <input type="date" value={from} disabled={busy} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }} className={inputCls} />
          </label>
          <label className="text-xs text-ink-500 flex flex-col gap-1">To
            <input type="date" value={to} disabled={busy} onChange={(e) => { setTo(e.target.value); setPreset("custom"); }} className={inputCls} />
          </label>
          <button type="button" disabled={busy || !from || !to} onClick={loadCustom} className="text-xs font-medium px-3 py-2 rounded-ctl border border-hairline-strong text-ink-700 hover:border-ink-400">
            Show these dates
          </button>
        </div>
        <p className="text-xs text-ink-400 mt-2">
          A boat counts in the period it was photographed (its shoot date, or the day its listing was made when there&rsquo;s no shoot date). Pocket listings and test accounts are left out; sold boats stay in.
        </p>
        {loading && <p className="text-xs text-ink-400 mt-2">Loading boats&hellip;</p>}
        {loadError && <p className="text-xs text-danger-700 mt-2">{loadError}</p>}
      </div>

      {/* 2. Boats */}
      {!loading && !loadError && (
        <div className={card}>
          <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
            <div>
              <p className="text-sm font-semibold text-ink-900">
                {boats.length === 0 ? "No boats in this period" : `${n} of ${boats.length} boat${boats.length === 1 ? "" : "s"} · ${formatRunTime(duration)}`}
              </p>
              <p className="text-xs text-ink-400 mt-0.5">
                {reviewTitle(from, to).replace(/ in review$/, "")}
                {excluded && (excluded.pocket || excluded.test || excluded.noPhotos)
                  ? ` · left out: ${[
                      excluded.pocket ? `${excluded.pocket} pocket listing${excluded.pocket === 1 ? "" : "s"}` : "",
                      excluded.test ? `${excluded.test} test` : "",
                      excluded.noPhotos ? `${excluded.noPhotos} with no photos` : "",
                    ].filter(Boolean).join(", ")}`
                  : ""}
              </p>
            </div>
            {boats.length > 0 && (
              <div className="flex gap-3 text-xs">
                <button type="button" disabled={busy} onClick={chronological} className="text-ink-600 underline">Back to date order</button>
                <button type="button" disabled={busy} onClick={() => setAll(true)} className="text-ink-600 underline">Tick all</button>
                <button type="button" disabled={busy} onClick={() => setAll(false)} className="text-ink-600 underline">Untick all</button>
              </div>
            )}
          </div>
          {boats.length > 0 && (
            <>
              <p className="text-xs text-ink-400 mb-3">Untick a boat to leave it out. Drag a tile to move it. &ldquo;Use another photo&rdquo; swaps the shot.</p>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={boats.map((b) => b.listingId)} strategy={rectSortingStrategy}>
                  <ul className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                    {boats.map((b, i) => (
                      <BoatTile key={b.listingId} boat={b} index={i} disabled={busy}
                        onToggle={() => update(b.listingId, { included: !b.included })}
                        onSwap={() => openSwap(b.listingId)} />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            </>
          )}
        </div>
      )}

      {/* Photo picker */}
      {swapBoat && (
        <div className="fixed inset-0 z-50 bg-ink-950/60 flex items-center justify-center p-4" onClick={() => setSwapFor(null)}>
          <div className="bg-white rounded-card shadow-elev-2 w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-hairline">
              <div>
                <p className="text-sm font-semibold text-ink-900">{swapBoat.name}</p>
                <p className="text-xs text-ink-400">Choose the photo for this boat.</p>
              </div>
              <button type="button" onClick={() => setSwapFor(null)} className="text-sm text-ink-500 px-2">Close</button>
            </div>
            <div className="p-4 overflow-y-auto">
              {optionsError && <p className="text-xs text-danger-700 mb-2">{optionsError}</p>}
              {!options[swapBoat.listingId] && !optionsError && <p className="text-xs text-ink-400">Loading photos&hellip;</p>}
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {(options[swapBoat.listingId] ?? []).map((p) => {
                  const on = p.id === swapBoat.photo.id;
                  return (
                    <button key={p.id} type="button" title={p.category ?? ""}
                      onClick={() => { update(swapBoat.listingId, { photo: { id: p.id, category: p.category, thumb: p.thumb } }); setSwapFor(null); }}
                      className={`relative aspect-[4/3] bg-ink-100 rounded-sm overflow-hidden ${on ? "ring-2 ring-accent-500" : "hover:ring-2 hover:ring-ink-300"}`}>
                      {p.thumb && <RetryImg src={p.thumb} alt={p.category ?? ""} loading="lazy" className="w-full h-full object-cover" />}
                      <span className="absolute bottom-0 left-0 right-0 bg-ink-950/60 text-white text-[10px] truncate px-1">{on ? "✓ " : ""}{p.category ?? "Other"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {boats.length > 0 && (
        <>
          {/* 3. Settings */}
          <div className={`${card} grid md:grid-cols-[1fr_auto] gap-6`}>
            <div className="grid sm:grid-cols-2 gap-5">
              <div className="text-xs text-ink-600 flex flex-col gap-1.5">
                <span className="label-caps text-ink-500">Format</span>
                <div className="flex flex-wrap gap-2">
                  {(["vertical", "wide"] as ReviewFormat[]).map((f) => (
                    <button key={f} type="button" disabled={busy} onClick={() => { setFormat(f); stale(); }} className={chip(format === f)}>{REVIEW_FRAMES[f].label}</button>
                  ))}
                </div>
                <span className="text-ink-400">{fr.hint} · {fr.w}&times;{fr.h}</span>
              </div>
              <div className="text-xs text-ink-600 flex flex-col gap-1.5">
                <span className="label-caps text-ink-500">Seconds per boat &middot; {secPerBoat.toFixed(1)} s</span>
                <input type="range" min={SEC_PER_BOAT_MIN} max={SEC_PER_BOAT_MAX} step={0.1} value={secPerBoat} disabled={busy}
                  onChange={(e) => { setSecPerBoat(Number(e.target.value)); setSecManual(true); stale(); }} className="accent-accent-500" />
                <span className="text-ink-400">
                  {secManual
                    ? <>Set by hand. <button type="button" className="underline" onClick={() => { setSecManual(false); stale(); }}>Back to automatic ({defaultSecPerBoat(n).toFixed(1)} s)</button></>
                    : "Automatic: 1.0 s up to 60 boats, 0.7 s up to 150, 0.5 s above."}
                </span>
              </div>
              <div className="text-xs text-ink-600 flex flex-col gap-1.5">
                <span className="label-caps text-ink-500">Between boats</span>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} onClick={() => { setTransition("crossfade"); stale(); }} className={chip(transition === "crossfade")}>Quick crossfade</button>
                  <button type="button" disabled={busy} onClick={() => { setTransition("cut"); stale(); }} className={chip(transition === "cut")}>Cut</button>
                </div>
              </div>
              <div className="text-xs text-ink-600 flex flex-col gap-1.5">
                <span className="label-caps text-ink-500">Framing</span>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} onClick={() => { setFraming("fill"); stale(); }} className={chip(framing === "fill")}>Full frame</button>
                  <button type="button" disabled={busy} onClick={() => { setFraming("whole"); stale(); }} className={chip(framing === "whole")}>Whole photo</button>
                </div>
                <span className="text-ink-400">
                  {framing === "fill"
                    ? (format === "vertical" ? "Fills the frame edge to edge — on 9:16 a landscape profile is cropped to its middle." : "Fills the frame edge to edge.")
                    : "The whole photo over a soft, blurred copy of itself — nothing cropped."}
                </span>
              </div>
              <div className="text-xs text-ink-600 flex flex-col gap-1.5 sm:col-span-2">
                <span className="label-caps text-ink-500">Music</span>
                <div className="flex flex-wrap gap-2">
                  {MUSIC_CHOICES.map((m) => (
                    <button key={m} type="button" disabled={busy} title={m === "off" || m === "auto" ? undefined : MUSIC_BLURB[m]}
                      onClick={() => pickMusic(m)} className={chip(music === m)}>
                      {m === "auto" ? `Auto · ${MUSIC_LABEL[resolveMood("auto", "editorial") ?? "elegant"]}` : MUSIC_LABEL[m]}
                    </button>
                  ))}
                  {mood && <button type="button" disabled={busy} onClick={() => { setSeed((s) => nextMusicSeed(s)); stale(); }} className="text-xs text-ink-600 underline">Try another</button>}
                </div>
                <span className="text-ink-400">
                  {mood ? `Original YachtPics music (${MUSIC_LABEL[mood]} — ${MUSIC_BLURB[mood]}), timed to the boats — free to post anywhere.` : "Leave off to add a trending sound when you post."}
                </span>
              </div>
              <div className="text-xs text-ink-600 flex flex-col gap-1.5 sm:col-span-2">
                <span className="label-caps text-ink-500">Opening card</span>
                <input value={title} disabled={busy} maxLength={60} onChange={(e) => { setLine1(e.target.value); setLine1Edited(true); stale(); }} className={inputCls} />
                <input value={sub} disabled={busy} maxLength={60} onChange={(e) => { setLine2(e.target.value); setLine2Edited(true); stale(); }} className={inputCls} />
                {(line1Edited || line2Edited) && (
                  <button type="button" className="self-start text-ink-500 underline" onClick={() => { setLine1Edited(false); setLine2Edited(false); stale(); }}>Back to automatic</button>
                )}
              </div>
              <div className="text-xs text-ink-600 flex flex-col gap-1.5 sm:col-span-2">
                <span className="label-caps text-ink-500">End card</span>
                <div className="flex flex-wrap gap-2 items-center">
                  {(Object.keys(YACHTPICS_PHONES) as YpPhone[]).map((k) => (
                    <button key={k} type="button" disabled={busy} onClick={() => { setPhone(k); stale(); }} className={chip(phone === k)}>
                      {YACHTPICS_PHONES[k].label} · {YACHTPICS_PHONES[k].phone}
                    </button>
                  ))}
                </div>
                <span className="text-ink-400">The YachtPics end card every branded reel closes on: logo, &ldquo;Powered by the YachtPics Portal&rdquo;, this number and yachtpics.com.</span>
              </div>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <canvas ref={previewRef} className="rounded-sm shadow-elev-1 max-w-[270px]" style={{ width: format === "vertical" ? 160 : 270 }} />
              <span className="text-[11px] text-ink-400">Opening card</span>
            </div>
          </div>

          {/* 4. Render */}
          <div className={card}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-ink-900">
                  {n ? `${n} boat${n === 1 ? "" : "s"} × ${secPerBoat.toFixed(1)} s · ${formatRunTime(duration)}` : "No boats ticked"}
                </p>
                <p className="text-xs text-ink-400 mt-0.5">
                  {fr.w}&times;{fr.h} MP4 made in this browser (Chrome or Edge on a computer) &mdash; keep this tab open and in front until it finishes.
                  {format === "vertical" && duration > SOCIAL_MAX_SEC ? " Over 90 s: post it from the Instagram app (the portal’s direct posting stops at 90 s)." : ""}
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                {busy ? (
                  <button onClick={() => { cancelRef.current = true; }} className="text-sm font-medium px-4 py-2.5 rounded-ctl border border-hairline-strong text-ink-600">Cancel</button>
                ) : (
                  <>
                    <button onClick={() => void save(false)} disabled={!boats.length} className="text-sm font-medium px-4 py-2.5 rounded-ctl border border-hairline-strong text-ink-700 hover:border-ink-400">
                      {savedId ? "Save changes" : "Save"}
                    </button>
                    <button onClick={() => void render()} disabled={!n}
                      className="bg-accent-500 hover:bg-accent-400 disabled:opacity-40 text-ink-950 text-sm font-semibold px-5 py-2.5 rounded-ctl">
                      {result ? "Make it again" : "Make the reel"}
                    </button>
                  </>
                )}
              </div>
            </div>
            {saveMsg && <p className="text-xs text-ink-500 mt-2">{saveMsg}</p>}
            {busy && (
              <div className="mt-4">
                <div className="bg-ink-100 rounded-full h-2"><div className="bg-accent-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} /></div>
                <p className="text-xs text-ink-500 mt-1">{stage} &middot; {pct}%</p>
              </div>
            )}
            {phase === "error" && <p className="text-xs text-danger-700 mt-3">{renderError}</p>}
            <canvas ref={canvasRef} className={`mt-4 rounded-sm bg-ink-950 ${format === "vertical" ? "w-48 aspect-[9/16]" : "w-full max-w-xl aspect-video"} ${busy ? "" : "hidden"}`} />

            {result && !busy && (
              <div className="mt-4 grid md:grid-cols-[auto_1fr] gap-5">
                <video src={result.url} controls playsInline className={`rounded-sm bg-ink-950 ${format === "vertical" ? "w-56 aspect-[9/16]" : "w-full max-w-xl aspect-video"}`} />
                <div className="text-xs text-ink-600 space-y-3">
                  <p>
                    {result.filename} &middot; {formatRunTime(result.seconds)} &middot; {result.withMusic && mood ? `original YachtPics music (${MUSIC_LABEL[mood]})` : "silent (add a sound when you post)"}
                  </p>
                  {result.notes.map((x) => <p key={x} className="text-warn-700">{x}</p>)}
                  <div className="flex gap-2 flex-wrap">
                    <a href={result.url} download={result.filename} className="bg-ink-950 hover:bg-ink-800 text-white text-sm font-semibold px-5 py-2.5 rounded-ctl">Download</a>
                    <button type="button" onClick={() => void sendToPhone()} disabled={sending}
                      className="text-sm font-medium px-4 py-2.5 rounded-ctl border border-hairline-strong text-ink-700 hover:border-ink-400 disabled:opacity-50">
                      {sending ? `Sending… ${sendPct}%` : "Send to my phone"}
                    </button>
                  </div>
                  {sendError && <p className="text-danger-700">{sendError}</p>}
                  {qr && (
                    <div className="flex items-start gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={qr.img} alt="QR code for the reel" className="w-40 h-40 border border-hairline rounded-sm" />
                      <p className="text-ink-500">Point your phone&rsquo;s camera at the code and tap the link &mdash; the reel downloads to the phone. The link works for 24 hours. <a href={qr.url} className="underline">Open link</a></p>
                    </div>
                  )}
                  <div>
                    <p className="label-caps text-ink-500 mb-1">Caption</p>
                    <textarea readOnly value={caption} rows={3} className={`${inputCls} w-full text-xs`} onFocus={(e) => e.currentTarget.select()} />
                    <button type="button" onClick={() => void copyCaption()} className="mt-1 text-xs font-medium px-3 py-1.5 rounded-ctl border border-hairline-strong text-ink-700">
                      {copied ? "Copied" : "Copy caption"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* 5. Saved */}
      <div className={card}>
        <p className="label-caps text-ink-500 mb-2">Saved reels</p>
        {savedNote && <p className="text-xs text-warn-700">{savedNote}</p>}
        {!savedNote && saved.length === 0 && <p className="text-xs text-ink-400">Nothing saved yet. A reel is saved when you make it (or with Save).</p>}
        {saved.length > 0 && (
          <ul className="divide-y divide-hairline">
            {saved.map((r) => (
              <li key={r.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-ink-900 truncate">{r.title}{r.id === savedId ? " · open" : ""}</p>
                  <p className="text-xs text-ink-400">
                    {r.boat_count} boats · {r.settings?.format === "wide" ? "16:9" : "9:16"} · {r.rendered_at ? `made ${fmtDate(r.rendered_at)}` : `saved ${fmtDate(r.updated_at)}`}
                  </p>
                </div>
                <div className="flex gap-3 text-xs shrink-0">
                  <button type="button" disabled={busy} onClick={() => openSaved(r)} className="font-medium text-accent-700 hover:underline">Open</button>
                  <button type="button" disabled={busy} onClick={() => void deleteSaved(r.id)} className="text-ink-400 hover:underline">Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function BoatTile({ boat, index, disabled, onToggle, onSwap }: {
  boat: Boat; index: number; disabled: boolean; onToggle: () => void; onSwap: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: boat.listingId, disabled });
  return (
    <li ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.7 : 1, position: "relative", zIndex: isDragging ? 10 : undefined }}
      className={`rounded-ctl border border-hairline bg-white overflow-hidden ${boat.included ? "" : "opacity-45"}`}>
      <div {...attributes} {...listeners} className="relative aspect-[4/3] bg-ink-100 cursor-grab active:cursor-grabbing touch-none" title="Drag to move">
        {boat.photo.thumb
          ? <RetryImg src={boat.photo.thumb} alt={boat.name} loading="lazy" className="w-full h-full object-cover pointer-events-none" draggable={false} />
          : <span className="absolute inset-0 flex items-center justify-center text-[10px] text-ink-400">No preview</span>}
        <span className="absolute top-1 right-1 bg-ink-950/70 text-white text-[10px] font-semibold rounded px-1">{index + 1}</span>
        {boat.sold && <span className="absolute bottom-1 right-1 bg-ink-950/70 text-white text-[9px] font-semibold rounded px-1">SOLD</span>}
      </div>
      <label className="absolute top-1 left-1 bg-white/90 rounded px-1 py-0.5 flex items-center" onPointerDown={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={boat.included} disabled={disabled} onChange={onToggle} className="h-4 w-4 accent-accent-500" aria-label={`Include ${boat.name}`} />
      </label>
      <div className="px-2 py-1.5">
        <p className="text-xs font-semibold text-ink-900 truncate" title={boat.name}>{boat.name}</p>
        <p className="text-[11px] text-ink-400 truncate" title={boat.shotDateGuessed ? "No shoot date — this is when the listing was made" : undefined}>
          {fmtDate(boat.shotAt)}{boat.shotDateGuessed ? "*" : ""}{boat.brokerName ? ` · ${boat.brokerName}` : ""}
        </p>
        <button type="button" disabled={disabled || boat.photoCount < 2} onClick={onSwap} className="text-[11px] text-accent-700 hover:underline disabled:text-ink-300">
          Use another photo
        </button>
      </div>
    </li>
  );
}
