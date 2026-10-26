"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Copy, ExternalLink, Trash2 } from "lucide-react";
import WebsitePlanCard, { type Entitlement } from "./WebsitePlanCard";
import LookPicker, { type Look } from "./LookPicker";
import {
  SITE_LIMITS,
  SITE_STATS_MAX,
  SITE_TESTIMONIALS_MAX,
  normaliseSlug,
  slugProblem,
  type BrokerSiteRow,
  type SiteSections,
  type SiteStat,
  type SiteTestimonial,
} from "@/lib/brokerSite";

type Boat = {
  id: string;
  name: string;
  specs: string;
  status: string;
  soldAt: string | null;
  hidden: boolean;
  pocket: boolean;
  hasPhotos: boolean;
  state: "on_site" | "hidden" | "no_photos" | "sold" | "pocket";
  slideshowSlug: string | null;
};

/** Same rule as the site (src/lib/brokerSiteServer.ts): pocket → never; sold → Recent sales; switched off; no photos. */
function boatState(b: Pick<Boat, "pocket" | "soldAt" | "hidden" | "hasPhotos">): Boat["state"] {
  if (b.pocket) return "pocket";
  if (b.soldAt) return "sold";
  if (b.hidden) return "hidden";
  if (!b.hasPhotos) return "no_photos";
  return "on_site";
}

type Payload = {
  ready: boolean;
  heroThumb: string | null;
  brokerId: string;
  role: "broker" | "assistant" | "admin";
  brokers: { id: string; name: string }[];
  hasAccess: boolean;
  entitlement: Entitlement | null;
  canBuy: boolean;
  isSelf: boolean;
  site: BrokerSiteRow | null;
  suggestedSlug: string;
  broker: { name: string; firstName: string; phone: string; email: string; bio: string; logoUrl: string | null; brokerageName: string; license: string; brandAccent?: string | null };
  /** Layouts & colours switched on (migration 20261026d). */
  lookReady?: boolean;
  portraitUrl: string | null;
  listings: Boat[];
  /** listings.site_hidden exists (migration 20261026c). */
  hiddenReady?: boolean;
};

type Lead = {
  id: string;
  kind: "showing" | "contact" | "valuation";
  name: string | null;
  email: string | null;
  phone: string | null;
  contact_pref: string | null;
  inquiry_type: string | null;
  message: string | null;
  boat: { builder?: string; model?: string; year?: string; length?: string } | null;
  created_at: string;
  handled_at: string | null;
  listings: { vessel_name: string | null; year: number | null; make: string | null; model: string | null; length_ft: number | null } | null;
};

const input =
  "w-full bg-white border border-hairline-strong text-ink-900 placeholder:text-ink-400 rounded-ctl px-4 py-2.5 text-sm focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/40 transition-colors duration-fast ease-quiet";
const labelCls = "block label-caps mb-1.5";
const card = "bg-white border border-hairline rounded-card shadow-elev-1 p-5 sm:p-6 mb-5";
const inkBtn =
  "inline-flex items-center justify-center gap-2 min-h-[44px] px-5 bg-ink-950 hover:bg-ink-800 disabled:opacity-40 disabled:pointer-events-none text-white text-sm font-medium rounded-ctl transition-colors duration-fast ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2";
const quietBtn =
  "inline-flex items-center justify-center gap-2 min-h-[44px] px-4 border border-hairline-strong text-ink-800 hover:bg-ink-50 disabled:opacity-40 disabled:pointer-events-none text-sm font-medium rounded-ctl transition-colors duration-fast ease-quiet";

const SECTION_LABELS: { key: keyof SiteSections; label: string; hint: string }[] = [
  { key: "sold", label: "Recent sales", hint: "Boats you've marked sold" },
  { key: "about", label: "About", hint: "Portrait, bio, credentials, brokerage" },
  { key: "testimonials", label: "Testimonials", hint: "Shown when you've added at least one" },
  { key: "sell", label: "Selling your yacht?", hint: "The “What's my boat worth?” form" },
];

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-base ease-quiet disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 ${on ? "bg-success-600" : "bg-ink-300"}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-base ease-quiet ${on ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

function leadBoat(l: Lead): string | null {
  if (l.kind === "valuation" && l.boat) return [l.boat.year, l.boat.builder, l.boat.model, l.boat.length ? `${l.boat.length} ft` : null].filter(Boolean).join(" ") || null;
  const b = l.listings;
  if (!b) return null;
  return b.vessel_name || [b.year, b.make, b.model].filter(Boolean).join(" ") || null;
}

/** The editor always shows four figure rows; empty ones are dropped on save. */
function pad4(stats: SiteStat[] | undefined | null): SiteStat[] {
  return Array.from({ length: SITE_STATS_MAX }, (_, i) => stats?.[i] ?? { value: "", label: "" });
}

const KIND_LABEL: Record<Lead["kind"], string> = { showing: "Showing request", contact: "Inquiry", valuation: "Valuation" };

export default function WebsiteEditor({ initialBrokerId }: { initialBrokerId: string | null }) {
  const router = useRouter();
  const [brokerId, setBrokerId] = useState<string | null>(initialBrokerId);
  const [data, setData] = useState<Payload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Editable fields
  const [headline, setHeadline] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [credentials, setCredentials] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [bio, setBio] = useState("");
  const [stats, setStats] = useState<SiteStat[]>([]);
  const [testimonials, setTestimonials] = useState<SiteTestimonial[]>([]);
  const [showPrices, setShowPrices] = useState(false);
  const [sections, setSections] = useState<SiteSections>({ sold: true, about: true, testimonials: true, sell: true });
  const [heroPhotoId, setHeroPhotoId] = useState<string | null>(null);
  const [heroThumb, setHeroThumb] = useState<string | null>(null);
  const [portrait, setPortrait] = useState<string | null>(null);
  const [look, setLook] = useState<Look>({ layout: "classic", palette: "harbor", accent: null });
  const [saveNote, setSaveNote] = useState<string | null>(null);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<{ text: string; field?: string } | null>(null);

  // Slug
  const [slugInput, setSlugInput] = useState("");
  const [slugMsg, setSlugMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [slugBusy, setSlugBusy] = useState(false);
  const [editingSlug, setEditingSlug] = useState(false);

  // Hero picker
  const [pickListing, setPickListing] = useState("");
  const [pickPhotos, setPickPhotos] = useState<{ id: string; url: string }[] | null>(null);
  const [pickBusy, setPickBusy] = useState(false);

  const [portraitBusy, setPortraitBusy] = useState(false);
  const [portraitErr, setPortraitErr] = useState<string | null>(null);
  const portraitInput = useRef<HTMLInputElement>(null);

  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [boatBusy, setBoatBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [origin, setOrigin] = useState("https://portal.yachtpics.com");

  const q = brokerId ? `?brokerId=${encodeURIComponent(brokerId)}` : "";
  const qa = brokerId ? `&brokerId=${encodeURIComponent(brokerId)}` : "";

  const applySite = useCallback((site: BrokerSiteRow | null, extra?: { heroThumb?: string | null; portraitUrl?: string | null; bio?: string }) => {
    setHeadline(site?.headline ?? "");
    setSpecialty(site?.specialty ?? "");
    setCredentials(site?.credentials ?? "");
    setWhatsapp(site?.whatsapp ?? "");
    setStats(pad4(site?.stats));
    setTestimonials(site?.testimonials ?? []);
    setShowPrices(site?.show_prices ?? false);
    setSections(site?.sections ?? { sold: true, about: true, testimonials: true, sell: true });
    setHeroPhotoId(site?.hero_photo_id ?? null);
    setLook({ layout: site?.layout ?? "classic", palette: site?.palette ?? "harbor", accent: site?.accent ?? null });
    if (extra && "heroThumb" in extra) setHeroThumb(extra.heroThumb ?? null);
    if (extra && "portraitUrl" in extra) setPortrait(extra.portraitUrl ?? null);
    if (extra && typeof extra.bio === "string") setBio(extra.bio);
    setDirty(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/website${q}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(json.error ?? "Couldn't load your website.");
        setData(null);
        return;
      }
      const p = json as Payload;
      setData(p);
      applySite(p.site, { heroThumb: p.heroThumb, portraitUrl: p.portraitUrl, bio: p.broker.bio });
      setSlugInput(p.site?.slug ?? p.suggestedSlug ?? "");
      setSlugMsg(null);
      setEditingSlug(false);
      if (p.ready && p.site) {
        const lr = await fetch(`/api/website/leads${q}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
        setLeads(lr && Array.isArray(lr.leads) ? (lr.leads as Lead[]) : []);
      } else {
        setLeads(null);
      }
    } catch {
      setLoadError("Couldn't load your website — check your connection.");
    } finally {
      setLoading(false);
    }
  }, [q, applySite]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOrigin(window.location.origin); }, []);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const touch = () => { setDirty(true); setSavedAt(null); };

  // ── Actions ────────────────────────────────────────────────────────────────

  const checkSlug = async (claim: boolean) => {
    const slug = normaliseSlug(slugInput);
    setSlugInput(slug);
    const problem = slugProblem(slug);
    if (problem) { setSlugMsg({ ok: false, text: problem }); return; }
    setSlugBusy(true);
    try {
      const res = await fetch(`/api/website${q}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: claim ? "claim_slug" : "check_slug", slug }),
      });
      const json = await res.json().catch(() => ({}));
      if (json.available === false || !res.ok) {
        setSlugMsg({ ok: false, text: json.error ?? "That address isn't available." });
        return;
      }
      if (claim) {
        await load();
        setSlugMsg({ ok: true, text: "Saved." });
      } else {
        setSlugMsg({ ok: true, text: "Available." });
      }
    } finally {
      setSlugBusy(false);
    }
  };

  const save = async (extra?: Record<string, unknown>) => {
    setSaveError(null);
    if (whatsapp.trim() && whatsapp.replace(/\D/g, "").length < 8) {
      setSaveError({ text: "WhatsApp needs the full number with country code, e.g. +1 561 555 0100.", field: "whatsapp" });
      return false;
    }
    const halfStat = stats.some((s) => (s.value.trim() && !s.label.trim()) || (!s.value.trim() && s.label.trim()));
    if (halfStat) {
      setSaveError({ text: "Each figure needs both a number and a label (e.g. “22 years” · “In the business”).", field: "stats" });
      return false;
    }
    const halfQuote = testimonials.some((t) => (t.quote.trim() && !t.name.trim()) || (!t.quote.trim() && t.name.trim()));
    if (halfQuote) {
      setSaveError({ text: "Each testimonial needs the words and a name.", field: "testimonials" });
      return false;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/website${q}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headline, specialty, credentials, whatsapp, bio,
          layout: look.layout, palette: look.palette, accent: look.accent,
          stats: stats.filter((x) => x.value.trim() || x.label.trim()), testimonials, show_prices: showPrices, sections, hero_photo_id: heroPhotoId,
          ...(extra ?? {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError({ text: json.error ?? "Couldn't save. Please try again.", field: json.field });
        return false;
      }
      if (json.site) setData((d) => (d ? { ...d, site: json.site as BrokerSiteRow } : d));
      setStats(pad4((json.site?.stats as SiteStat[] | undefined) ?? stats));
      setTestimonials((json.site?.testimonials as SiteTestimonial[] | undefined) ?? testimonials);
      setDirty(false);
      setSavedAt(Date.now());
      setSaveNote(typeof json.warning === "string" ? json.warning : null);
      return true;
    } catch {
      setSaveError({ text: "Couldn't save — check your connection." });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const setPublished = async (on: boolean) => {
    setPublishBusy(true);
    // Publishing also saves anything pending, so the live page matches the editor.
    await save({ published: on });
    setPublishBusy(false);
  };

  const openPicker = async (listingId: string) => {
    setPickListing(listingId);
    setPickPhotos(null);
    if (!listingId) return;
    setPickBusy(true);
    try {
      const res = await fetch(`/api/website?photos=${encodeURIComponent(listingId)}${qa}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      setPickPhotos(Array.isArray(json.photos) ? json.photos : []);
    } finally {
      setPickBusy(false);
    }
  };

  const uploadPortrait = async (file: File) => {
    setPortraitErr(null);
    setPortraitBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/website/portrait${q}`, { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setPortraitErr(json.error ?? "Upload failed."); return; }
      setPortrait(json.url ?? null);
    } finally {
      setPortraitBusy(false);
      if (portraitInput.current) portraitInput.current.value = "";
    }
  };

  const removePortrait = async () => {
    setPortraitBusy(true);
    try {
      await fetch(`/api/website/portrait${q}`, { method: "DELETE" });
      setPortrait(null);
    } finally {
      setPortraitBusy(false);
    }
  };

  const markSold = async (boat: Boat, sold: boolean) => {
    setBoatBusy(boat.id);
    try {
      const res = await fetch(`/api/website${q}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_sold", listingId: boat.id, sold }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { alert(json.error ?? "Couldn't update that boat."); return; }
      setData((d) => {
        if (!d) return d;
        return {
          ...d,
          listings: d.listings.map((l) =>
            l.id !== boat.id
              ? l
              : { ...l, soldAt: json.soldAt ?? null, state: boatState({ ...l, soldAt: json.soldAt ?? null }) }
          ),
        };
      });
    } finally {
      setBoatBusy(null);
    }
  };

  const setHidden = async (boat: Boat, hidden: boolean) => {
    setBoatBusy(boat.id);
    try {
      const res = await fetch(`/api/website${q}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_hidden", listingId: boat.id, hidden }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { alert(json.error ?? "Couldn't update that boat."); return; }
      setData((d) => (d ? { ...d, listings: d.listings.map((l) => (l.id !== boat.id ? l : { ...l, hidden, state: boatState({ ...l, hidden }) })) } : d));
    } finally {
      setBoatBusy(null);
    }
  };

  const markHandled = async (lead: Lead, handled: boolean) => {
    const res = await fetch(`/api/website/leads${q}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: lead.id, handled }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) setLeads((ls) => (ls ?? []).map((l) => (l.id === lead.id ? { ...l, handled_at: json.handledAt ?? null } : l)));
  };

  const switchBroker = (id: string) => {
    if (dirty && !confirm("You have unsaved changes. Switch broker anyway?")) return;
    setBrokerId(id);
    router.replace(`/dashboard/website?brokerId=${encodeURIComponent(id)}`);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const header = (
    <div className="mb-6 pb-6 border-b border-hairline">
      <h1 className="text-display text-ink-900">Website</h1>
      <p className="text-ink-500 mt-1 text-sm max-w-2xl">
        Your own website at portal.yachtpics.com/b/… — it fills itself from your listings. Boats appear when their slideshow is published.
      </p>
      {data && data.brokers.length > 1 && (
        <div className="mt-4 max-w-xs">
          <label className={labelCls} htmlFor="site-broker">Broker</label>
          <select id="site-broker" className={input} value={data.brokerId} onChange={(e) => switchBroker(e.target.value)}>
            {data.brokers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}
      {data && data.role === "admin" && <p className="mt-3 text-xs text-ink-500">Editing for <span className="font-semibold text-ink-800">{data.broker.name || "this broker"}</span> as admin.</p>}
    </div>
  );

  if (loading && !data) {
    return <div className="px-4 sm:px-6 py-8 max-w-3xl mx-auto">{header}<p className="text-ink-400 text-sm">Loading…</p></div>;
  }
  if (loadError || !data) {
    return (
      <div className="px-4 sm:px-6 py-8 max-w-3xl mx-auto">
        {header}
        <div className={card}><p className="text-sm text-ink-700">{loadError ?? "Couldn't load your website."}</p></div>
      </div>
    );
  }
  if (!data.ready) {
    return (
      <div className="px-4 sm:px-6 py-8 max-w-3xl mx-auto">
        {header}
        <div className={card}>
          <p className="text-h2 text-ink-900">Website isn&rsquo;t switched on yet</p>
          <p className="text-sm text-ink-500 mt-1">It&rsquo;s almost ready. Check back soon.</p>
        </div>
      </div>
    );
  }

  const site = data.site;
  const live = data.entitlement?.live === true;
  const offlineBanner = (
    <WebsitePlanCard ent={data.entitlement} role={data.role} canBuy={data.canBuy} isSelf={data.isSelf} brokerId={data.brokerId} onChanged={load} />
  );

  // ── No site yet: create card ──
  if (!site) {
    return (
      <div className="px-4 sm:px-6 py-8 max-w-3xl mx-auto">
        {header}
        {offlineBanner}
        <div className={card}>
          <h2 className="text-h2 text-ink-900">Create your website</h2>
          <p className="text-sm text-ink-500 mt-1 mb-5">
            Pick your address. Your published listings, your bio and a contact form are ready the moment you create it — nothing goes live until you switch it on.
          </p>
          <label className={labelCls} htmlFor="slug">Your address</label>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="text-sm text-ink-500 whitespace-nowrap">portal.yachtpics.com/b/</span>
            <input
              id="slug"
              className={input}
              value={slugInput}
              onChange={(e) => { setSlugInput(e.target.value.toLowerCase()); setSlugMsg(null); }}
              onBlur={() => slugInput && checkSlug(false)}
              placeholder="your-name"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={60}
            />
          </div>
          {slugMsg && <p className={`text-xs mt-2 ${slugMsg.ok ? "text-success-700" : "text-danger-600"}`}>{slugMsg.text}</p>}
          <p className="text-xs text-ink-500 mt-2">Lowercase letters, numbers and hyphens. You can change it later.</p>
          <button type="button" className={inkBtn + " mt-5"} disabled={slugBusy || !slugInput} onClick={() => checkSlug(true)}>
            {slugBusy ? "Creating…" : "Create my website"}
          </button>
        </div>
      </div>
    );
  }

  const siteUrl = `${origin}/b/${site.slug}`;
  const displayUrl = siteUrl.replace(/^https?:\/\//, "");
  const pickable = data.listings.filter((l) => l.state === "on_site" || l.state === "hidden");
  const unhandled = (leads ?? []).filter((l) => !l.handled_at).length;

  return (
    <div className="px-4 sm:px-6 py-8 max-w-3xl mx-auto">
      {header}
      {offlineBanner}

      {/* Look */}
      <section className={card}>
        <h2 className="text-h2 text-ink-900">Look</h2>
        <p className="text-sm text-ink-500 mt-1 mb-4">Choose a layout and colours. Everything is designed to work together, so any choice looks right.</p>
        <LookPicker
          look={look}
          onChange={(next) => { setLook(next); touch(); }}
          brandAccent={data.broker.brandAccent ?? null}
          slug={site.slug}
          ready={data.lookReady !== false}
        />
      </section>

      {/* Publish */}
      <section className={card}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-h2 text-ink-900">{site.published ? (live ? "Your website is live" : "Publish is on — not live yet") : "Your website is off"}</h2>
            <p className="text-sm text-ink-500 mt-1">
              {site.published
                ? live ? "Anyone with the link can see it." : "It goes live as soon as the website is included in your account (see above)."
                : "Switch it on when you're happy with it."}
            </p>
          </div>
          <Toggle on={site.published} onChange={setPublished} label="Publish website" disabled={publishBusy || saving} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <a href={siteUrl} target="_blank" rel="noopener noreferrer" className={quietBtn}>
            <ExternalLink className="w-4 h-4" aria-hidden /> View site
          </a>
          <button
            type="button"
            className={quietBtn}
            onClick={() => { navigator.clipboard?.writeText(siteUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }, () => {}); }}
          >
            {copied ? <Check className="w-4 h-4" aria-hidden /> : <Copy className="w-4 h-4" aria-hidden />} {copied ? "Copied" : "Copy link"}
          </button>
          <span className="text-xs text-ink-500 break-all">{displayUrl}</span>
        </div>
        {(!site.published || !live) && <p className="text-xs text-ink-500 mt-3">Until it&rsquo;s live, the link shows &ldquo;This page isn&rsquo;t available&rdquo;.</p>}
        <div className="mt-4 pt-4 border-t border-hairline">
          {!editingSlug ? (
            <button type="button" onClick={() => { setEditingSlug(true); setSlugInput(site.slug); setSlugMsg(null); }} className="text-sm text-accent-700 hover:text-accent-800 font-medium min-h-[44px]">
              Change address
            </button>
          ) : (
            <div>
              <label className={labelCls} htmlFor="slug-edit">Address</label>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <span className="text-sm text-ink-500 whitespace-nowrap">/b/</span>
                <input id="slug-edit" className={input} value={slugInput} onChange={(e) => { setSlugInput(e.target.value.toLowerCase()); setSlugMsg(null); }} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={60} />
                <button type="button" className={inkBtn} disabled={slugBusy} onClick={() => checkSlug(true)}>{slugBusy ? "Saving…" : "Save address"}</button>
                <button type="button" className={quietBtn} onClick={() => { setEditingSlug(false); setSlugMsg(null); }}>Cancel</button>
              </div>
              {slugMsg && <p className={`text-xs mt-2 ${slugMsg.ok ? "text-success-700" : "text-danger-600"}`}>{slugMsg.text}</p>}
              <p className="text-xs text-ink-500 mt-2">The old link stops working when you change it.</p>
            </div>
          )}
        </div>
      </section>

      {/* Hero */}
      <section className={card}>
        <h2 className="text-h2 text-ink-900 mb-4">Top of the page</h2>
        <div className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="headline">Headline</label>
            <input id="headline" className={input} value={headline} maxLength={SITE_LIMITS.headline} onChange={(e) => { setHeadline(e.target.value); touch(); }} placeholder="Sportfish and motor yachts, 50–90 ft · Palm Beach" />
            <p className="text-xs text-ink-500 mt-1">One line under your name. Leave empty to hide it.</p>
          </div>
          <div>
            <label className={labelCls} htmlFor="specialty">Specialty</label>
            <input id="specialty" className={input} value={specialty} maxLength={SITE_LIMITS.specialty} onChange={(e) => { setSpecialty(e.target.value); touch(); }} placeholder="Viking, Hatteras and Bertram specialist" />
          </div>
          <div>
            <p className={labelCls}>Photo</p>
            <div className="flex items-center gap-4">
              <div className="relative w-36 aspect-[3/2] rounded-ctl overflow-hidden bg-ink-100 border border-hairline shrink-0">
                {heroPhotoId && heroThumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={heroThumb} alt="Chosen photo" className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center text-[0.6875rem] text-ink-500 text-center px-2">Cover of your newest boat</span>
                )}
              </div>
              {heroPhotoId && (
                <button type="button" className={quietBtn} onClick={() => { setHeroPhotoId(null); setHeroThumb(null); touch(); }}>Use newest boat&rsquo;s cover</button>
              )}
            </div>
            {pickable.length > 0 ? (
              <div className="mt-3">
                <label className="sr-only" htmlFor="hero-listing">Choose a listing</label>
                <select id="hero-listing" className={input} value={pickListing} onChange={(e) => openPicker(e.target.value)}>
                  <option value="">Choose a photo from one of your listings…</option>
                  {pickable.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                {pickBusy && <p className="text-xs text-ink-500 mt-2">Loading photos…</p>}
                {pickPhotos && pickPhotos.length === 0 && <p className="text-xs text-ink-500 mt-2">No photos on this listing yet.</p>}
                {pickPhotos && pickPhotos.length > 0 && (
                  <ul className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-80 overflow-y-auto pr-1">
                    {pickPhotos.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => { setHeroPhotoId(p.id); setHeroThumb(p.url); touch(); }}
                          aria-pressed={heroPhotoId === p.id}
                          className={`relative block w-full aspect-[3/2] rounded-ctl overflow-hidden border-2 ${heroPhotoId === p.id ? "border-accent-500" : "border-transparent hover:border-ink-300"}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.url} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-xs text-ink-500 mt-2">Add a listing to choose a photo.</p>
            )}
          </div>
        </div>
      </section>

      {/* Proof strip */}
      <section className={card}>
        <h2 className="text-h2 text-ink-900">At a glance</h2>
        <p className="text-sm text-ink-500 mt-1 mb-4">Up to {SITE_STATS_MAX} short facts under the photo, like &ldquo;22 years&rdquo; · &ldquo;In the business&rdquo;. Hidden when empty.</p>
        <div className="space-y-2">
          {pad4(stats).map((s, i) => {
            const setAt = (patch: Partial<SiteStat>) => {
              setStats(pad4(stats).map((x, j) => (j === i ? { ...x, ...patch } : x)));
              touch();
            };
            return (
              <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
                <input aria-label={`Figure ${i + 1}`} className={input} value={s.value} maxLength={SITE_LIMITS.statValue} onChange={(e) => setAt({ value: e.target.value })} placeholder={["22 years", "140+", "$600M", "CPYB"][i]} />
                <input aria-label={`Label ${i + 1}`} className={input} value={s.label} maxLength={SITE_LIMITS.statLabel} onChange={(e) => setAt({ label: e.target.value })} placeholder={["In the business", "Yachts sold", "In sales", "Certified Professional Yacht Broker"][i]} />
              </div>
            );
          })}
        </div>
        {saveError?.field === "stats" && <p className="text-xs text-danger-600 mt-2">{saveError.text}</p>}
      </section>

      {/* About */}
      <section className={card}>
        <h2 className="text-h2 text-ink-900 mb-4">About you</h2>
        <div className="space-y-4">
          <div>
            <p className={labelCls}>Portrait</p>
            <div className="flex items-center gap-4">
              <div className="relative w-20 aspect-[4/5] rounded-ctl overflow-hidden bg-ink-100 border border-hairline shrink-0">
                {portrait && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={portrait} alt="Your portrait" className="absolute inset-0 w-full h-full object-cover" />
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={quietBtn} disabled={portraitBusy} onClick={() => portraitInput.current?.click()}>
                  {portraitBusy ? "Uploading…" : portrait ? "Replace" : "Upload portrait"}
                </button>
                {portrait && <button type="button" className={quietBtn} disabled={portraitBusy} onClick={removePortrait}>Remove</button>}
              </div>
              <input ref={portraitInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPortrait(f); }} />
            </div>
            {portraitErr && <p className="text-xs text-danger-600 mt-2">{portraitErr}</p>}
            <p className="text-xs text-ink-500 mt-2">A vertical photo works best. PNG, JPG or WebP, under 5 MB.</p>
          </div>
          <div>
            <label className={labelCls} htmlFor="bio">Bio</label>
            <textarea id="bio" rows={6} className={input + " resize-y"} value={bio} maxLength={SITE_LIMITS.bio} onChange={(e) => { setBio(e.target.value); touch(); }} />
            <p className="text-xs text-ink-500 mt-1">The same bio your slideshows use. Leave a blank line between paragraphs.</p>
          </div>
          <div>
            <label className={labelCls} htmlFor="credentials">Credentials</label>
            <input id="credentials" className={input} value={credentials} maxLength={SITE_LIMITS.credentials} onChange={(e) => { setCredentials(e.target.value); touch(); }} placeholder="CPYB · Member, Yacht Brokers Association of America" />
          </div>
          <div>
            <label className={labelCls} htmlFor="whatsapp">WhatsApp</label>
            <input id="whatsapp" type="tel" className={input} value={whatsapp} maxLength={SITE_LIMITS.whatsapp} onChange={(e) => { setWhatsapp(e.target.value); touch(); }} placeholder="+1 561 555 0100" />
            {saveError?.field === "whatsapp" ? (
              <p className="text-xs text-danger-600 mt-1">{saveError.text}</p>
            ) : (
              <p className="text-xs text-ink-500 mt-1">Optional. Adds a WhatsApp button. Include the country code.</p>
            )}
          </div>
          <p className="text-xs text-ink-500">
            Phone, email, brokerage, license and logo come from <Link href="/dashboard/profile" className="text-accent-700 hover:underline">My Profile</Link>
            {data.role !== "broker" ? " (the broker's profile)" : ""}.
          </p>
        </div>
      </section>

      {/* Testimonials */}
      <section className={card}>
        <h2 className="text-h2 text-ink-900">Testimonials</h2>
        <p className="text-sm text-ink-500 mt-1 mb-4">Up to {SITE_TESTIMONIALS_MAX} short quotes from clients, with their permission.</p>
        <ul className="space-y-4">
          {testimonials.map((t, i) => {
            const setAt = (patch: Partial<SiteTestimonial>) => { setTestimonials(testimonials.map((x, j) => (j === i ? { ...x, ...patch } : x))); touch(); };
            const move = (dir: -1 | 1) => {
              const j = i + dir;
              if (j < 0 || j >= testimonials.length) return;
              const next = testimonials.slice();
              const tmp = next[i]; next[i] = next[j]; next[j] = tmp;
              setTestimonials(next); touch();
            };
            return (
              <li key={i} className="border border-hairline rounded-ctl p-3">
                <textarea aria-label={`Quote ${i + 1}`} rows={3} className={input + " resize-y"} value={t.quote} maxLength={SITE_LIMITS.quote} onChange={(e) => setAt({ quote: e.target.value })} placeholder="What the client said" />
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input aria-label={`Name ${i + 1}`} className={input} value={t.name} maxLength={SITE_LIMITS.quoteName} onChange={(e) => setAt({ name: e.target.value })} placeholder="Name" />
                  <input aria-label={`City ${i + 1}`} className={input} value={t.place} maxLength={SITE_LIMITS.quotePlace} onChange={(e) => setAt({ place: e.target.value })} placeholder="City (optional)" />
                </div>
                <div className="mt-2 flex gap-1 justify-end">
                  <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(-1)} className="w-11 h-11 inline-flex items-center justify-center rounded-ctl text-ink-500 hover:bg-ink-50 disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
                  <button type="button" aria-label="Move down" disabled={i === testimonials.length - 1} onClick={() => move(1)} className="w-11 h-11 inline-flex items-center justify-center rounded-ctl text-ink-500 hover:bg-ink-50 disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
                  <button type="button" aria-label="Remove" onClick={() => { setTestimonials(testimonials.filter((_, j) => j !== i)); touch(); }} className="w-11 h-11 inline-flex items-center justify-center rounded-ctl text-danger-600 hover:bg-danger-50"><Trash2 className="w-4 h-4" /></button>
                </div>
              </li>
            );
          })}
        </ul>
        {saveError?.field === "testimonials" && <p className="text-xs text-danger-600 mt-2">{saveError.text}</p>}
        {testimonials.length < SITE_TESTIMONIALS_MAX && (
          <button type="button" className={quietBtn + " mt-3"} onClick={() => { setTestimonials(testimonials.concat([{ quote: "", name: "", place: "" }])); touch(); }}>
            Add a testimonial
          </button>
        )}
      </section>

      {/* Options */}
      <section className={card}>
        <h2 className="text-h2 text-ink-900 mb-4">What&rsquo;s on the page</h2>
        <ul className="divide-y divide-hairline">
          <li className="py-3 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-ink-900">Show prices</p>
              <p className="text-xs text-ink-500">Off: every boat reads &ldquo;Price on request&rdquo;.</p>
            </div>
            <Toggle on={showPrices} onChange={(v) => { setShowPrices(v); touch(); }} label="Show prices" />
          </li>
          {SECTION_LABELS.map((s) => (
            <li key={s.key} className="py-3 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-ink-900">{s.label}</p>
                <p className="text-xs text-ink-500">{s.hint}</p>
              </div>
              <Toggle on={sections[s.key]} onChange={(v) => { setSections({ ...sections, [s.key]: v }); touch(); }} label={s.label} />
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-500 mt-3">Yachts and Contact are always on.</p>
      </section>

      {/* Boats */}
      <section className={card}>
        <h2 className="text-h2 text-ink-900">Your boats</h2>
        <p className="text-sm text-ink-500 mt-1 mb-4">Every active boat with photos shows on your site, with its own page and slideshow. Switch one off to leave it out. Pocket listings never show. Mark a boat sold to move it to Recent sales.</p>
        {data.listings.length === 0 ? (
          <p className="text-sm text-ink-500">No active listings yet.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {data.listings.map((b) => (
              <li key={b.id} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/dashboard/listings/${b.id}`} className="text-sm font-semibold text-ink-900 hover:underline">{b.name}</Link>
                  {b.specs && <p className="text-xs text-ink-500">{b.specs}</p>}
                  <p className="mt-1">
                    {b.state === "on_site" && <span className="text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full bg-success-50 text-success-700 border border-success-200">On your site</span>}
                    {b.state === "hidden" && <span className="text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full bg-ink-100 text-ink-600 border border-hairline">Switched off — not shown</span>}
                    {b.state === "no_photos" && (
                      <Link href={`/dashboard/listings/${b.id}`} className="text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full bg-ink-100 text-ink-600 border border-hairline hover:bg-ink-200">
                        Not shown — no photos yet
                      </Link>
                    )}
                    {b.state === "pocket" && <span className="text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full bg-ink-100 text-ink-600 border border-hairline">Pocket listing — not shown</span>}
                    {b.state === "sold" && <span className="text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full bg-accent-50 text-accent-800 border border-accent-200">Sold{sections.sold ? " — in Recent sales" : ""}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {!b.pocket && !b.soldAt && data.hiddenReady !== false && (
                    <label className="inline-flex items-center gap-2 text-xs text-ink-700 min-h-[44px]">
                      <Toggle on={!b.hidden} onChange={(v) => setHidden(b, !v)} label={`Show ${b.name} on my website`} disabled={boatBusy === b.id} />
                      <span>Show on my website</span>
                    </label>
                  )}
                  {!b.pocket && (
                    <button type="button" className={quietBtn} disabled={boatBusy === b.id} onClick={() => markSold(b, !b.soldAt)}>
                      {boatBusy === b.id ? "…" : b.soldAt ? "Back on the market" : "Mark sold"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Inquiries */}
      <section id="inquiries" className={card + " scroll-mt-20"}>
        <h2 className="text-h2 text-ink-900">Inquiries{unhandled > 0 ? ` (${unhandled} new)` : ""}</h2>
        <p className="text-sm text-ink-500 mt-1 mb-4">Every message from your website also goes straight to {data.broker.email || "your email"}.</p>
        {leads === null ? (
          <p className="text-sm text-ink-400">Loading…</p>
        ) : leads.length === 0 ? (
          <p className="text-sm text-ink-500">No inquiries yet.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {leads.map((l) => {
              const boat = leadBoat(l);
              return (
                <li key={l.id} className={`py-4 ${l.handled_at ? "opacity-60" : ""}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-ink-900">
                      {KIND_LABEL[l.kind]}{boat ? ` · ${boat}` : ""}{l.kind === "contact" && l.inquiry_type ? ` · ${l.inquiry_type}` : ""}
                    </p>
                    <p className="text-xs text-ink-500 tabular-nums">{fmtDate(l.created_at)}</p>
                  </div>
                  <p className="text-sm text-ink-800 mt-1">
                    {l.name}
                    {l.email && <> · <a href={`mailto:${l.email}`} className="text-accent-700 hover:underline break-all">{l.email}</a></>}
                    {l.phone && <> · <a href={`tel:${l.phone.replace(/[^\d+]/g, "")}`} className="text-accent-700 hover:underline">{l.phone}</a></>}
                    {l.contact_pref && <span className="text-ink-500"> · prefers {l.contact_pref.toLowerCase()}</span>}
                  </p>
                  {l.message && <p className="text-sm text-ink-600 mt-1 whitespace-pre-line">{l.message}</p>}
                  <button type="button" onClick={() => markHandled(l, !l.handled_at)} className="mt-2 text-xs font-medium text-accent-700 hover:text-accent-800 min-h-[36px]">
                    {l.handled_at ? "Mark as new" : "Mark handled"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Save bar */}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4 z-30">
        <div>
          <div className="bg-white border border-hairline rounded-card shadow-elev-3 px-4 py-3 flex items-center justify-between gap-3">
            <p className={`text-sm ${saveError ? "text-danger-600" : dirty ? "text-ink-700" : "text-ink-500"}`}>
              {saveError ? saveError.text : saving ? "Saving…" : dirty ? "You have unsaved changes." : savedAt ? (saveNote ?? "Saved.") : "All changes saved."}
            </p>
            <button type="button" className={inkBtn} disabled={saving || !dirty} onClick={() => save()}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
