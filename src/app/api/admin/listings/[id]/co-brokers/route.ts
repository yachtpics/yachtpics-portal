import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";

// Add a co-broker to a listing. Admin only.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin, userId } = auth;
  const listingId = params.id;

  let body: { brokerId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const brokerId = (body.brokerId ?? "").trim();
  if (!brokerId) return NextResponse.json({ error: "A broker is required." }, { status: 400 });

  // The target must be a broker.
  const { data: target } = await admin.from("profiles").select("role").eq("id", brokerId).single();
  if (target?.role !== "broker") {
    return NextResponse.json({ error: "That account isn't a broker." }, { status: 400 });
  }

  // Can't co-broker the listing to its own owner.
  const { data: listing } = await admin.from("listings").select("broker_id").eq("id", listingId).single();
  if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  if (listing.broker_id === brokerId) {
    return NextResponse.json({ error: "That broker already owns this listing." }, { status: 400 });
  }

  const { error } = await admin
    .from("listing_co_brokers")
    .upsert({ listing_id: listingId, broker_id: brokerId, added_by: userId }, { onConflict: "listing_id,broker_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

// Remove a co-broker from a listing. Admin only.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;
  const listingId = params.id;

  let body: { brokerId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const brokerId = (body.brokerId ?? "").trim();
  if (!brokerId) return NextResponse.json({ error: "A broker is required." }, { status: 400 });

  const { error } = await admin
    .from("listing_co_brokers")
    .delete()
    .eq("listing_id", listingId)
    .eq("broker_id", brokerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
