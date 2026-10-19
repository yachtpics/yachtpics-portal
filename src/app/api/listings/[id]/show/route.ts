import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";
import {
  getCurrentShows, isShowCurrent, SHOW_LOCATION_MAX, SHOW_NOTE_MAX,
  type BoatShow, type ShowEntry,
} from "@/lib/boatShows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/listings/[id]/show — mark a boat as being at a boat show (FLIBS 2026).
 *
 *   GET    → { shows, entries, canEdit, slideshowPublished } — anyone who can
 *            read the listing (RLS read under their own session).
 *   PUT    { showKey, location?, note? } → upsert this listing's entry.
 *   DELETE ?show=<key> → remove it.
 *
 * Writes: listing editors — the owner, their assistants, a brokerage admin of
 * the owner's brokerage, and portal admins (assertListingAccess with
 * includeBrokerageAdmin). The show must exist, be active and not be over.
 */

function service(): SupabaseClient {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  // One line, no control characters.
  const t = v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return t || null;
}

async function signedInUser() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

async function editorCheck(svc: SupabaseClient, listingId: string, userId: string): Promise<NextResponse | null> {
  const access = await assertListingAccess(svc, listingId, userId, { includeBrokerageAdmin: true });
  return access instanceof NextResponse ? access : null;
}

async function loadShow(svc: SupabaseClient, key: unknown): Promise<BoatShow | null> {
  if (typeof key !== "string" || !/^[a-z0-9_-]{1,40}$/i.test(key)) return null;
  const { data } = await svc
    .from("boat_shows")
    .select("key, name, short_name, starts_on, ends_on, city, is_active")
    .eq("key", key)
    .maybeSingle();
  return (data as BoatShow | null) ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { supabase, user } = await signedInUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // Readers: whatever the listings RLS lets this person see.
  const { data: listing } = await supabase
    .from("listings")
    .select("id, slideshow_published, slideshow_slug")
    .eq("id", params.id)
    .maybeSingle();
  if (!listing) return NextResponse.json({ error: "Listing not found." }, { status: 404 });

  const svc = service();
  const [shows, { data: entries }, denied] = await Promise.all([
    getCurrentShows(svc),
    svc.from("listing_show_entries")
      .select("id, listing_id, show_key, location, note, marked_by, created_at, updated_at")
      .eq("listing_id", params.id),
    editorCheck(svc, params.id, user.id),
  ]);

  return NextResponse.json({
    shows,
    entries: (entries ?? []) as ShowEntry[],
    canEdit: denied === null,
    slideshowPublished: !!listing.slideshow_published && !!listing.slideshow_slug,
  });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { user } = await signedInUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { showKey?: unknown; location?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const svc = service();
  const denied = await editorCheck(svc, params.id, user.id);
  if (denied) return denied;

  const show = await loadShow(svc, body.showKey);
  if (!show) return NextResponse.json({ error: "That show isn't in the Portal." }, { status: 400 });
  if (!isShowCurrent(show)) return NextResponse.json({ error: `${show.short_name} is closed for marking.` }, { status: 400 });

  const { data, error } = await svc
    .from("listing_show_entries")
    .upsert(
      {
        listing_id: params.id,
        show_key: show.key,
        location: cleanText(body.location, SHOW_LOCATION_MAX),
        note: cleanText(body.note, SHOW_NOTE_MAX),
        marked_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "listing_id,show_key" }
    )
    .select("id, listing_id, show_key, location, note, marked_by, created_at, updated_at")
    .single();
  if (error || !data) return NextResponse.json({ error: "Couldn't save. Please try again." }, { status: 500 });

  return NextResponse.json({ ok: true, entry: data as ShowEntry });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { user } = await signedInUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const svc = service();
  const denied = await editorCheck(svc, params.id, user.id);
  if (denied) return denied;

  const show = await loadShow(svc, req.nextUrl.searchParams.get("show"));
  if (!show) return NextResponse.json({ error: "That show isn't in the Portal." }, { status: 400 });
  if (!isShowCurrent(show)) return NextResponse.json({ error: `${show.short_name} is closed for marking.` }, { status: 400 });

  const { error } = await svc
    .from("listing_show_entries")
    .delete()
    .eq("listing_id", params.id)
    .eq("show_key", show.key);
  if (error) return NextResponse.json({ error: "Couldn't remove it. Please try again." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
