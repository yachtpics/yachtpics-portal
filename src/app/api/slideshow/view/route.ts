import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { listingId, slug } = await req.json();
    if (!listingId || !slug) return NextResponse.json({ ok: true });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    await supabase.from("slideshow_views").insert({
      listing_id: listingId,
      slideshow_slug: slug,
    });

    // Notify the broker (and any linked assistants) that a client is viewing.
    try {
      const { data: listing } = await supabase
        .from("listings")
        .select("vessel_name, broker_id")
        .eq("id", listingId)
        .single();

      if (listing?.broker_id) {
        const { sendPushToUser } = await import("@/lib/sendPush");
        const payload = {
          title: "A client is viewing your listing",
          body: `Someone just opened the slideshow for ${listing.vessel_name ?? "your listing"}.`,
          url: `/dashboard/listings/${listingId}`,
          tag: `view-${listingId}`,
        };
        await sendPushToUser(listing.broker_id, payload);

        const { data: links } = await supabase
          .from("broker_assistants")
          .select("assistant_id")
          .eq("broker_id", listing.broker_id);
        await Promise.all((links ?? []).map((l) => sendPushToUser(l.assistant_id, payload)));
      }
    } catch {
      // Never block the viewer on notification failures.
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true }); // never block the viewer
  }
}
