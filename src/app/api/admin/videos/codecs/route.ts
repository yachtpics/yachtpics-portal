import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { VIDEO_CODEC_COLUMNS_MISSING, isMissingCodecColumn } from "@/lib/jobs/videoCodecScan";

export const runtime = "nodejs";

const RISKY_LIST_MAX = 200;

// GET /api/admin/videos/codecs
//   → counts of stored videos by format, and the H.265 / ProRes ones.
// Powers the admin dashboard "Video formats" card. Admin only. Before
// migration 20261120_video_codec.sql is applied: { notReady: true, error }.
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const svc = auth.admin;

  const count = async (build: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    const { count: n, error } = await build(base());
    if (error) throw error;
    return n ?? 0;
  };
  function base() {
    return svc.from("videos").select("id", { count: "exact", head: true });
  }

  let counts: { total: number; checked: number; unchecked: number; h265: number; prores: number; unknown: number };
  try {
    const [total, unchecked, h265, prores, unknown] = await Promise.all([
      count((q) => q),
      count((q) => q.is("codec_checked_at", null)),
      count((q) => q.eq("video_codec", "h265")),
      count((q) => q.eq("video_codec", "prores")),
      count((q) => q.eq("video_codec", "unknown")),
    ]);
    counts = { total, checked: total - unchecked, unchecked, h265, prores, unknown };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (isMissingCodecColumn(err)) return NextResponse.json({ notReady: true, error: VIDEO_CODEC_COLUMNS_MISSING });
    return NextResponse.json({ error: err.message ?? "Couldn't count the videos." }, { status: 500 });
  }

  const { data: rows, error } = await svc
    .from("videos")
    .select("id, listing_id, filename, storage_path, video_codec, video_width, video_height, created_at")
    .in("video_codec", ["h265", "prores"])
    .order("created_at", { ascending: false })
    .limit(RISKY_LIST_MAX);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const list = (rows ?? []) as {
    id: string;
    listing_id: string | null;
    filename: string | null;
    storage_path: string;
    video_codec: string;
    video_width: number | null;
    video_height: number | null;
    created_at: string;
  }[];
  const listingIds = Array.from(new Set(list.map((r) => r.listing_id).filter((x): x is string => !!x)));
  const names: Record<string, string> = {};
  if (listingIds.length) {
    const { data: ls } = await svc.from("listings").select("id, vessel_name").in("id", listingIds);
    ((ls ?? []) as { id: string; vessel_name: string | null }[]).forEach((l) => (names[l.id] = l.vessel_name || "Untitled"));
  }

  return NextResponse.json({
    counts,
    risky: list.map((r) => ({
      id: r.id,
      listingId: r.listing_id,
      vesselName: (r.listing_id && names[r.listing_id]) || "No listing",
      filename: r.filename || r.storage_path.split("/").pop() || "video",
      codec: r.video_codec,
      width: r.video_width,
      height: r.video_height,
      createdAt: r.created_at,
    })),
    truncated: list.length >= RISKY_LIST_MAX,
  });
}

// No fetch made while answering this route is ever served from the Next.js
// fetch cache (Nov 2026: cached internal calls froze the daily jobs for two weeks).
export const fetchCache = "force-no-store";
