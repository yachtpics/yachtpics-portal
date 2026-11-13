import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/requireAdmin";
import { getDemoAccounts, isDemoUser } from "@/lib/demoServer";
import { logoFileError, storeBrokerLogoFile } from "@/lib/brokerLogoUpload";

export const runtime = "nodejs";

/**
 * Admin → Brokers → a broker → Logo. Sets (POST, multipart "file") or clears
 * (DELETE) a broker's logo for them. Stores exactly what the broker's own
 * upload on My Profile stores (src/lib/brokerLogoUpload.ts): the file at
 * broker-logos/{brokerId}/logo.{ext} and its public URL in
 * broker_details.logo_url — so the reel end card, spec sheet, slideshow,
 * social post, dock card and website all pick it up, and a later upload by
 * the broker replaces it normally. Admin-only; not in Help.
 */

/** Null when the id is a real broker the admin may edit, else the response to send. */
async function checkTarget(svc: SupabaseClient, brokerId: string): Promise<NextResponse | null> {
  const { data: profile } = await svc.from("profiles").select("role").eq("id", brokerId).maybeSingle();
  if (!profile) return NextResponse.json({ error: "Broker not found." }, { status: 404 });
  if (profile.role !== "broker") {
    return NextResponse.json({ error: "Logos can only be set on broker accounts." }, { status: 400 });
  }
  // The demo and filming accounts keep the logo their seed jobs give them.
  const demoRows = await getDemoAccounts(svc, { fresh: true });
  if (demoRows.some((r) => r.user_id === brokerId)) {
    return NextResponse.json({ error: "That's a demo account — its logo can't be changed here." }, { status: 400 });
  }
  const { data: authUser } = await svc.auth.admin.getUserById(brokerId);
  if (authUser?.user && isDemoUser(authUser.user)) {
    return NextResponse.json({ error: "That's a demo account — its logo can't be changed here." }, { status: 400 });
  }
  return null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;

  try {
    const bad = await checkTarget(admin, params.id);
    if (bad) return bad;

    let file: File | null = null;
    try {
      const form = await req.formData();
      const f = form.get("file");
      file = f && typeof f !== "string" ? (f as File) : null;
    } catch {
      return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
    }
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const invalid = logoFileError(file);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const stored = await storeBrokerLogoFile(admin, params.id, file);
    if (stored.error !== undefined) return NextResponse.json({ error: stored.error }, { status: 500 });

    // The broker may have no broker_details row yet (it's created the first
    // time they save their profile), so upsert on the id — only logo_url is
    // written; any other column on an existing row is left alone.
    const { error: dbError } = await admin
      .from("broker_details")
      .upsert({ id: params.id, logo_url: stored.url }, { onConflict: "id" });
    if (dbError) return NextResponse.json({ error: `DB update failed: ${dbError.message}` }, { status: 500 });

    return NextResponse.json({ url: stored.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Mirrors the broker's "Remove logo" on My Profile: clears logo_url only.
// That flow leaves the file in storage, so this does too (the next upload
// overwrites it at the same path).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;

  try {
    const bad = await checkTarget(admin, params.id);
    if (bad) return bad;

    const { error } = await admin.from("broker_details").update({ logo_url: null }).eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ url: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
