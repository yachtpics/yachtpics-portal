import Link from "next/link";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireAdminPage } from "@/lib/requireAdminPage";
import { seeVideoRows } from "@/app/see/_components/seeVideos";
import NoTrackToggle from "./_components/NoTrackToggle";

export const dynamic = "force-dynamic";

/**
 * Admin → Video metrics (Nov 14): who presses play on the Portal marketing
 * videos (/see and the yachtpics.com tour) and whether they then click
 * "Request access". Data: marketing_video_events, written by
 * /api/see/event; aggregated in SQL by public.marketing_video_summary().
 */

const RANGES = [7, 30, 90];

type Counts = { plays: number; visitors: number };
type VideoAgg = Counts & { video: string; q50: number; completes: number; walk_clicks: number; access_clicks: number };
type Summary = {
  plays: number;
  visitors: number;
  completes: number;
  access_clicks: number;
  access_after_watch: number;
  by_video: VideoAgg[];
  by_surface: (Counts & { surface: string })[];
  by_device: (Counts & { device: string })[];
  by_day: { day: string; plays: number }[];
};

const SURFACE_LABELS: { key: string; label: string }[] = [
  { key: "see", label: "Portal /see" },
  { key: "yachtpics_home", label: "yachtpics.com home" },
  { key: "yachtpics_portal", label: "yachtpics.com Portal page" },
];
const DEVICE_LABELS: { key: string; label: string }[] = [
  { key: "phone", label: "Phone" },
  { key: "tablet", label: "Tablet" },
  { key: "desktop", label: "Desktop" },
  { key: "unknown", label: "Unknown" },
];

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function pct(part: number, whole: number): string {
  if (!whole) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

function fmtDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export default async function VideoMetricsPage({ searchParams }: { searchParams: { range?: string } }) {
  // Role check lives in the page, not only the layout — see requireAdminPage.
  await requireAdminPage();

  const range = RANGES.indexOf(Number(searchParams.range)) >= 0 ? Number(searchParams.range) : 30;
  const since = new Date(Date.now() - range * 24 * 60 * 60 * 1000).toISOString();

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  let summary: Summary | null = null;
  let notSetUp = false;
  try {
    const { data, error } = await svc.rpc("marketing_video_summary", { p_since: since });
    if (error) notSetUp = true;
    else summary = data as Summary;
  } catch {
    notSetUp = true;
  }

  const rows = seeVideoRows();
  const byVideo: Record<string, VideoAgg> = {};
  (summary?.by_video ?? []).forEach((v) => { byVideo[v.video] = v; });
  const get = (key: string) => byVideo[key];
  let maxPlays = 0;
  rows.forEach((r) => { maxPlays = Math.max(maxPlays, n(get(r.key)?.plays)); });

  const plays = n(summary?.plays);
  const days = summary?.by_day ?? [];
  let maxDay = 0;
  days.forEach((d) => { maxDay = Math.max(maxDay, n(d.plays)); });
  const surfaceMap: Record<string, Counts> = {};
  (summary?.by_surface ?? []).forEach((s) => { surfaceMap[s.surface] = s; });
  const deviceMap: Record<string, Counts> = {};
  (summary?.by_device ?? []).forEach((d) => { deviceMap[d.device] = d; });

  const card = "bg-white border border-hairline rounded-card shadow-elev-1";

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display text-ink-900">Video metrics</h1>
          <p className="text-ink-500 mt-1 text-sm">Plays of the Portal marketing videos on /see and yachtpics.com — anonymous, no cookies.</p>
        </div>
        <div className="inline-flex rounded-ctl border border-hairline bg-white overflow-hidden text-sm" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/admin/video-metrics?range=${r}`}
              aria-current={r === range ? "page" : undefined}
              className={`px-3.5 py-2 transition-colors duration-fast ease-quiet ${r === range ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-50"}`}
            >
              Last {r} days
            </Link>
          ))}
        </div>
      </div>

      {notSetUp ? (
        <div className={`${card} p-6 text-sm text-ink-600 mb-8`}>
          The video metrics table isn&rsquo;t set up yet. Apply the migration <code className="text-ink-900">20261114_marketing_video_events.sql</code> in Supabase, then reload this page.
        </div>
      ) : plays === 0 && n(summary?.access_clicks) === 0 ? (
        <div className={`${card} py-12 px-6 text-center text-ink-500 text-sm mb-8`}>
          No plays recorded yet. Counts start from the moment this page went live.
        </div>
      ) : (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[
              { label: "Total plays", value: String(plays), note: null as string | null },
              { label: "Visitors who played", value: String(n(summary?.visitors)), note: "One per browser tab session" },
              { label: "Completion rate", value: pct(n(summary?.completes), plays), note: `${n(summary?.completes)} watched to the end` },
              { label: "Request access after watching", value: String(n(summary?.access_after_watch)), note: `of ${n(summary?.access_clicks)} Request access clicks near a video` },
            ].map((s) => (
              <div key={s.label} className={`${card} p-4`}>
                <p className="label-caps">{s.label}</p>
                <p className="text-2xl font-light tabular-nums text-ink-900 mt-1">{s.value}</p>
                {s.note && <p className="text-xs text-ink-400 mt-0.5">{s.note}</p>}
              </div>
            ))}
          </div>

          {/* Per video */}
          <div className={`${card} overflow-hidden mb-8`}>
            <div className="px-6 py-4 border-b border-hairline">
              <h2 className="text-h2 text-ink-900">By video</h2>
              <p className="text-xs text-ink-500 mt-0.5">In page order. The most-played video is highlighted.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline bg-ink-50">
                    <th className="text-left px-6 py-3 label-caps">Video</th>
                    <th className="text-right px-4 py-3 label-caps">Plays</th>
                    <th className="text-right px-4 py-3 label-caps">Visitors</th>
                    <th className="text-right px-4 py-3 label-caps">Reached 50%</th>
                    <th className="text-right px-4 py-3 label-caps">Completed</th>
                    <th className="text-right px-4 py-3 label-caps">Completion</th>
                    <th className="text-right px-4 py-3 label-caps">Walkthrough clicks</th>
                    <th className="text-right px-6 py-3 label-caps">Request access</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {rows.map((r) => {
                    const v = get(r.key);
                    const p = n(v?.plays);
                    const top = maxPlays > 0 && p === maxPlays;
                    const walk = r.walkKey ? n(get(r.walkKey)?.walk_clicks) : null;
                    const dim = (x: number) => (x > 0 ? "text-ink-900" : "text-ink-300");
                    return (
                      <tr key={r.key} className={top ? "bg-accent-50/60" : "hover:bg-ink-50 transition-colors duration-fast ease-quiet"}>
                        <td className={`px-6 py-3 ${r.kind === "tour" ? "font-medium text-ink-900" : "text-ink-700"}`}>
                          {r.label}
                          {top && <span className="ml-2 text-xs text-accent-700">Most played</span>}
                        </td>
                        <td className={`px-4 py-3 text-right tabular-nums font-medium ${dim(p)}`}>{p}</td>
                        <td className={`px-4 py-3 text-right tabular-nums ${dim(n(v?.visitors))}`}>{n(v?.visitors)}</td>
                        <td className={`px-4 py-3 text-right tabular-nums ${dim(n(v?.q50))}`}>{n(v?.q50)}</td>
                        <td className={`px-4 py-3 text-right tabular-nums ${dim(n(v?.completes))}`}>{n(v?.completes)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink-700">{pct(n(v?.completes), p)}</td>
                        <td className={`px-4 py-3 text-right tabular-nums ${walk === null ? "text-ink-300" : dim(walk)}`}>{walk === null ? "—" : walk}</td>
                        <td className={`px-6 py-3 text-right tabular-nums ${dim(n(v?.access_clicks))}`}>{n(v?.access_clicks)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Where + device */}
          <div className="grid gap-6 md:grid-cols-2 mb-8">
            {[
              { title: "Where it was watched", labels: SURFACE_LABELS, map: surfaceMap },
              { title: "Device", labels: DEVICE_LABELS.filter((d) => d.key !== "unknown" || !!deviceMap.unknown), map: deviceMap },
            ].map((t) => (
              <div key={t.title} className={`${card} overflow-hidden`}>
                <div className="px-6 py-4 border-b border-hairline">
                  <h2 className="text-h2 text-ink-900">{t.title}</h2>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline bg-ink-50">
                      <th className="text-left px-6 py-3 label-caps">{t.title === "Device" ? "Device" : "Where"}</th>
                      <th className="text-right px-4 py-3 label-caps">Plays</th>
                      <th className="text-right px-4 py-3 label-caps">Visitors</th>
                      <th className="text-right px-6 py-3 label-caps">Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {t.labels.map((l) => {
                      const c = t.map[l.key];
                      return (
                        <tr key={l.key}>
                          <td className="px-6 py-3 text-ink-700">{l.label}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-ink-900">{n(c?.plays)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-ink-700">{n(c?.visitors)}</td>
                          <td className="px-6 py-3 text-right tabular-nums text-ink-500">{pct(n(c?.plays), plays)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          {/* Plays per day */}
          <div className={`${card} p-6 mb-8`}>
            <h2 className="text-h2 text-ink-900">Plays per day</h2>
            <p className="text-xs text-ink-500 mt-0.5 mb-4">Eastern time.</p>
            <div className="flex items-end gap-[2px] h-24" aria-hidden>
              {days.map((d) => {
                const v = n(d.plays);
                const h = maxDay ? Math.max(v ? 4 : 1, Math.round((v / maxDay) * 96)) : 1;
                return (
                  <div key={d.day} className="flex-1 min-w-0 flex items-end h-full" title={`${fmtDay(d.day)}: ${v} play${v === 1 ? "" : "s"}`}>
                    <div className={`w-full rounded-t-sm ${v ? "bg-accent-500" : "bg-ink-100"}`} style={{ height: `${h}px` }} />
                  </div>
                );
              })}
            </div>
            {days.length > 0 && (
              <div className="flex justify-between text-xs text-ink-400 mt-2 tabular-nums">
                <span>{fmtDay(days[0].day)}</span>
                <span>{fmtDay(days[days.length - 1].day)}</span>
              </div>
            )}
            <ul className="sr-only">
              {days.map((d) => (
                <li key={d.day}>{fmtDay(d.day)}: {n(d.plays)} plays</li>
              ))}
            </ul>
          </div>
        </>
      )}

      <div className="max-w-xl">
        <NoTrackToggle />
      </div>
      <p className="text-xs text-ink-400 mt-4 max-w-2xl">
        Recorded: which video, play / 25% / 50% / 75% / finished, walkthrough and Request access clicks, phone/tablet/desktop, the site it was played on, and a random id that lasts one browser tab. Not recorded: IP addresses, names, cookies or full browser details. Plays by signed-in admins and the demo accounts aren&rsquo;t counted.
      </p>
    </div>
  );
}
