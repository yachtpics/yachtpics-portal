import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Marketing-email opt-out by token. Handles two callers:
//  1. Mail clients (Gmail/Yahoo) hitting List-Unsubscribe one-click → POST.
//  2. Our own /unsubscribe page button → POST (with optional action=resubscribe).
// GET intentionally does NOT change state, so link scanners that pre-fetch the
// footer link can't silently unsubscribe a broker.

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function setOptOut(token: string, optOut: boolean): Promise<boolean> {
  if (!token) return false;
  const { data, error } = await service()
    .from("profiles")
    .update({ email_opt_out: optOut })
    .eq("unsubscribe_token", token)
    .select("id")
    .maybeSingle();
  return !error && !!data;
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const action = req.nextUrl.searchParams.get("action");
  const optOut = action !== "resubscribe";
  const ok = await setOptOut(token, optOut);
  if (!ok) return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
  return NextResponse.json({ ok: true, optedOut: optOut });
}

// For convenience, a GET with a token returns current status without changing it.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });
  const { data } = await service()
    .from("profiles")
    .select("email_opt_out")
    .eq("unsubscribe_token", token)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  return NextResponse.json({ optedOut: data.email_opt_out === true });
}
