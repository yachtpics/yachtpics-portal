import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { resolveActingBroker, serviceClient, portraitUrl, PORTRAIT_BUCKET } from "@/lib/brokerSiteServer";
import { isMissingSchema } from "@/lib/brokerSite";

export const runtime = "nodejs";

/**
 * Website portrait upload / removal (Oct 26). Same pattern as the logo upload
 * (src/app/api/logo/upload/route.ts): PNG/JPG/WebP ≤ 5 MB, stored in the
 * public `broker-logos` bucket at {brokerId}/portrait-{time}.{ext}; the path
 * goes in broker_sites.portrait_path and the previous file is removed.
 */

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_BYTES = 5 * 1024 * 1024;

async function currentSite(brokerId: string) {
  const { data, error } = await serviceClient().from("broker_sites").select("slug, portrait_path").eq("broker_id", brokerId).maybeSingle();
  return { site: data as { slug: string; portrait_path: string | null } | null, error };
}

export async function POST(req: NextRequest) {
  const who = await resolveActingBroker(req.nextUrl.searchParams.get("brokerId"));
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  const { site, error } = await currentSite(who.brokerId);
  if (error) return NextResponse.json({ error: isMissingSchema(error) ? "Website isn't switched on yet." : error.message }, { status: isMissingSchema(error) ? 503 : 500 });
  if (!site) return NextResponse.json({ error: "Create your website first." }, { status: 400 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "No file provided." }, { status: 400 });
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "Portrait must be a PNG, JPG or WebP image." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That photo is too large — please use one under 5 MB." }, { status: 400 });

  const svc = serviceClient();
  const path = `${who.brokerId}/portrait-${Date.now()}.${ext}`;
  const { error: upErr } = await svc.storage.from(PORTRAIT_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), {
    contentType: file.type,
    cacheControl: "31536000",
    upsert: false,
  });
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });

  const { error: dbErr } = await svc.from("broker_sites").update({ portrait_path: path, updated_at: new Date().toISOString() }).eq("broker_id", who.brokerId);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  if (site.portrait_path && !/^https?:/.test(site.portrait_path) && site.portrait_path.startsWith(`${who.brokerId}/`)) {
    await svc.storage.from(PORTRAIT_BUCKET).remove([site.portrait_path]).then(() => {}, () => {});
  }
  try { revalidatePath(`/b/${site.slug}`, "layout"); } catch { /* not fatal */ }
  return NextResponse.json({ ok: true, url: portraitUrl(svc, path) });
}

export async function DELETE(req: NextRequest) {
  const who = await resolveActingBroker(req.nextUrl.searchParams.get("brokerId"));
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  const { site, error } = await currentSite(who.brokerId);
  if (error) return NextResponse.json({ error: isMissingSchema(error) ? "Website isn't switched on yet." : error.message }, { status: isMissingSchema(error) ? 503 : 500 });
  if (!site) return NextResponse.json({ ok: true });
  const svc = serviceClient();
  await svc.from("broker_sites").update({ portrait_path: null, updated_at: new Date().toISOString() }).eq("broker_id", who.brokerId);
  if (site.portrait_path && site.portrait_path.startsWith(`${who.brokerId}/`)) {
    await svc.storage.from(PORTRAIT_BUCKET).remove([site.portrait_path]).then(() => {}, () => {});
  }
  try { revalidatePath(`/b/${site.slug}`, "layout"); } catch { /* not fatal */ }
  return NextResponse.json({ ok: true });
}
