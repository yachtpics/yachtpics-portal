import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { demoGuard } from "@/lib/demoServer";
import { officeBookendStatus, readBookendSettings, type BookendTarget } from "@/lib/logoBookendsServer";
import { bookendDelete, bookendPatch, bookendPost } from "@/lib/logoBookendsRoutes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * My Profile → "Open and close with my logo" (Nov 25, 2026): the signed-in
 * broker's OWN logo bookends (src/lib/logoBookends.ts).
 *   GET    → { available, own: settings | null, office: { name, on } | null }
 *   POST   multipart { which, file }   PATCH { on, ground }   DELETE ?which=
 * Brokers only; the read-only demo and the filming account are refused (not
 * on DEMO_RW_ALLOW). Before the migration: available false, writes 409.
 */

type Ok = { svc: SupabaseClient; target: BookendTarget; error?: undefined };
type Err = { error: NextResponse; svc?: undefined; target?: undefined };

async function caller(write: boolean): Promise<Ok | Err> {
  const { data: { user } } = await (await createServerClient()).auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  // Read-only demo (layer 3 — src/lib/demo.ts).
  if (write) { const demo = demoGuard(user); if (demo) return { error: demo }; }
  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: me } = await svc.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "broker") {
    return { error: NextResponse.json({ error: "Only a broker can set this on their own profile." }, { status: 403 }) };
  }
  return { svc, target: { kind: "broker", id: user.id } };
}

export async function GET() {
  const c = await caller(false);
  if (c.error) return c.error;
  const own = await readBookendSettings(c.svc, c.target);
  if (!own) return NextResponse.json({ available: false, own: null, office: null }, { headers: { "Cache-Control": "no-store" } });
  const office = await officeBookendStatus(c.svc, c.target.id);
  return NextResponse.json(
    { available: true, own, office: office ? { name: office.name, on: office.on } : null },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: Request) {
  const c = await caller(true);
  if (c.error) return c.error;
  return bookendPost(c.svc, c.target, req);
}

export async function PATCH(req: Request) {
  const c = await caller(true);
  if (c.error) return c.error;
  return bookendPatch(c.svc, c.target, req);
}

export async function DELETE(req: Request) {
  const c = await caller(true);
  if (c.error) return c.error;
  return bookendDelete(c.svc, c.target, req);
}

// No fetch made while answering this route is ever served from the Next.js
// fetch cache (Nov 2026: cached internal calls froze the daily jobs for two weeks).
export const fetchCache = "force-no-store";
