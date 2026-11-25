import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clearBookendImage, parseWhich, saveBookendImage, saveBookendSettings,
  type BookendResult, type BookendTarget,
} from "@/lib/logoBookendsServer";

/**
 * The three write verbs every logo-bookend route shares (broker's own, office,
 * admin), once the route has decided who may write to which target.
 *   POST   multipart { which: "open" | "close", file }
 *   PATCH  json { on?: boolean, ground?: "#rrggbb" | null }
 *   DELETE ?which=open|close
 * Each answers { settings } or { error } with the status the helper chose
 * (409 before the migration is applied).
 */

const NO_STORE = { "Cache-Control": "no-store" };

function answer(r: BookendResult): NextResponse {
  return r.ok
    ? NextResponse.json({ settings: r.settings }, { headers: NO_STORE })
    : NextResponse.json({ error: r.error }, { status: r.status, headers: NO_STORE });
}

export async function bookendPost(svc: SupabaseClient, target: BookendTarget, req: Request): Promise<NextResponse> {
  let which: ReturnType<typeof parseWhich> = null;
  let file: File | null = null;
  try {
    const form = await req.formData();
    which = parseWhich(form.get("which"));
    const f = form.get("file");
    file = f && typeof f !== "string" ? (f as File) : null;
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  if (!which) return NextResponse.json({ error: "Say which logo this is: opening or closing." }, { status: 400 });
  if (!file) return NextResponse.json({ error: "No file provided." }, { status: 400 });
  return answer(await saveBookendImage(svc, target, which, file));
}

export async function bookendPatch(svc: SupabaseClient, target: BookendTarget, req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { on?: unknown; ground?: unknown } | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  return answer(await saveBookendSettings(svc, target, { on: body.on, ground: body.ground }));
}

export async function bookendDelete(svc: SupabaseClient, target: BookendTarget, req: Request): Promise<NextResponse> {
  const which = parseWhich(new URL(req.url).searchParams.get("which"));
  if (!which) return NextResponse.json({ error: "Say which logo to remove: opening or closing." }, { status: 400 });
  return answer(await clearBookendImage(svc, target, which));
}
