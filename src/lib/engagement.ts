import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Everything the portal knows about how a listing's slideshow is being looked
 * at: views and unique visitors, time on page, which photos buyers linger on
 * and save, named opens from tracked Send-to-Client links, tour clicks, video
 * plays, and inquiries. Feeds the Engagement panel on the listing page, the
 * Seller Report, and /api/listings/[id]/engagement.
 */
export type EngagementSummary = {
  views: number;
  uniqueVisitors: number;
  views7d: number;
  views30d: number;
  avgSeconds: number | null;
  avgPhotosSeen: number | null;
  bySource: { source: string; views: number }[];
  byDay: { day: string; views: number }[];
  sends: {
    id: string; client_email: string; client_name: string | null; sent_at: string;
    included_slideshow: boolean; open_count: number; last_opened_at: string | null; token: string | null;
  }[];
  topPhotos: { photo_id: string; category: string | null; filename: string | null; dwellSeconds: number; favorites: number; looks: number }[];
  favoritesTotal: number;
  tourClicks: number;
  videoPlays: number;
  detailsViews: number;
  leads: number;
  firstViewAt: string | null;
  lastViewAt: string | null;
};

export async function buildEngagement(
  service: SupabaseClient,
  listingId: string
): Promise<EngagementSummary> {
  const [{ data: views }, { data: sends }, { data: events }, { count: leads }, { data: photos }] = await Promise.all([
    service.from("slideshow_views").select("viewed_at, source, session_id, duration_s, photos_seen").eq("listing_id", listingId).order("viewed_at", { ascending: true }),
    service.from("client_sends").select("id, client_email, client_name, sent_at, included_slideshow, open_count, last_opened_at, token").eq("listing_id", listingId).order("sent_at", { ascending: false }),
    service.from("slideshow_events").select("kind, photo_id, value, session_id").eq("listing_id", listingId),
    service.from("listing_leads").select("id", { count: "exact", head: true }).eq("listing_id", listingId),
    service.from("photos").select("id, category, filename").eq("listing_id", listingId),
  ]);

  const now = Date.now();
  const d7 = now - 7 * 86400000;
  const d30 = now - 30 * 86400000;

  const vs = views ?? [];
  const sessions = new Set<string>();
  let anonymous = 0;
  const durations: number[] = [];
  const seen: number[] = [];
  const bySourceMap = new Map<string, number>();
  const byDayMap = new Map<string, number>();
  let views7d = 0, views30d = 0;

  for (const v of vs) {
    const t = new Date(v.viewed_at).getTime();
    if (t >= d7) views7d++;
    if (t >= d30) views30d++;
    if (v.session_id) sessions.add(v.session_id); else anonymous++;
    if (typeof v.duration_s === "number" && v.duration_s > 0) durations.push(v.duration_s);
    if (typeof v.photos_seen === "number" && v.photos_seen > 0) seen.push(v.photos_seen);
    const src = v.source ?? "link";
    bySourceMap.set(src, (bySourceMap.get(src) ?? 0) + 1);
    if (t >= d30) {
      const day = new Date(v.viewed_at).toISOString().slice(0, 10);
      byDayMap.set(day, (byDayMap.get(day) ?? 0) + 1);
    }
  }

  // Fill the last 30 days so the chart has a bar (or a gap) for every day.
  const byDay: { day: string; views: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(now - i * 86400000).toISOString().slice(0, 10);
    byDay.push({ day, views: byDayMap.get(day) ?? 0 });
  }

  const photoMeta = new Map((photos ?? []).map((p) => [p.id, p]));
  const perPhoto = new Map<string, { dwell: number; favs: number; looks: number }>();
  let favoritesTotal = 0, tourClicks = 0, videoPlays = 0, detailsViews = 0;
  for (const e of events ?? []) {
    if (e.kind === "tour_click") tourClicks++;
    else if (e.kind === "video_play") videoPlays++;
    else if (e.kind === "details_view") detailsViews++;
    if (!e.photo_id || !photoMeta.has(e.photo_id)) continue;
    const row = perPhoto.get(e.photo_id) ?? { dwell: 0, favs: 0, looks: 0 };
    if (e.kind === "dwell") { row.dwell += e.value ?? 0; row.looks++; }
    if (e.kind === "favorite") { row.favs++; favoritesTotal++; }
    if (e.kind === "unfavorite") { row.favs = Math.max(0, row.favs - 1); favoritesTotal = Math.max(0, favoritesTotal - 1); }
    perPhoto.set(e.photo_id, row);
  }

  const topPhotos = Array.from(perPhoto.entries())
    .map(([photo_id, r]) => ({
      photo_id,
      category: photoMeta.get(photo_id)?.category ?? null,
      filename: photoMeta.get(photo_id)?.filename ?? null,
      dwellSeconds: r.dwell,
      favorites: r.favs,
      looks: r.looks,
    }))
    .sort((a, b) => (b.dwellSeconds + b.favorites * 15) - (a.dwellSeconds + a.favorites * 15))
    .slice(0, 8);

  return {
    views: vs.length,
    uniqueVisitors: sessions.size + anonymous,
    views7d,
    views30d,
    avgSeconds: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    avgPhotosSeen: seen.length ? Math.round(seen.reduce((a, b) => a + b, 0) / seen.length) : null,
    bySource: Array.from(bySourceMap.entries()).map(([source, n]) => ({ source, views: n })).sort((a, b) => b.views - a.views),
    byDay,
    sends: (sends ?? []).map((s) => ({ ...s, open_count: s.open_count ?? 0 })),
    topPhotos,
    favoritesTotal,
    tourClicks,
    videoPlays,
    detailsViews,
    leads: leads ?? 0,
    firstViewAt: vs.length ? vs[0].viewed_at : null,
    lastViewAt: vs.length ? vs[vs.length - 1].viewed_at : null,
  };
}
