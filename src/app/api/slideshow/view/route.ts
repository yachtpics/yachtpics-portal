import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logEmail } from "@/lib/logEmail";
import { buyerViewEmailHtml, viewEmailSubject } from "@/lib/viewNotifyEmail";
import { describeViewSource, describeDevice, describeLocation, referrerHost } from "@/lib/viewSource";
import { formatDateTimeET } from "@/lib/datetime";
import { getEffectiveAccessStatus } from "@/lib/brokerAccess";
import { hasAccess } from "@/lib/subscriptionAccess";
import { isDemoListing } from "@/lib/demoServer";

export const runtime = "nodejs";

// Don't ping the broker on every single page load — only on a "fresh" open.
const THROTTLE_MS = 6 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const { listingId, slug, source, sendToken, sessionId, site, referrer } = await req.json();
    if (!listingId || !slug) return NextResponse.json({ ok: true });
    const src = typeof source === "string" ? source.slice(0, 24).replace(/[^a-z0-9_-]/gi, "") || null : null;
    const token = typeof sendToken === "string" ? sendToken.slice(0, 40).replace(/[^a-z0-9]/gi, "") || null : null;
    const session = typeof sessionId === "string" ? sessionId.slice(0, 48).replace(/[^a-z0-9_-]/gi, "") || null : null;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // The read-only demo's boat: count nothing, notify nobody.
    if (await isDemoListing(supabase, String(listingId))) return NextResponse.json({ ok: true });

    // Was this slideshow already viewed recently? Check before inserting so the
    // new row doesn't count against itself.
    const { count: recentViews } = await supabase
      .from("slideshow_views")
      .select("*", { count: "exact", head: true })
      .eq("listing_id", listingId)
      .gte("viewed_at", new Date(Date.now() - THROTTLE_MS).toISOString());

    // A tracked Send-to-Client link? Attribute the open to that recipient.
    let send: { id: string; client_email: string; client_name: string | null; open_count: number; sent_at: string | null } | null = null;
    if (token) {
      const { data: row } = await supabase
        .from("client_sends")
        .select("id, client_email, client_name, open_count, sent_at")
        .eq("token", token)
        .eq("listing_id", listingId)
        .maybeSingle();
      if (row) {
        send = row;
        await supabase
          .from("client_sends")
          .update({ open_count: (row.open_count ?? 0) + 1, last_opened_at: new Date().toISOString() })
          .eq("id", row.id);
      }
    }

    await supabase.from("slideshow_views").insert({
      listing_id: listingId,
      slideshow_slug: slug,
      source: src,
      send_id: send?.id ?? null,
      session_id: session,
    });

    // A named recipient opening their link is always worth telling the broker
    // about — that's the whole point of the tracked link.
    const isFreshOpen = (recentViews ?? 0) === 0 || !!send;

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
            // Everything we know about this visit, in plain words — the same
            // facts go in the push, the email and the email's log row.
            const now = Date.now();
            const iso = (ms: number) => new Date(ms).toISOString();
            const countSince = (since: string | null) => {
              let q = supabase.from("slideshow_views").select("*", { count: "exact", head: true }).eq("listing_id", listingId);
              if (since) q = q.gte("viewed_at", since);
              return q;
            };
            const [v7, v30, vAll, prev, shows, access] = await Promise.all([
              countSince(iso(now - 7 * 86400000)),
              countSince(iso(now - 30 * 86400000)),
              countSince(null),
              // The two newest rows: this view, and the one before it.
              supabase.from("slideshow_views").select("viewed_at").eq("listing_id", listingId).order("viewed_at", { ascending: false }).limit(2),
              supabase.from("boat_shows").select("key, short_name"),
              getEffectiveAccessStatus(supabase, listing.broker_id).catch(() => null),
            ]);
            const showNames: Record<string, string> = {};
            (shows.data ?? []).forEach((r: { key: string | null; short_name: string | null }) => {
              if (r.key && r.short_name) showNames[r.key.toLowerCase()] = r.short_name;
            });
            const info = describeViewSource({ source: src, tracked: !!send, onBrokerSite: typeof site === "string" && !!site, showNames });
            const location = describeLocation({
              city: req.headers.get("x-vercel-ip-city"),
              region: req.headers.get("x-vercel-ip-country-region"),
              country: req.headers.get("x-vercel-ip-country"),
            });
            const device = describeDevice(req.headers.get("user-agent"));
            const cameFrom = referrerHost(referrer);
            const previousViewAt = prev.data && prev.data.length > 1 ? prev.data[1].viewed_at : null;
            const who = send ? (send.client_name || send.client_email) : null;
            const boatName = listing.vessel_name ?? "your listing";

            // Push (best-effort; requires VAPID keys configured)
            try {
              const { sendPushToUser } = await import("@/lib/sendPush");
              const payload = {
                title: who ? `${who} is viewing your listing` : `New view on ${boatName}`,
                body: who
                  ? `${who} just opened the slideshow for ${boatName}.`
                  : `Came from: ${info.label}${location ? ` · ${location}` : ""}.`,
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
              const subject = viewEmailSubject({ who, vesselName: listing.vessel_name, sourceLabel: info.label });
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
                    who,
                    whoEmail: send?.client_email ?? null,
                    openCount: send ? (send.open_count ?? 0) + 1 : null,
                    sentAt: send?.sent_at ? formatDateTimeET(send.sent_at) : null,
                    sourceLabel: info.label,
                    sourceDetail: info.detail,
                    viewedAt: formatDateTimeET(now),
                    location,
                    device,
                    referrer: cameFrom,
                    views7d: v7.count ?? null,
                    views30d: v30.count ?? null,
                    viewsAll: vAll.count ?? null,
                    previousViewAt: previousViewAt ? formatDateTimeET(previousViewAt) : null,
                    canSend: access ? hasAccess(access.status) : undefined,
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
                // So "where did that view come from?" can be answered later.
                metadata: { source: src ?? "link", sourceLabel: info.label, sendId: send?.id ?? null, location, device, referrer: cameFrom },
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
