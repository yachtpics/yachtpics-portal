import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  r2Configured, r2MissingConfig, r2Put, r2Delete, r2PublicUrl, R2_BUCKET,
  r2VideoConfigured, r2VideoPut, r2VideoDelete, r2SignedGetUrl, R2_VIDEO_BUCKET,
  r2EnsureVideoCors,
} from "@/lib/r2";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/admin/r2/selftest
 *
 * Proves the whole R2 chain end to end before any real media depends on it:
 * write a tiny file with the API token, fetch it back over the public domain,
 * then delete it. Three separate things can be wrong — the credentials, the
 * bucket, or the custom domain — and each fails differently. Testing them
 * together in order means the answer names which one.
 *
 * Admin only, and it cleans up after itself.
 */
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const svc = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: me } = await svc.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  if (!r2Configured()) {
    return NextResponse.json({
      ok: false,
      step: "settings",
      detail: `Missing: ${r2MissingConfig().join(", ")}. Add them in Vercel, then redeploy — environment variables only reach the app on a fresh deploy.`,
    });
  }

  const key = `_selftest/${Date.now()}.txt`;
  const body = `yachtpics r2 selftest ${new Date().toISOString()}`;
  const url = r2PublicUrl(key);

  // 1. Write — checks the API token, the account id, and the bucket name.
  try {
    await r2Put(key, Buffer.from(body, "utf8"), "text/plain; charset=utf-8");
  } catch (e) {
    return NextResponse.json({
      ok: false,
      step: "upload",
      bucket: R2_BUCKET,
      detail: e instanceof Error ? e.message : String(e),
      hint: "Usually the API token (wrong key, or not Object Read & Write), the account id, or a bucket name that doesn't match.",
    });
  }

  // 2. Read back over the public domain — checks the custom domain and that
  // public access is actually enabled. A file that uploads but won't serve is
  // the failure that would otherwise only show up on a live boat page.
  let publicRead: { ok: boolean; status: number; matched: boolean; detail?: string };
  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = res.ok ? await res.text() : "";
    publicRead = { ok: res.ok, status: res.status, matched: text.trim() === body };
  } catch (e) {
    publicRead = { ok: false, status: 0, matched: false, detail: e instanceof Error ? e.message : String(e) };
  }

  // 3. Tidy up regardless — a self-test shouldn't leave litter in the bucket.
  let cleaned = true;
  try {
    await r2Delete(key);
  } catch {
    cleaned = false;
  }

  if (!publicRead.ok) {
    return NextResponse.json({
      ok: false,
      step: "public-read",
      uploaded: true,
      cleaned,
      url,
      status: publicRead.status,
      detail: publicRead.detail,
      hint: publicRead.status === 404
        ? "The file uploaded but the domain didn't serve it — check the custom domain is Active and points at this bucket."
        : "Check Settings → Custom Domains on the bucket, and that public access is allowed.",
    });
  }

  if (!publicRead.matched) {
    return NextResponse.json({
      ok: false,
      step: "public-read",
      uploaded: true,
      cleaned,
      url,
      detail: "The domain served something, but not the file we just wrote — it may be pointing at a different bucket.",
    });
  }

  // 4. The private video bucket. Separate bucket, separate failure mode — most
  // likely an API token still scoped to the public bucket only. Checked before
  // any video is trusted to it.
  const privateResult = await checkPrivateBucket();

  return NextResponse.json({
    ok: privateResult.ok,
    publicBucket: { ok: true, bucket: R2_BUCKET, publicBase: r2PublicUrl("").replace(/\/$/, ""), cleaned },
    privateBucket: privateResult,
    message: privateResult.ok
      ? "Both buckets are working — public serves over the custom domain, private signs temporary links."
      : `The website bucket is fine. The private video bucket isn't ready: ${privateResult.detail}`,
  });
}

/**
 * Write, read back through a signed link, and delete — in the private bucket.
 *
 * Deliberately fetches through the signed URL rather than the API: that is how
 * a broker's browser will actually reach a video, so it's what needs proving.
 */
async function checkPrivateBucket(): Promise<{ ok: boolean; bucket?: string; detail?: string; hint?: string }> {
  if (!r2VideoConfigured()) {
    return {
      ok: false,
      detail: "R2_VIDEO_BUCKET isn't set.",
      hint: "Add it in Vercel and redeploy.",
    };
  }

  const key = `_selftest/${Date.now()}.txt`;
  const body = `yachtpics private selftest ${new Date().toISOString()}`;

  // Browser uploads and zip downloads need CORS on this bucket, and a fresh
  // bucket has none. Applying it here makes the self-test the one switch that
  // readies an environment.
  try {
    await r2EnsureVideoCors();
  } catch (e) {
    return {
      ok: false,
      bucket: R2_VIDEO_BUCKET,
      detail: `Couldn't set CORS on the bucket: ${e instanceof Error ? e.message : String(e)}`,
      hint: "Browser uploads will fail until this succeeds — likely the API token lacks bucket-settings permission.",
    };
  }

  try {
    await r2VideoPut(key, Buffer.from(body, "utf8"), "text/plain; charset=utf-8");
  } catch (e) {
    return {
      ok: false,
      bucket: R2_VIDEO_BUCKET,
      detail: e instanceof Error ? e.message : String(e),
      hint: "Most likely the API token is still scoped to the website bucket only, or the bucket name doesn't match.",
    };
  }

  try {
    const url = await r2SignedGetUrl(key, { expiresIn: 120 });
    const res = await fetch(url, { cache: "no-store" });
    const text = res.ok ? await res.text() : "";
    if (!res.ok || text.trim() !== body) {
      await r2VideoDelete(key).catch(() => {});
      return {
        ok: false,
        bucket: R2_VIDEO_BUCKET,
        detail: `Signed link returned ${res.status} and didn't match what was written.`,
      };
    }
  } catch (e) {
    await r2VideoDelete(key).catch(() => {});
    return { ok: false, bucket: R2_VIDEO_BUCKET, detail: e instanceof Error ? e.message : String(e) };
  }

  // It must NOT be reachable without a signature — that's the whole reason this
  // bucket is separate. A public private-bucket would be worse than no move.
  let publiclyExposed = false;
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (base) {
    try {
      const res = await fetch(`${base.replace(/\/+$/, "")}/${key}`, { cache: "no-store" });
      publiclyExposed = res.ok;
    } catch {
      publiclyExposed = false;
    }
  }

  await r2VideoDelete(key).catch(() => {});

  if (publiclyExposed) {
    return {
      ok: false,
      bucket: R2_VIDEO_BUCKET,
      detail: "The private bucket answered over the public domain — it isn't private.",
      hint: "Check that no custom domain or public access is enabled on the video bucket.",
    };
  }

  return { ok: true, bucket: R2_VIDEO_BUCKET };
}
