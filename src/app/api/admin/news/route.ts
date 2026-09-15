import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { isNewsCategory, NATIVE_SOURCE_NAME, NATIVE_SOURCE_HOMEPAGE } from "@/lib/newsSources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The same ceilings the model writes to, so hand-written items read the same. */
const MAX_TITLE = 90;
const MAX_SUMMARY = 260;

const SELECT = "id, url, source, source_url, title, summary, category, published_at, featured, hidden, native";

/**
 * Hide, unhide, feature or unfeature one item.
 *
 * Nothing is deleted: a hidden item stays in the table so the fetcher doesn't
 * pick the same story up again the next morning.
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;

  let body: { id?: string; hidden?: boolean; featured?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ error: "Which item?" }, { status: 400 });

  const patch: { hidden?: boolean; featured?: boolean } = {};
  if (typeof body.hidden === "boolean") patch.hidden = body.hidden;
  if (typeof body.featured === "boolean") patch.featured = body.featured;
  if (patch.hidden === undefined && patch.featured === undefined) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("industry_news")
    .update(patch)
    .eq("id", id)
    .select(SELECT)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, item: data });
}

/**
 * Add a YachtPics item — a boat on Recently Photographed, a broker's reel, a
 * show we're shooting. It sits in the same feed as the trade press, marked as
 * ours, because that's the point: this is YachtPics' view of the industry, not
 * a scraper.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;

  let body: { title?: string; summary?: string; url?: string; category?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
  const category = body.category;

  if (!title) return NextResponse.json({ error: "A headline is required" }, { status: 400 });
  if (title.length > MAX_TITLE) {
    return NextResponse.json({ error: `The headline is ${title.length} characters; the limit is ${MAX_TITLE}` }, { status: 400 });
  }
  if (!summary) return NextResponse.json({ error: "A summary is required" }, { status: 400 });
  if (summary.length > MAX_SUMMARY) {
    return NextResponse.json({ error: `The summary is ${summary.length} characters; the limit is ${MAX_SUMMARY}` }, { status: 400 });
  }
  if (!isNewsCategory(category)) return NextResponse.json({ error: "Choose a category" }, { status: 400 });

  let url: string;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("not http");
    url = parsed.toString();
  } catch {
    return NextResponse.json({ error: "That link doesn't look like a web address" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("industry_news")
    .insert({
      url,
      source: NATIVE_SOURCE_NAME,
      source_url: NATIVE_SOURCE_HOMEPAGE,
      title,
      summary,
      category,
      published_at: new Date().toISOString(),
      native: true,
    })
    .select(SELECT)
    .single();

  if (error) {
    // 23505 — the url column is unique, so this link is already in the feed.
    const message = error.code === "23505" ? "That link is already in the feed" : error.message;
    return NextResponse.json({ error: message }, { status: error.code === "23505" ? 409 : 500 });
  }

  return NextResponse.json({ ok: true, item: data });
}
