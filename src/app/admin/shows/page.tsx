import { requireAdminPage } from "@/lib/requireAdminPage";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getCurrentShows, showDatesLabel } from "@/lib/boatShows";
import ShowBoard, { type ShowRow, type UnmarkedRow } from "./_components/ShowBoard";
import ReelServiceQr from "./_components/ReelServiceQr";

export const dynamic = "force-dynamic";

/**
 * Admin → Shows. For each boat show still to come: the boats brokers have
 * marked (boat, broker, brokerage, dock / slip, note, when), CSV export, dock
 * card PDFs one by one or all in a zip — and the recent listings nobody has
 * marked, so Charlie can nudge.
 */

type Profile = { first_name: string | null; last_name: string | null; display_email: string | null };

function personName(p: Profile | null | undefined): string {
  if (!p) return "";
  return [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.display_email || "";
}

export default async function AdminShowsPage() {
  // Role check lives in the page, not only the layout — see requireAdminPage.
  await requireAdminPage();
  const service = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const shows = await getCurrentShows(service);
  const since60 = new Date(Date.now() - 60 * 86_400_000).toISOString();

  const [{ data: entries }, { data: recent }] = await Promise.all([
    shows.length
      ? service
          .from("listing_show_entries")
          .select("id, listing_id, show_key, location, note, created_at, updated_at, marked_by, listings!inner(id, vessel_name, year, length_ft, make, model, broker_id, slideshow_published, slideshow_slug)")
          .in("show_key", shows.map((s) => s.key))
      : Promise.resolve({ data: [] as unknown[] }),
    service
      .from("listings")
      .select("id, vessel_name, year, length_ft, make, broker_id, updated_at, status")
      .eq("status", "active")
      .gte("updated_at", since60)
      .order("updated_at", { ascending: false }),
  ]);

  type EntryRow = {
    id: string; listing_id: string; show_key: string; location: string | null; note: string | null;
    created_at: string; updated_at: string; marked_by: string | null;
    listings: { id: string; vessel_name: string | null; year: number | null; length_ft: number | null; make: string | null; model: string | null; broker_id: string; slideshow_published: boolean; slideshow_slug: string | null }
      | { id: string; vessel_name: string | null; year: number | null; length_ft: number | null; make: string | null; model: string | null; broker_id: string; slideshow_published: boolean; slideshow_slug: string | null }[];
  };
  const entryRows = (entries ?? []) as EntryRow[];
  const recentRows = (recent ?? []) as { id: string; vessel_name: string | null; year: number | null; length_ft: number | null; make: string | null; broker_id: string; updated_at: string }[];

  // Brokers + brokerages + who marked, in two reads.
  const people = new Set<string>();
  entryRows.forEach((e) => {
    const l = Array.isArray(e.listings) ? e.listings[0] : e.listings;
    if (l?.broker_id) people.add(l.broker_id);
    if (e.marked_by) people.add(e.marked_by);
  });
  recentRows.forEach((l) => l.broker_id && people.add(l.broker_id));
  const ids = Array.from(people);
  const [{ data: profiles }, { data: details }] = ids.length
    ? await Promise.all([
        service.from("profiles").select("id, first_name, last_name, display_email").in("id", ids),
        service.from("broker_details").select("id, brokerage_name").in("id", ids),
      ])
    : [{ data: [] }, { data: [] }];
  const profileById = new Map(((profiles ?? []) as (Profile & { id: string })[]).map((p) => [p.id, p] as [string, Profile]));
  const brokerageById = new Map(((details ?? []) as { id: string; brokerage_name: string | null }[]).map((d) => [d.id, d.brokerage_name ?? ""] as [string, string]));

  const markedIds = new Set<string>();
  const rowsByShow: Record<string, ShowRow[]> = {};
  entryRows.forEach((e) => {
    const l = Array.isArray(e.listings) ? e.listings[0] : e.listings;
    if (!l) return;
    markedIds.add(l.id);
    (rowsByShow[e.show_key] = rowsByShow[e.show_key] ?? []).push({
      listingId: l.id,
      boat: l.vessel_name ?? "Untitled vessel",
      specs: [l.year, l.length_ft ? `${Number(l.length_ft)}′` : null, [l.make, l.model].filter(Boolean).join(" ") || null].filter(Boolean).join(" · "),
      broker: personName(profileById.get(l.broker_id)),
      brokerId: l.broker_id,
      brokerage: brokerageById.get(l.broker_id) ?? "",
      location: e.location ?? "",
      note: e.note ?? "",
      markedAt: e.updated_at ?? e.created_at,
      markedBy: e.marked_by && e.marked_by !== l.broker_id ? personName(profileById.get(e.marked_by)) : "",
      published: !!l.slideshow_published && !!l.slideshow_slug,
    });
  });
  Object.keys(rowsByShow).forEach((k) => {
    rowsByShow[k].sort((a, b) =>
      (a.brokerage || "￿").localeCompare(b.brokerage || "￿") || a.boat.localeCompare(b.boat)
    );
  });

  const unmarked: UnmarkedRow[] = recentRows
    .filter((l) => !markedIds.has(l.id))
    .map((l) => ({
      listingId: l.id,
      boat: l.vessel_name ?? "Untitled vessel",
      specs: [l.year, l.length_ft ? `${Number(l.length_ft)}′` : null, l.make].filter(Boolean).join(" · "),
      broker: personName(profileById.get(l.broker_id)),
      brokerage: brokerageById.get(l.broker_id) ?? "",
      updatedAt: l.updated_at,
    }));

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-display text-ink-900">Shows</h1>
        <p className="text-ink-500 mt-1 text-sm">
          Boats brokers have marked for an upcoming show, with their dock or slip. Dock cards download from here.
        </p>
      </div>

      <ReelServiceQr />

      {shows.length === 0 ? (
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 py-14 text-center">
          <p className="text-ink-500 text-sm">No upcoming boat shows.</p>
          <p className="text-ink-400 text-xs mt-1">Shows live in the boat_shows table (migration 20261019_boat_shows.sql).</p>
        </div>
      ) : (
        <ShowBoard
          shows={shows.map((s) => ({ key: s.key, name: s.name, short: s.short_name, dates: showDatesLabel(s), city: s.city ?? "" }))}
          rowsByShow={rowsByShow}
          unmarked={unmarked}
        />
      )}
    </div>
  );
}
