import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/requireAdmin";
import { BILLING_NOT_READY, type BrandKey, type ItemBrand } from "./types";

/**
 * Who may use the Billing section, and what they may touch.
 *
 * Being an `admin` is not enough: a login must also have an active row in
 * billing_staff. Each login keeps its own book (Charlie's and Samantha's money
 * never mix) and bills only under the brands in billing_staff_brands. The
 * owner (is_owner) is the only one who can change tax settings, edit or
 * retire YPDesigns / "both" items, confirm the brand split, merge clients,
 * and change Settings. The database repeats the read side of this in RLS
 * (billing_is_staff / billing_my_brands); writes only happen here, with the
 * service role, so every write route must call requireBillingStaff().
 */

export type BillingStaff = {
  profileId: string;
  displayName: string;
  isOwner: boolean;
  brands: BrandKey[];
  cardFeeRate: number;
};

/** Missing table / column (migration not applied yet). */
export function isMissingBillingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "PGRST205" || err.code === "42883" || err.code === "PGRST202" || err.code === "42703") return true;
  return /does not exist|could not find the (table|function)/i.test(err.message ?? "");
}

export function booksServiceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export type StaffLookup =
  | { state: "ok"; staff: BillingStaff }
  | { state: "not_ready" }
  | { state: "not_staff" }
  | { state: "error"; message: string };

export async function lookupBillingStaff(admin: SupabaseClient, userId: string): Promise<StaffLookup> {
  const { data, error } = await admin
    .from("billing_staff")
    .select("profile_id, display_name, is_owner, card_fee_rate, active")
    .eq("profile_id", userId)
    .maybeSingle();
  if (error) return isMissingBillingTable(error) ? { state: "not_ready" } : { state: "error", message: error.message };
  if (!data || !data.active) return { state: "not_staff" };

  const { data: brandRows, error: bErr } = await admin
    .from("billing_staff_brands")
    .select("brand")
    .eq("profile_id", userId);
  if (bErr) return isMissingBillingTable(bErr) ? { state: "not_ready" } : { state: "error", message: bErr.message };

  const brands: BrandKey[] = [];
  (brandRows ?? []).forEach((r: { brand: string }) => {
    if ((r.brand === "yachtpics" || r.brand === "ypdesigns") && brands.indexOf(r.brand) === -1) brands.push(r.brand);
  });
  brands.sort(); // yachtpics before ypdesigns

  return {
    state: "ok",
    staff: {
      profileId: data.profile_id as string,
      displayName: data.display_name as string,
      isOwner: !!data.is_owner,
      brands,
      cardFeeRate: Number(data.card_fee_rate),
    },
  };
}

type StaffOk = { admin: SupabaseClient; staff: BillingStaff; error?: undefined };
type StaffErr = { error: NextResponse; admin?: undefined; staff?: undefined };

/**
 * For /api/admin/books/* routes: signed in, admin role, AND active billing
 * staff. 403 for an admin who isn't billing staff; 503 when the tables
 * aren't there yet. Pass { ownerOnly: true } for owner-only actions.
 */
export async function requireBillingStaff(opts?: { ownerOnly?: boolean }): Promise<StaffOk | StaffErr> {
  const auth = await requireAdmin();
  if (auth.error) return { error: auth.error };
  const found = await lookupBillingStaff(auth.admin, auth.userId);
  if (found.state === "not_ready") return { error: NextResponse.json({ error: BILLING_NOT_READY, notReady: true }, { status: 503 }) };
  if (found.state === "error") return { error: NextResponse.json({ error: found.message }, { status: 500 }) };
  if (found.state === "not_staff") {
    return { error: NextResponse.json({ error: "This login doesn't keep a book in Billing." }, { status: 403 }) };
  }
  if (opts?.ownerOnly && !found.staff.isOwner) {
    return { error: NextResponse.json({ error: "Only the owner can do that." }, { status: 403 }) };
  }
  return { admin: auth.admin, staff: found.staff };
}

/** Can this login see an item of this brand? ("both" is visible to all staff.) */
export function canSeeItemBrand(staff: BillingStaff, brand: ItemBrand): boolean {
  return brand === "both" || staff.brands.indexOf(brand) !== -1;
}

/**
 * Can this login edit an item of this brand? The owner edits everything;
 * anyone else only items of a brand they bill under — never YPDesigns or
 * "both" (those carry YPDesigns, which is the owner's alone).
 */
export function canEditItemBrand(staff: BillingStaff, brand: ItemBrand): boolean {
  if (staff.isOwner) return true;
  if (brand === "both" || brand === "ypdesigns") return false;
  return staff.brands.indexOf(brand) !== -1;
}

export function isBrandKey(v: unknown): v is BrandKey {
  return v === "yachtpics" || v === "ypdesigns";
}
export function isItemBrand(v: unknown): v is ItemBrand {
  return v === "yachtpics" || v === "ypdesigns" || v === "both";
}

/** Trimmed string or null; caps length so a pasted essay can't bloat a row. */
export function cleanText(v: unknown, max = 500): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

export function isEmail(v: string | null): boolean {
  return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
