import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/requireAdmin";
import { getDemoAccounts, isDemoUser } from "@/lib/demoServer";
import { officeBookendStatus, readBookendSettings, resolveLogoBookends, type BookendTarget } from "@/lib/logoBookendsServer";
import { bookendDelete, bookendPatch, bookendPost } from "@/lib/logoBookendsRoutes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin: set a broker's or a brokerage's logo bookends for them (Nov 25,
 * 2026 — src/lib/logoBookends.ts). Admin-only; not in Help.
 *   ?brokerId=…    a broker's own set     ?brokerageId=…  an office's set
 *   GET            → { available, own, office? }
 *   GET ?resolveFor=<brokerId> → { bookends } — what that broker's reels use
 *                    (the admin Reel Studio, when branding is the broker's)
 *   POST multipart { which, file }   PATCH { on, ground }   DELETE ?which=
 * The demo and filming accounts are refused as targets (as the admin logo
 * route does). Before the migration: available false, writes 409.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function targetFrom(svc: SupabaseClient, req: Request): Promise<{ target: BookendTarget; error?: undefined } | { error: NextResponse; target?: undefined }> {
  const sp = new URL(req.url).searchParams;
  const brokerId = sp.get("brokerId");
  const brokerageId = sp.get("brokerageId");
  if (brokerageId && UUID_RE.test(brokerageId)) {
    const { data } = await svc.from("brokerages").select("id").eq("id", brokerageId).maybeSingle();
    if (!data) return { error: NextResponse.json({ error: "Brokerage not found." }, { status: 404 }) };
    return { target: { kind: "office", id: brokerageId } };
  }
  if (brokerId && UUID_RE.test(brokerId)) {
    const { data: profile } = await svc.from("profiles").select("role").eq("id", brokerId).maybeSingle();
    if (!profile) return { error: NextResponse.json({ error: "Broker not found." }, { status: 404 }) };
    if (profile.role !== "broker") return { error: NextResponse.json({ error: "This can only be set on broker accounts." }, { status: 400 }) };
    // The demo and filming accounts keep what their seed jobs give them.
    const demoRows = await getDemoAccounts(svc, { fresh: true });
    if (demoRows.some((r) => r.user_id === brokerId)) {
      return { error: NextResponse.json({ error: "That's a demo account — this can't be changed here." }, { status: 400 }) };
    }
    const { data: authUser } = await svc.auth.admin.getUserById(brokerId);
    if (authUser?.user && isDemoUser(authUser.user)) {
      return { error: NextResponse.json({ error: "That's a demo account — this can't be changed here." }, { status: 400 }) };
    }
    return { target: { kind: "broker", id: brokerId } };
  }
  return { error: NextResponse.json({ error: "brokerId or brokerageId required." }, { status: 400 }) };
}

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const svc = auth.admin;
  const resolveFor = new URL(req.url).searchParams.get("resolveFor");
  if (resolveFor !== null) {
    if (!UUID_RE.test(resolveFor)) return NextResponse.json({ bookends: null }, { headers: { "Cache-Control": "no-store" } });
    const bookends = await resolveLogoBookends(svc, resolveFor);
    return NextResponse.json({ bookends }, { headers: { "Cache-Control": "no-store" } });
  }
  const t = await targetFrom(svc, req);
  if (t.error) return t.error;
  const own = await readBookendSettings(svc, t.target);
  if (!own) return NextResponse.json({ available: false, own: null, office: null }, { headers: { "Cache-Control": "no-store" } });
  const office = t.target.kind === "broker" ? await officeBookendStatus(svc, t.target.id) : null;
  return NextResponse.json(
    { available: true, own, office: office ? { name: office.name, on: office.on } : null },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const t = await targetFrom(auth.admin, req);
  if (t.error) return t.error;
  return bookendPost(auth.admin, t.target, req);
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const t = await targetFrom(auth.admin, req);
  if (t.error) return t.error;
  return bookendPatch(auth.admin, t.target, req);
}

export async function DELETE(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const t = await targetFrom(auth.admin, req);
  if (t.error) return t.error;
  return bookendDelete(auth.admin, t.target, req);
}

// No fetch made while answering this route is ever served from the Next.js
// fetch cache (Nov 2026: cached internal calls froze the daily jobs for two weeks).
export const fetchCache = "force-no-store";
