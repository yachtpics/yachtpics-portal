import type { SupabaseClient } from "@supabase/supabase-js";
import { getEffectiveAccessStatus } from "@/lib/brokerAccess";
import { hasAccess } from "@/lib/subscriptionAccess";
import { heroImage } from "@/lib/slideshowReadyCampaign";
import type { EmailImage } from "@/lib/emailCoverImage";
import { isTestBroker, todayET, etMidnightUtc } from "@/lib/reviewReel";
import { unsubscribeFooterHtml, unsubscribeHeaders } from "@/lib/unsubscribe";
import { sendResendBatch, type BatchEmail } from "@/lib/sendEmailBatch";
import { logEmail } from "@/lib/logEmail";
import { newEmailLogId, trackEmailHtml } from "@/lib/emailTracking";
import { BILLING_PATH, PLAN_FROM_PRICE } from "@/lib/planValue";

/**
 * "Your boats this month" (Nov 1) — SERVER ONLY.
 *
 * The Seller Report, pushed: on the 1st, every broker with live listings
 * (paying or not) and each of their assistants gets last month's numbers for
 * every active boat — buyer views, unique visitors, the photo buyers lingered
 * on, dock-card scans, photo downloads, inquiries — without pressing a button.
 *
 * Who: brokers (role broker) with ≥ 1 active, unsold listing that has ≥ 1
 * visible photo; not opted out (profiles.email_opt_out), not hard-bounced
 * (email_bounced_at), has an address, not a test account (isTestBroker).
 * Plus every assistant (broker_assistants) of those brokers, ONE email per
 * assistant: one broker → "{Broker}'s boats in October"; several → a section
 * per broker. Dedup: email_log type monthlyReportType(month), status sent,
 * per recipient — a second run (manual or cron) never sends twice.
 *
 * Numbers (calendar month in Eastern time; same definitions as the Seller
 * Report's buildEngagement in src/lib/engagement.ts, batched — one query per
 * table for the month across all listings, never per listing):
 *   views        slideshow_views rows
 *   visitors     distinct session_id + sessionless views
 *   top photo    slideshow_events dwell seconds + 15 per favorite (category)
 *   scans        slideshow_views whose source is a boat_shows key (dock-card
 *                QR codes carry ?src={show key}), distinct visits
 *   downloads    photo_downloads.photo_count summed (admins' downloads left out)
 *   inquiries    listing_leads (slideshow Inquire) + site_leads tagged to the
 *                listing (broker website)
 *
 * Driven from /admin/announce/monthly-report; the daily cron sends it on the
 * 1st at ~9 AM ET only when the "Schedule automatically" switch
 * (app_settings MONTHLY_REPORT_AUTO_KEY) is on and that month's batch hasn't
 * been sent (/api/cron/monthly-report).
 */

export const MONTHLY_REPORT_AUTO_KEY = "monthly_report_auto";
const FROM = "Charlie & Samantha at YachtPics <hello@yachtpics.com>";
const PORTAL = "https://portal.yachtpics.com";
const MAX_ROWS = 8;

// ── Months ──────────────────────────────────────────────────────────────────

export function isMonth(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The current month in Eastern time, "YYYY-MM". */
export function currentMonthET(now: Date = new Date()): string {
  return todayET(now).slice(0, 7);
}

/** Last calendar month in Eastern time — what a send on the 1st covers. */
export function previousMonthET(now: Date = new Date()): string {
  return shiftMonth(currentMonthET(now), -1);
}

/** The last n completed months, newest first (for the admin picker). */
export function recentMonths(n: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) out.push(shiftMonth(currentMonthET(now), -i));
  return out;
}

/** Only whole, finished months can be reported. */
export function isCompletedMonth(month: string, now: Date = new Date()): boolean {
  return isMonth(month) && month < currentMonthET(now);
}

export function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
}

export function monthLabel(month: string): string {
  return `${monthName(month)} ${month.slice(0, 4)}`;
}

export function monthWindow(month: string): { fromIso: string; toIso: string } {
  return { fromIso: etMidnightUtc(`${month}-01`), toIso: etMidnightUtc(`${shiftMonth(month, 1)}-01`) };
}

export function monthlyReportType(month: string): string {
  return `monthly_report:${month}`;
}

// ── Data ────────────────────────────────────────────────────────────────────

type PageResult = { data: unknown[] | null; error: { message: string } | null };

/** All rows of a query, 1,000 at a time. Optional tables: an error = no rows. */
async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<PageResult>, optional = false): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 200000; from += 1000) {
    const { data, error } = await fetchPage(from, from + 999);
    if (error) {
      if (optional) return out;
      throw new Error(error.message);
    }
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export type ListingStats = {
  views: number;
  visitors: number;
  scans: number;
  downloads: number;
  inquiries: number;
  /** Category of the photo buyers lingered on most, or null. */
  topPhoto: string | null;
  /** Ever sent to a client (client_sends), any month. */
  everSent: boolean;
};

const EMPTY_STATS: ListingStats = { views: 0, visitors: 0, scans: 0, downloads: 0, inquiries: 0, topPhoto: null, everSent: false };

/** The month's numbers for many listings — one query per table. */
export async function loadMonthStats(svc: SupabaseClient, listingIds: string[], month: string): Promise<Map<string, ListingStats>> {
  const { fromIso, toIso } = monthWindow(month);
  const want = new Set(listingIds);
  const stats = new Map<string, ListingStats>();
  const get = (id: string) => {
    let s = stats.get(id);
    if (!s) { s = { ...EMPTY_STATS }; stats.set(id, s); }
    return s;
  };

  const [views, events, downloads, leads, siteLeads, shows, admins] = await Promise.all([
    pageAll<{ listing_id: string; source: string | null; session_id: string | null }>((a, b) =>
      svc.from("slideshow_views").select("id, listing_id, source, session_id").gte("viewed_at", fromIso).lt("viewed_at", toIso).order("id").range(a, b)),
    pageAll<{ listing_id: string; photo_id: string | null; kind: string; value: number | null }>((a, b) =>
      svc.from("slideshow_events").select("id, listing_id, photo_id, kind, value").in("kind", ["dwell", "favorite", "unfavorite"]).gte("created_at", fromIso).lt("created_at", toIso).order("id").range(a, b)),
    pageAll<{ listing_id: string; photo_count: number | null; downloaded_by: string | null }>((a, b) =>
      svc.from("photo_downloads").select("id, listing_id, photo_count, downloaded_by").gte("downloaded_at", fromIso).lt("downloaded_at", toIso).order("id").range(a, b)),
    pageAll<{ listing_id: string }>((a, b) =>
      svc.from("listing_leads").select("id, listing_id").gte("created_at", fromIso).lt("created_at", toIso).order("id").range(a, b), true),
    pageAll<{ listing_id: string }>((a, b) =>
      svc.from("site_leads").select("id, listing_id").not("listing_id", "is", null).gte("created_at", fromIso).lt("created_at", toIso).order("id").range(a, b), true),
    pageAll<{ key: string }>((a, b) => svc.from("boat_shows").select("key").range(a, b), true),
    pageAll<{ id: string }>((a, b) => svc.from("profiles").select("id").eq("role", "admin").range(a, b)),
  ]);

  // Views, visitors, dock-card scans.
  const showKeys = new Set(shows.map((s) => s.key));
  const sessions = new Map<string, Set<string>>();
  const scanSessions = new Map<string, Set<string>>();
  for (const v of views) {
    if (!want.has(v.listing_id)) continue;
    const s = get(v.listing_id);
    s.views++;
    if (v.session_id) {
      const set = sessions.get(v.listing_id) ?? new Set<string>();
      set.add(v.session_id);
      sessions.set(v.listing_id, set);
    } else s.visitors++;
    if (v.source && showKeys.has(v.source)) {
      if (v.session_id) {
        const set = scanSessions.get(v.listing_id) ?? new Set<string>();
        set.add(v.session_id);
        scanSessions.set(v.listing_id, set);
      } else s.scans++;
    }
  }
  sessions.forEach((set, id) => { get(id).visitors += set.size; });
  scanSessions.forEach((set, id) => { get(id).scans += set.size; });

  // Top photo: dwell seconds + 15 per net favorite (the Seller Report's ranking).
  const perPhoto = new Map<string, { listingId: string; dwell: number; favs: number }>();
  for (const e of events) {
    if (!want.has(e.listing_id) || !e.photo_id) continue;
    const row = perPhoto.get(e.photo_id) ?? { listingId: e.listing_id, dwell: 0, favs: 0 };
    if (e.kind === "dwell") row.dwell += e.value ?? 0;
    else if (e.kind === "favorite") row.favs++;
    else if (e.kind === "unfavorite") row.favs = Math.max(0, row.favs - 1);
    perPhoto.set(e.photo_id, row);
  }
  const photoIds = Array.from(perPhoto.keys());
  const photoMeta = new Map<string, { listing_id: string; category: string | null }>();
  for (let i = 0; i < photoIds.length; i += 200) {
    const { data } = await svc.from("photos").select("id, listing_id, category").in("id", photoIds.slice(i, i + 200));
    ((data ?? []) as { id: string; listing_id: string; category: string | null }[]).forEach((p) => photoMeta.set(p.id, p));
  }
  const best = new Map<string, { score: number; category: string | null }>();
  perPhoto.forEach((r, photoId) => {
    const meta = photoMeta.get(photoId);
    if (!meta || meta.listing_id !== r.listingId) return; // deleted / moved photo
    const score = r.dwell + r.favs * 15;
    if (score <= 0) return;
    const cur = best.get(r.listingId);
    if (!cur || score > cur.score) best.set(r.listingId, { score, category: meta.category });
  });
  // An uncategorised / "Other" photo says nothing useful — leave the line out.
  best.forEach((b, id) => {
    const cat = (b.category ?? "").trim();
    if (cat && !/^other$/i.test(cat)) get(id).topPhoto = cat;
  });

  // Photo downloads (the broker's own team; admin downloads aren't theirs).
  const adminIds = new Set(admins.map((a) => a.id));
  for (const d of downloads) {
    if (!want.has(d.listing_id) || (d.downloaded_by && adminIds.has(d.downloaded_by))) continue;
    get(d.listing_id).downloads += d.photo_count ?? 0;
  }

  // Inquiries.
  for (const l of leads.concat(siteLeads)) if (want.has(l.listing_id)) get(l.listing_id).inquiries++;

  // Ever sent to a client — decides "hasn't been sent" vs "no views this month".
  for (let i = 0; i < listingIds.length; i += 150) {
    const rows = await pageAll<{ listing_id: string }>((a, b) =>
      svc.from("client_sends").select("id, listing_id").in("listing_id", listingIds.slice(i, i + 150)).order("id").range(a, b), true);
    rows.forEach((r) => { get(r.listing_id).everSent = true; });
  }

  return stats;
}

export type ReportListing = {
  id: string;
  vessel: string;
  spec: string;
  stats: ListingStats;
};

export type BrokerBlock = {
  brokerId: string;
  name: string;
  hasAccess: boolean;
  /** Sorted: most viewed first, then most recently photographed. */
  listings: ReportListing[];
  totals: { boats: number; views: number; downloads: number; scans: number };
};

export type MonthlyRecipient = {
  /** "b:{profileId}" or "a:{profileId}". */
  key: string;
  kind: "broker" | "assistant";
  id: string;
  name: string;
  firstName: string;
  email: string;
  unsubToken: string | null;
  blocks: BrokerBlock[];
};

export type MonthlyPlan = {
  month: string;
  type: string;
  /** Not yet sent this month — the queue. */
  recipients: MonthlyRecipient[];
  brokers: number;
  assistants: number;
  alreadySent: number;
  optedOut: number;
  bounced: number;
  noEmail: number;
  testSkipped: number;
  listings: number;
};

type ProfileRow = {
  id: string;
  role: string | null;
  first_name: string | null;
  last_name: string | null;
  display_email: string | null;
  email_opt_out: boolean | null;
  email_bounced_at: string | null;
  unsubscribe_token: string | null;
};

const PROFILE_COLS = "id, role, first_name, last_name, display_email, email_opt_out, email_bounced_at, unsubscribe_token";

function vesselOf(l: { vessel_name: string | null; year: number | null; make: string | null; model: string | null }): string {
  return (l.vessel_name ?? "").trim() || [l.year, l.make, l.model].filter(Boolean).join(" ") || "Untitled listing";
}

function specOf(l: { year: number | null; length_ft: number | null; make: string | null; model: string | null }): string {
  const len = typeof l.length_ft === "number" && l.length_ft > 0 ? `${Math.round(l.length_ft)}′` : null;
  return [l.year, len, l.make, l.model].filter(Boolean).join(" ");
}

const fullName = (p: { first_name: string | null; last_name: string | null; display_email: string | null }) =>
  [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.display_email || "Broker";

async function visibleListingIds(svc: SupabaseClient, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25);
    const res = await Promise.all(chunk.map((id) =>
      svc.from("photos").select("id", { count: "exact", head: true }).eq("listing_id", id).eq("is_visible", true).then((r) => r.count ?? 0)));
    chunk.forEach((id, j) => { if (res[j] > 0) out.add(id); });
  }
  return out;
}

/** Everyone who gets this month's email (and who's left out, by reason). */
export async function planMonthlyReport(svc: SupabaseClient, month: string): Promise<MonthlyPlan> {
  type L = { id: string; broker_id: string; vessel_name: string | null; year: number | null; length_ft: number | null; make: string | null; model: string | null; photographed_at: string | null; created_at: string | null };
  const all = await pageAll<L>((a, b) =>
    svc.from("listings").select("id, broker_id, vessel_name, year, length_ft, make, model, photographed_at, created_at")
      .eq("status", "active").is("sold_at", null).order("id").range(a, b));
  const visible = await visibleListingIds(svc, all.map((l) => l.id));
  const live = all.filter((l) => visible.has(l.id));

  const brokerIds = Array.from(new Set(live.map((l) => l.broker_id)));
  const brokers = new Map<string, ProfileRow>();
  for (let i = 0; i < brokerIds.length; i += 200) {
    const { data } = await svc.from("profiles").select(PROFILE_COLS).in("id", brokerIds.slice(i, i + 200)).eq("role", "broker");
    ((data ?? []) as ProfileRow[]).forEach((p) => brokers.set(p.id, p));
  }

  let testSkipped = 0;
  const realBrokers = Array.from(brokers.values()).filter((b) => {
    if (isTestBroker(b)) { testSkipped++; return false; }
    return true;
  });

  // Access (own plan, Office plan, paid Reel Service) — decides the plan line.
  const access = new Map<string, boolean>();
  for (let i = 0; i < realBrokers.length; i += 10) {
    const slice = realBrokers.slice(i, i + 10);
    const st = await Promise.all(slice.map((b) => getEffectiveAccessStatus(svc, b.id).then((r) => hasAccess(r.status)).catch(() => false)));
    slice.forEach((b, j) => access.set(b.id, st[j]));
  }

  const liveOfReal = live.filter((l) => access.has(l.broker_id));
  const stats = await loadMonthStats(svc, liveOfReal.map((l) => l.id), month);

  const when = (l: L) => Date.parse(l.photographed_at ?? l.created_at ?? "") || 0;
  const blocks = new Map<string, BrokerBlock>();
  for (const b of realBrokers) {
    const mine = liveOfReal.filter((l) => l.broker_id === b.id)
      .map((l) => ({ l, s: stats.get(l.id) ?? { ...EMPTY_STATS } }))
      .sort((x, y) => y.s.views - x.s.views || when(y.l) - when(x.l));
    if (mine.length === 0) continue;
    const listings = mine.map(({ l, s }) => ({ id: l.id, vessel: vesselOf(l), spec: specOf(l), stats: s }));
    blocks.set(b.id, {
      brokerId: b.id,
      name: fullName(b),
      hasAccess: access.get(b.id) === true,
      listings,
      totals: {
        boats: listings.length,
        views: listings.reduce((n, x) => n + x.stats.views, 0),
        downloads: listings.reduce((n, x) => n + x.stats.downloads, 0),
        scans: listings.reduce((n, x) => n + x.stats.scans, 0),
      },
    });
  }

  // Assistants of those brokers — one email each, covering all their brokers.
  const links = await pageAll<{ broker_id: string; assistant_id: string }>((a, b) =>
    svc.from("broker_assistants").select("id, broker_id, assistant_id").order("id").range(a, b));
  const byAssistant = new Map<string, string[]>();
  links.forEach((x) => {
    if (!blocks.has(x.broker_id) || !x.assistant_id) return;
    byAssistant.set(x.assistant_id, (byAssistant.get(x.assistant_id) ?? []).concat([x.broker_id]));
  });
  const assistantIds = Array.from(byAssistant.keys());
  const assistants = new Map<string, ProfileRow>();
  for (let i = 0; i < assistantIds.length; i += 200) {
    const { data } = await svc.from("profiles").select(PROFILE_COLS).in("id", assistantIds.slice(i, i + 200)).eq("role", "assistant");
    ((data ?? []) as ProfileRow[]).forEach((p) => assistants.set(p.id, p));
  }

  const type = monthlyReportType(month);
  const sentRows = await pageAll<{ recipient_id: string | null }>((a, b) =>
    svc.from("email_log").select("id, recipient_id").eq("email_type", type).eq("status", "sent").order("id").range(a, b));
  const sent = new Set(sentRows.map((r) => r.recipient_id).filter(Boolean) as string[]);

  let alreadySent = 0, optedOut = 0, bounced = 0, noEmail = 0;
  const recipients: MonthlyRecipient[] = [];
  const consider = (p: ProfileRow, kind: "broker" | "assistant", bl: BrokerBlock[]) => {
    if (!p.display_email) { noEmail++; return; }
    if (p.email_opt_out) { optedOut++; return; }
    if (p.email_bounced_at) { bounced++; return; }
    if (sent.has(p.id)) { alreadySent++; return; }
    recipients.push({
      key: `${kind === "broker" ? "b" : "a"}:${p.id}`,
      kind,
      id: p.id,
      name: fullName(p),
      firstName: (p.first_name ?? "").trim() || "there",
      email: p.display_email,
      unsubToken: p.unsubscribe_token,
      blocks: bl,
    });
  };
  for (const b of realBrokers) {
    const bl = blocks.get(b.id);
    if (bl) consider(b, "broker", [bl]);
  }
  assistants.forEach((a) => {
    if (isTestBroker(a)) { testSkipped++; return; }
    const bl = (byAssistant.get(a.id) ?? []).map((id) => blocks.get(id)!).filter(Boolean)
      .sort((x, y) => y.totals.views - x.totals.views || x.name.localeCompare(y.name));
    if (bl.length) consider(a, "assistant", bl);
  });
  recipients.sort((x, y) => (x.kind === y.kind ? x.name.localeCompare(y.name) : x.kind === "broker" ? -1 : 1));

  return {
    month,
    type,
    recipients,
    brokers: recipients.filter((r) => r.kind === "broker").length,
    assistants: recipients.filter((r) => r.kind === "assistant").length,
    alreadySent,
    optedOut,
    bounced,
    noEmail,
    testSkipped,
    listings: liveOfReal.length,
  };
}

// ── The email ───────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const n = (x: number) => x.toLocaleString("en-US");
const plural = (x: number, one: string, many: string) => `${n(x)} ${x === 1 ? one : many}`;

/** How many rows each broker gets — 8 for one broker, fewer when an assistant covers several. */
function rowsPerBroker(blocks: number): number {
  return blocks <= 1 ? MAX_ROWS : Math.max(1, Math.floor(MAX_ROWS / blocks));
}

/** The listings whose cover thumbs this email shows. */
export function shownListingIds(r: MonthlyRecipient): string[] {
  const per = rowsPerBroker(r.blocks.length);
  return r.blocks.flatMap((b) => b.listings.slice(0, per).map((l) => l.id));
}

export function monthlySubject(r: MonthlyRecipient, month: string): string {
  const m = monthName(month);
  if (r.kind === "broker") {
    const b = r.blocks[0];
    return b.listings.length === 1 ? `${b.listings[0].vessel} in ${m}` : `Your boats in ${m}`;
  }
  if (r.blocks.length === 1) {
    const b = r.blocks[0];
    return b.listings.length === 1 ? `${b.name}'s ${b.listings[0].vessel} in ${m}` : `${b.name}'s boats in ${m}`;
  }
  return `Your brokers' boats in ${m}`;
}

function summaryLine(t: { boats: number; views: number; downloads: number; scans: number }): string {
  return [
    `${plural(t.boats, "boat", "boats")} in the Portal`,
    plural(t.views, "buyer view", "buyer views"),
    plural(t.downloads, "photo download", "photo downloads"),
    plural(t.scans, "dock-card scan", "dock-card scans"),
  ].join(" &middot; ");
}

function listingRow(l: ReportListing, month: string, img: EmailImage | null): string {
  const s = l.stats;
  const listingUrl = `${PORTAL}/dashboard/listings/${l.id}`;
  const sendUrl = `${listingUrl}?section=slideshow`;
  const reportUrl = `${PORTAL}/report/listing/${l.id}`;
  const v = esc(l.vessel);
  const line = (t: string, color = "#374151", size = 13) =>
    `<p style="margin:3px 0 0;font-size:${size}px;color:${color};line-height:1.5;">${t}</p>`;
  const link = (href: string, t: string) =>
    `<p style="margin:6px 0 0;font-size:13px;line-height:1.5;"><a href="${href}" style="color:#9a7a33;font-weight:600;text-decoration:none;">${t} &rarr;</a></p>`;

  let body = "";
  if (s.views > 0) {
    const bits = [plural(s.views, "buyer view", "buyer views"), plural(s.visitors, "visitor", "visitors")];
    if (s.scans) bits.push(plural(s.scans, "dock-card scan", "dock-card scans"));
    if (s.inquiries) bits.push(plural(s.inquiries, "inquiry", "inquiries"));
    body += line(`<strong style="color:#0c1420;">${bits.join(" &middot; ")}</strong>`);
    if (s.topPhoto) body += line(`Lingered on most: ${esc(s.topPhoto)}`, "#6b7280");
  } else {
    body += line(s.everSent ? `No buyer views in ${monthName(month)}` : "No buyer views yet &mdash; her slideshow hasn&rsquo;t been sent", "#6b7280");
    if (s.inquiries) body += line(plural(s.inquiries, "inquiry", "inquiries"));
  }
  if (s.downloads) body += line(`${plural(s.downloads, "photo", "photos")} downloaded`, "#6b7280");
  body += s.views > 0 ? link(reportUrl, "See her Seller Report") : link(sendUrl, "Send her slideshow");

  const thumb = img
    ? `<a href="${listingUrl}" style="display:block;"><img src="${esc(img.url)}" alt="${v}" width="112" height="${Math.max(1, Math.round((112 * img.height) / img.width))}" style="display:block;width:112px;height:auto;border:0;border-radius:6px;" /></a>`
    : `<div style="width:112px;height:75px;background:#eef0f2;border-radius:6px;"></div>`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0;border-top:1px solid #f3f4f6;">
        <tr>
          <td width="112" valign="top" style="padding:16px 0;width:112px;">${thumb}</td>
          <td valign="top" style="padding:16px 0 16px 16px;">
            <p style="margin:0;font-size:15px;font-weight:600;color:#0c1420;line-height:1.35;"><a href="${listingUrl}" style="color:#0c1420;text-decoration:none;">${v}</a></p>
            ${l.spec ? line(esc(l.spec), "#9ca3af", 12) : ""}
            ${body}
          </td>
        </tr>
      </table>`;
}

function moreLine(more: number, whose: string): string {
  if (more <= 0) return "";
  return `<p style="margin:4px 0 0;padding-top:12px;border-top:1px solid #f3f4f6;font-size:13px;line-height:1.5;"><a href="${PORTAL}/dashboard" style="color:#9a7a33;font-weight:600;text-decoration:none;">+${n(more)} more in ${whose} Portal &rarr;</a></p>`;
}

/** The email for one recipient. images: listing id → email-safe cover JPEG. */
export function monthlyReportHtml(r: MonthlyRecipient, month: string, images: Map<string, EmailImage | null>): string {
  const m = monthName(month);
  const p = (t: string, muted = false) =>
    `<p style="margin:0 0 16px;font-size:15px;color:${muted ? "#6b7280" : "#374151"};line-height:1.65;">${t}</p>`;
  const per = rowsPerBroker(r.blocks.length);
  const total = r.blocks.reduce(
    (t, b) => ({ boats: t.boats + b.totals.boats, views: t.views + b.totals.views, downloads: t.downloads + b.totals.downloads, scans: t.scans + b.totals.scans }),
    { boats: 0, views: 0, downloads: 0, scans: 0 }
  );

  let intro: string;
  if (r.kind === "broker") intro = `Here&rsquo;s what your boats did in ${m}.`;
  else if (r.blocks.length === 1) intro = `Here&rsquo;s what ${esc(r.blocks[0].name)}&rsquo;s boats did in ${m}.`;
  else intro = `Here&rsquo;s what the boats of the ${r.blocks.length} brokers you work with did in ${m}.`;

  const summary = `<p style="margin:0 0 20px;padding:14px 16px;background:#f7f8f9;border-radius:8px;font-size:14px;color:#0c1420;line-height:1.6;font-weight:600;">${summaryLine(total)}</p>`;

  let rows = "";
  for (const b of r.blocks) {
    if (r.blocks.length > 1) {
      rows += `<p style="margin:24px 0 2px;font-size:16px;font-weight:700;color:#0c1420;">${esc(b.name)}</p>
      <p style="margin:0 0 4px;font-size:12px;color:#6b7280;line-height:1.5;">${summaryLine(b.totals)}</p>`;
    }
    rows += b.listings.slice(0, per).map((l) => listingRow(l, month, images.get(l.id) ?? null)).join("\n");
    const whose = r.kind === "broker" ? "your" : r.blocks.length === 1 ? "the" : `${esc(b.name.split(" ")[0])}&rsquo;s`;
    rows += moreLine(b.listings.length - per, whose);
  }

  // Quiet plan line — only where a broker has no plan.
  let planLine = "";
  const locked = r.blocks.filter((b) => !b.hasAccess);
  const base = `Sending slideshows, the share link and dock cards are part of a Portal plan, from $${PLAN_FROM_PRICE} a month.`;
  if (r.kind === "broker" && locked.length) {
    planLine = p(`${base} <a href="${PORTAL}${BILLING_PATH}" style="color:#9a7a33;font-weight:600;text-decoration:none;">Choose a plan &rarr;</a>`, true);
  } else if (r.kind === "assistant" && locked.length) {
    const who = locked.length === 1 ? esc(locked[0].name) : "Each broker";
    planLine = p(`${base} ${who} can choose one in the Portal.`, true);
  }

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics</p>
      <p style="margin:6px 0 0;font-size:12px;font-weight:600;color:#dfc98a;letter-spacing:0.14em;text-transform:uppercase;">${esc(monthLabel(month))}</p>
    </div>
    <div style="padding:36px 40px 32px;">
      ${p(`${esc(r.firstName)},`)}
      ${p(intro)}
      ${summary}
      ${rows}
      <div style="height:24px;"></div>
      ${planLine}
      <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">Charlie<br><span style="color:#9ca3af;">YachtPics</span></p>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">YachtPics &middot; Professional yacht photography &amp; delivery<br>Questions? Just reply to this email.</p>
    </div>${r.unsubToken ? unsubscribeFooterHtml(r.unsubToken) : ""}
  </div>
</body>
</html>`;
}

/** Cover thumbs for many listings (shared across recipients), a few at a time. */
export async function coverImages(svc: SupabaseClient, listingIds: string[], into: Map<string, EmailImage | null> = new Map()): Promise<Map<string, EmailImage | null>> {
  const todo = Array.from(new Set(listingIds)).filter((id) => !into.has(id));
  for (let i = 0; i < todo.length; i += 6) {
    const chunk = todo.slice(i, i + 6);
    const imgs = await Promise.all(chunk.map((id) => heroImage(svc, id)));
    chunk.forEach((id, j) => into.set(id, imgs[j]));
  }
  return into;
}

export async function renderMonthly(svc: SupabaseClient, r: MonthlyRecipient, month: string, images?: Map<string, EmailImage | null>): Promise<{ subject: string; html: string }> {
  const imgs = await coverImages(svc, shownListingIds(r), images);
  return { subject: monthlySubject(r, month), html: monthlyReportHtml(r, month, imgs) };
}

// ── Sending ─────────────────────────────────────────────────────────────────

/**
 * Send this month's email to the given recipient keys (null = everyone in
 * the plan). The plan is recomputed here, so only eligible, opted-in,
 * not-yet-sent people get it. Chunks of 25: render → Resend batch
 * (sendResendBatch) → email_log, so a timeout part-way loses nothing already
 * sent and a re-run picks up the rest.
 */
export async function sendMonthlyReport(
  svc: SupabaseClient,
  month: string,
  keys: string[] | null,
  sentBy: string
): Promise<{ sent: number; failed: number; skipped: number; total: number }> {
  if (!isCompletedMonth(month)) throw new Error("That month isn't over yet.");
  const plan = await planMonthlyReport(svc, month);
  const wanted = keys ? new Set(keys) : null;
  const queue = wanted ? plan.recipients.filter((r) => wanted.has(r.key)) : plan.recipients;
  const images = new Map<string, EmailImage | null>();
  let sent = 0, failed = 0;

  for (let c = 0; c < queue.length; c += 25) {
    const chunk = queue.slice(c, c + 25);
    await coverImages(svc, chunk.flatMap(shownListingIds), images);
    const rendered = chunk.map((r) => {
      const logId = newEmailLogId();
      return { r, logId, subject: monthlySubject(r, month), html: trackEmailHtml(monthlyReportHtml(r, month, images), logId) };
    });
    const messages: BatchEmail[] = rendered.map(({ r, subject, html }) => ({
      from: FROM,
      to: r.email,
      subject,
      html,
      headers: r.unsubToken ? unsubscribeHeaders(r.unsubToken) : undefined,
    }));
    const results = await sendResendBatch(messages);
    await Promise.all(rendered.map(({ r, logId, subject }, i) => {
      const ok = results[i]?.ok ?? false;
      if (ok) sent++; else failed++;
      return logEmail({
        id: logId,
        emailType: plan.type,
        recipientEmail: r.email,
        recipientRole: r.kind,
        recipientId: r.id,
        brokerId: r.blocks.length === 1 ? r.blocks[0].brokerId : null,
        subject,
        status: ok ? "sent" : "failed",
        error: ok ? null : results[i]?.error ?? "Send failed",
        sentBy,
        metadata: {
          month,
          brokers: r.blocks.map((b) => b.brokerId),
          boats: r.blocks.reduce((t, b) => t + b.totals.boats, 0),
          views: r.blocks.reduce((t, b) => t + b.totals.views, 0),
          resendId: results[i]?.id ?? null,
          tracked: true,
        },
      });
    }));
  }
  return { sent, failed, skipped: wanted ? wanted.size - queue.length : 0, total: queue.length };
}

/** A test copy to the admin (logged as …_test, so it never counts as sent). */
export async function sendMonthlyReportTest(svc: SupabaseClient, month: string, to: string, sentBy: string, key?: string): Promise<{ ok: boolean; error?: string }> {
  const plan = await planMonthlyReport(svc, month);
  const r = (key ? plan.recipients.find((x) => x.key === key) : undefined) ?? plan.recipients[0];
  if (!r) return { ok: false, error: "No recipients to base a test on." };
  const { subject, html } = await renderMonthly(svc, r, month);
  const logId = newEmailLogId();
  const [res] = await sendResendBatch([{ from: FROM, to, subject: `[Test] ${subject}`, html: trackEmailHtml(html, logId) }]);
  await logEmail({
    id: logId,
    emailType: `${plan.type}_test`,
    recipientEmail: to,
    recipientRole: null,
    subject: `[Test] ${subject}`,
    status: res?.ok ? "sent" : "failed",
    error: res?.ok ? null : res?.error ?? null,
    sentBy,
    metadata: { sample: r.key, month, tracked: true },
  });
  return res?.ok ? { ok: true } : { ok: false, error: res?.error ?? "Send failed" };
}

export async function monthlyAutoOn(svc: SupabaseClient): Promise<boolean> {
  const { data } = await svc.from("app_settings").select("value").eq("key", MONTHLY_REPORT_AUTO_KEY).maybeSingle();
  return data?.value === true;
}

/** Has any of this month's batch gone out (by hand or by the cron)? */
export async function monthlyBatchSent(svc: SupabaseClient, month: string): Promise<number> {
  const { count } = await svc.from("email_log").select("id", { count: "exact", head: true }).eq("email_type", monthlyReportType(month)).eq("status", "sent");
  return count ?? 0;
}
