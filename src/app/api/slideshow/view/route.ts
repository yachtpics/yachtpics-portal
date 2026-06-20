import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logEmail } from "@/lib/logEmail";
import { buyerViewEmailHtml } from "@/lib/viewNotifyEmail";

export const runtime = "nodejs";

// Don't ping the broker on every single page load — only on a "fresh" open.
const THROTTLE_MS = 6 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const { listingId, slug, source } = await req.json();
    if (!listingId || !slug) return NextResponse.json({ ok: true });
    const src = typeof source === "string" ? source.slice(0, 24).replace(/[^a-z0-9_-]/gi, "") || null : null;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Was this slideshow already viewed recently? Check before inserting so the
    // new row doesn't count against itself.
    const { count: recentViews } = await supabase
      .from("slideshow_views")
      .select("*", { count: "exact", head: true })
      .eq("listing_id", listingId)
      .gte("viewed_at", new Date(Date.now() - THROTTLE_MS).toISOString());

    await supabase.from("slideshow_views").insert({
      listing_id: listingId,
      slideshow_slug: slug,
      source: src,
    });

    const isFreshOpen = (recentViews ?? 0) === 0;

    // Notify the broker (and assistants) only on a fresh open.
    if (isFreshOpen) {
      try {
        const { data: listing } = await supabase
          .from("listings")
          .select("vessel_name, broker_id")
          .eq("id", listingId)
          .single();

        if (listing?.broker_id) {
          const { data: broker } = await supabase
            .from("profiles")
            .select("first_name, display_email, notify_on_view")
            .eq("id", listing.broker_id)
            .single();

          const wantsAlerts = broker?.notify_on_view !== false;

          if (wantsAlerts) {
            // Push (best-effort; requires VAPID keys configured)
            try {
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
            } catch {
              // push not configured / failed — ignore
            }

            // Email the broker
            if (broker?.display_email) {
              const subject = `A buyer opened your slideshow — ${listing.vessel_name ?? "your listing"}`;
              const res = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  from: "YachtPics <hello@yachtpics.com>",
                  to: broker.display_email,
                  subject,
                  html: buyerViewEmailHtml({
                    firstName: broker.first_name ?? "there",
                    vesselName: listing.vessel_name,
                    listingId,
                  }),
                }),
              });
              await logEmail({
                emailType: "slideshow_viewed",
                recipientEmail: broker.display_email,
                recipientRole: "broker",
                recipientId: listing.broker_id,
                brokerId: listing.broker_id,
                listingId,
                subject,
                status: res.ok ? "sent" : "failed",
              });
            }
          }
        }
      } catch {
        // Never block the viewer on notification failures.
      }
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true }); // never block the viewer
  }
}
