import type { SupabaseClient } from "@supabase/supabase-js";

export type ExistingUser = { id: string; role: string | null; first_name: string | null; last_name: string | null };

/**
 * Reliably resolve an existing account for an email, regardless of how many
 * accounts exist. Checks the profiles table first (no pagination concerns),
 * then falls back to scanning auth users in large pages.
 *
 * IMPORTANT: a bare `auth.admin.listUsers()` only returns the FIRST 50 accounts.
 * Relying on it to detect existing users silently breaks once the account count
 * grows past 50 — which caused "email already registered" errors when re-adding
 * a known broker/assistant. Always use this helper instead.
 */
/**
 * `ilike` treats % and _ as wildcards (and \ as their escape), and PostgREST
 * also turns * into %: escape \ % _, and put a one-character wildcard in for
 * * (it can't be escaped through PostgREST). The caller then keeps only an
 * exact case-insensitive match, so "a_b@x.com" never finds "axb@x.com".
 */
export function escapeLikePattern(s: string): string {
  return s.replace(/[\\%_]/g, (c) => "\\" + c).replace(/\*/g, "_");
}

export async function findExistingUser(supabase: SupabaseClient, email: string): Promise<ExistingUser | null> {
  const { data: profs } = await supabase
    .from("profiles")
    .select("id, role, first_name, last_name, display_email")
    .ilike("display_email", escapeLikePattern(email))
    .limit(5);
  const want = email.toLowerCase();
  const prof = (profs ?? []).find((p) => typeof p.display_email === "string" && p.display_email.toLowerCase() === want);
  if (prof) {
    return { id: prof.id, role: prof.role ?? null, first_name: prof.first_name ?? null, last_name: prof.last_name ?? null };
  }

  for (let page = 1; page <= 20; page++) {
    const { data } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    const u = data?.users?.find((x) => x.email?.toLowerCase() === email.toLowerCase());
    if (u) {
      const { data: p2 } = await supabase.from("profiles").select("role, first_name, last_name").eq("id", u.id).maybeSingle();
      return { id: u.id, role: p2?.role ?? null, first_name: p2?.first_name ?? null, last_name: p2?.last_name ?? null };
    }
    if (!data?.users || data.users.length < 1000) break;
  }
  return null;
}
