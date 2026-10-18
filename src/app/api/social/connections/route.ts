import { NextRequest, NextResponse } from "next/server";
import { metaConfigured, metaMissingConfig } from "@/lib/meta/config";
import { decryptToken, encryptToken, openJson } from "@/lib/meta/crypto";
import { graphErrorMessage } from "@/lib/meta/graph";
import { PENDING_COOKIE, listPages, revokePermissions, type PendingConnect } from "@/lib/meta/oauth";
import { deleteFacebookVideo } from "@/lib/meta/publish";
import { CONNECTION_PUBLIC_COLUMNS, loadConnection, socialViewer } from "@/lib/meta/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PublicConnection = {
  id: string; broker_id: string; fb_user_id: string; page_id: string; page_name: string | null;
  ig_user_id: string | null; ig_username: string | null; token_expires_at: string | null; connected_at: string; updated_at: string | null;
  broker_name?: string;
};

function pendingFrom(req: NextRequest, uid: string): PendingConnect | null {
  const p = openJson<PendingConnect>(req.cookies.get(PENDING_COOKIE)?.value);
  if (!p || p.uid !== uid || p.exp < Date.now()) return null;
  return p;
}

function clearPending(res: NextResponse) {
  res.cookies.set(PENDING_COOKIE, "", { path: "/api/social", maxAge: 0 });
  return res;
}

/**
 * GET /api/social/connections[?all=1]
 * → { configured, allowed, isAdmin, missing?, connections, pending, pendingError? }
 *
 * `connections` are the viewer's own Pages (admin with all=1: everyone's,
 * with the broker's name — for the "post to which Page" picker). Tokens are
 * never returned. `pending` lists the Pages from a just-finished Facebook
 * sign-in, waiting for the user to pick.
 */
export async function GET(req: NextRequest) {
  const viewer = await socialViewer();
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const base = { configured: metaConfigured(), allowed: viewer.allowed, isAdmin: viewer.isAdmin };
  if (!viewer.allowed) return NextResponse.json({ ...base, connections: [], pending: null });

  const all = viewer.isAdmin && req.nextUrl.searchParams.get("all") === "1";
  let q = viewer.svc.from("social_connections").select(CONNECTION_PUBLIC_COLUMNS).order("connected_at", { ascending: true });
  if (!all) q = q.eq("broker_id", viewer.userId);
  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ ...base, connections: [], pending: null, error: `Couldn't read social connections (${error.message}). The migration 20261018_social_publishing.sql may not be applied yet.` });
  }
  let connections = (data ?? []) as PublicConnection[];
  if (all && connections.length) {
    const ids = connections.map((c) => c.broker_id).filter((x, i, a) => a.indexOf(x) === i);
    const { data: people } = await viewer.svc.from("profiles").select("id, first_name, last_name, display_email").in("id", ids);
    const name: Record<string, string> = {};
    (people ?? []).forEach((p: { id: string; first_name: string | null; last_name: string | null; display_email: string | null }) => {
      name[p.id] = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.display_email || "Broker";
    });
    connections = connections.map((c) => ({ ...c, broker_name: c.broker_id === viewer.userId ? "You" : name[c.broker_id] ?? "Broker" }));
  }

  let pending: { id: string; name: string; ig_user_id: string | null; ig_username: string | null; connected: boolean }[] | null = null;
  let pendingError: string | undefined;
  const p = metaConfigured() ? pendingFrom(req, viewer.userId) : null;
  if (p) {
    try {
      const pages = await listPages(p.userToken);
      const mine = connections.filter((c) => c.broker_id === viewer.userId).map((c) => c.page_id);
      pending = pages.map((pg) => ({
        id: pg.id,
        name: pg.name,
        ig_user_id: pg.instagram_business_account?.id ?? null,
        ig_username: pg.instagram_business_account?.username ?? null,
        connected: mine.indexOf(pg.id) >= 0,
      }));
    } catch (e) {
      pendingError = graphErrorMessage(e);
    }
  }

  return NextResponse.json({
    ...base,
    missing: viewer.isAdmin && !metaConfigured() ? metaMissingConfig() : undefined,
    connections,
    pending,
    pendingError,
  });
}

/**
 * POST /api/social/connections
 *   { action: "choose", pageIds: string[] } — save the picked Pages from the pending sign-in.
 *   { action: "discard" }                   — forget the pending sign-in.
 */
export async function POST(req: NextRequest) {
  const viewer = await socialViewer();
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!viewer.allowed || !metaConfigured()) return NextResponse.json({ error: "Social publishing isn't available." }, { status: 403 });
  const body = await req.json().catch(() => ({}));

  if (body?.action === "discard") return clearPending(NextResponse.json({ ok: true }));

  if (body?.action !== "choose") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const ids: string[] = Array.isArray(body.pageIds) ? body.pageIds.map(String) : [];
  if (ids.length === 0) return NextResponse.json({ error: "Pick a Page." }, { status: 400 });
  const p = pendingFrom(req, viewer.userId);
  if (!p) return NextResponse.json({ error: "The Facebook sign-in expired. Click Connect again." }, { status: 400 });

  try {
    const pages = (await listPages(p.userToken)).filter((pg) => ids.indexOf(pg.id) >= 0);
    if (pages.length === 0) return NextResponse.json({ error: "Those Pages weren't in your Facebook account." }, { status: 400 });
    const now = new Date().toISOString();
    const rows = pages.map((pg) => ({
      broker_id: viewer.userId,
      fb_user_id: p.fbUserId,
      page_id: pg.id,
      page_name: pg.name,
      // A Page token fetched with a long-lived user token doesn't expire.
      page_token_enc: encryptToken(pg.access_token),
      ig_user_id: pg.instagram_business_account?.id ?? null,
      ig_username: pg.instagram_business_account?.username ?? null,
      token_expires_at: null,
      updated_at: now,
    }));
    const { error } = await viewer.svc.from("social_connections").upsert(rows, { onConflict: "broker_id,page_id" });
    if (error) return NextResponse.json({ error: `Couldn't save the connection: ${error.message}` }, { status: 500 });
    return clearPending(NextResponse.json({ ok: true, saved: pages.length }));
  } catch (e) {
    return NextResponse.json({ error: graphErrorMessage(e) }, { status: 502 });
  }
}

/**
 * DELETE /api/social/connections?id=… — Disconnect.
 * Deletes the row (and so the encrypted token), cancels that Page's
 * scheduled posts, and — when it was this Facebook user's last Page here —
 * asks Meta to remove the app's permissions too (best effort).
 */
export async function DELETE(req: NextRequest) {
  const viewer = await socialViewer();
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  const conn = await loadConnection(viewer.svc, id);
  if (!conn) return NextResponse.json({ ok: true });
  if (conn.broker_id !== viewer.userId && !viewer.isAdmin) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Scheduled posts can't go out without the token: cancel them (and pull
  // any reel Facebook is holding for later).
  const { data: scheduled } = await viewer.svc.from("social_posts")
    .select("id, platform, external_id").eq("connection_id", id).eq("status", "scheduled");
  const list = (scheduled ?? []) as { id: string; platform: string; external_id: string | null }[];
  if (list.length) {
    let token: string | null = null;
    try { token = decryptToken(conn.page_token_enc); } catch { token = null; }
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.platform === "facebook" && s.external_id && token) {
        await deleteFacebookVideo(s.external_id, token).catch(() => undefined);
      }
    }
    await viewer.svc.from("social_posts").update({ status: "cancelled", error: "Page disconnected", updated_at: new Date().toISOString() })
      .in("id", list.map((s) => s.id));
  }

  const { error } = await viewer.svc.from("social_connections").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let revoked = false;
  const { count } = await viewer.svc.from("social_connections").select("id", { count: "exact", head: true }).eq("fb_user_id", conn.fb_user_id);
  if (!count) revoked = await revokePermissions(conn.fb_user_id);
  return NextResponse.json({ ok: true, revoked, cancelled: list.length });
}
