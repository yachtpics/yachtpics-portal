import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user for a server-rendered page, or null.
 *
 * Wrapped in React `cache()`, which is scoped to a single request: when the
 * dashboard layout and the dashboard page both ask during one page load, the
 * Supabase Auth round trip happens once. Nothing is shared between requests
 * or between users.
 *
 * Uses `getUser()` — the token is verified by Supabase Auth, not just decoded.
 * Callers still decide what to do when it's null (usually redirect to login).
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});
