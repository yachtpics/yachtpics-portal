import { NextResponse } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { assertListingAccess } from "@/lib/assertListingAccess";

/**
 * Shared by the broker-side Reel Service routes: the caller must be signed in
 * and be the listing's broker, an assistant linked to that broker, or an
 * admin (assertListingAccess — no co-brokers, no brokerage admins).
 */
export async function reelServiceCaller(listingId: unknown): Promise<
  { error: NextResponse } | {
    error: null; service: SupabaseClient; userId: string; brokerId: string; isAdmin: boolean;
    /** The listing's broker or one of their assistants — the only people who may pay for it (an admin never pays for a broker). */
    canBuy: boolean;
  }
> {
  if (typeof listingId !== "string" || !/^[0-9a-f-]{36}$/i.test(listingId)) {
    return { error: NextResponse.json({ error: "Missing listing." }, { status: 400 }) };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  const service = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const access = await assertListingAccess(service, listingId, user.id);
  if (access instanceof NextResponse) return { error: access };
  const { data: me } = await service.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const isAdmin = me?.role === "admin";
  let canBuy = user.id === access.brokerId;
  if (!canBuy) {
    const { data: link } = await service.from("broker_assistants").select("broker_id")
      .eq("broker_id", access.brokerId).eq("assistant_id", user.id).maybeSingle();
    canBuy = !!link || !isAdmin;
  }
  return { error: null, service, userId: user.id, brokerId: access.brokerId, isAdmin, canBuy };
}
