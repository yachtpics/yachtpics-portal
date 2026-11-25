import type { SupabaseClient } from "@supabase/supabase-js";
import { PLANS, brokeragePlanFitting, planIncludesWebsite } from "@/lib/plans";
import { getAccessStatus, hasAccess, trialDaysFor, type AccessStatus, type SubRow } from "@/lib/subscriptionAccess";
import {
  isPayingPlan, officeAdminRuleOn, officeCoverEnforceOn, officePlanActive, paidReelServiceBrokerIds, type OfficeAdminCover,
} from "@/lib/brokerAccess";

/* ------------------------------------------------------------------ *
 * SOFT MODE (the default — OFFICE_COVER_ENFORCE_LIMIT = false in
 * brokerAccess.ts; owner decision Nov 25 2026, 2:56 PM: "a counter … so they
 * know where they are and when they need to upgrade"): nothing is ever
 * locked or refused. Every active unsold boat of a broker covered by a paying
 * office admin is unlocked for everyone who can work on it, and its buyer
 * links work. The table below is a COUNTER: a boat is recorded the first
 * time ANYONE who may work on it uses a paid tool on it (attributed to the
 * paying admin with the fewest boats in use, ties by name), with no limit.
 * The admin sees "3 of 5 boats in use on your Starter plan." and, over the
 * range, "You're using the Portal's tools on 7 boats. Your Starter plan
 * covers 5. Growth covers 6–10 boats." Everything below about AVAILABLE /
 * FULL / refusals applies only with the switch set to true (the hard cap).
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Office cover SLOTS (owner decision, Charlie Clark, Nov 25 2026 — refines
 * 68a46e1 "a company admin's plan covers their office").
 *
 * A paying company (office) admin's own plan covers only as many boats as the
 * plan's range allows (PLANS[].maxListings: Starter 5, Growth 10, Pro 20,
 * Elite unlimited). Her own active unsold boats use slots first. The other
 * slots go to the office's boats "the first time she starts using the tools
 * on them" — first come, first served.
 *
 * A boat whose owner is covered ONLY by an office admin's plan (no own plan
 * or running trial, no Office plan, no Reel Service) is, for that plan:
 *   COVERED   — holds a slot: every paid tool unlocked for everyone who can
 *               work on the boat, and its public buyer links work.
 *   AVAILABLE — no slot yet, the plan has room: unlocked for the paying admin
 *               (and her own assistant, and YachtPics admins); the first paid
 *               ACTION takes a slot (takeCoverSlot). Locked for anyone else.
 *   FULL      — no room: locked for everyone.
 *
 * A slot is live while: the boat is active and unsold, the owner is still in
 * the admin's brokerage and still needs it (no own plan / trial / Office plan
 * / Reel Service), the admin still pays, and it fits under the limit after
 * her own boats (oldest slots first). Anything else is released
 * automatically (housekeeping in adminSlotUsage, the listing PATCH route,
 * the cascade on delete) or by a YachtPics admin (Admin → Brokers → the
 * admin → Release).
 *
 * Until migration 20261125b_office_cover_slots.sql is applied the table is
 * missing and everything falls back to 68a46e1: every boat in the office is
 * unlocked by a paying admin ("officeAdminAll"). Switch: OFFICE_ADMIN_PLAN_
 * COVERS_OFFICE in brokerAccess.ts (off = exactly pre-68a46e1).
 * ------------------------------------------------------------------ */

const TABLE = "office_cover_slots";

export type ListingAccessReason =
  | "own"                    // the owner's own plan, comp or running trial
  | "office"                 // the brokerage's Office plan
  | "reelService"            // a paid Reel Service boat
  | "officeAdminSlot"        // COVERED: holds a paying admin's slot
  | "officeAdminAvailable"   // AVAILABLE: a paying admin's plan has room
  | "officeAdminFull"        // FULL: the paying admins' plans have no room
  | "officeAdminAll"         // slots table missing: 68a46e1 fallback, unlocked
  | "none";                  // locked, nothing covers it

export type SlotCover = {
  adminId: string;
  adminName: string;
  officeName: string | null;
  /** "Starter" … or null when the admin's Stripe price isn't one of PLANS. */
  planName: string | null;
  /** null = unlimited (Elite). */
  limit: number | null;
  /** Own active boats + live slots (never above limit). */
  used: number;
  /** Names of the boats using the plan, own first, then slots oldest first. */
  inUse: string[];
  /** The next plan up, for "Growth covers 6–10 boats." */
  nextPlan: { name: string; range: string } | null;
  /** Brokers (role broker) in the office — picks Team or Office for the full note (Nov 25 2026). */
  officeBrokers: number;
};

export type ListingAccess = {
  listingId: string;
  ownerId: string | null;
  /** What gates should test with hasAccess(): already resolved for the viewer. */
  status: AccessStatus;
  reason: ListingAccessReason;
  /** The viewer may take a slot for this boat (AVAILABLE, admin side). */
  canTakeSlot: boolean;
  cover: SlotCover | null;
  trialEndsAt: string | null;
  trialDays: number;
  /** Plain sentence for the slot states (null otherwise). */
  notice: CoverNotice | null;
  /** Soft mode (counter only): taking a slot never blocks anything. */
  soft: boolean;
};

export type CoverNotice = {
  /** subtle = admin AVAILABLE; full = admin FULL (with Billing link); locked = anyone else. */
  tone: "subtle" | "full" | "locked";
  text: string;
  /** Show the Billing / upgrade link (the admin's own plan). */
  upgrade: boolean;
};

/* ── the table may not exist yet ───────────────────────────────────── */

let missingUntil = 0;
let missingLogged = false;

function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const code = err.code ?? "";
  const msg = (err.message ?? "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || code === "PGRST202" || code === "42883"
    || /office_cover_slot/.test(msg) && /does not exist|could not find|schema cache/.test(msg);
}

function noteMissing() {
  missingUntil = Date.now() + 60_000; // look again in a minute (the migration may be applied meanwhile)
  if (!missingLogged) {
    missingLogged = true;
    console.warn("[office-cover-slots] table office_cover_slots not found — apply supabase/migrations/20261125b_office_cover_slots.sql. Until then a paying office admin unlocks every boat in the office (Nov 25 68a46e1 behaviour).");
  }
}

/** True while the last read found no office_cover_slots table (re-checked each minute). */
export function coverSlotsTableMissing(): boolean {
  return Date.now() < missingUntil;
}

/** Tests only: forget the "table missing" memory. */
export function __resetCoverSlotsMemoryForTests() {
  missingUntil = 0;
  missingLogged = false;
}

type SlotRow = {
  listing_id: string;
  admin_id: string;
  brokerage_id: string;
  owner_id: string | null;
  taken_at: string;
  released_at: string | null;
};

const CHUNK = 150;
function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

/** Live slot rows matching a filter; null when the table is missing. */
async function readSlots(
  svc: SupabaseClient,
  by: { listingIds?: string[]; adminIds?: string[]; ownerIds?: string[] }
): Promise<SlotRow[] | null> {
  if (Date.now() < missingUntil) return null;
  if (by.listingIds && by.listingIds.length > CHUNK) {
    const parts = await Promise.all(chunks(by.listingIds).map((listingIds) => readSlots(svc, { ...by, listingIds })));
    if (parts.some((p) => p === null)) return null;
    return (parts as SlotRow[][]).reduce((all, p) => all.concat(p), [] as SlotRow[])
      .sort((a, b) => a.taken_at.localeCompare(b.taken_at) || a.listing_id.localeCompare(b.listing_id));
  }
  let q = svc.from(TABLE).select("listing_id, admin_id, brokerage_id, owner_id, taken_at, released_at").is("released_at", null);
  if (by.listingIds) q = q.in("listing_id", by.listingIds);
  if (by.adminIds) q = q.in("admin_id", by.adminIds);
  if (by.ownerIds) q = q.in("owner_id", by.ownerIds);
  const { data, error } = await q;
  if (error) {
    // Missing table, or a read that failed: answer "unknown", and every
    // caller then falls back to 68a46e1 (unlocked) — never lock on a hiccup.
    if (isMissingTable(error)) noteMissing();
    else console.warn("[office-cover-slots] read failed:", error.message);
    return null;
  }
  return ((data ?? []) as SlotRow[]).slice().sort((a, b) => a.taken_at.localeCompare(b.taken_at) || a.listing_id.localeCompare(b.listing_id));
}

/* ── base access: everything except the office admin's plan ────────── */

export type BaseAccess = {
  status: AccessStatus;
  reason: "own" | "office" | "reelService" | "none";
  brokerageId: string | null;
  officeName: string | null;
  trialEndsAt: string | null;
  trialDays: number;
};

/**
 * For many brokers at once (four queries): own plan / comp / running trial →
 * Office plan → paid Reel Service. Same order and rules as
 * getEffectiveAccessStatus, without the office-admin step.
 */
export async function baseAccessMany(svc: SupabaseClient, brokerIds: string[]): Promise<Map<string, BaseAccess>> {
  const ids = brokerIds.filter((b, i, a) => !!b && a.indexOf(b) === i);
  const out = new Map<string, BaseAccess>();
  if (ids.length === 0) return out;
  if (ids.length > CHUNK) {
    const parts = await Promise.all(chunks(ids).map((part) => baseAccessMany(svc, part)));
    parts.forEach((m) => m.forEach((v, k) => out.set(k, v)));
    return out;
  }
  const { data: subs } = await svc.from("subscriptions").select("broker_id, status, stripe_subscription_id, trial_ends_at, created_at").in("broker_id", ids);
  const subBy = new Map<string, SubRow & { created_at?: string | null }>();
  ((subs ?? []) as (SubRow & { broker_id: string; created_at?: string | null })[]).forEach((s) => subBy.set(s.broker_id, s));
  // Brokerage only for those whose own plan doesn't already answer (one query
  // fewer on the common path — a public buyer link of a paying broker).
  const needOffice = ids.filter((id) => getAccessStatus(subBy.get(id) ?? null) !== "active");
  const brokerageBy = new Map<string, string | null>();
  if (needOffice.length > 0) {
    const { data: profs } = await svc.from("profiles").select("id, brokerage_id").in("id", needOffice);
    ((profs ?? []) as { id: string; brokerage_id: string | null }[]).forEach((p) => brokerageBy.set(p.id, p.brokerage_id ?? null));
  }
  const officeIds = Array.from(new Set(Array.from(brokerageBy.values()).filter((b): b is string => !!b)));
  const offices = new Map<string, { name: string | null; subscription_status: string | null }>();
  if (officeIds.length > 0) {
    const { data: rows } = await svc.from("brokerages").select("id, name, subscription_status").in("id", officeIds);
    ((rows ?? []) as { id: string; name: string | null; subscription_status: string | null }[]).forEach((o) => offices.set(o.id, o));
  }
  const needReel: string[] = [];
  ids.forEach((id) => {
    const sub = subBy.get(id) ?? null;
    const own = getAccessStatus(sub);
    const brokerageId = brokerageBy.get(id) ?? null;
    const office = brokerageId ? offices.get(brokerageId) ?? null : null;
    const base: BaseAccess = {
      status: own,
      reason: "none",
      brokerageId,
      officeName: office?.name ?? null,
      trialEndsAt: sub?.trial_ends_at ?? null,
      trialDays: trialDaysFor(sub ?? null),
    };
    if (own === "active") base.reason = "own";
    else if (officePlanActive(office)) { base.status = "active"; base.reason = "office"; }
    else needReel.push(id);
    out.set(id, base);
  });
  if (needReel.length > 0) {
    const reel = await paidReelServiceBrokerIds(svc, needReel);
    reel.forEach((id) => {
      const b = out.get(id);
      if (b) { b.status = "active"; b.reason = "reelService"; }
    });
  }
  // A running trial is the owner's own access too (hasAccess), so it needs no slot.
  out.forEach((b) => { if (b.reason === "none" && hasAccess(b.status)) b.reason = "own"; });
  return out;
}

/* ── paying admins and their plans ─────────────────────────────────── */

export type PayingAdmin = {
  id: string;
  name: string;
  brokerageId: string;
  planName: string | null;
  limit: number | null;
  nextPlan: { name: string; range: string } | null;
  /** Brokers (role broker) in the admin's office, for the Team / Office note. */
  officeBrokers: number;
};

function displayName(p: { first_name?: string | null; last_name?: string | null }): string {
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Your office admin";
}

function rangeLabel(p: { name: string; minListings: number; maxListings: number | null }): string {
  if (p.maxListings == null) return planIncludesWebsite(p.name) ? "unlimited listings, with your website included" : "unlimited listings";
  return `${p.minListings}–${p.maxListings} boats`;
}

/**
 * Nov 25 2026: when a paying admin's plan is covering OTHER brokers' boats,
 * the over / full note points at the brokerage plan that fits the office's
 * broker count instead of the next broker tier. No price here.
 */
export function officePlanSentence(officeBrokers: number): string {
  const p = brokeragePlanFitting(officeBrokers);
  return `${p.name} covers every boat for up to ${p.brokerCap} brokers.`;
}

/** The plan's slot count. An unknown price (not in PLANS) gets the smallest range, never unlimited. */
export function planSlots(priceId: string | null | undefined): { planName: string | null; limit: number | null; nextPlan: { name: string; range: string } | null } {
  const i = PLANS.findIndex((p) => p.priceId === priceId);
  const plan = i >= 0 ? PLANS[i] : null;
  const next = i >= 0 ? PLANS[i + 1] ?? null : PLANS[1] ?? null;
  return {
    planName: plan?.name ?? null,
    limit: plan ? plan.maxListings : PLANS[0].maxListings,
    nextPlan: next ? { name: next.name, range: rangeLabel(next) } : null,
  };
}

/** Paying office admins of one brokerage, with their plan's slots. [] when the rule is off. */
export async function payingAdminsWithPlans(svc: SupabaseClient, brokerageId: string | null | undefined): Promise<PayingAdmin[]> {
  if (!officeAdminRuleOn() || !brokerageId) return [];
  const { data: admins, error } = await svc
    .from("profiles")
    .select("id, first_name, last_name, brokerage_id")
    .eq("brokerage_id", brokerageId)
    .eq("is_brokerage_admin", true);
  if (error || !admins || admins.length === 0) return [];
  const { count: brokerCount } = await svc
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("brokerage_id", brokerageId)
    .eq("role", "broker");
  const officeBrokers = brokerCount ?? 0;
  const rows = admins as { id: string; first_name: string | null; last_name: string | null }[];
  const { data: subs, error: subErr } = await svc
    .from("subscriptions")
    .select("broker_id, status, stripe_subscription_id, stripe_price_id, trial_ends_at")
    .in("broker_id", rows.map((a) => a.id));
  if (subErr || !subs) return [];
  const paying = new Map<string, string | null>();
  ((subs ?? []) as (SubRow & { broker_id: string; stripe_price_id?: string | null })[])
    .filter((s) => isPayingPlan(s))
    .forEach((s) => paying.set(s.broker_id, s.stripe_price_id ?? null));
  return rows
    .filter((a) => paying.has(a.id))
    .sort((a, b) => displayName(a).localeCompare(displayName(b)) || a.id.localeCompare(b.id))
    .map((a) => ({ id: a.id, name: displayName(a), brokerageId, officeBrokers, ...planSlots(paying.get(a.id)) }));
}

/* ── one admin's slots in use ──────────────────────────────────────── */

export type AdminSlotUsage = {
  admin: PayingAdmin;
  ownBoats: { id: string; name: string }[];
  /** Live slots that cover a boat, oldest first. */
  slots: { listingId: string; name: string; ownerId: string }[];
  used: number;
  /** null = unlimited. */
  free: number | null;
};

type ListingLite = { id: string; broker_id: string; status: string | null; sold_at?: string | null; vessel_name: string | null };

async function readListings(svc: SupabaseClient, by: { ids?: string[]; brokerId?: string; activeOnly?: boolean }): Promise<ListingLite[]> {
  // Long id lists in chunks, so the request URL stays a sane length.
  if (by.ids && by.ids.length > CHUNK) {
    const parts = await Promise.all(chunks(by.ids).map((ids) => readListings(svc, { ...by, ids })));
    return parts.reduce((all, p) => all.concat(p), [] as ListingLite[]);
  }
  const run = async (withSold: boolean) => {
    let q = svc.from("listings").select(withSold ? "id, broker_id, status, sold_at, vessel_name" : "id, broker_id, status, vessel_name");
    if (by.ids) q = q.in("id", by.ids);
    if (by.brokerId) q = q.eq("broker_id", by.brokerId);
    if (by.activeOnly) q = q.eq("status", "active");
    if (by.activeOnly && withSold) q = q.is("sold_at", null);
    return q;
  };
  let res = await run(true);
  if (res.error) res = await run(false); // before listings.sold_at existed
  return ((res.data ?? []) as unknown as ListingLite[]);
}

function boatName(l: { vessel_name: string | null } | undefined): string {
  return (l?.vessel_name ?? "").trim() || "Untitled boat";
}

function liveBoat(l: ListingLite | undefined): boolean {
  return !!l && l.status === "active" && !l.sold_at;
}

/**
 * The admin's own active unsold boats + her live slots, capped at her limit
 * (oldest slots first). With `housekeep`, rows that are no longer live are
 * released (sold / archived / owner covered otherwise / moved office / over
 * the limit). Null when the slots table is missing.
 */
export async function adminSlotUsage(svc: SupabaseClient, admin: PayingAdmin, opts: { housekeep?: boolean } = {}): Promise<AdminSlotUsage | null> {
  const rows = await readSlots(svc, { adminIds: [admin.id] });
  if (rows === null) return null;
  const [own, listings] = await Promise.all([
    readListings(svc, { brokerId: admin.id, activeOnly: true }),
    rows.length > 0 ? readListings(svc, { ids: rows.map((r) => r.listing_id) }) : Promise.resolve([] as ListingLite[]),
  ]);
  const byId = new Map(listings.map((l) => [l.id, l] as [string, ListingLite]));
  const owners = Array.from(new Set(listings.map((l) => l.broker_id)));
  const base = owners.length > 0 ? await baseAccessMany(svc, owners) : new Map<string, BaseAccess>();
  // Soft mode counts every boat (no limit); the hard cap keeps the oldest first.
  const room = admin.limit == null || !officeCoverEnforceOn() ? Number.MAX_SAFE_INTEGER : Math.max(0, admin.limit - own.length);
  const slots: AdminSlotUsage["slots"] = [];
  const release: { id: string; reason: string }[] = [];
  rows.forEach((r) => {
    const l = byId.get(r.listing_id);
    const b = l ? base.get(l.broker_id) : undefined;
    let why: string | null = null;
    if (!l) why = "deleted";
    else if (!liveBoat(l)) why = l.sold_at || l.status === "sold" ? "sold" : "not active";
    else if (l.broker_id === admin.id) why = "admin's own boat";
    else if (b && hasAccess(b.status)) why = `owner covered (${b.reason})`;
    else if (!b || b.brokerageId !== admin.brokerageId) why = "owner left the office";
    else if (slots.length >= room) why = "over the plan's limit";
    if (why) release.push({ id: r.listing_id, reason: why });
    else slots.push({ listingId: r.listing_id, name: boatName(l), ownerId: (l as ListingLite).broker_id });
  });
  if (opts.housekeep && release.length > 0) {
    await Promise.all(release.map((x) =>
      svc.from(TABLE).update({ released_at: new Date().toISOString(), release_reason: x.reason.slice(0, 80) })
        .eq("listing_id", x.id).eq("admin_id", admin.id).is("released_at", null)
    )).catch(() => undefined);
  }
  const used = own.length + slots.length;
  return {
    admin,
    ownBoats: own.map((l) => ({ id: l.id, name: boatName(l) })),
    slots,
    used,
    free: admin.limit == null ? null : Math.max(0, admin.limit - used),
  };
}

function coverOf(u: AdminSlotUsage, officeName: string | null): SlotCover {
  return {
    adminId: u.admin.id,
    adminName: u.admin.name,
    officeName,
    planName: u.admin.planName,
    limit: u.admin.limit,
    used: u.admin.limit == null || !officeCoverEnforceOn() ? u.used : Math.min(u.used, u.admin.limit),
    inUse: u.ownBoats.map((b) => b.name).concat(u.slots.map((s) => s.name)),
    nextPlan: u.admin.nextPlan,
    officeBrokers: u.admin.officeBrokers,
  };
}

function hasRoom(u: AdminSlotUsage): boolean {
  return u.free == null || u.free > 0;
}

/* ── copy (plain, calm, no exclamation marks) ──────────────────────── */

function plural(n: number, one: string, many: string) { return n === 1 ? one : many; }

function joinNames(names: string[]): string {
  if (names.length <= 6) return names.join(", ");
  return `${names.slice(0, 6).join(", ")} and ${names.length - 6} more`;
}

function planWord(c: SlotCover): string {
  return c.planName ? `${c.planName} plan` : "plan";
}

/* Soft-mode counter copy (owner's wording, Nov 25 2026). */

/** The plan that fits a count (for "Growth covers 6–10 boats."). */
function planFitting(n: number): { name: string; range: string } | null {
  const fit = PLANS.find((p) => p.maxListings == null || n <= p.maxListings) ?? null;
  return fit ? { name: fit.name, range: rangeLabel(fit) } : null;
}

function yourPlan(planName: string | null): string {
  return planName ? `your ${planName} plan` : "your plan";
}

/** "3 of 5 boats in use on your Starter plan." (also exactly at the limit) */
export function counterShort(p: { planName: string | null; limit: number | null; used: number }): string {
  if (p.limit == null) return `${p.used} ${plural(p.used, "boat", "boats")} in use on ${yourPlan(p.planName)}.`;
  return `${p.used} of ${p.limit} boats in use on ${yourPlan(p.planName)}.`;
}

/**
 * Over the range — the only place upgrade wording appears. `officeBrokers`
 * is passed only when the plan is covering OTHER brokers' boats: the last
 * sentence then names Team or Office ("Team covers every boat for up to 4
 * brokers.") instead of the next broker tier.
 */
export function overMessage(p: { planName: string | null; limit: number | null; used: number; officeBrokers?: number | null }): string | null {
  if (p.limit == null || p.used <= p.limit) return null;
  const plan = p.planName ? `Your ${p.planName} plan` : "Your plan";
  let next = "";
  if (p.officeBrokers != null) {
    next = ` ${officePlanSentence(p.officeBrokers)}`;
  } else {
    const fit = planFitting(p.used);
    if (fit && fit.name !== p.planName) next = ` ${fit.name} covers ${fit.range}.`;
  }
  return `You're using the Portal's tools on ${p.used} boats. ${plan} covers ${p.limit}.${next}`;
}

/**
 * Billing panel: within → "Your Starter plan covers 5 boats. 3 are in use:
 * Everglade, …"; exactly at → "5 of 5 boats in use on your Starter plan.";
 * over → the over message.
 */
export function counterLong(p: { planName: string | null; limit: number | null; used: number; names: string[]; officeBrokers?: number | null }): string {
  const over = overMessage(p);
  if (over) return over;
  if (p.limit != null && p.used === p.limit) return counterShort(p);
  const plan = p.planName ? `Your ${p.planName} plan` : "Your plan";
  const covers = p.limit == null ? `${plan} covers every boat in the office.` : `${plan} covers ${p.limit} ${plural(p.limit, "boat", "boats")}.`;
  if (p.used === 0) return `${covers} None are in use yet.`;
  return `${covers} ${p.used} ${plural(p.used, "is", "are")} in use: ${joinNames(p.names)}.`;
}

/** Listing page line for the paying admin (soft mode). */
function counterNotice(u: AdminSlotUsage): CoverNotice {
  const p = { planName: u.admin.planName, limit: u.admin.limit, used: u.used, officeBrokers: u.slots.length > 0 ? u.admin.officeBrokers : null };
  const over = overMessage(p);
  return over ? { tone: "subtle", text: over, upgrade: true } : { tone: "subtle", text: counterShort(p), upgrade: false };
}

/** Admin (or her assistant: `who` = "Kelly"), boat AVAILABLE. */
export function availableNotice(c: SlotCover, who: string | null = null): string {
  const lead = who ? `${who}'s ${planWord(c)}` : `Your ${planWord(c)}`;
  if (c.limit == null) return `${lead} covers every boat in the office. Using a tool on this boat adds it.`;
  const inUse = c.used === 0 ? "None are in use yet." : `${c.used} ${plural(c.used, "is", "are")} in use.`;
  return `${lead} covers ${c.limit} ${plural(c.limit, "boat", "boats")}. ${inUse} Using a tool on this boat will use one.`;
}

/** Admin (or her assistant), FULL. */
export function fullNotice(c: SlotCover, who: string | null = null): string {
  const lead = who ? `${who}'s ${planWord(c)}` : `Your ${planWord(c)}`;
  const n = c.limit ?? c.used;
  const all = n === 1 ? "and it is in use" : `and all ${n} are in use`;
  const names = c.inUse.length > 0 ? `: ${joinNames(c.inUse)}` : "";
  // FULL only happens with office boats waiting: point at Team / Office.
  const next = ` ${officePlanSentence(c.officeBrokers)}`;
  return `${lead} covers ${n} ${plural(n, "boat", "boats")}, ${all}${names}.${next}`;
}

/** The boat's owner (or anyone else who isn't the admin's side), no slot. */
export function ownerNotice(c: SlotCover, full: boolean): string {
  const first = c.adminName.split(" ")[0] || c.adminName;
  const at = c.officeName ? ` at ${c.officeName}` : "";
  if (c.limit == null) {
    return `${c.adminName}'s plan covers the boats${at} once ${first} uses a tool on them, and this isn't one of them yet. Ask ${first} to use a tool on it, or choose your own plan.`;
  }
  const covers = `${c.adminName}'s plan covers ${c.limit} ${plural(c.limit, "boat", "boats")}${at}`;
  if (full) return `${covers} and all ${c.limit} are in use. You can choose your own plan.`;
  return `${covers} and this isn't one of them yet. Ask ${first} to use a tool on it, or choose your own plan.`;
}

/* ── who is looking ────────────────────────────────────────────────── */

type Viewer = { kind: "payingAdmin" | "adminAssistant" | "yachtpics" | "other"; adminId: string | null; firstName: string | null };

async function resolveViewer(svc: SupabaseClient, viewerId: string | null | undefined, admins: PayingAdmin[]): Promise<Viewer> {
  if (!viewerId) return { kind: "other", adminId: null, firstName: null };
  if (admins.some((a) => a.id === viewerId)) return { kind: "payingAdmin", adminId: viewerId, firstName: null };
  const { data: me } = await svc.from("profiles").select("role").eq("id", viewerId).maybeSingle();
  const role = (me as { role?: string | null } | null)?.role ?? null;
  if (role === "admin") return { kind: "yachtpics", adminId: null, firstName: null };
  if (role === "assistant" && admins.length > 0) {
    const { data: links } = await svc.from("broker_assistants").select("broker_id").eq("assistant_id", viewerId).in("broker_id", admins.map((a) => a.id));
    const first = ((links ?? []) as { broker_id: string }[]).map((l) => l.broker_id);
    const admin = admins.find((a) => first.indexOf(a.id) !== -1);
    if (admin) return { kind: "adminAssistant", adminId: admin.id, firstName: admin.name.split(" ")[0] || admin.name };
  }
  return { kind: "other", adminId: null, firstName: null };
}

/* ── per-listing access ────────────────────────────────────────────── */

function plain(listingId: string, ownerId: string | null, b: BaseAccess | null, extra: Partial<ListingAccess> = {}): ListingAccess {
  return {
    listingId,
    ownerId,
    status: b?.status ?? "no_access",
    reason: b ? (hasAccess(b.status) ? (b.reason === "none" ? "own" : b.reason) : "none") : "none",
    canTakeSlot: false,
    cover: null,
    trialEndsAt: b?.trialEndsAt ?? null,
    trialDays: b?.trialDays ?? 14,
    notice: null,
    soft: !officeCoverEnforceOn(),
    ...extra,
  };
}

/**
 * Access to the paid tools on ONE listing, as `viewerUserId` sees it (omit
 * the viewer for public pages: only a COVERED boat is unlocked there). Use
 * a service-role client.
 */
export async function getListingAccess(svc: SupabaseClient, listingId: string, viewerUserId?: string | null): Promise<ListingAccess> {
  const [l] = await readListings(svc, { ids: [listingId] });
  if (!l) return plain(listingId, null, null);
  const map = await listingsAccessFor(svc, [l], viewerUserId ?? null);
  return map.get(listingId) ?? plain(listingId, l.broker_id, null);
}

/** Many listings at once (My Listings). Keyed by listing id. */
export async function getListingsAccess(
  svc: SupabaseClient,
  listings: { id: string; broker_id: string | null | undefined }[],
  viewerUserId?: string | null
): Promise<Map<string, ListingAccess>> {
  const ids = listings.filter((l) => !!l.broker_id).map((l) => l.id);
  const full = ids.length > 0 ? await readListings(svc, { ids }) : [];
  const out = await listingsAccessFor(svc, full, viewerUserId ?? null);
  listings.forEach((l) => { if (!out.has(l.id)) out.set(l.id, plain(l.id, l.broker_id ?? null, null)); });
  return out;
}

async function listingsAccessFor(svc: SupabaseClient, listings: ListingLite[], viewerId: string | null): Promise<Map<string, ListingAccess>> {
  const out = new Map<string, ListingAccess>();
  if (listings.length === 0) return out;
  const base = await baseAccessMany(svc, listings.map((l) => l.broker_id));
  const waiting: ListingLite[] = [];
  listings.forEach((l) => {
    const b = base.get(l.broker_id) ?? null;
    if (b && hasAccess(b.status)) out.set(l.id, plain(l.id, l.broker_id, b));
    else if (!officeAdminRuleOn() || !b?.brokerageId) out.set(l.id, plain(l.id, l.broker_id, b));
    else waiting.push(l);
  });
  if (waiting.length === 0) return out;

  // Per office: paying admins (other than the owner), their usage, the viewer.
  const offices = Array.from(new Set(waiting.map((l) => base.get(l.broker_id)?.brokerageId as string)));
  const slotRows = await readSlots(svc, { listingIds: waiting.map((l) => l.id) });
  for (const officeId of offices) {
    const inOffice = waiting.filter((l) => base.get(l.broker_id)?.brokerageId === officeId);
    const officeName = base.get(inOffice[0].broker_id)?.officeName ?? null;
    const admins = await payingAdminsWithPlans(svc, officeId);
    if (admins.length === 0) {
      inOffice.forEach((l) => out.set(l.id, plain(l.id, l.broker_id, base.get(l.broker_id) ?? null)));
      continue;
    }
    // Slots table missing (or unreadable) → 68a46e1: every boat unlocked by
    // a paying admin other than its owner.
    const fallback = () => inOffice.forEach((l) => {
      const b = base.get(l.broker_id) ?? null;
      const a = admins.find((x) => x.id !== l.broker_id);
      if (!a) { out.set(l.id, plain(l.id, l.broker_id, b)); return; }
      out.set(l.id, plain(l.id, l.broker_id, b, {
        status: "active",
        reason: "officeAdminAll",
        cover: { adminId: a.id, adminName: a.name, officeName, planName: a.planName, limit: null, used: 0, inUse: [], nextPlan: a.nextPlan, officeBrokers: a.officeBrokers },
      }));
    });
    if (slotRows === null) { fallback(); continue; }
    const usages: AdminSlotUsage[] = [];
    let unreadable = false;
    for (const a of admins) {
      const u = await adminSlotUsage(svc, a);
      if (u) usages.push(u); else unreadable = true;
    }
    if (unreadable) { fallback(); continue; }
    const viewer = await resolveViewer(svc, viewerId, admins);
    if (!officeCoverEnforceOn()) {
      // SOFT: every live boat unlocked for everyone; the record is a counter.
      const mine = viewer.kind === "payingAdmin" ? usages.find((u) => u.admin.id === viewer.adminId) ?? null : null;
      for (const l of inOffice) {
        const b = base.get(l.broker_id) ?? null;
        const others = usages.filter((u) => u.admin.id !== l.broker_id);
        if (others.length === 0 || !liveBoat(l)) { out.set(l.id, plain(l.id, l.broker_id, b)); continue; }
        const holder = others.find((u) => u.slots.some((s) => s.listingId === l.id)) ?? null;
        out.set(l.id, plain(l.id, l.broker_id, b, {
          status: "active",
          reason: holder ? "officeAdminSlot" : "officeAdminAvailable",
          // Anyone signed in who can work on the boat records it on first use.
          canTakeSlot: !holder && !!viewerId,
          cover: coverOf(holder ?? pickSoftAdmin(others), officeName),
          // Only the paying admin sees the counter on a boat page.
          notice: mine && mine.admin.id !== l.broker_id ? counterNotice(mine) : null,
        }));
      }
      continue;
    }
    for (const l of inOffice) {
      const b = base.get(l.broker_id) ?? null;
      const others = usages.filter((u) => u.admin.id !== l.broker_id);
      if (others.length === 0) { out.set(l.id, plain(l.id, l.broker_id, b)); continue; }
      // COVERED: a live slot of a paying admin.
      const holder = others.find((u) => u.slots.some((s) => s.listingId === l.id));
      if (holder) {
        out.set(l.id, plain(l.id, l.broker_id, b, { status: "active", reason: "officeAdminSlot", cover: coverOf(holder, officeName) }));
        continue;
      }
      // A sold / archived boat can't take a slot: locked, as without a plan.
      if (!liveBoat(l)) { out.set(l.id, plain(l.id, l.broker_id, b)); continue; }
      const acting = viewer.kind === "payingAdmin" || viewer.kind === "adminAssistant"
        ? others.find((u) => u.admin.id === viewer.adminId) ?? null
        : viewer.kind === "yachtpics"
          ? others.find(hasRoom) ?? null
          : null;
      if (acting && hasRoom(acting)) {
        const c = coverOf(acting, officeName);
        out.set(l.id, plain(l.id, l.broker_id, b, {
          status: "active",
          reason: "officeAdminAvailable",
          canTakeSlot: true,
          cover: c,
          // Elite: nothing to count, nothing to say.
          notice: c.limit == null ? null : { tone: "subtle", text: availableNotice(c, viewer.kind === "adminAssistant" ? viewer.firstName : null), upgrade: false },
        }));
        continue;
      }
      if (acting) {
        // The acting admin's own plan is full (another admin may have room — her plan is the one she uses).
        const c = coverOf(acting, officeName);
        out.set(l.id, plain(l.id, l.broker_id, b, {
          reason: "officeAdminFull",
          cover: c,
          notice: { tone: "full", text: fullNotice(c, viewer.kind === "adminAssistant" ? viewer.firstName : null), upgrade: viewer.kind === "payingAdmin" },
        }));
        continue;
      }
      const roomy = others.find(hasRoom);
      const c = coverOf(roomy ?? others[0], officeName);
      out.set(l.id, plain(l.id, l.broker_id, b, {
        reason: roomy ? "officeAdminAvailable" : "officeAdminFull",
        cover: c,
        notice: { tone: "locked", text: ownerNotice(c, !roomy), upgrade: false },
      }));
    }
  }
  return out;
}

/** Soft mode: the paying admin a new record is attributed to — fewest boats in use, ties by name. */
function pickSoftAdmin(usages: AdminSlotUsage[]): AdminSlotUsage {
  return usages.slice().sort((a, b) => a.used - b.used || a.admin.name.localeCompare(b.admin.name) || a.admin.id.localeCompare(b.admin.id))[0];
}

/* ── taking a slot ─────────────────────────────────────────────────── */

export type TakeResult =
  | { ok: true; state: "taken" | "held" | "notNeeded"; access: ListingAccess }
  | { ok: false; status: number; error: string; access: ListingAccess | null };

const NO_TOOL = "This boat isn't covered by a plan. Choose a plan on Billing to use this tool.";

/**
 * The first paid ACTION on a boat: take a slot when the boat is AVAILABLE for
 * the actor (the paying admin, her assistant, or a YachtPics admin).
 * Idempotent. Nothing happens for a boat that is already unlocked another way.
 * Refuses (403) with a plain sentence when the boat is locked or FULL.
 * Callers must already have checked the actor may act on the listing.
 */
export async function takeCoverSlot(svc: SupabaseClient, listingId: string, actorUserId: string): Promise<TakeResult> {
  if (!officeCoverEnforceOn()) return recordUse(svc, listingId, actorUserId);
  const startedAt = new Date().toISOString();
  const access = await getListingAccess(svc, listingId, actorUserId);
  if (access.reason === "officeAdminSlot") return { ok: true, state: "held", access };
  if (hasAccess(access.status) && access.reason !== "officeAdminAvailable") return { ok: true, state: "notNeeded", access };
  if (!access.canTakeSlot || !access.cover) {
    return { ok: false, status: 403, error: access.notice?.text ?? NO_TOOL, access };
  }
  const admins = await payingAdminsWithPlans(svc, (await baseAccessMany(svc, [access.ownerId as string])).get(access.ownerId as string)?.brokerageId);
  const admin = admins.find((a) => a.id === access.cover?.adminId);
  if (!admin) return { ok: false, status: 403, error: NO_TOOL, access };
  // Release stale rows first so the database count matches what people see.
  await adminSlotUsage(svc, admin, { housekeep: true });
  // The boat isn't covered (checked above), so a row still marked live for it
  // is doing nothing — its admin stopped paying, or it fell past that admin's
  // limit. Release it so it can't block this take. Rows taken after this call
  // started (another admin's take a moment ago) are left alone.
  const existing = await readSlots(svc, { listingIds: [listingId] });
  if (existing === null) return { ok: true, state: "notNeeded", access }; // table missing: 68a46e1 fallback
  const stale = existing.filter((r) => r.taken_at < startedAt);
  for (const r of stale) {
    const why = admins.some((a) => a.id === r.admin_id) ? "over the plan's limit" : "admin no longer pays";
    await svc.from(TABLE).update({ released_at: new Date().toISOString(), release_reason: why })
      .eq("listing_id", listingId).eq("admin_id", r.admin_id).is("released_at", null);
  }
  const { data, error } = await svc.rpc("office_cover_slot_take", {
    p_listing_id: listingId,
    p_admin_id: admin.id,
    p_brokerage_id: admin.brokerageId,
    p_owner_id: access.ownerId,
    p_taken_by: actorUserId,
    p_limit: admin.limit,
  });
  if (error) {
    if (isMissingTable(error)) { noteMissing(); return { ok: true, state: "notNeeded", access }; }
    return { ok: false, status: 500, error: "The plan couldn't be checked just now. Try again in a moment.", access };
  }
  const after = await getListingAccess(svc, listingId, actorUserId);
  if (data === "full" || after.reason !== "officeAdminSlot") {
    const error = after.notice && after.notice.tone !== "subtle"
      ? after.notice.text
      : data === "full" && access.cover
        ? fullNotice({ ...access.cover, used: access.cover.limit ?? access.cover.used })
        : "This boat's plan changed a moment ago. Reload the page and try again.";
    return { ok: false, status: 403, error, access: after };
  }
  return { ok: true, state: data === "taken" ? "taken" : "held", access: after };
}

/**
 * Server gates: may `userId` use a paid tool on this listing right now? Takes
 * the slot when the boat is AVAILABLE for them. `allowed` false → refuse with
 * `error` (403).
 */
/**
 * SOFT mode take: record that a paid tool was used on this boat — by anyone
 * who may work on it (the caller checked that) — and never refuse. Any
 * failure is logged and answered ok, so the action always goes ahead.
 */
async function recordUse(svc: SupabaseClient, listingId: string, actorUserId: string): Promise<TakeResult> {
  const startedAt = new Date().toISOString();
  const access = await getListingAccess(svc, listingId, actorUserId);
  if (access.reason === "officeAdminSlot") return { ok: true, state: "held", access };
  if (access.reason !== "officeAdminAvailable") return { ok: true, state: "notNeeded", access };
  try {
    const brokerageId = (await baseAccessMany(svc, [access.ownerId as string])).get(access.ownerId as string)?.brokerageId;
    const admins = (await payingAdminsWithPlans(svc, brokerageId)).filter((a) => a.id !== access.ownerId);
    const usages: AdminSlotUsage[] = [];
    for (const a of admins) {
      const u = await adminSlotUsage(svc, a, { housekeep: true });
      if (u) usages.push(u);
    }
    if (usages.length === 0) return { ok: true, state: "notNeeded", access };
    const admin = pickSoftAdmin(usages).admin;
    // A row still live for this boat isn't counting (its admin stopped paying): release it.
    const existing = (await readSlots(svc, { listingIds: [listingId] })) ?? [];
    for (const r of existing.filter((x) => x.taken_at < startedAt)) {
      await svc.from(TABLE).update({ released_at: new Date().toISOString(), release_reason: "admin no longer pays" })
        .eq("listing_id", listingId).eq("admin_id", r.admin_id).is("released_at", null);
    }
    const { data, error } = await svc.rpc("office_cover_slot_take", {
      p_listing_id: listingId,
      p_admin_id: admin.id,
      p_brokerage_id: admin.brokerageId,
      p_owner_id: access.ownerId,
      p_taken_by: actorUserId,
      p_limit: null, // never refuses: the function skips the count when the limit is null
    });
    if (error) {
      if (isMissingTable(error)) noteMissing(); else console.warn("[office-cover-slots] record failed:", error.message);
      return { ok: true, state: "notNeeded", access };
    }
    return { ok: true, state: data === "taken" ? "taken" : "held", access };
  } catch (err) {
    console.warn("[office-cover-slots] record failed:", err instanceof Error ? err.message : err);
    return { ok: true, state: "notNeeded", access };
  }
}

export async function claimListingTool(svc: SupabaseClient, listingId: string, userId: string): Promise<{ allowed: boolean; error: string | null; access: ListingAccess | null }> {
  if (!officeCoverEnforceOn()) {
    // SOFT: allowed exactly when the boat has access; record the use, never refuse.
    const access = await getListingAccess(svc, listingId, userId);
    if (!hasAccess(access.status)) return { allowed: false, error: null, access };
    if (access.reason === "officeAdminAvailable") await recordUse(svc, listingId, userId).catch(() => null);
    return { allowed: true, error: null, access };
  }
  const access = await getListingAccess(svc, listingId, userId);
  if (!hasAccess(access.status)) return { allowed: false, error: access.notice?.text ?? null, access };
  if (access.reason !== "officeAdminAvailable") return { allowed: true, error: null, access };
  const r = await takeCoverSlot(svc, listingId, userId);
  return r.ok ? { allowed: true, error: null, access: r.access } : { allowed: false, error: r.error, access: r.access };
}

/** Release a boat's slot (YachtPics admin, or a status change). Quiet when there's none. */
export async function releaseCoverSlot(svc: SupabaseClient, listingId: string, reason: string): Promise<boolean> {
  if (Date.now() < missingUntil) return false;
  const { data, error } = await svc.from(TABLE)
    .update({ released_at: new Date().toISOString(), release_reason: reason.slice(0, 80) })
    .eq("listing_id", listingId).is("released_at", null)
    .select("listing_id");
  if (error) { if (isMissingTable(error)) noteMissing(); return false; }
  return ((data ?? []) as unknown[]).length > 0;
}

/* ── broker level (no listing) ─────────────────────────────────────── */

/**
 * For broker-level callers (dashboard, nav badge, trial emails, Billing): is
 * this broker covered by a paying office admin of their brokerage? Yes when
 * one of their boats holds a live slot, or when a paying admin has a free
 * slot and the broker has at least one active unsold boat. Table missing →
 * 68a46e1 (any paying admin covers). The broker's own plan, Office plan and
 * Reel Service are checked by the caller first.
 */
export async function brokerSlotCover(
  svc: SupabaseClient,
  brokerId: string,
  brokerageId: string | null | undefined,
  officeName: string | null = null
): Promise<(OfficeAdminCover & { slotBoats: string[]; available: boolean }) | null> {
  if (!officeAdminRuleOn() || !brokerageId) return null;
  const admins = (await payingAdminsWithPlans(svc, brokerageId)).filter((a) => a.id !== brokerId);
  if (admins.length === 0) return null;
  // SOFT: a paying admin of the office (other than themselves) simply covers them (68a46e1).
  if (!officeCoverEnforceOn()) return { adminId: admins[0].id, adminName: admins[0].name, officeName, slotBoats: [], available: true };
  const mine = await readSlots(svc, { ownerIds: [brokerId] });
  if (mine === null) return { adminId: admins[0].id, adminName: admins[0].name, officeName, slotBoats: [], available: true };
  const usages: AdminSlotUsage[] = [];
  for (const a of admins) {
    const u = await adminSlotUsage(svc, a);
    // Unreadable → 68a46e1 (covered), never a lock on a hiccup.
    if (!u) return { adminId: admins[0].id, adminName: admins[0].name, officeName, slotBoats: [], available: true };
    usages.push(u);
  }
  for (const u of usages) {
    const boats = u.slots.filter((s) => s.ownerId === brokerId).map((s) => s.name);
    if (boats.length > 0) {
      const more = usages.filter((x) => x !== u).flatMap((x) => x.slots.filter((s) => s.ownerId === brokerId).map((s) => s.name));
      return { adminId: u.admin.id, adminName: u.admin.name, officeName, slotBoats: boats.concat(more), available: false };
    }
  }
  const roomy = usages.find(hasRoom);
  if (!roomy) return null;
  const active = await readListings(svc, { brokerId, activeOnly: true });
  if (active.length === 0) return null;
  return { adminId: roomy.admin.id, adminName: roomy.admin.name, officeName, slotBoats: [], available: true };
}

/**
 * Billing / admin panel for a paying admin: her plan's slots. Null when she
 * isn't a paying office admin, the office has an Office plan, the rule is off
 * or the table is missing.
 */
export async function coverSlotsForAdmin(svc: SupabaseClient, adminId: string): Promise<{
  officeName: string | null;
  planName: string | null;
  limit: number | null;
  used: number;
  ownBoats: { id: string; name: string }[];
  slots: { listingId: string; name: string; ownerName: string }[];
  waiting: number;
  /** Brokers (role broker) in the office, for the Team / Office note. */
  officeBrokers: number;
} | null> {
  if (!officeAdminRuleOn()) return null;
  const { data: me } = await svc.from("profiles").select("brokerage_id, is_brokerage_admin").eq("id", adminId).maybeSingle();
  const prof = me as { brokerage_id: string | null; is_brokerage_admin: boolean | null } | null;
  if (!prof?.is_brokerage_admin || !prof.brokerage_id) return null;
  const { data: office } = await svc.from("brokerages").select("name, subscription_status").eq("id", prof.brokerage_id).maybeSingle();
  if (officePlanActive((office as { subscription_status: string | null } | null) ?? null)) return null;
  const admin = (await payingAdminsWithPlans(svc, prof.brokerage_id)).find((a) => a.id === adminId);
  if (!admin) return null;
  const u = await adminSlotUsage(svc, admin, { housekeep: true });
  if (!u) return null;
  const ownerIds = Array.from(new Set(u.slots.map((s) => s.ownerId)));
  const names = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: ps } = await svc.from("profiles").select("id, first_name, last_name").in("id", ownerIds);
    ((ps ?? []) as { id: string; first_name: string | null; last_name: string | null }[]).forEach((p) => names.set(p.id, displayName(p)));
  }
  // Office boats still waiting for a slot (owners covered only by admins' plans).
  let waiting = 0;
  const { data: members } = await svc.from("profiles").select("id").eq("brokerage_id", prof.brokerage_id).eq("role", "broker");
  const otherIds = ((members ?? []) as { id: string }[]).map((m) => m.id).filter((id) => id !== adminId);
  if (otherIds.length > 0) {
    const base = await baseAccessMany(svc, otherIds);
    const needy = otherIds.filter((id) => !hasAccess(base.get(id)?.status ?? "no_access"));
    if (needy.length > 0) {
      const held = new Set<string>();
      const all = await readSlots(svc, { ownerIds: needy });
      (all ?? []).forEach((r) => held.add(r.listing_id));
      for (const id of needy) {
        const boats = await readListings(svc, { brokerId: id, activeOnly: true });
        waiting += boats.filter((b) => !held.has(b.id)).length;
      }
    }
  }
  return {
    officeName: (office as { name?: string | null } | null)?.name ?? null,
    planName: admin.planName,
    limit: admin.limit,
    used: u.used,
    ownBoats: u.ownBoats,
    slots: u.slots.map((s) => ({ listingId: s.listingId, name: s.name, ownerName: names.get(s.ownerId) ?? "" })),
    waiting,
    officeBrokers: admin.officeBrokers,
  };
}

/** "Your plan covers 5 boats. In use (3): Everglade, …" */
export function adminSlotsSentence(p: { limit: number | null; used: number; ownBoats: { name: string }[]; slots: { name: string }[] }, who: string | null = null): string {
  const lead = who ? `${who}'s plan` : "Your plan";
  const names = p.ownBoats.map((b) => b.name).concat(p.slots.map((s) => s.name));
  const covers = p.limit == null ? `${lead} covers every boat in the office.` : `${lead} covers ${p.limit} ${plural(p.limit, "boat", "boats")}.`;
  return names.length === 0 ? `${covers} None are in use yet.` : `${covers} In use (${names.length}): ${joinNames(names)}.`;
}
