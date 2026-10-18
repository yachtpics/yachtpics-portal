import { NextRequest, NextResponse } from "next/server";
import { decryptToken } from "@/lib/meta/crypto";
import { graphErrorMessage } from "@/lib/meta/graph";
import { deleteFacebookVideo } from "@/lib/meta/publish";
import { POST_COLUMNS, advancePost, loadConnection, socialViewer, type SocialPostRow } from "@/lib/meta/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/social/posts[?jobId=…] → { posts } — recent posts (admin: all;
 * broker: own), newest first, with the Page name. With jobId, just that reel's.
 */
export async function GET(req: NextRequest) {
  const viewer = await socialViewer();
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!viewer.allowed) return NextResponse.json({ posts: [] });
  let q = viewer.svc.from("social_posts").select(POST_COLUMNS).order("created_at", { ascending: false }).limit(25);
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (jobId) q = q.eq("source_id", jobId);
  if (!viewer.isAdmin) q = q.eq("broker_id", viewer.userId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ posts: [], error: error.message });
  const posts = (data ?? []) as SocialPostRow[];
  const pageIds = posts.map((p) => p.page_id).filter((x, i, a) => a.indexOf(x) === i);
  const names: Record<string, string> = {};
  if (pageIds.length) {
    const { data: conns } = await viewer.svc.from("social_connections").select("page_id, page_name").in("page_id", pageIds);
    (conns ?? []).forEach((c: { page_id: string; page_name: string | null }) => { if (c.page_name) names[c.page_id] = c.page_name; });
  }
  return NextResponse.json({ posts: posts.map((p) => ({ ...p, page_name: names[p.page_id] ?? null })) });
}

/**
 * POST /api/social/posts
 *   { action: "cancel", id } — cancel a scheduled post (pulls the reel Facebook is holding).
 *   { action: "check",  id } — move a 'posting' Instagram reel on (publish once Instagram
 *                              has processed it); the post dialog calls this while open.
 */
export async function POST(req: NextRequest) {
  const viewer = await socialViewer();
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!viewer.allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? "");
  const { data } = await viewer.svc.from("social_posts").select(POST_COLUMNS).eq("id", id).maybeSingle();
  const post = data as SocialPostRow | null;
  if (!post || (!viewer.isAdmin && post.broker_id !== viewer.userId)) return NextResponse.json({ error: "Post not found." }, { status: 404 });

  if (body?.action === "cancel") {
    if (post.status !== "scheduled") return NextResponse.json({ error: "Only scheduled posts can be cancelled." }, { status: 400 });
    if (post.platform === "facebook" && post.external_id && post.connection_id) {
      const conn = await loadConnection(viewer.svc, post.connection_id);
      if (conn) {
        try {
          await deleteFacebookVideo(post.external_id, decryptToken(conn.page_token_enc));
        } catch (e) {
          return NextResponse.json({ error: `Facebook wouldn't cancel it: ${graphErrorMessage(e)}` }, { status: 502 });
        }
      }
    }
    const { data: row } = await viewer.svc.from("social_posts")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", id).eq("status", "scheduled").select(POST_COLUMNS).maybeSingle();
    return NextResponse.json({ ok: true, post: row ?? post });
  }

  if (body?.action === "check") {
    // Only nudge work that's actually waiting; never publish a future scheduled post early.
    if (post.status !== "posting") return NextResponse.json({ ok: true, post });
    const row = await advancePost(viewer.svc, post, Date.now() + 20_000);
    return NextResponse.json({ ok: true, post: row ?? post });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
