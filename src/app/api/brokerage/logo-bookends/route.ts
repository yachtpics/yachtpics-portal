import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireBrokerageAdmin } from "@/lib/requireBrokerageAdmin";
import { demoGuardFromSession } from "@/lib/demoServer";
import { readBookendSettings, type BookendTarget } from "@/lib/logoBookendsServer";
import { bookendDelete, bookendPatch, bookendPost } from "@/lib/logoBookendsRoutes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Brokerage → "Open and close with our logo" (Nov 25, 2026): the office's
 * logo bookends (src/lib/logoBookends.ts). When on, they open and close every
 * reel and slideshow of every broker in the brokerage, over a broker's own.
 *   GET    → { available, own: settings | null }
 *   POST   multipart { which, file }   PATCH { on, ground }   DELETE ?which=
 * Brokerage admins only, for their own brokerage. The read-only demo is
 * refused on writes. Before the migration: available false, writes 409.
 */

type Ok = { svc: SupabaseClient; target: BookendTarget; error?: undefined };
type Err = { error: NextResponse; svc?: undefined; target?: undefined };

async function caller(write: boolean): Promise<Ok | Err> {
  const auth = await requireBrokerageAdmin();
  if (auth.error) return { error: auth.error };
  // Read-only demo (layer 3 — src/lib/demo.ts). requireBrokerageAdmin doesn't
  // hand back the user, so this reads it from the session.
  if (write) { const demo = await demoGuardFromSession(); if (demo) return { error: demo }; }
  return { svc: auth.admin, target: { kind: "office", id: auth.brokerageId } };
}

export async function GET() {
  const c = await caller(false);
  if (c.error) return c.error;
  const own = await readBookendSettings(c.svc, c.target);
  return NextResponse.json({ available: !!own, own }, { headers: { "Cache-Control": "no-store" } });
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
