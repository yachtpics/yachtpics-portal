import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { DockCardSize } from "@/lib/dockCardPdf";
import { buildEverydayDockCard, pdfHeaders } from "@/lib/dockCardAssets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/listings/[id]/dock-card?size=5x7|letter
 *
 * The everyday dock card (Nov 1): the show card's layout without a show,
 * whose QR opens the YachtPics always-live link /yp/{token}?via=card#video —
 * so it works with or without a plan (it's our marketing), and scans are
 * recorded as source "yp_card". Built by buildEverydayDockCard
 * (src/lib/dockCardAssets.ts).
 *
 * Access: the same as /show-card — anyone who can read the listing under
 * their own session (RLS: owner, co-broker, assistant, brokerage admin,
 * admin). Signed out → sign in and come straight back (the monthly email
 * links here). 409 "Publish the slideshow first." without a published
 * slideshow (or with the YachtPics link switched off).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const size: DockCardSize = req.nextUrl.searchParams.get("size") === "letter" ? "letter" : "5x7";
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const back = `/api/listings/${encodeURIComponent(params.id)}/dock-card?size=${size}`;
    return NextResponse.redirect(new URL(`/auth/login?next=${encodeURIComponent(back)}`, req.nextUrl.origin));
  }

  // Readers only: the listings RLS decides.
  const { data: readable } = await supabase.from("listings").select("id").eq("id", params.id).maybeSingle();
  if (!readable) return NextResponse.json({ error: "Listing not found." }, { status: 404 });

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const card = await buildEverydayDockCard(svc, readable.id as string, size);
  if (!card.ok) return NextResponse.json({ error: card.error }, { status: card.status });

  return new NextResponse(Buffer.from(card.pdf), { status: 200, headers: pdfHeaders(card.fileName) });
}
