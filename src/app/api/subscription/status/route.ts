import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { trialDaysRemaining } from "@/lib/subscriptionAccess";
import { getEffectiveAccessStatus } from "@/lib/brokerAccess";
import { canActForBroker } from "@/lib/assertListingAccess";
import { brokerSlotCover, coverSlotsForAdmin, coverSlotsTableMissing, getListingAccess, adminSlotsSentence, counterLong, overMessage } from "@/lib/officeCoverSlots";
import { officeCoverEnforceOn } from "@/lib/brokerAccess";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Optional: caller can supply a brokerId (the listing page, when the viewer
  // isn't the listing's own broker). Allowed callers — the same people who can
  // already open that broker's listings: the broker, a linked assistant, a
  // portal admin, or an office admin of the broker's own brokerage
  // (canActForBroker — the same rule as assertListingAccess). Read-only plan
  // status; nothing here manages the broker's subscription.
  const url = new URL(req.url);
  let requestedBrokerId = url.searchParams.get("brokerId");
  // Optional listingId (Nov 25 2026, office cover slots): the answer is then
  // for THAT boat as this viewer sees it (getListingAccess) — a company
  // admin's plan covers boats, not brokers. The listing's owner is the broker
  // asked about; the same people as before may ask (canActForBroker).
  const listingId = url.searchParams.get("listingId");
  if (listingId) {
    if (!/^[0-9a-f-]{36}$/i.test(listingId)) return NextResponse.json({ error: "Bad listingId" }, { status: 400 });
    const svc = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: l } = await svc.from("listings").select("broker_id").eq("id", listingId).maybeSingle();
    if (!l) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
    if (requestedBrokerId && requestedBrokerId !== l.broker_id) return NextResponse.json({ error: "That listing belongs to another broker." }, { status: 400 });
    requestedBrokerId = l.broker_id as string;
  }

  let brokerId = user.id;
  // Anyone viewing another broker's listing: that broker's name, so plan
  // gates can say whose plan it is
  // ("Needs Jim Nobel's plan") — src/lib/planValue.ts assistantPlanCopy.
  let brokerName: { first: string | null; last: string | null } | null = null;

  if (requestedBrokerId && requestedBrokerId !== user.id) {
    // Caller is asking about a different broker — verify they are linked
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    // Linked assistant, portal admin, or office admin of the broker's
    // brokerage — the shared rule in src/lib/assertListingAccess.ts.
    const allowed = await canActForBroker(supabaseAdmin, user.id, requestedBrokerId);
    if (!allowed) return NextResponse.json({ error: "You don't have access to this broker's plan." }, { status: 403 });
    brokerId = requestedBrokerId;
    const { data: bp } = await supabaseAdmin
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", brokerId)
      .maybeSingle();
    brokerName = { first: bp?.first_name ?? null, last: bp?.last_name ?? null };
  }

  // Use service role so RLS on subscriptions table never blocks the read
  const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Effective status accounts for the broker's own plan OR their office plan.
  // Also a paying office admin's own plan (officeAdminCovered, Nov 25 2026 —
  // OFFICE_ADMIN_PLAN_COVERS_OFFICE in brokerAccess.ts).
  const eff = await getEffectiveAccessStatus(supabaseAdmin, brokerId);
  const { trialEndsAt, trialDays, officeCovered, reelServiceCovered, officeAdminCovered, officeAdminCover } = eff;
  let status = eff.status;
  const daysLeft = trialDaysRemaining(trialEndsAt);

  // One boat: its own answer for this viewer. `status` is what the page
  // gates on; `listingAccess` carries the slot state and its sentence.
  let listingAccess: {
    reason: string;
    canTakeSlot: boolean;
    notice: { tone: string; text: string; upgrade: boolean } | null;
    adminName: string | null;
    officeName: string | null;
    soft: boolean;
  } | null = null;
  if (listingId) {
    const la = await getListingAccess(supabaseAdmin, listingId, user.id);
    status = la.status;
    listingAccess = {
      reason: la.reason,
      canTakeSlot: la.canTakeSlot,
      notice: la.notice,
      adminName: la.cover?.adminName ?? null,
      officeName: la.cover?.officeName ?? null,
      soft: la.soft,
    };
  }

  // The signed-in broker's own Billing page (no brokerId / listingId): the
  // slots panel for a paying company admin, and for a broker covered by one,
  // which of their boats her plan covers.
  // soft (counter only, the default): `text` is the counter sentence; `over`
  // = past the plan's range (Billing then shows the over note with its
  // Upgrade button instead, and the boats as `names`).
  let adminSlots: { text: string; limit: number | null; used: number; planName: string | null; names: string[]; over: boolean; soft: boolean; officeNote: boolean } | null = null;
  let coveredBoats: string[] | null = null;
  if (!listingId && brokerId === user.id) {
    const mine = await coverSlotsForAdmin(supabaseAdmin, user.id).catch(() => null);
    if (mine) {
      const names = mine.ownBoats.map((b) => b.name).concat(mine.slots.map((x) => x.name));
      const soft = !officeCoverEnforceOn();
      // Covering other brokers' boats → the over note names Team / Office.
      const p = { planName: mine.planName, limit: mine.limit, used: mine.used, officeBrokers: mine.slots.length > 0 ? mine.officeBrokers : null };
      adminSlots = {
        text: soft ? counterLong({ ...p, names }) : adminSlotsSentence(mine),
        limit: mine.limit, used: mine.used, planName: mine.planName, names,
        over: soft && !!overMessage(p),
        soft,
        // The over note names Team / Office (Billing links to Brokerage → Billing).
        officeNote: soft && !!overMessage(p) && p.officeBrokers != null,
      };
    }
    // Soft mode: no list — "Your Portal tools are covered by Kelly Sprigg's plan (SYC Yachts)."
    if (officeAdminCovered && officeAdminCover && officeCoverEnforceOn()) {
      const { data: me } = await supabaseAdmin.from("profiles").select("brokerage_id").eq("id", user.id).maybeSingle();
      const cover = await brokerSlotCover(supabaseAdmin, user.id, (me as { brokerage_id: string | null } | null)?.brokerage_id ?? null, officeAdminCover.officeName).catch(() => null);
      // Table not there yet (68a46e1 fallback): null → the old sentence.
      coveredBoats = cover && !coverSlotsTableMissing() ? cover.slotBoats : null;
    }
  }

  // trialDays: this broker's trial length (14, or 30 for accounts opened
  // before Oct 24 2026) — see trialDaysFor in subscriptionAccess.ts.
  return NextResponse.json({
    status, daysLeft, trialEndsAt, trialDays, officeCovered, reelServiceCovered: !!reelServiceCovered, brokerName,
    officeAdminCovered: !!officeAdminCovered,
    // "Kelly Sprigg's plan covers these boats of yours: …"
    officeAdminName: officeAdminCover?.adminName ?? null,
    officeName: officeAdminCover?.officeName ?? null,
    listingAccess,
    adminSlots,
    coveredBoats,
  });
}

// No fetch made while answering this route is ever served from the Next.js
// fetch cache (Nov 2026: cached internal calls froze the daily jobs for two weeks).
export const fetchCache = "force-no-store";
