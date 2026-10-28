import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { lookupPhotoPaths, originalPathInScope, signOriginalPaths } from "@/lib/photoStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_PATHS = 1000;
const MIN_TTL = 60;
const MAX_TTL = 60 * 60 * 6;

/**
 * POST /api/photos/originals  { paths: string[], ttl?: seconds, download?: boolean }
 *   → { urls: { [path]: signedUrl } }
 *
 * Signs photo ORIGINALS for the browser — needed for originals on R2, which
 * the browser can't sign itself (src/lib/photoStoreClient.ts). Paths the
 * caller may not read are simply left out.
 *
 * Access = the rule storage RLS applied to the Supabase objects: a listing
 * photo is readable by anyone who can read the listing (the caller's own RLS
 * read decides — owner, assistants, co-brokers, brokerage admins, shared
 * inventory, admins); gallery photos are admin-only. And the path must sit in
 * its own row's listing / gallery folder.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const paths: string[] = Array.isArray(body?.paths)
    ? Array.from(new Set<string>(body.paths.filter((x: unknown) => typeof x === "string" && x))).slice(0, MAX_PATHS)
    : [];
  if (paths.length === 0) return NextResponse.json({ urls: {} });
  const ttlRaw = Number(body?.ttl);
  const ttl = Number.isFinite(ttlRaw) ? Math.min(MAX_TTL, Math.max(MIN_TTL, Math.round(ttlRaw))) : 3600;

  const userClient = await createServerClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const rows = await lookupPhotoPaths(svc, paths);

  const listingIds = new Set<string>();
  let anyGallery = false;
  rows.forEach((r) => {
    if (!r.known) return;
    if (r.listing_id) listingIds.add(r.listing_id);
    else if (r.gallery_id) anyGallery = true;
  });

  // Listings the caller can read, under their own RLS.
  const readable = new Set<string>();
  const ids = Array.from(listingIds);
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await userClient.from("listings").select("id").in("id", ids.slice(i, i + 200));
    (data ?? []).forEach((l) => readable.add(l.id as string));
  }
  let isAdmin = false;
  if (anyGallery || readable.size < listingIds.size) {
    const { data: me } = await svc.from("profiles").select("role").eq("id", user.id).maybeSingle();
    isAdmin = me?.role === "admin";
  }

  const allowed = paths.filter((p) => {
    const r = rows.get(p);
    if (!r?.known) return false;
    if (!originalPathInScope(p, r)) return false;
    if (r.listing_id) return isAdmin || readable.has(r.listing_id);
    return isAdmin;
  });

  const signed = await signOriginalPaths(svc, allowed, ttl, { download: body?.download === true });
  const urls: Record<string, string> = {};
  signed.forEach((s) => { if (s.signedUrl) urls[s.path] = s.signedUrl; });
  return NextResponse.json({ urls });
}
