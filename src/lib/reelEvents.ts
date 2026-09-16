import { createClient as createServiceClient } from "@supabase/supabase-js";

/**
 * Reel metrics.
 *
 * The Reel went out to every broker on the portal as a two-week open house,
 * and the only honest way to know whether that landed is to count what they
 * made. So: one row when a film finishes rendering, one row for each thing
 * they do with it afterwards.
 *
 * Everything here is deliberately quiet. A tracking failure must never break
 * a render the broker is waiting on, so every path swallows its errors and
 * the caller is told nothing went wrong.
 */

export type ReelEventKind =
  | "render"
  | "download"
  | "send_to_phone"
  | "copy_caption"
  | "added_to_listing";

export const REEL_EVENT_KINDS: ReelEventKind[] = [
  "render", "download", "send_to_phone", "copy_caption", "added_to_listing",
];

/** What was made — only carried on a 'render' row. */
export type ReelShape = {
  format?: string | null;
  look?: string | null;
  reelLength?: string | null;
  fit?: string | null;
  photoCount?: number | null;
  seconds?: number | null;
  ypBrand?: boolean | null;
  renderMs?: number | null;
};

function clampText(v: unknown, max = 40): string | null {
  return typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;
}

function clampInt(v: unknown, max = 100_000_000): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(max, Math.round(v)));
}

/**
 * Record one Reel event.
 *
 * `userId` is whoever clicked; the broker is resolved from the listing, so an
 * assistant's reel counts towards the broker it was made for. Admin rows are
 * written like any other and tagged with the role — the Reels page shows them
 * separately rather than pretending the test renders didn't happen.
 */
export async function logReelEvent(opts: {
  userId: string;
  kind: ReelEventKind;
  listingId?: string | null;
  shape?: ReelShape;
}): Promise<void> {
  try {
    const service = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const listingId = typeof opts.listingId === "string" ? opts.listingId : null;

    const { data: profile } = await service
      .from("profiles")
      .select("role")
      .eq("id", opts.userId)
      .maybeSingle();

    // The broker comes from the listing, never from the caller — an assistant's
    // reel is the broker's uptake, and nothing client-side gets to say whose.
    let brokerId: string | null = null;
    if (listingId) {
      const { data: listing } = await service
        .from("listings")
        .select("broker_id")
        .eq("id", listingId)
        .maybeSingle();
      brokerId = listing?.broker_id ?? null;
    }

    const s = opts.shape ?? {};

    await service.from("reel_events").insert({
      user_id: opts.userId,
      role: profile?.role ?? null,
      broker_id: brokerId,
      listing_id: listingId,
      kind: opts.kind,
      format: clampText(s.format),
      look: clampText(s.look),
      reel_length: clampText(s.reelLength),
      fit: clampText(s.fit),
      photo_count: clampInt(s.photoCount, 200),
      seconds: clampInt(s.seconds, 3600),
      yp_brand: s.ypBrand === true,
      render_ms: clampInt(s.renderMs, 3_600_000),
    });
  } catch {
    // Never let tracking failures surface to the caller.
  }
}
