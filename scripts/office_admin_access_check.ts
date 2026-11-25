/**
 * Offline checks for the office-admin rule in src/lib/assertListingAccess.ts
 * (no network, no database — a small in-memory fake of the Supabase client).
 *
 *   npx tsx scripts/office_admin_access_check.ts
 *
 * Office admin = profiles.is_brokerage_admin true, brokerage_id set, and the
 * same brokerage_id as the listing's owner (owner decision Nov 25 2026: an
 * office admin changes listings in their office just like an assistant).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { assertListingAccess, brokerActor, canActForBroker } from "../src/lib/assertListingAccess";

type Row = Record<string, unknown>;

// ── fake Supabase: from(t).select(c).eq(k, v)….maybeSingle() / .single() ──
function fakeClient(tables: Record<string, Row[]>): SupabaseClient {
  function query(table: string) {
    const filters: [string, unknown][] = [];
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return q;
      },
      maybeSingle: async () => {
        const rows = (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
        return { data: rows[0] ?? null, error: null };
      },
      single: async () => {
        const rows = (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
        return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: "not one row" } };
      },
    };
    return q;
  }
  return { from: (t: string) => query(t) } as unknown as SupabaseClient;
}

const OFFICE_A = "office-a";
const OFFICE_B = "office-b";

const people: Row[] = [
  { id: "steve", role: "broker", first_name: "Steve", last_name: "Sprigg", is_brokerage_admin: false, brokerage_id: OFFICE_A },
  { id: "kelly", role: "broker", first_name: "Kelly", last_name: "Sprigg", is_brokerage_admin: true, brokerage_id: OFFICE_A },
  { id: "admin", role: "admin", first_name: "Y", last_name: "P", is_brokerage_admin: false, brokerage_id: null },
  { id: "asst", role: "assistant", first_name: "Ann", last_name: "Assist", is_brokerage_admin: false, brokerage_id: null },
  { id: "otheradmin", role: "broker", first_name: "Olga", last_name: "Other", is_brokerage_admin: true, brokerage_id: OFFICE_B },
  { id: "nobrokerage", role: "broker", first_name: "Ned", last_name: "None", is_brokerage_admin: true, brokerage_id: null },
  { id: "colleague", role: "broker", first_name: "Cole", last_name: "League", is_brokerage_admin: false, brokerage_id: OFFICE_A },
  { id: "cobroker", role: "broker", first_name: "Cory", last_name: "Co", is_brokerage_admin: false, brokerage_id: OFFICE_B },
  { id: "loner", role: "broker", first_name: "Lone", last_name: "Wolf", is_brokerage_admin: false, brokerage_id: null },
];

const svc = fakeClient({
  profiles: people,
  listings: [
    { id: "L1", broker_id: "steve", is_shared: false }, // Steve's boat, office A
    { id: "L2", broker_id: "loner", is_shared: false }, // owner has no brokerage
    { id: "L3", broker_id: "steve", is_shared: true }, // shared into office A
  ],
  broker_assistants: [{ broker_id: "steve", assistant_id: "asst" }],
  listing_co_brokers: [{ listing_id: "L1", broker_id: "cobroker" }],
});

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function access(listingId: string, userId: string, opts: { includeCoBroker?: boolean } = {}) {
  const r = await assertListingAccess(svc, listingId, userId, opts);
  if (r instanceof NextResponse) {
    const body = (await r.json()) as { error?: string };
    return { ok: false as const, status: r.status, error: body.error ?? "" };
  }
  return { ok: true as const, actor: r.actor, brokerId: r.brokerId };
}

async function main() {
  // assertListingAccess
  let r = await access("L1", "steve");
  check("owner passes", r.ok && r.actor === "owner");
  r = await access("L1", "admin");
  check("portal admin passes", r.ok && r.actor === "admin");
  r = await access("L1", "asst");
  check("linked assistant passes", r.ok && r.actor === "assistant");
  r = await access("L1", "kelly");
  check("office admin, same office, passes (Kelly on Steve's listing)", r.ok && r.actor === "office_admin");
  r = await access("L1", "otheradmin");
  check("office admin of a DIFFERENT office is refused", !r.ok && r.status === 403, !r.ok ? r.error : "");
  r = await access("L1", "nobrokerage");
  check("is_brokerage_admin true but brokerage_id null is refused", !r.ok && r.status === 403, !r.ok ? r.error : "");
  r = await access("L2", "kelly");
  check("listing owner with null brokerage_id is refused", !r.ok && r.status === 403, !r.ok ? r.error : "");
  r = await access("L1", "colleague");
  check("ordinary broker in the same office (not admin) is refused", !r.ok && r.status === 403, !r.ok ? r.error : "");
  r = await access("L1", "cobroker");
  check("co-broker refused without includeCoBroker", !r.ok && r.status === 403, !r.ok ? r.error : "");
  r = await access("L1", "cobroker", { includeCoBroker: true });
  check("co-broker passes with includeCoBroker", r.ok && r.actor === "co_broker");
  r = await access("NOPE", "steve");
  check("unknown listing → 404", !r.ok && r.status === 404);

  // Refusal wording
  r = await access("L1", "cobroker");
  check(
    "refusal names the owner when the caller can see the listing (co-broker)",
    !r.ok && r.error === "Only Steve Sprigg, their assistant or their office admin can change this listing.",
    !r.ok ? r.error : ""
  );
  r = await access("L3", "colleague");
  check(
    "refusal names the owner on a listing shared into the caller's office",
    !r.ok && r.error === "Only Steve Sprigg, their assistant or their office admin can change this listing.",
    !r.ok ? r.error : ""
  );
  r = await access("L1", "otheradmin");
  check(
    "refusal is generic for someone who can't see the listing",
    !r.ok && r.error === "You don't have access to change this listing.",
    !r.ok ? r.error : ""
  );
  r = await access("L1", "colleague");
  check("never a bare Forbidden", !r.ok && r.error !== "Forbidden", !r.ok ? r.error : "");

  // canActForBroker / brokerActor
  check("canActForBroker: owner", await canActForBroker(svc, "steve", "steve"));
  check("canActForBroker: admin", await canActForBroker(svc, "admin", "steve"));
  check("canActForBroker: linked assistant", await canActForBroker(svc, "asst", "steve"));
  check("canActForBroker: office admin same office", (await brokerActor(svc, "kelly", "steve")) === "office_admin");
  check("canActForBroker: office admin other office refused", !(await canActForBroker(svc, "otheradmin", "steve")));
  check("canActForBroker: brokerage admin without brokerage refused", !(await canActForBroker(svc, "nobrokerage", "steve")));
  check("canActForBroker: owner without brokerage refused for office admin", !(await canActForBroker(svc, "kelly", "loner")));
  check("canActForBroker: plain colleague refused", !(await canActForBroker(svc, "colleague", "steve")));
  check("canActForBroker: co-broker is not a broker-wide actor", !(await canActForBroker(svc, "cobroker", "steve")));

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
