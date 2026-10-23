import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { r2SignedGetUrl, r2VideoConfigured } from "@/lib/r2";
import { ANGLE_LABEL, loadReelServiceEnrolment, type ReelServiceAngle } from "@/lib/reelService";
import ReelList, { type DeliveredReel } from "./ReelList";

export const dynamic = "force-dynamic";

/**
 * Your reels — the Reel Service deliveries (Oct 4).
 *
 * A broker sees their own delivered reels; an assistant sees those of every
 * broker they're linked to; an admin sees the latest across everyone. Newest
 * first, each with an inline preview, Download / Save or share, and the
 * caption to copy. Playback links are signed here (6 hours); Download and
 * Share ask /api/reel-service/jobs/[id]/url for fresh ones.
 */
export default async function YourReelsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: me } = await svc.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const role = me?.role ?? "broker";

  let brokerIds: string[] | null = [user.id];
  if (role === "assistant") {
    const { data: links } = await svc.from("broker_assistants").select("broker_id").eq("assistant_id", user.id);
    brokerIds = ((links ?? []) as { broker_id: string }[]).map((l) => l.broker_id);
  } else if (role === "admin") {
    brokerIds = null;
  }

  let reels: DeliveredReel[] = [];
  if (brokerIds === null || brokerIds.length > 0) {
    let q = svc.from("reel_service_jobs")
      .select("id, broker_id, period, slot, angle, caption, video_path, delivered_at, listings:listing_id(vessel_name, year, make, model), profiles:broker_id(first_name, last_name)")
      .eq("status", "delivered")
      .not("video_path", "is", null)
      .order("delivered_at", { ascending: false })
      .limit(brokerIds === null ? 60 : 200);
    if (brokerIds !== null) q = q.in("broker_id", brokerIds);
    const { data } = await q;
    const rows = (data ?? []) as unknown as {
      id: string; broker_id: string; period: string; slot: number; angle: string; caption: string | null; video_path: string;
      delivered_at: string | null;
      listings: { vessel_name: string | null; year: number | null; make: string | null; model: string | null } | null;
      profiles: { first_name: string | null; last_name: string | null } | null;
    }[];
    const canSign = r2VideoConfigured();
    reels = await Promise.all(rows.map(async (r) => {
      let playUrl: string | null = null;
      if (canSign) { try { playUrl = await r2SignedGetUrl(r.video_path, { expiresIn: 60 * 60 * 6 }); } catch { playUrl = null; } }
      const l = r.listings;
      return {
        id: r.id,
        boat: l?.vessel_name || [l?.year, l?.make, l?.model].filter(Boolean).join(" ") || "Listing",
        angle: ANGLE_LABEL[r.angle as ReelServiceAngle] ?? r.angle,
        caption: r.caption ?? "",
        deliveredAt: r.delivered_at,
        playUrl,
        brokerName: role === "broker" ? null : [r.profiles?.first_name, r.profiles?.last_name].filter(Boolean).join(" ") || null,
      };
    }));
  }

  // The boats in the Reel Service (Oct 23 — enrolment is per boat). A broker
  // with no boats chosen yet still has every active listing planned, so those
  // are listed. No price here: quotes are handled by email.
  let enrolledBoats: string[] = [];
  if (brokerIds !== null && brokerIds.length > 0) {
    try {
      const { data: subs } = await svc.from("reel_service_subscriptions").select("broker_id").in("broker_id", brokerIds).eq("enabled", true);
      const active = ((subs ?? []) as { broker_id: string }[]).map((x) => x.broker_id);
      if (active.length) {
        const en = await loadReelServiceEnrolment(svc, active);
        const legacy = active.filter((b) => en[b]?.legacy);
        const ids = active.reduce((acc: string[], b) => acc.concat(en[b]?.listingIds ?? []), []);
        const reads = [];
        if (ids.length) reads.push(svc.from("listings").select("vessel_name, year, make, model").in("id", ids).eq("status", "active"));
        if (legacy.length) reads.push(svc.from("listings").select("vessel_name, year, make, model").in("broker_id", legacy).eq("status", "active"));
        const res = await Promise.all(reads);
        enrolledBoats = res.reduce((acc: string[], r) => acc.concat(((r.data ?? []) as { vessel_name: string | null; year: number | null; make: string | null; model: string | null }[])
          .map((l) => l.vessel_name || [l.year, l.make, l.model].filter(Boolean).join(" ") || "Listing")), [])
          .filter((x, i, a) => a.indexOf(x) === i)
          .sort((a, b) => a.localeCompare(b));
      }
    } catch {
      enrolledBoats = [];
    }
  }

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">
      <h1 className="text-display text-ink-900">Your reels</h1>
      <p className="text-ink-500 mt-1 text-sm max-w-2xl">
        Social reels made for you by YachtPics for the boats enrolled in the Reel Service. Each is silent on purpose &mdash; add a trending track when you post.
        On a phone, <strong>Save or share</strong> sends it straight to Instagram or your camera roll.
      </p>
      {enrolledBoats.length > 0 && (
        <p className="text-ink-600 mt-3 text-sm max-w-2xl">
          <span className="font-medium text-ink-900">Boats in the Reel Service:</span> {enrolledBoats.join(", ")}.
          {" "}To add or remove a boat, just email us.
        </p>
      )}
      <ReelList reels={reels} />
    </div>
  );
}
