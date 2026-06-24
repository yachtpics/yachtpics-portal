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
export async function findExistingUser(supabase: SupabaseClient, email: string): Promise<ExistingUser | null> {
  const { data: prof } = await supabase
    .from("profiles")
    .select("id, role, first_name, last_name")
    .ilike("display_email", email)
    .limit(1)
    .maybeSingle();
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
