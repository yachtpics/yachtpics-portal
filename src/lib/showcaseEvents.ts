import { createClient as createServiceClient } from "@supabase/supabase-js";

type ShowcaseEventKind = "page_open" | "boat_view" | "contact_click";

/**
 * Record a Recently Photographed usage event. Admin activity is skipped — the
 * point is to measure whether brokers/assistants are using the page, not us.
 * Failures are swallowed so tracking never breaks the request it rides along.
 */
export async function logShowcaseEvent(opts: {
  userId: string;
  kind: ShowcaseEventKind;
  listingId?: string | null;
  detail?: string | null;
  throttleMinutes?: number;
}): Promise<void> {
  try {
    const service = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Only track brokers/assistants — ignore admins curating the page.
    const { data: profile } = await service
      .from("profiles")
      .select("role")
      .eq("id", opts.userId)
      .maybeSingle();
    if (profile?.role === "admin") return;

    if (opts.throttleMinutes && opts.throttleMinutes > 0) {
      const cutoff = new Date(Date.now() - opts.throttleMinutes * 60 * 1000).toISOString();
      let q = service
        .from("showcase_events")
        .select("id")
        .eq("user_id", opts.userId)
        .eq("kind", opts.kind)
        .gte("created_at", cutoff);
      q = opts.listingId ? q.eq("listing_id", opts.listingId) : q.is("listing_id", null);
      const { data: recent } = await q.limit(1);
      if (recent && recent.length > 0) return;
    }

    await service.from("showcase_events").insert({
      user_id: opts.userId,
      kind: opts.kind,
      listing_id: opts.listingId ?? null,
      detail: opts.detail ?? null,
    });
  } catch {
    // Never let tracking failures surface to the caller.
  }
}
