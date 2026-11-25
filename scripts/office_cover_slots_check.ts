/**
 * Offline checks for the office cover SLOTS (src/lib/officeCoverSlots.ts,
 * owner decision Nov 25 2026): a paying company admin's plan covers as many
 * office boats as its range, claimed the first time she uses a paid tool on
 * a boat. No network, no database — an in-memory fake of the Supabase client
 * (including the office_cover_slot_take function, written to match the SQL in
 * supabase/migrations/20261125b_office_cover_slots.sql).
 *
 *   npx tsx scripts/office_cover_slots_check.ts
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

function fakeClient(tables: Record<string, Row[]>, opts: { missing?: string[] } = {}): SupabaseClient {
  const missing = new Set(opts.missing ?? []);
  const missingErr = (t: string) => ({ code: "42P01", message: `relation "public.${t}" does not exist` });
  function query(table: string) {
    const filters: Filter[] = [];
    let head = false;
    let counting = false;
    let updateVals: Row | null = null;
    let returning = false;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const run = () => {
      if (missing.has(table)) return { data: null, count: null, error: missingErr(table) };
      if (updateVals) {
        const hit = rows();
        hit.forEach((r) => Object.assign(r, updateVals));
        return { data: returning ? hit : null, count: null, error: null };
      }
      const rs = rows();
      return { data: head ? null : rs, count: counting ? rs.length : null, error: null };
    };
    const q = {
      select: (_c?: string, o?: { count?: string; head?: boolean }) => {
        if (updateVals) { returning = true; return q; }
        counting = !!o?.count;
        head = !!o?.head;
        return q;
      },
      update: (vals: Row) => { updateVals = vals; return q; },
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), q),
      is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), q),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.indexOf(r[k]) !== -1), q),
      order: () => q,
      limit: () => q,
      maybeSingle: async () => {
        const r = run();
        return r.error ? r : { data: (r.data as Row[] | null)?.[0] ?? null, error: null };
      },
      single: async () => {
        const r = run();
        if (r.error) return r;
        const rs = (r.data as Row[]) ?? [];
        return rs.length === 1 ? { data: rs[0], error: null } : { data: null, error: { message: "not one row" } };
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return q;
  }
  // office_cover_slot_take — same steps as the SQL function.
  async function rpc(fn: string, a: Record<string, unknown>) {
    if (fn !== "office_cover_slot_take") return { data: null, error: { code: "42883", message: "function not found" } };
    if (missing.has("office_cover_slots")) return { data: null, error: { code: "PGRST202", message: "Could not find the function public.office_cover_slot_take in the schema cache" } };
    const slots = tables.office_cover_slots;
    const existing = slots.find((s) => s.listing_id === a.p_listing_id);
    if (existing && existing.released_at == null) return { data: "held", error: null };
    if (a.p_limit != null) {
      const live = (l: Row | undefined) => !!l && l.status === "active" && (l.sold_at ?? null) === null;
      const own = tables.listings.filter((l) => l.broker_id === a.p_admin_id && live(l)).length;
      const held = slots.filter((s) => s.admin_id === a.p_admin_id && s.released_at == null && live(tables.listings.find((l) => l.id === s.listing_id))).length;
      if (own + held >= (a.p_limit as number)) return { data: "full", error: null };
    }
    const row = { listing_id: a.p_listing_id, admin_id: a.p_admin_id, brokerage_id: a.p_brokerage_id, owner_id: a.p_owner_id, taken_by: a.p_taken_by, taken_at: new Date(Date.UTC(2026, 0, 1) + (++tick) * 1000).toISOString(), released_at: null, release_reason: null };
    if (existing) Object.assign(existing, row); else slots.push(row);
    return { data: "taken", error: null };
  }
  return { from: (t: string) => query(t), rpc } as unknown as SupabaseClient;
}
let tick = 0;

const STARTER = "price_1TQXoyK5G1w3hzIsVwbb9wau";
const GROWTH = "price_1TQXqgK5G1w3hzIsuxv4WI6B";
const ELITE = "price_1Te6f1K5G1w3hzIsGm6Wnola";
const future = new Date(Date.now() + 10 * 86400000).toISOString();
const past = new Date(Date.now() - 40 * 86400000).toISOString();

function world() {
  const profiles: Row[] = [
    // SYC Yachts: Kelly (company admin, paying Starter), her assistant, Steve (no plan).
    { id: "kelly", role: "broker", first_name: "Kelly", last_name: "Sprigg", is_brokerage_admin: true, brokerage_id: "syc" },
    { id: "kasst", role: "assistant", first_name: "Kim", last_name: "Assist", is_brokerage_admin: false, brokerage_id: null },
    { id: "steve", role: "broker", first_name: "Steve", last_name: "Sprigg", is_brokerage_admin: false, brokerage_id: "syc" },
    { id: "sasst", role: "assistant", first_name: "Sid", last_name: "Assist", is_brokerage_admin: false, brokerage_id: null },
    { id: "paula", role: "broker", first_name: "Paula", last_name: "Paid", is_brokerage_admin: false, brokerage_id: "syc" },
    { id: "rita", role: "broker", first_name: "Rita", last_name: "Reels", is_brokerage_admin: false, brokerage_id: "syc" },
    { id: "cora", role: "broker", first_name: "Cora", last_name: "Comped", is_brokerage_admin: false, brokerage_id: "syc" },
    { id: "tina", role: "broker", first_name: "Tina", last_name: "Trial", is_brokerage_admin: false, brokerage_id: "syc" },
    // Two paying admins in one office.
    { id: "ann", role: "broker", first_name: "Ann", last_name: "One", is_brokerage_admin: true, brokerage_id: "two" },
    { id: "bob", role: "broker", first_name: "Bob", last_name: "Two", is_brokerage_admin: true, brokerage_id: "two" },
    { id: "sam", role: "broker", first_name: "Sam", last_name: "Many", is_brokerage_admin: false, brokerage_id: "two" },
    // Elite admin.
    { id: "eve", role: "broker", first_name: "Eve", last_name: "Elite", is_brokerage_admin: true, brokerage_id: "eli" },
    { id: "ed", role: "broker", first_name: "Ed", last_name: "Boats", is_brokerage_admin: false, brokerage_id: "eli" },
    // Office plan.
    { id: "obi", role: "broker", first_name: "Obi", last_name: "Office", is_brokerage_admin: false, brokerage_id: "officeplan" },
    // Ordinary broker, own Starter, no office.
    { id: "ord", role: "broker", first_name: "Ord", last_name: "Inary", is_brokerage_admin: false, brokerage_id: null },
    // YachtPics admin.
    { id: "yp", role: "admin", first_name: "Charlie", last_name: "Clark", is_brokerage_admin: false, brokerage_id: null },
  ];
  const subscriptions: Row[] = [
    { broker_id: "kelly", status: "active", stripe_subscription_id: "sub_k", stripe_price_id: STARTER, trial_ends_at: past },
    { broker_id: "steve", status: "trialing", stripe_subscription_id: null, trial_ends_at: past },
    { broker_id: "paula", status: "active", stripe_subscription_id: "sub_p", stripe_price_id: GROWTH, trial_ends_at: past },
    { broker_id: "rita", status: "trialing", stripe_subscription_id: null, trial_ends_at: past },
    { broker_id: "cora", status: "active", stripe_subscription_id: null, trial_ends_at: null },
    { broker_id: "tina", status: "trialing", stripe_subscription_id: null, trial_ends_at: future },
    { broker_id: "ann", status: "active", stripe_subscription_id: "sub_a", stripe_price_id: STARTER, trial_ends_at: past },
    { broker_id: "bob", status: "active", stripe_subscription_id: "sub_b", stripe_price_id: STARTER, trial_ends_at: past },
    { broker_id: "sam", status: "trialing", stripe_subscription_id: null, trial_ends_at: past },
    { broker_id: "eve", status: "active", stripe_subscription_id: "sub_e", stripe_price_id: ELITE, trial_ends_at: past },
    { broker_id: "ed", status: "trialing", stripe_subscription_id: null, trial_ends_at: past },
    { broker_id: "obi", status: "trialing", stripe_subscription_id: null, trial_ends_at: past },
    { broker_id: "ord", status: "active", stripe_subscription_id: "sub_o", stripe_price_id: STARTER, trial_ends_at: past },
  ];
  const brokerages: Row[] = [
    { id: "syc", name: "SYC Yachts", subscription_status: null },
    { id: "two", name: "Two Admins Yachts", subscription_status: null },
    { id: "eli", name: "Elite Yachts", subscription_status: null },
    { id: "officeplan", name: "Office Plan Yachts", subscription_status: "active" },
  ];
  const listings: Row[] = [];
  const boats = (broker: string, prefix: string, count: number, extra: Row = {}) => {
    for (let i = 1; i <= count; i++) listings.push({ id: `${prefix}${i}`, broker_id: broker, status: "active", sold_at: null, vessel_name: `${prefix}${i}`, ...extra });
  };
  boats("steve", "S", 13);
  boats("paula", "P", 4);
  boats("rita", "R", 2);
  boats("cora", "C", 2);
  boats("tina", "T", 1);
  boats("sam", "M", 12);
  boats("ed", "E", 25);
  boats("obi", "O", 2);
  boats("ord", "D", 3);
  const reel_service_listings: Row[] = [{ listing_id: "R1", broker_id: "rita", ended_at: null, billing_status: "active" }];
  const broker_assistants: Row[] = [{ assistant_id: "kasst", broker_id: "kelly" }, { assistant_id: "sasst", broker_id: "steve" }];
  return { profiles, subscriptions, brokerages, listings, reel_service_listings, broker_assistants, office_cover_slots: [] as Row[], broker_sites: [] as Row[] };
}

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_offline_never_used";
  const access = await import("../src/lib/brokerAccess");
  const slots = await import("../src/lib/officeCoverSlots");
  const allowanceLib = await import("../src/lib/listingAllowance");
  const { hasAccess } = await import("../src/lib/subscriptionAccess");
  const origWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(" ")); };

  let t = world();
  let svc = fakeClient(t);
  const la = (listing: string, viewer?: string) => slots.getListingAccess(svc, listing, viewer);
  const live = () => t.office_cover_slots.filter((s) => s.released_at == null);

  // ── AVAILABLE ──
  {
    const k = await la("S1", "kelly");
    check("Kelly on Steve's S1 → AVAILABLE, unlocked for her, can take a slot", k.reason === "officeAdminAvailable" && k.status === "active" && k.canTakeSlot, `${k.reason} ${k.status}`);
    check("  notice (subtle)", k.notice?.tone === "subtle" && k.notice.text === "Your Starter plan covers 5 boats. None are in use yet. Using a tool on this boat will use one.", k.notice?.text);
    const s = await la("S1", "steve");
    check("Steve on his own S1 → locked (trial ended), cannot take", !hasAccess(s.status) && s.reason === "officeAdminAvailable" && !s.canTakeSlot, `${s.reason} ${s.status}`);
    check("  owner copy", s.notice?.tone === "locked" && s.notice.text === "Kelly Sprigg's plan covers 5 boats at SYC Yachts and this isn't one of them yet. Ask Kelly to use a tool on it, or choose your own plan.", s.notice?.text);
    const sa = await la("S1", "sasst");
    check("Steve's assistant → locked too", !hasAccess(sa.status) && !sa.canTakeSlot);
    const pub = await la("S1");
    check("public buyer link of an AVAILABLE boat → dark (as with no plan)", !hasAccess(pub.status));
    const owner = await slots.takeCoverSlot(svc, "S1", "steve");
    check("owner cannot take a slot", !owner.ok && owner.status === 403 && live().length === 0);
    const yp = await la("S1", "yp");
    check("YachtPics admin → AVAILABLE, can take", yp.reason === "officeAdminAvailable" && yp.canTakeSlot);
  }

  // ── first use takes a slot; idempotent ──
  {
    const r = await slots.takeCoverSlot(svc, "S1", "kelly");
    check("Kelly's first use on S1 → slot taken", r.ok && r.state === "taken" && live().length === 1, JSON.stringify(r.ok ? r.state : r.error));
    const again = await slots.takeCoverSlot(svc, "S1", "kelly");
    check("second use → held, still one slot", again.ok && again.state === "held" && live().length === 1);
    const s = await la("S1", "steve");
    check("Steve's S1 now COVERED for Steve", s.reason === "officeAdminSlot" && s.status === "active" && !s.notice);
    const pub = await la("S1");
    check("public buyer link of a COVERED boat → live", hasAccess(pub.status) && pub.reason === "officeAdminSlot");
    const k = await la("S2", "kelly");
    check("  Kelly on S2 → '1 is in use.'", k.notice?.text === "Your Starter plan covers 5 boats. 1 is in use. Using a tool on this boat will use one.", k.notice?.text);
    const viaAsst = await slots.takeCoverSlot(svc, "S2", "kasst");
    check("Kelly's own assistant takes a slot on S2", viaAsst.ok && viaAsst.state === "taken" && live().length === 2);
    const tool = await slots.claimListingTool(svc, "S3", "kelly");
    check("claimListingTool (server gate, e.g. Send to Client) takes S3", tool.allowed && live().length === 3);
    const toolOwner = await slots.claimListingTool(svc, "S4", "steve");
    check("claimListingTool for the owner on an AVAILABLE boat → refused with the owner sentence", !toolOwner.allowed && /isn't one of them yet/.test(toolOwner.error ?? ""), toolOwner.error ?? "");
  }

  // ── admin's own boats count first; 6th refused on Starter ──
  {
    t.listings.push({ id: "K1", broker_id: "kelly", status: "active", sold_at: null, vessel_name: "Everglade" });
    t.listings.push({ id: "K2", broker_id: "kelly", status: "active", sold_at: null, vessel_name: "Kestrel" });
    const k = await la("S4", "kelly");
    check("own boats count first: 2 own + 3 slots = 5 → FULL for Kelly", k.reason === "officeAdminFull" && !hasAccess(k.status) && !k.canTakeSlot, k.reason);
    check("  FULL copy", k.notice?.tone === "full" && k.notice.upgrade && k.notice.text === "Your Starter plan covers 5 boats, and all 5 are in use: Everglade, Kestrel, S1, S2, S3. Growth covers 6–10 boats.", k.notice?.text);
    const r = await slots.takeCoverSlot(svc, "S4", "kelly");
    check("6th boat refused on Starter with the FULL sentence", !r.ok && r.status === 403 && /all 5 are in use/.test(r.error) && live().length === 3, r.ok ? "" : r.error);
    const s = await la("S4", "steve");
    check("  owner FULL copy", s.notice?.text === "Kelly Sprigg's plan covers 5 boats at SYC Yachts and all 5 are in use. You can choose your own plan.", s.notice?.text);
    const kOwn = await la("K1", "steve");
    check("Kelly's own boat → own plan (no slot needed)", kOwn.reason === "own" && hasAccess(kOwn.status));
    const a = await allowanceLib.listingAllowance(svc, "kelly");
    check("allowance: own 2 + slots 3 = 5, not over, full with boats waiting", a.activeCount === 5 && !a.over && a.office?.mode === "slots" && a.office.full && a.office.waiting === 10, JSON.stringify({ c: a.activeCount, o: a.office }));
    check("  reminder text", allowanceLib.allowanceMessage(a) === "Your Starter plan covers 5 boats, and all 5 are in use. Growth covers 6–10 boats — $49/mo.", String(allowanceLib.allowanceMessage(a)));
    check("  assistant wording", allowanceLib.allowanceMessage(a, "Kelly") === "Kelly's Starter plan covers 5 boats, and all 5 are in use. Growth covers 6–10 boats — $49/mo.");
    const panel = await slots.coverSlotsForAdmin(svc, "kelly");
    check("Billing panel sentence", !!panel && slots.adminSlotsSentence(panel) === "Your plan covers 5 boats. In use (5): Everglade, Kestrel, S1, S2, S3.", panel ? slots.adminSlotsSentence(panel) : "null");
  }

  // ── release when sold / archived ──
  {
    const s1 = t.listings.find((l) => l.id === "S1")!;
    s1.sold_at = new Date().toISOString(); // (the database trigger releases the row; here: liveness + housekeeping)
    const s1v = await la("S1", "steve");
    check("sold S1 → no longer covered (locked as without a plan)", !hasAccess(s1v.status));
    const r = await slots.takeCoverSlot(svc, "S4", "kelly");
    check("S1 sold frees a slot → S4 taken", r.ok && r.state === "taken", r.ok ? "" : r.error);
    check("  S1's row released (housekeeping)", t.office_cover_slots.find((x) => x.listing_id === "S1")?.released_at != null);
    t.listings.find((l) => l.id === "S2")!.status = "archived";
    const r2 = await slots.takeCoverSlot(svc, "S5", "kelly");
    check("S2 archived frees a slot → S5 taken", r2.ok && r2.state === "taken", r2.ok ? "" : r2.error);
    check("  S2's row released", t.office_cover_slots.find((x) => x.listing_id === "S2")?.released_at != null);
    const r3 = await slots.takeCoverSlot(svc, "S6", "kelly");
    check("still full after that → S6 refused", !r3.ok);
  }

  // ── broker level ──
  {
    const eff = await access.getEffectiveAccessStatus(svc, "steve");
    check("broker level: Steve (boats holding slots) → covered, no trial nags", eff.status === "active" && eff.officeAdminCovered === true && eff.officeAdminCover?.adminName === "Kelly Sprigg");
    const cover = await slots.brokerSlotCover(svc, "steve", "syc", "SYC Yachts");
    check("  'Kelly Sprigg's plan covers these boats of yours' list", !!cover && cover.slotBoats.join(",") === "S3,S4,S5", cover?.slotBoats.join(","));
    const tina = await access.getEffectiveAccessStatus(svc, "tina");
    check("broker level: Tina on her own running trial keeps her trial status", tina.status === "trial_active" && !tina.officeAdminCovered, tina.status);
    const tinaBoat = await la("T1", "tina");
    check("Tina's boat → her own trial, no slot", tinaBoat.reason === "own" && hasAccess(tinaBoat.status));
  }

  // ── owner gets their own plan → slot not needed, released ──
  {
    const sub = t.subscriptions.find((s) => s.broker_id === "steve")!;
    Object.assign(sub, { status: "active", stripe_subscription_id: "sub_s", stripe_price_id: GROWTH });
    const s3 = await la("S3", "steve");
    check("Steve buys a plan → his boats are 'own'", s3.reason === "own" && hasAccess(s3.status));
    await slots.coverSlotsForAdmin(svc, "kelly"); // Billing / admin page housekeeping
    check("  his slots released", live().length === 0, JSON.stringify(live().map((x) => x.listing_id)));
    const panel = await slots.coverSlotsForAdmin(svc, "kelly");
    check("  Kelly's plan now in use by her 2 own boats only", !!panel && panel.used === 2 && panel.slots.length === 0, JSON.stringify(panel && { used: panel.used, slots: panel.slots.length }));
    Object.assign(sub, { status: "trialing", stripe_subscription_id: null, stripe_price_id: null });
  }

  // ── unchanged for everyone else ──
  {
    const p = await la("P1", "kelly");
    check("Paula (own Growth) → own, no slot", p.reason === "own" && p.status === "active");
    const r = await la("R2", "rita");
    check("Rita (paid Reel Service) → reelService on every boat", r.reason === "reelService" && r.status === "active");
    const c = await la("C1", "kelly");
    check("Cora (comped) → own", c.reason === "own" && c.status === "active");
    const o = await la("O1", "obi");
    check("Obi (Office plan) → office", o.reason === "office" && o.status === "active");
    const d = await la("D1");
    check("ordinary broker with own plan → public link live", d.reason === "own" && d.status === "active");
    const take = await slots.takeCoverSlot(svc, "P1", "kelly");
    check("taking on a boat that needs no slot → notNeeded, nothing written", take.ok && take.state === "notNeeded" && !t.office_cover_slots.some((x) => x.listing_id === "P1"));
    for (const id of ["paula", "rita", "cora", "obi", "ord"]) {
      const e = await access.getEffectiveAccessStatus(svc, id);
      check(`broker level unchanged for ${id}`, e.status === "active" && !e.officeAdminCovered, JSON.stringify(e));
    }
    const ordA = await allowanceLib.listingAllowance(svc, "ord");
    check("ordinary broker's reminder unchanged (3 boats on Starter → none)", ordA.office === null && allowanceLib.allowanceMessage(ordA) === null);
  }

  // ── Elite never refuses ──
  {
    let ok = 0;
    for (let i = 1; i <= 25; i++) { const r = await slots.takeCoverSlot(svc, `E${i}`, "eve"); if (r.ok && r.state === "taken") ok++; }
    check("Elite admin: 25 boats taken, none refused", ok === 25, String(ok));
    const e = await la("E1", "ed");
    check("  Ed's boat covered", e.reason === "officeAdminSlot");
  }

  // ── two paying admins: separate limits ──
  {
    for (let i = 1; i <= 5; i++) await slots.takeCoverSlot(svc, `M${i}`, "ann");
    const a6 = await slots.takeCoverSlot(svc, "M6", "ann");
    check("Ann: 5 taken, 6th refused", !a6.ok && t.office_cover_slots.filter((s) => s.admin_id === "ann" && s.released_at == null).length === 5);
    const bobView = await la("M6", "bob");
    check("Bob still has room on his own plan", bobView.reason === "officeAdminAvailable" && bobView.canTakeSlot);
    const b = await slots.takeCoverSlot(svc, "M6", "bob");
    check("Bob takes M6 with his plan", b.ok && b.state === "taken" && t.office_cover_slots.find((s) => s.listing_id === "M6")?.admin_id === "bob");
    const held = await slots.takeCoverSlot(svc, "M1", "bob");
    check("a boat Ann covers needs no slot of Bob's", held.ok && held.state === "held" && t.office_cover_slots.filter((s) => s.admin_id === "bob" && s.released_at == null).length === 1);
    const sam = await la("M7", "sam");
    check("Sam's uncovered boat: AVAILABLE through Bob (owner sees it locked)", sam.reason === "officeAdminAvailable" && !hasAccess(sam.status) && sam.cover?.adminName === "Bob Two");
    // Ann stops paying: her slots stop covering, and Bob can take one of those boats.
    Object.assign(t.subscriptions.find((x) => x.broker_id === "ann")!, { status: "past_due" });
    const m2 = await la("M2", "sam");
    check("admin stops paying → her slots stop covering", m2.reason !== "officeAdminSlot" && !hasAccess(m2.status), m2.reason);
    const bob2 = await slots.takeCoverSlot(svc, "M2", "bob");
    check("  Bob takes M2 (Ann's stale row released first)", bob2.ok && bob2.state === "taken" && t.office_cover_slots.find((x) => x.listing_id === "M2")?.admin_id === "bob", bob2.ok ? bob2.state : bob2.error);
  }

  // ── table missing → 68a46e1 fallback ──
  {
    slots.__resetCoverSlotsMemoryForTests();
    t = world();
    svc = fakeClient(t, { missing: ["office_cover_slots"] });
    const s = await slots.getListingAccess(svc, "S9", "steve");
    check("table missing → Steve's boat unlocked (68a46e1)", s.status === "active" && s.reason === "officeAdminAll");
    const pub = await slots.getListingAccess(svc, "S9");
    check("  public link live too", hasAccess(pub.status));
    const r = await slots.takeCoverSlot(svc, "S9", "kelly");
    check("  taking → ok, nothing to write", r.ok && r.state === "notNeeded");
    const e = await access.getEffectiveAccessStatus(svc, "steve");
    check("  broker level covered", e.status === "active" && e.officeAdminCovered === true);
    const a = await allowanceLib.listingAllowance(svc, "kelly");
    // 68a46e1 counted every broker without an own plan: Steve 13 + Rita 2 + Tina 1.
    check("  allowance falls back to the 68a46e1 office count", a.office?.mode === "all" && a.activeCount === 16 && a.over, JSON.stringify(a.office));
    check("  logged once", warnings.filter((w) => /office_cover_slots not found/.test(w)).length === 1, String(warnings.length));
    slots.__resetCoverSlotsMemoryForTests();
  }

  // ── switch off → pre-68a46e1 ──
  {
    t = world();
    svc = fakeClient(t);
    access.__setOfficeAdminRuleForTests(false);
    try {
      const s = await slots.getListingAccess(svc, "S1", "kelly");
      check("switch off → Steve's boat locked even for Kelly", !hasAccess(s.status) && s.reason === "none" && !s.notice);
      const e = await access.getEffectiveAccessStatus(svc, "steve");
      check("switch off → broker level locked (old behaviour)", e.status === "trial_expired" && !e.officeAdminCovered);
      const r = await slots.takeCoverSlot(svc, "S1", "kelly");
      check("switch off → no slot can be taken", !r.ok && t.office_cover_slots.length === 0);
      const a = await allowanceLib.listingAllowance(svc, "kelly");
      check("switch off → Kelly's allowance has no office part", a.office === null);
      const o = await slots.getListingAccess(svc, "O1", "obi");
      check("switch off → Office plan still covers", o.reason === "office");
    } finally {
      access.__setOfficeAdminRuleForTests(null);
    }
  }

  console.warn = origWarn;
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
