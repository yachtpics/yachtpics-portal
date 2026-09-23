import { createClient as createServiceClient } from "@supabase/supabase-js";
import { ANNOUNCEMENT_TYPE } from "@/lib/announcementEmail";
import { REEL_PROMO_START, REEL_PROMO_END, reelPromoCountdown } from "@/lib/reelPromo";
import {
  readReelStats, statsAreWorthSharing, followUpSubject,
  followUpWindowOpen, FOLLOWUP_TYPE, FOLLOWUP_WINDOW, type FollowUpKey,
} from "@/lib/reelFollowUpEmail";
import FollowUpControls from "./FollowUpControls";

export const dynamic = "force-dynamic";

/**
 * Reels — did the open house work?
 *
 * The Reel went out to every broker on the portal, free for a fortnight. The
 * whole point of this page is one question: after the announcement landed, did
 * anyone actually make one. So the clock starts at the announcement (or, until
 * it goes out, at the day the open house opened), and the numbers are read in
 * that window rather than for all time.
 *
 * The second question is quieter and more useful: of the reels that got made,
 * how many went anywhere. A render nobody downloaded is a broker who had a
 * look; a render that was downloaded or sent to a phone is one that probably
 * got posted. The gap between those two columns is the real signal.
 */

type Kind = "render" | "download" | "send_to_phone" | "copy_caption" | "added_to_listing";

type EventRow = {
  id: string;
  created_at: string;
  kind: Kind;
  user_id: string | null;
  role: string | null;
  broker_id: string | null;
  listing_id: string | null;
  format: string | null;
  look: string | null;
  reel_length: string | null;
  fit: string | null;
  photo_count: number | null;
  seconds: number | null;
  yp_brand: boolean | null;
  render_ms: number | null;
};

const KIND_LABEL: Record<Kind, string> = {
  render: "Made",
  download: "Downloaded",
  send_to_phone: "Sent to phone",
  copy_caption: "Copied caption",
  added_to_listing: "Added to listing",
};

const LOOK_LABEL: Record<string, string> = {
  editorial: "Editorial",
  cinematic: "Cinematic",
  gallery: "Gallery",
  classic: "Classic",
  energy: "Energy",
  stack: "Stack",
  marquee: "Marquee",
  marquee_still: "Marquee Still",
};

export default async function ReelsPage() {
  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // When the clock starts. The announcement is the honest mark; until it goes
  // out, the open house opening is the next best thing — anything made before
  // either is Charlie testing, and says nothing about uptake.
  const { data: announceRow } = await service
    .from("email_log")
    .select("sent_at")
    .eq("email_type", ANNOUNCEMENT_TYPE)
    .order("sent_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const announcedAt: string | null = announceRow?.sent_at ?? null;
  const since = announcedAt ?? REEL_PROMO_START;

  const [{ data: eventsRaw }, { data: profilesRaw }, { data: listingsRaw }] = await Promise.all([
    service.from("reel_events").select("*").gte("created_at", since).order("created_at", { ascending: false }),
    service.from("profiles").select("id, first_name, last_name, display_email, role"),
    service.from("listings").select("id, vessel_name"),
  ]);

  const events = (eventsRaw ?? []) as EventRow[];

  const nameOf = new Map<string, string>();
  const emailOf = new Map<string, string>();
  for (const p of profilesRaw ?? []) {
    const n = p.first_name ? `${p.first_name} ${p.last_name ?? ""}`.trim() : p.display_email ?? "—";
    nameOf.set(p.id, n);
    emailOf.set(p.id, p.display_email ?? "—");
  }
  const vesselOf = new Map<string, string>();
  for (const l of listingsRaw ?? []) vesselOf.set(l.id, l.vessel_name ?? "Untitled");

  // Charlie's own renders are kept but counted separately — they're worth being
  // able to see, and worth never being mistaken for a broker using the tool.
  const real = events.filter((e) => e.role !== "admin");
  const mine = events.filter((e) => e.role === "admin");

  const renders = real.filter((e) => e.kind === "render");
  const count = (k: Kind) => real.filter((e) => e.kind === k).length;

  const reels = renders.filter((e) => e.format === "reel").length;
  const films = renders.filter((e) => e.format === "film").length;
  const makers = new Set(renders.map((e) => e.broker_id ?? e.user_id).filter(Boolean)).size;
  const taken = new Set(
    real.filter((e) => e.kind === "download" || e.kind === "send_to_phone" || e.kind === "added_to_listing")
        .map((e) => e.listing_id)
        .filter(Boolean)
  ).size;

  // Which looks they actually reach for — the thing a feature list can't tell
  // you and a fortnight of real use can.
  // Kept as a plain object rather than a Map on purpose: tsconfig sets no
  // `target`, so TypeScript compiles to ES5, where spreading a Map or Set
  // iterator is an error. Object.entries works at every target.
  const lookCounts: Record<string, number> = {};
  for (const r of renders) {
    const k = r.look ?? "—";
    lookCounts[k] = (lookCounts[k] ?? 0) + 1;
  }
  const looks = Object.entries(lookCounts).sort((a, b) => b[1] - a[1]);
  const topLook = looks[0]?.[1] ?? 0;

  // Per broker. An assistant's reel counts for the broker it was made for.
  const byBroker: Record<string, EventRow[]> = {};
  for (const e of real) {
    const key = e.broker_id ?? e.user_id ?? "unknown";
    if (!byBroker[key]) byBroker[key] = [];
    byBroker[key].push(e);
  }
  const brokerRows = Object.entries(byBroker).map(([id, rows]) => {
    const made = rows.filter((r) => r.kind === "render");
    // The looks this broker has tried, in the order they first tried them.
    const seenLook: Record<string, true> = {};
    const lookList: string[] = [];
    for (const r of made) {
      if (r.look && !seenLook[r.look]) { seenLook[r.look] = true; lookList.push(r.look); }
    }
    return {
      id,
      name: nameOf.get(id) ?? "Unknown",
      email: emailOf.get(id) ?? "—",
      reels: made.filter((r) => r.format === "reel").length,
      films: made.filter((r) => r.format === "film").length,
      downloads: rows.filter((r) => r.kind === "download").length,
      phone: rows.filter((r) => r.kind === "send_to_phone").length,
      added: rows.filter((r) => r.kind === "added_to_listing").length,
      captions: rows.filter((r) => r.kind === "copy_caption").length,
      // An assistant doing the work for a broker is worth seeing, not hiding.
      viaAssistant: new Set(made.filter((r) => r.role === "assistant").map((r) => r.user_id)).size,
      last: made[0]?.created_at ?? rows[0]?.created_at ?? null,
      looks: lookList,
    };
  });
  brokerRows.sort((a, b) => (b.reels + b.films) - (a.reels + a.films)
    || (b.last ? Date.parse(b.last) : 0) - (a.last ? Date.parse(a.last) : 0));

  function fmtWhen(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      timeZone: "America/New_York",
    });
  }
  function fmtDay(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "long", day: "numeric", timeZone: "America/New_York",
    });
  }

  const promoOver = Date.now() > Date.parse(REEL_PROMO_END);
  const log = events.slice(0, 120);

  // The follow-ups. They live on THIS page rather than on /admin/announce on
  // purpose: the week-one email's copy is these numbers, so the button that
  // sends it belongs under the table that shows them.
  const stats = await readReelStats(service);
  const proof = statsAreWorthSharing(stats);

  const audience = (profilesRaw ?? []).filter(
    (p) => (p.role === "broker" || p.role === "assistant") && p.display_email
  ).length;

  const followUpMeta: { key: FollowUpKey; title: string; blurb: string }[] = [
    {
      key: "week1",
      title: "One week in",
      blurb: "What brokers made, and a nudge to the ones who haven't. Leads with the numbers when they're strong enough to lead with.",
    },
    {
      key: "lastcall",
      title: "Last call",
      blurb: "Two days before the window shuts. Short \u2014 the date and the button.",
    },
  ];

  const followUps = await Promise.all(
    followUpMeta.map(async (m) => {
      const { count } = await service
        .from("email_log")
        .select("id", { count: "exact", head: true })
        .eq("email_type", FOLLOWUP_TYPE[m.key])
        .eq("status", "sent");
      const already = count ?? 0;
      const w = FOLLOWUP_WINDOW[m.key];
      return {
        ...m,
        subject: followUpSubject(m.key, stats),
        windowOpen: followUpWindowOpen(m.key),
        windowLabel: `Can be sent ${fmtDay(w.after)} to ${fmtDay(w.before)}`,
        alreadySent: already,
        remaining: Math.max(0, audience - already),
        proof,
      };
    })
  );

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-display text-ink-900">Reels</h1>
        <p className="text-ink-500 mt-1 text-sm">
          {announcedAt
            ? <>Everything made since the announcement went out on {fmtDay(announcedAt)}.</>
            : <>The announcement hasn&rsquo;t gone out yet — counting from the day the open house opened, {fmtDay(REEL_PROMO_START)}.</>}
          {" "}
          <span className={promoOver ? "text-ink-400" : "text-accent-700 font-medium"}>
            {promoOver ? "The free window has closed." : `Free window: ${reelPromoCountdown()}.`}
          </span>
        </p>
      </div>

      {/* The headline numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-3">
        {[
          { label: "Reels made", value: reels },
          { label: "Films made", value: films },
          { label: "Brokers", value: makers, note: "made at least one" },
          { label: "Downloaded", value: count("download") },
          { label: "Sent to phone", value: count("send_to_phone") },
          { label: "Boats it left with", value: taken, note: "downloaded, sent or posted" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white border border-hairline rounded-card shadow-elev-1 p-4">
            <p className="label-caps">{stat.label}</p>
            <p className="text-2xl font-light tabular-nums text-ink-900 mt-1">{stat.value}</p>
            {stat.note && <p className="text-xs text-ink-400 mt-0.5">{stat.note}</p>}
          </div>
        ))}
      </div>
      <p className="text-xs text-ink-400 mb-8">
        {mine.length === 0
          ? "No admin activity in this window."
          : `Your own ${mine.filter((e) => e.kind === "render").length} test render${mine.filter((e) => e.kind === "render").length === 1 ? "" : "s"} are excluded from every number above, and shown greyed in the log.`}
      </p>

      {/* The follow-ups */}
      <div className="mb-8">
        <h2 className="text-h2 text-ink-900 mb-0.5">Follow-ups</h2>
        <p className="text-xs text-ink-500 mb-3">
          Neither one sends on a schedule. Read the numbers above, send yourself a test, then send it by hand.
        </p>
        <FollowUpControls cards={followUps} />
      </div>

      {/* Which looks they reach for */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-6 mb-8">
        <h2 className="text-h2 text-ink-900">Looks</h2>
        <p className="text-xs text-ink-500 mt-0.5 mb-4">What brokers actually choose, across every reel and film made in the window.</p>
        {looks.length === 0 ? (
          <p className="text-sm text-ink-400">Nothing made yet.</p>
        ) : (
          <div className="space-y-2">
            {looks.map(([k, n]) => (
              <div key={k} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-sm text-ink-700">{LOOK_LABEL[k] ?? k}</span>
                <span className="flex-1 h-2 rounded-full bg-ink-100 overflow-hidden">
                  <span className="block h-full bg-accent-500" style={{ width: `${topLook ? (n / topLook) * 100 : 0}%` }} />
                </span>
                <span className="w-8 shrink-0 text-sm tabular-nums text-ink-900 text-right">{n}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Per broker */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-hairline">
          <h2 className="text-h2 text-ink-900">Who made them</h2>
          <p className="text-xs text-ink-500 mt-0.5">Credited to the listing&rsquo;s broker — an assistant&rsquo;s reel counts for the broker it was made for.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline bg-ink-50">
                <th className="text-left px-6 py-3 label-caps">Broker</th>
                <th className="text-center px-4 py-3 label-caps">Reels</th>
                <th className="text-center px-4 py-3 label-caps">Films</th>
                <th className="text-center px-4 py-3 label-caps">Downloaded</th>
                <th className="text-center px-4 py-3 label-caps">To Phone</th>
                <th className="text-center px-4 py-3 label-caps">Added</th>
                <th className="text-left px-4 py-3 label-caps">Looks</th>
                <th className="text-left px-4 py-3 label-caps">Last One</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {brokerRows.map((b) => (
                <tr key={b.id} className="hover:bg-ink-50 transition-colors duration-fast ease-quiet">
                  <td className="px-6 py-4">
                    <a href={`/admin/brokers/${b.id}`} className="font-medium text-ink-900 hover:text-accent-700 transition-colors duration-fast ease-quiet">
                      {b.name}
                    </a>
                    <p className="text-xs text-ink-400 mt-0.5">{b.email}</p>
                    {b.viaAssistant > 0 && (
                      <p className="text-xs text-ink-400 mt-0.5">via assistant</p>
                    )}
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className={`font-medium tabular-nums ${b.reels > 0 ? "text-ink-900" : "text-ink-300"}`}>{b.reels}</span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className={`font-medium tabular-nums ${b.films > 0 ? "text-ink-900" : "text-ink-300"}`}>{b.films}</span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className={`font-medium tabular-nums ${b.downloads > 0 ? "text-success-600" : "text-ink-300"}`}>{b.downloads}</span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className={`font-medium tabular-nums ${b.phone > 0 ? "text-success-600" : "text-ink-300"}`}>{b.phone}</span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className={`font-medium tabular-nums ${b.added > 0 ? "text-accent-700" : "text-ink-300"}`}>{b.added}</span>
                  </td>
                  <td className="px-4 py-4 text-xs text-ink-500">
                    {b.looks.length === 0 ? "—" : b.looks.map((l) => LOOK_LABEL[l] ?? l).join(", ")}
                  </td>
                  <td className="px-4 py-4 text-xs text-ink-400 tabular-nums">{fmtWhen(b.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {brokerRows.length === 0 && (
            <div className="py-12 text-center text-ink-400 text-sm">
              Nothing made yet in this window.
            </div>
          )}
        </div>
      </div>

      {/* The log */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 overflow-hidden">
        <div className="px-6 py-4 border-b border-hairline">
          <h2 className="text-h2 text-ink-900">Every event</h2>
          <p className="text-xs text-ink-500 mt-0.5">
            Newest first{events.length > log.length ? `, most recent ${log.length} of ${events.length}` : ""}. Admin rows are greyed.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline bg-ink-50">
                <th className="text-left px-6 py-3 label-caps">When</th>
                <th className="text-left px-4 py-3 label-caps">Who</th>
                <th className="text-left px-4 py-3 label-caps">Boat</th>
                <th className="text-left px-4 py-3 label-caps">What</th>
                <th className="text-left px-4 py-3 label-caps">Shape</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {log.map((e) => {
                const isAdminRow = e.role === "admin";
                return (
                  <tr key={e.id} className={`hover:bg-ink-50 transition-colors duration-fast ease-quiet ${isAdminRow ? "opacity-50" : ""}`}>
                    <td className="px-6 py-3 text-xs text-ink-500 tabular-nums whitespace-nowrap">{fmtWhen(e.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className="text-ink-800">{e.user_id ? nameOf.get(e.user_id) ?? "Unknown" : "—"}</span>
                      {e.role && e.role !== "broker" && (
                        <span className="text-xs text-ink-400 ml-1.5">({e.role})</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-700">
                      {e.listing_id
                        ? <a href={`/admin/listings/${e.listing_id}`} className="hover:text-accent-700 transition-colors duration-fast ease-quiet">{vesselOf.get(e.listing_id) ?? "—"}</a>
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        e.kind === "render" ? "bg-ink-100 text-ink-700" : "bg-success-50 text-success-600"
                      }`}>
                        {KIND_LABEL[e.kind] ?? e.kind}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-500">
                      {e.kind !== "render" ? "—" : [
                        e.format === "reel" ? "Reel" : e.format === "film" ? "Film" : null,
                        e.look ? LOOK_LABEL[e.look] ?? e.look : null,
                        e.reel_length,
                        e.fit === "whole" ? "whole photo" : e.fit === "fill" ? "filled" : null,
                        e.photo_count ? `${e.photo_count} photos` : null,
                        e.seconds ? `${e.seconds}s` : null,
                        e.yp_brand ? "YP brand" : null,
                      ].filter(Boolean).join(" · ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {log.length === 0 && (
            <div className="py-12 text-center text-ink-400 text-sm">
              Nothing recorded yet. The first row lands the next time anyone finishes a reel.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
