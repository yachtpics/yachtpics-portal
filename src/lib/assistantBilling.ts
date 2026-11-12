import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Assistants have no plan of their own (Nov 11): everything they do follows
 * the broker's plan. The broker billing routes (Stripe checkout, billing
 * portal, change plan) call this right after getUser() so an assistant can't
 * start a subscription of their own, whatever the page shows. The Billing page
 * shows them a "Plans belong to the broker" panel instead of plans.
 *
 * Reads the caller's OWN profile row with the session client (RLS allows it).
 * Returns a 403 response for an assistant, otherwise null.
 */
export async function refuseAssistantBilling(supabase: SupabaseClient, userId: string): Promise<NextResponse | null> {
  const { data: me } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (me?.role !== "assistant") return null;
  return NextResponse.json(
    { error: "Plans belong to the broker. As an assistant there's nothing for you to subscribe to." },
    { status: 403 }
  );
}
