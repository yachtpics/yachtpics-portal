/**
 * Offline checks for "an office admin's own plan covers their office"
 * (OFFICE_ADMIN_PLAN_COVERS_OFFICE in src/lib/brokerAccess.ts, owner decision
 * Nov 25 2026) and the office part of src/lib/listingAllowance.ts. Since the
 * slots refinement the per-boat rule is checked in
 * scripts/office_cover_slots_check.ts; this file keeps the broker-level rule.
 * No network, no database — a small in-memory fake of the Supabase client.
 *
 *   npx tsx scripts/office_admin_plan_check.ts
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

// ── fake Supabase: from(t).select(c, {count, head}).eq/in/is/neq…, then
//    .single() / .maybeSingle() / await (rows or a count) ──
function fakeClient(tables: Record<string, Row[]>): SupabaseClient {
  function query(table: string) {
    const filters: Filter[] = [];
    let head = false;
    let counting = false;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const q = {
      select: (_c?: string, opts?: { count?: string; head?: boolean }) => {
        counting = !!opts?.count;
        head = !!opts?.head;
        return q;
      },
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), q),
      is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), q),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.indexOf(r[k]) !== -1), q),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => {
        const rs = rows();
        return rs.length === 1 ? { data: rs[0], error: null } : { data: null, error: { message: "not one row" } };
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        const rs = rows();
        return Promise.resolve({ data: head ? null : rs, count: counting ? rs.length : null, error: null }).then(resolve, reject);
      },
    };
    return q;
  }
  return { from: (t: string) => query(t) } as unknown as SupabaseClient;
}

const STARTER = "price_1TQXoyK5G1w3hzIsVwbb9wau";
const GROWTH = "price_1TQXqgK5G1w3hzIsuxv4WI6B";
const SYC = "syc";
const OTHER = "other-office";
const OFFICE_PLAN = "office-plan";
const COMPED_OFFICE = "comped-office";
const TRIAL_OFFICE = "trial-office";
const future = new Date(Date.now() + 10 * 86400000).toISOString();
const past = new Date(Date.now() - 40 * 86400000).toISOString();

const profiles: Row[] = [
  // SYC Yachts: Kelly (admin, paying Starter, 0 boats), Steve (no plan, 13 boats),
  // Paula (own Growth plan, 4 boats), Tina (own trial running, 1 boat).
  { id: "kelly", role: "broker", first_name: "Kelly", last_name: "Sprigg", is_brokerage_admin: true, brokerage_id: SYC },
  { id: "steve", role: "broker", first_name: "Steve", last_name: "Sprigg", is_brokerage_admin: false, brokerage_id: SYC },
  { id: "paula", role: "broker", first_name: "Paula", last_name: "Paid", is_brokerage_admin: false, brokerage_id: SYC },
  { id: "tina", role: "broker", first_name: "Tina", last_name: "Trial", is_brokerage_admin: false, brokerage_id: SYC },
  // Another office: paying admin Olga; Steve is NOT in it.
  { id: "olga", role: "broker", first_name: "Olga", last_name: "Other", is_brokerage_admin: true, brokerage_id: OTHER },
  // An office with an Office plan.
  { id: "obi", role: "broker", first_name: "Obi", last_name: "Office", is_brokerage_admin: false, brokerage_id: OFFICE_PLAN },
  // An office whose admin is comped (active, no Stripe id).
  { id: "cadmin", role: "broker", first_name: "Cora", last_name: "Comped", is_brokerage_admin: true, brokerage_id: COMPED_OFFICE },
  { id: "cbroker", role: "broker", first_name: "Carl", last_name: "Broker", is_brokerage_admin: false, brokerage_id: COMPED_OFFICE },
  // An office whose admin is on a free trial (in-app, and a Stripe 'trialing' one).
  { id: "tadmin", role: "broker", first_name: "Tara", last_name: "Trial", is_brokerage_admin: true, brokerage_id: TRIAL_OFFICE },
  { id: "tadmin2", role: "broker", first_name: "Tess", last_name: "Stripetrial", is_brokerage_admin: true, brokerage_id: TRIAL_OFFICE },
  { id: "tbroker", role: "broker", first_name: "Ted", last_name: "Broker", is_brokerage_admin: false, brokerage_id: TRIAL_OFFICE },
  // No brokerage at all.
  { id: "loner", role: "broker", first_name: "Lone", last_name: "Wolf", is_brokerage_admin: false, brokerage_id: null },
  // Ordinary broker with their own Starter plan and 8 boats.
  { id: "ord", role: "broker", first_name: "Ord", last_name: "Inary", is_brokerage_admin: false, brokerage_id: null },
];

const subscriptions: Row[] = [
  { broker_id: "kelly", status: "active", stripe_subscription_id: "sub_kelly", stripe_price_id: STARTER, trial_ends_at: past },
  { broker_id: "steve", status: "trialing", stripe_subscription_id: null, trial_ends_at: past },
  { broker_id: "paula", status: "active", stripe_subscription_id: "sub_paula", stripe_price_id: GROWTH, trial_ends_at: past },
  { broker_id: "tina", status: "trialing", stripe_subscription_id: null, trial_ends_at: future },
  { broker_id: "olga", status: "active", stripe_subscription_id: "sub_olga", stripe_price_id: STARTER, trial_ends_at: past },
  { broker_id: "obi", status: "trialing", stripe_subscription_id: null, trial_ends_at: past },
  { broker_id: "cadmin", status: "active", stripe_subscription_id: null, trial_ends_at: null },
  { broker_id: "cbroker", status: "trialing", stripe_subscription_id: null, trial_ends_at: past },
  { broker_id: "tadmin", status: "trialing", stripe_subscription_id: null, trial_ends_at: future },
  { broker_id: "tadmin2", status: "trialing", stripe_subscription_id: "sub_tess", stripe_price_id: STARTER, trial_ends_at: future },
  { broker_id: "tbroker", status: "trialing", stripe_subscription_id: null, trial_ends_at: past },
  { broker_id: "loner", status: "trialing", stripe_subscription_id: null, trial_ends_at: past },
  { broker_id: "ord", status: "active", stripe_subscription_id: "sub_ord", stripe_price_id: STARTER, trial_ends_at: past },
];

const brokerages: Row[] = [
  { id: SYC, name: "SYC Yachts", subscription_status: null },
  { id: OTHER, name: "Other Yachts", subscription_status: null },
  { id: OFFICE_PLAN, name: "Office Plan Yachts", subscription_status: "active" },
  { id: COMPED_OFFICE, name: "Comped Yachts", subscription_status: null },
  { id: TRIAL_OFFICE, name: "Trial Yachts", subscription_status: null },
];

const listings: Row[] = [];
let n = 0;
function boats(broker: string, count: number, extra: Row = {}) {
  for (let i = 0; i < count; i++) listings.push({ id: `L${++n}`, broker_id: broker, status: "active", sold_at: null, ...extra });
}
boats("steve", 13);
boats("steve", 2, { status: "archived" }); // not counted
boats("steve", 1, { sold_at: past }); // sold — not counted
boats("paula", 4); // own plan — not counted in Kelly's office count
boats("tina", 1); // own trial running, no plan → covered → counted
boats("ord", 8);
boats("olga", 2);

const tables = { profiles, subscriptions, brokerages, listings, reel_service_listings: [] as Row[], broker_sites: [] as Row[] };

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  // websiteAddon (pulled in by listingAllowance) constructs a Stripe client at import.
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_offline_never_used";
  const access = await import("../src/lib/brokerAccess");
  const allowanceLib = await import("../src/lib/listingAllowance");
  const svc = fakeClient(tables);

  const eff = (id: string, client: SupabaseClient = svc) => access.getEffectiveAccessStatus(client, id);

  // 1. Owner with own plan → active, not officeAdminCovered
  {
    const r = await eff("paula");
    check("owner with own plan → active", r.status === "active");
    check("owner with own plan → not officeAdminCovered", !r.officeAdminCovered && !r.officeCovered);
  }
  // 2. Owner in office with Office plan → officeCovered as before
  {
    const r = await eff("obi");
    check("office plan → active + officeCovered", r.status === "active" && r.officeCovered === true && !r.officeAdminCovered);
  }
  // 3. Owner with no plan + paying admin in same office → active + officeAdminCovered
  {
    const r = await eff("steve");
    check("Steve (no plan) + Kelly paying → active", r.status === "active");
    check("Steve → officeAdminCovered", r.officeAdminCovered === true && r.officeCovered === false);
    check("Steve → covered by Kelly Sprigg (SYC Yachts)",
      r.officeAdminCover?.adminId === "kelly" && r.officeAdminCover?.adminName === "Kelly Sprigg" && r.officeAdminCover?.officeName === "SYC Yachts",
      JSON.stringify(r.officeAdminCover));
  }
  // 4. Admin comped (no Stripe id) → NOT covered
  {
    const r = await eff("cbroker");
    check("comped admin does NOT cover the office", r.status === "trial_expired" && !r.officeAdminCovered, r.status);
  }
  // 5. Admin on a free trial → NOT covered (in-app trial and Stripe 'trialing')
  {
    const r = await eff("tbroker");
    check("admins on free trials do NOT cover the office", r.status === "trial_expired" && !r.officeAdminCovered, r.status);
  }
  // 6. Paying admin in a DIFFERENT office → NOT covered (Olga's office has no Steve)
  {
    const r = await eff("loner");
    check("owner with null brokerage → NOT covered", r.status === "trial_expired" && !r.officeAdminCovered, r.status);
    const cover = await access.officeAdminCoverFor(svc, "steve", OTHER);
    // Steve's own brokerage is SYC; check the rule keys on the owner's office only:
    const steveProfileOffice = profiles.find((p) => p.id === "steve")!.brokerage_id;
    check("paying admin in a different office → not Steve's cover", steveProfileOffice === SYC && (await eff("steve")).officeAdminCover?.adminId !== "olga");
    check("(sanity) Olga would cover someone in HER office only", cover?.adminId === "olga");
  }
  {
    // A broker in SYC whose only paying admin is in another office: drop Kelly's plan.
    const noKelly = fakeClient({
      ...tables,
      subscriptions: subscriptions.map((s) => (s.broker_id === "kelly" ? { ...s, status: "canceled" } : s)),
    });
    const r = await eff("steve", noKelly);
    check("only a paying admin in a DIFFERENT office → Steve NOT covered", r.status === "trial_expired" && !r.officeAdminCovered, r.status);
    const pastDue = fakeClient({
      ...tables,
      subscriptions: subscriptions.map((s) => (s.broker_id === "kelly" ? { ...s, status: "past_due" } : s)),
    });
    check("admin past_due → NOT covered", (await eff("steve", pastDue)).status === "trial_expired");
  }
  // 7. The admin's own access unchanged
  {
    const r = await eff("kelly");
    check("Kelly's own access → active via her own plan", r.status === "active" && !r.officeAdminCovered && !r.officeCovered);
  }
  // A broker on their own running trial: since the slots refinement their
  // boats need no slot and they keep their own trial status (pre-68a46e1).
  {
    const r = await eff("tina");
    check("Tina (own trial running) → her own trial, not officeAdminCovered", r.status === "trial_active" && !r.officeAdminCovered, r.status);
  }
  // 8. Constant off → old behaviour (the switch flipped through the
  //    tests-only setter; the constant itself is checked to be on).
  {
    check("OFFICE_ADMIN_PLAN_COVERS_OFFICE is on", access.OFFICE_ADMIN_PLAN_COVERS_OFFICE === true);
    access.__setOfficeAdminRuleForTests(false);
    try {
      const steve = await access.getEffectiveAccessStatus(svc, "steve");
      check("constant off → Steve locked again (old behaviour)", steve.status === "trial_expired" && !steve.officeAdminCovered, steve.status);
      const obi = await access.getEffectiveAccessStatus(svc, "obi");
      check("constant off → Office plan still covers", obi.status === "active" && obi.officeCovered);
      const k = await allowanceLib.listingAllowance(svc, "kelly");
      check("constant off → Kelly's allowance counts only her own boats", k.office === null && k.activeCount === 0 && !k.over);
      check("constant off → payingOfficeAdmins empty", (await access.payingOfficeAdmins(svc, [SYC])).size === 0);
    } finally {
      access.__setOfficeAdminRuleForTests(null);
    }
  }

  // 9. Allowance for the admin (slots refinement — scripts/office_cover_slots_check.ts
  //    covers taking slots): no slot in use yet → her own boats only, not over,
  //    no reminder; 14 office boats waiting (Steve 13 + Tina 1 — Tina's trial
  //    runs, but her boat would need a slot once it ends).
  {
    const a = await allowanceLib.listingAllowance(svc, "kelly");
    check("Kelly's allowance: plan Starter, limit 5", a.plan === "Starter" && a.limit === 5, `${a.plan}/${a.limit}`);
    check("Kelly's allowance: ownCount 0", a.ownCount === 0, String(a.ownCount));
    check("Kelly's allowance: slots mode, 0 in use, not over", a.office?.mode === "slots" && a.office.slotsInUse === 0 && a.activeCount === 0 && !a.over, JSON.stringify(a.office) + ` active=${a.activeCount}`);
    check("Kelly: no reminder while slots are free", allowanceLib.allowanceMessage(a) === null);
  }
  // 10. Allowance for an ordinary broker unchanged
  {
    const a = await allowanceLib.listingAllowance(svc, "ord");
    check("ordinary broker: 8 boats on Starter, office null", a.activeCount === 8 && a.ownCount === 8 && a.office === null && a.over);
    const msg = allowanceLib.allowanceMessage(a);
    check("ordinary broker message unchanged", msg === "You have 8 active boats. Starter covers up to 5. Growth covers 6–10 boats — $49/mo.", msg ?? "null");
    const steve = await allowanceLib.listingAllowance(svc, "steve");
    check("covered broker Steve: no plan → no reminder", steve.plan === null && allowanceLib.allowanceMessage(steve) === null);
    const olga = await allowanceLib.listingAllowance(svc, "olga");
    check("paying admin with nobody to cover: own count only, nothing waiting", olga.activeCount === 2 && (olga.office === null || (olga.office.waiting === 0 && !olga.office.full)));
    const cadmin = await allowanceLib.listingAllowance(svc, "cadmin");
    check("comped admin: no office count", cadmin.office === null);
  }
  // 11. Batch helper used by the trial emails
  {
    const m = await access.payingOfficeAdmins(svc, [SYC, OTHER, COMPED_OFFICE, TRIAL_OFFICE]);
    check("payingOfficeAdmins: SYC → Kelly, Other → Olga, comped/trial offices → none",
      (m.get(SYC) ?? []).map((a) => a.id).join() === "kelly" && (m.get(OTHER) ?? []).map((a) => a.id).join() === "olga" && !m.has(COMPED_OFFICE) && !m.has(TRIAL_OFFICE));
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
