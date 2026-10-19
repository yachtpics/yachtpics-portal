// Boat shows (FLIBS 2026 first) — shared types and small helpers.
// Browser-safe: no server-only imports. Tables: public.boat_shows and
// public.listing_show_entries (migration 20261019_boat_shows.sql).

import type { SupabaseClient } from "@supabase/supabase-js";

export type BoatShow = {
  key: string;
  name: string;
  short_name: string;
  starts_on: string; // YYYY-MM-DD
  ends_on: string;   // YYYY-MM-DD
  city: string | null;
  is_active: boolean;
};

export type ShowEntry = {
  id: string;
  listing_id: string;
  show_key: string;
  location: string | null;
  note: string | null;
  marked_by: string | null;
  created_at: string;
  updated_at: string;
};

export const SHOW_LOCATION_MAX = 60;
export const SHOW_NOTE_MAX = 280;

/** The public site the dock-card QR codes point at. */
export const PORTAL_ORIGIN = "https://portal.yachtpics.com";

/** Today's date in Eastern time (the shows are in Florida), as YYYY-MM-DD. */
export function todayET(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** A show is "current" — worth showing a broker — from now until its last day. */
export function isShowCurrent(show: Pick<BoatShow, "is_active" | "ends_on">, today: string = todayET()): boolean {
  return show.is_active && show.ends_on >= today;
}

/**
 * Active shows whose last day hasn't passed, soonest first. Returns [] when the
 * table isn't there yet (migration not applied) or the read fails, so callers
 * simply show nothing.
 */
export async function getCurrentShows(client: SupabaseClient): Promise<BoatShow[]> {
  try {
    const { data, error } = await client
      .from("boat_shows")
      .select("key, name, short_name, starts_on, ends_on, city, is_active")
      .eq("is_active", true)
      .gte("ends_on", todayET())
      .order("starts_on", { ascending: true });
    if (error || !data) return [];
    return data as BoatShow[];
  } catch {
    return [];
  }
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "October 28 – November 1" (or "May 14 – 17" within one month). */
export function showDatesLabel(show: Pick<BoatShow, "starts_on" | "ends_on">): string {
  const [, sm, sd] = show.starts_on.split("-").map(Number);
  const [, em, ed] = show.ends_on.split("-").map(Number);
  if (sm === em) return `${MONTHS[sm - 1]} ${sd} – ${ed}`;
  return `${MONTHS[sm - 1]} ${sd} – ${MONTHS[em - 1]} ${ed}`;
}

/** The QR target for a listing's dock card: the slideshow, opened on the Video tab. */
export function dockCardUrl(slideshowSlug: string, showKey: string): string {
  return `${PORTAL_ORIGIN}/s/${encodeURIComponent(slideshowSlug)}?from=${encodeURIComponent(showKey)}#video`;
}

/** Clean a `?from=` / source value the same way the view and event routes do. */
export function cleanSource(v: unknown): string | null {
  return typeof v === "string" ? v.slice(0, 24).replace(/[^a-z0-9_-]/gi, "") || null : null;
}
