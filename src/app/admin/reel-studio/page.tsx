"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { VESSEL_TYPES } from "@/lib/vesselTypes";
import { normalizeHex } from "@/lib/reelStyles";
import type { BrokerCard } from "@/lib/yachtpicsBrand";
import ReelMaker, { type ListingData, type ReelPhoto, type ReelSource } from "@/components/ReelMaker";

/**
 * Reel Studio — admin only
 * ------------------------
 * The same reel maker the brokers get, fed from the phone in Samantha's hand
 * instead of from a listing. She picks photographs off the camera roll, types
 * the boat's name and a couple of facts, and posts the reel — no listing, no
 * upload, nothing for anyone to approve.
 *
 * NOTHING LEAVES THE DEVICE. The photographs are decoded in the browser and
 * the film is encoded in the browser; no file is uploaded and no row is
 * written. That is what makes this safe to point at a boat we shot for someone
 * else, or at a boat that isn't in the portal at all.
 *
 * It is deliberately NOT offered to brokers: the reel generator is the reason
 * to keep a listing in the Portal, and a studio that makes reels out of loose
 * photographs is the one thing that would undo that. This is our own tool for
 * our own advertising.
 */

type StudioPhoto = {
  id: string;
  file: File;
  previewUrl: string;
  /** Natural size, read once when the file is added. Null if it wouldn't decode. */
  width: number | null;
  height: number | null;
};

type Draft = {
  vessel_name: string; year: string; make: string; model: string;
  vessel_type: string; length_ft: string; location: string; asking_price: string; staterooms: string;
  /** Which form is showing — and which shape of ListingData it builds. */
  subject: "vessel" | "free";
  /** The free-subject form: a headline and up to two lines under it. */
  title: string; subtitle: string; detail: string;
};

const EMPTY_DRAFT: Draft = {
  vessel_name: "", year: "", make: "", model: "",
  vessel_type: "", length_ft: "", location: "", asking_price: "", staterooms: "",
  subject: "vessel", title: "", subtitle: "", detail: "",
};

const DRAFT_KEY = "yp.reelStudio.draft";

/** The photographs on a phone are 12MP and up; a number or nothing. */
function num(v: string): number | null {
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

type BrokerRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  display_email: string | null;
  broker_details:
    | { brokerage_name: string | null; brokerage_website: string | null; logo_url: string | null; brand_accent: string | null; brand_ground: string | null }
    | { brokerage_name: string | null; brokerage_website: string | null; logo_url: string | null; brand_accent: string | null; brand_ground: string | null }[]
    | null;
};

/** Supabase hands an embedded row back as an object or a one-element array. */
function details(row: BrokerRow) {
  const d = row.broker_details;
  return Array.isArray(d) ? d[0] ?? null : d;
}

function brokerName(row: BrokerRow) {
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || row.display_email || "Broker";
}

export default function ReelStudioPage() {
  const supabase = createClient();

  const [photos, setPhotos] = useState<StudioPhoto[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [brokers, setBrokers] = useState<BrokerRow[]>([]);
  const [brokerId, setBrokerId] = useState("yachtpics");
  const [budget, setBudget] = useState<{ maxPhotos: number; longEdgeScale: number } | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  // Every object URL handed out, so they can all be released on the way out.
  const urls = useRef<string[]>([]);

  // ── The draft, remembered ────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Draft>;
        // A draft written before the switch existed — or with anything else in
        // that slot — opens on the yacht form, exactly as it always did.
        setDraft({ ...EMPTY_DRAFT, ...saved, subject: saved.subject === "free" ? "free" : "vessel" });
      }
    } catch { /* private window, or a draft written by an older version */ }
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* best effort */ }
  }, [draft]);

  /**
   * A phone's budget.
   *
   * Twenty-six 2200px bitmaps plus a frame-sized backdrop for each is half a
   * gigabyte in the tab — a laptop shrugs, an iPhone reloads the page halfway
   * through. So on a phone the cap comes down and every photograph is decoded
   * smaller. Measured after mount, never during render, so the server and the
   * browser agree on the first paint.
   *
   * "Phone" is read from the user agent, not the viewport: Charlie and
   * Samantha both carry a Galaxy Z Fold, whose inner screen is wider than a
   * small laptop's, so a width test would hand it the desktop budget and the
   * tab would die mid-render. Big-memory Android (Chrome reports deviceMemory
   * up to 8) gets a middle budget; anything reporting 4GB or less, or any
   * iPhone, gets the small one.
   */
  useEffect(() => {
    const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
    const ua = nav.userAgent || "";
    const mobile = nav.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
      || (window.matchMedia?.("(pointer: coarse)").matches && window.innerWidth < 1100);
    const mem = nav.deviceMemory ?? (mobile ? 4 : 8);
    if (!mobile) { setBudget(undefined); return; }
    setBudget(mem >= 8 ? { maxPhotos: 18, longEdgeScale: 0.85 } : { maxPhotos: 12, longEdgeScale: 0.75 });
  }, []);

  // ── The brokers, for the card on the end ─────────────────────────────────
  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, first_name, last_name, phone, display_email, broker_details(brokerage_name, brokerage_website, logo_url, brand_accent, brand_ground)")
      .eq("role", "broker")
      .order("first_name")
      .then(({ data }) => setBrokers((data as BrokerRow[]) ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  // ── Photographs off the device ───────────────────────────────────────────
  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const added: StudioPhoto[] = [];
    for (const file of Array.from(list)) {
      const previewUrl = URL.createObjectURL(file);
      urls.current.push(previewUrl);
      // The natural size, read once: loadBitmap needs it to work out the
      // resize that fits the frame's long edge without squashing the picture.
      const size = await naturalSize(previewUrl);
      added.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl,
        width: size?.width ?? null,
        height: size?.height ?? null,
      });
    }
    setPhotos((prev) => [...prev, ...added]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) {
        URL.revokeObjectURL(gone.previewUrl);
        urls.current = urls.current.filter((u) => u !== gone.previewUrl);
      }
      return prev.filter((p) => p.id !== id);
    });
  }

  const reelPhotos: ReelPhoto[] = useMemo(
    () =>
      photos.map((p) => ({
        id: p.id,
        previewUrl: p.previewUrl,
        filename: p.file.name,
        category: null,
        loadBitmap: (longEdge: number) => decodeToBitmap(p, longEdge),
      })),
    [photos],
  );

  // ── The card on the end ──────────────────────────────────────────────────
  const pickedBroker = brokers.find((b) => b.id === brokerId) ?? null;
  const card: BrokerCard | null = useMemo(() => {
    if (!pickedBroker) return null;
    const d = details(pickedBroker);
    return {
      name: brokerName(pickedBroker),
      brokerage: d?.brokerage_name ?? null,
      phone: pickedBroker.phone ?? null,
      email: pickedBroker.display_email ?? null,
      website: d?.brokerage_website ?? null,
      logoUrl: d?.logo_url ?? null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedBroker]);

  const brand = useMemo(() => {
    const d = pickedBroker ? details(pickedBroker) : null;
    return { accent: normalizeHex(d?.brand_accent), ground: normalizeHex(d?.brand_ground) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedBroker]);

  const listing: ListingData = useMemo(() => (draft.subject === "free" ? {
    // Not a boat. The Title becomes the headline the renderer already draws
    // from `vessel_name`; the two free lines sit under it. Every vessel field
    // is explicitly null, so there is nothing for the title card or the end
    // card to put on screen.
    vessel_name: draft.title.trim() || null,
    subtitle: draft.subtitle.trim() || null,
    detail: draft.detail.trim() || null,
    subject: "free",
    year: null,
    make: null,
    model: null,
    vessel_type: null,
    length_ft: null,
    location: null,
    asking_price: null,
    staterooms: null,
    broker_id: pickedBroker?.id ?? "",
    hero_photo_id: null,
    photo_order_manual: null,
  } : {
    vessel_name: draft.vessel_name.trim() || null,
    year: num(draft.year),
    make: draft.make.trim() || null,
    model: draft.model.trim() || null,
    vessel_type: draft.vessel_type || null,
    length_ft: num(draft.length_ft),
    location: draft.location.trim() || null,
    asking_price: num(draft.asking_price),
    staterooms: num(draft.staterooms),
    // No listing behind it: nothing to own, nothing to order, nothing to save.
    broker_id: pickedBroker?.id ?? "",
    hero_photo_id: null,
    photo_order_manual: null,
  }), [draft, pickedBroker]);

  const source: ReelSource = useMemo(() => ({
    listing,
    photos: reelPhotos,
    broker: card,
    listingId: null,
    isAdmin: true,
    isOwner: false,
    locked: false,
    brand,
    budget,
    // Ours by default — the reason the Studio exists. Picking a broker hands
    // the end card back to them.
    defaultYpBrand: brokerId === "yachtpics",
  }), [listing, reelPhotos, card, brand, budget, brokerId]);

  const field = "w-full text-sm border border-hairline-strong rounded-ctl px-3 py-2 bg-white focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500";
  const chip = (active: boolean) =>
    `text-xs font-medium px-3 py-1.5 rounded-ctl border transition-colors ${active ? "bg-accent-500 text-ink-950 border-accent-500" : "bg-white text-ink-600 border-hairline-strong hover:border-ink-300"}`;

  /** A free subject leads with its title — there is no fallback worth using. */
  const needsTitle = draft.subject === "free" && !draft.title.trim();

  return (
    <>
      <div className="px-6 pt-8 max-w-3xl mx-auto">
        <h1 className="text-display text-ink-900">Reel Studio</h1>
        <p className="text-ink-500 mt-1 text-sm">
          Make a reel from photos on this device. Nothing is uploaded — it renders here.
        </p>

        {/* Photographs */}
        <div className="mt-6">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
            <p className="label-caps text-ink-500">Photos · {photos.length}</p>
            <div className="flex gap-3">
              <button onClick={() => fileRef.current?.click()} className="text-xs font-semibold text-accent-700 hover:underline">
                {photos.length === 0 ? "Choose photos" : "Add photos"}
              </button>
              {photos.length > 0 && (
                <button
                  onClick={() => { photos.forEach((p) => URL.revokeObjectURL(p.previewUrl)); urls.current = []; setPhotos([]); }}
                  className="text-xs font-semibold text-ink-400 hover:underline"
                >
                  Remove all
                </button>
              )}
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*"
            onChange={(e) => { void addFiles(e.target.files); }}
            className="block w-full text-sm text-ink-600 file:mr-3 file:py-2 file:px-4 file:rounded-ctl file:border file:border-hairline-strong file:text-sm file:font-semibold file:bg-white file:text-ink-700"
          />
          {budget && (
            <p className="text-xs text-ink-400 mt-2">On a phone, up to {budget.maxPhotos} photos per reel.</p>
          )}
          {photos.length > 0 && (
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5 mt-3">
              {photos.map((p) => (
                <div key={p.id} className="relative aspect-square overflow-hidden rounded-sm bg-ink-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => removePhoto(p.id)}
                    aria-label="Remove this photo"
                    className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-ink-950/80 text-white text-[11px] leading-none font-semibold flex items-center justify-center"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-ink-400 mt-2">
            The order you pick them in below is the order they play. Remove one here and it leaves the reel too.
          </p>
        </div>

        {/* What the reel is of */}
        <div className="mt-6">
          <p className="label-caps text-ink-500 mb-2">What&rsquo;s this reel of?</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setDraft({ ...draft, subject: "vessel" })} className={chip(draft.subject === "vessel")}>Yacht</button>
            <button onClick={() => setDraft({ ...draft, subject: "free" })} className={chip(draft.subject === "free")}>Something else</button>
          </div>
          <p className="text-xs text-ink-400 mt-2">
            A yacht gets the boat fields on the opening frame. Anything else &mdash; a product, a panel, an event &mdash; gets a title and two free lines, and no boat fields at all.
          </p>
        </div>

        {draft.subject === "free" ? (
        /* Something else */
        <div className="mt-6">
          <p className="label-caps text-ink-500 mb-2">The subject</p>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-xs text-ink-500 mb-1">Title</label>
              <input className={field} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="The Compass Rose" />
            </div>
            <div>
              <label className="block text-xs text-ink-500 mb-1">Second line <span className="text-ink-400">(optional)</span></label>
              <input className={field} value={draft.subtitle} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} placeholder="A commission for a private owner" />
            </div>
            <div>
              <label className="block text-xs text-ink-500 mb-1">Detail <span className="text-ink-400">(optional)</span></label>
              <input className={field} value={draft.detail} onChange={(e) => setDraft({ ...draft, detail: e.target.value })} placeholder="e.g. Hand-engraved · Delivered to HMY Yachts" />
            </div>
          </div>
          <p className="text-xs text-ink-400 mt-2">
            The title leads the opening frame and signs the end card; the two lines sit under it, and either left blank is simply left off. Kept on this device until you change it.
          </p>
        </div>
        ) : (
        /* The boat */
        <div className="mt-6">
          <p className="label-caps text-ink-500 mb-2">The boat</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs text-ink-500 mb-1">Vessel name</label>
              <input className={field} value={draft.vessel_name} onChange={(e) => setDraft({ ...draft, vessel_name: e.target.value })} placeholder="Now Available" />
            </div>
            <div>
              <label className="block text-xs text-ink-500 mb-1">Year</label>
              <input className={field} inputMode="numeric" value={draft.year} onChange={(e) => setDraft({ ...draft, year: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs text-ink-500 mb-1">Builder</label>
              <input className={field} value={draft.make} onChange={(e) => setDraft({ ...draft, make: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs text-ink-500 mb-1">Model</label>
              <input className={field} value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs text-ink-500 mb-1">Type</label>
              <select className={field} value={draft.vessel_type} onChange={(e) => setDraft({ ...draft, vessel_type: e.target.value })}>
                <option value="">—</option>
                {VESSEL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-ink-500 mb-1">Length (ft)</label>
              <input className={field} inputMode="numeric" value={draft.length_ft} onChange={(e) => setDraft({ ...draft, length_ft: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs text-ink-500 mb-1">Staterooms</label>
              <input className={field} inputMode="numeric" value={draft.staterooms} onChange={(e) => setDraft({ ...draft, staterooms: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs text-ink-500 mb-1">Location</label>
              <input className={field} value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="Fort Lauderdale, FL" />
            </div>
            <div>
              <label className="block text-xs text-ink-500 mb-1">Asking price</label>
              <input className={field} inputMode="numeric" value={draft.asking_price} onChange={(e) => setDraft({ ...draft, asking_price: e.target.value })} placeholder="2,950,000" />
            </div>
          </div>
          <p className="text-xs text-ink-400 mt-2">
            Whatever you fill in appears on the opening frame and the end card; anything left blank is simply left off. Kept on this device until you change it.
          </p>
        </div>
        )}

        {/* Whose reel it is */}
        <div className="mt-6">
          <p className="label-caps text-ink-500 mb-2">Branding</p>
          <select className={field} value={brokerId} onChange={(e) => setBrokerId(e.target.value)}>
            <option value="yachtpics">YachtPics — our own ad</option>
            {brokers.map((b) => (
              <option key={b.id} value={b.id}>
                {brokerName(b)}{details(b)?.brokerage_name ? ` · ${details(b)?.brokerage_name}` : ""}
              </option>
            ))}
          </select>
          <p className="text-xs text-ink-400 mt-2">
            Ours by default. Pick a broker and the end card carries their name, brokerage, numbers, logo and colours instead — the same card their own reels sign off with.
          </p>
        </div>
      </div>

      {photos.length === 0 || needsTitle ? (
        <div className="px-6 py-8 max-w-3xl mx-auto">
          <div className="rounded-card border border-dashed border-hairline-strong bg-white px-5 py-8 text-center">
            <p className="text-sm font-semibold text-ink-900">
              {photos.length === 0 ? "Choose some photos to begin" : "Give it a title to begin"}
            </p>
            <p className="text-xs text-ink-400 mt-1">
              {photos.length === 0
                ? "Every look, length and framing the brokers get — rendered here, on this device."
                : "The title is the headline on the opening frame and the last thing on the end card."}
            </p>
          </div>
        </div>
      ) : (
        <ReelMaker source={source} />
      )}
    </>
  );
}

/** The photograph's own pixel dimensions, or null if the browser can't read it. */
function naturalSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * One photograph off the device, decoded at the size the frame wants.
 *
 * The fast path asks the browser to decode and resize in one step, which keeps
 * a 48-megapixel phone photograph from ever existing full-size in memory.
 * Safari can refuse it — a HEIC straight off an iPhone, or an older build with
 * no options argument at all — so the fallback decodes through an <img>, draws
 * it down to the target size on a canvas, and takes the bitmap from there.
 */
async function decodeToBitmap(p: StudioPhoto, longEdge: number): Promise<ImageBitmap> {
  const fit = (w: number, h: number) => {
    const scale = Math.min(1, longEdge / Math.max(w, h));
    return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
  };

  if (p.width && p.height) {
    const target = fit(p.width, p.height);
    try {
      return await createImageBitmap(p.file, {
        resizeWidth: target.width,
        resizeHeight: target.height,
        resizeQuality: "high",
        imageOrientation: "from-image",
      });
    } catch { /* fall through to the <img> path */ }
  }

  const img = new Image();
  img.src = p.previewUrl;
  await img.decode();
  const target = fit(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser couldn't read that photo.");
  ctx.drawImage(img, 0, 0, target.width, target.height);
  return createImageBitmap(canvas);
}
