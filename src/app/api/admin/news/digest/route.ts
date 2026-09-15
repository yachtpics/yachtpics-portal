import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { DIGEST_SELECT, renderDigestHtml, type DigestRow } from "@/lib/newsDigest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Room to edit in without letting a paste run away with the page. */
const MAX_TITLE = 80;
const MAX_INTRO = 600;
const MAX_BODY = 20_000;

/**
 * Read the weekly pieces.
 *
 * `latest` is whatever is newest — usually this Monday's draft. `past` is the
 * dozen before it, so the admin page can show what has already gone out.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;

  const { data, error } = await admin
    .from("news_digests")
    .select(DIGEST_SELECT)
    .order("week_start", { ascending: false })
    .limit(13);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as unknown as DigestRow[];
  return NextResponse.json({ ok: true, latest: rows[0] ?? null, past: rows.slice(1) });
}

/**
 * Save an edit to the title, intro or body.
 *
 * A piece that has already been approved carries rendered HTML — the copy the
 * website reads — so an edit re-renders it. A piece that has been sent is
 * closed: the email is in people's inboxes and changing the page underneath it
 * would only make the two disagree.
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;

  let body: { id?: string; title?: string; intro?: string; body_md?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ error: "Which digest?" }, { status: 400 });

  const { data: current, error: readError } = await admin
    .from("news_digests")
    .select(DIGEST_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: "That digest is gone" }, { status: 404 });

  const row = current as unknown as DigestRow;
  if (row.status === "sent") {
    return NextResponse.json({ error: "This piece has already been sent; it can't be edited now" }, { status: 409 });
  }

  const patch: { title?: string; intro?: string; body_md?: string; html?: string } = {};

  if (typeof body.title === "string") {
    const title = body.title.trim();
    if (!title) return NextResponse.json({ error: "A title is required" }, { status: 400 });
    if (title.length > MAX_TITLE) {
      return NextResponse.json({ error: `The title is ${title.length} characters; the limit is ${MAX_TITLE}` }, { status: 400 });
    }
    patch.title = title;
  }

  if (typeof body.intro === "string") {
    const intro = body.intro.trim();
    if (!intro) return NextResponse.json({ error: "An intro is required" }, { status: 400 });
    if (intro.length > MAX_INTRO) {
      return NextResponse.json({ error: `The intro is ${intro.length} characters; the limit is ${MAX_INTRO}` }, { status: 400 });
    }
    patch.intro = intro;
  }

  if (typeof body.body_md === "string") {
    const bodyMd = body.body_md.replace(/\r\n/g, "\n").trim();
    if (!bodyMd) return NextResponse.json({ error: "The piece is empty" }, { status: 400 });
    if (bodyMd.length > MAX_BODY) {
      return NextResponse.json({ error: `The piece is ${bodyMd.length} characters; the limit is ${MAX_BODY}` }, { status: 400 });
    }
    patch.body_md = bodyMd;
  }

  if (patch.title === undefined && patch.intro === undefined && patch.body_md === undefined) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }

  // Already approved? Keep the rendered copy in step with the words.
  if (row.html && row.html.trim().length > 0) {
    patch.html = renderDigestHtml({ body_md: patch.body_md ?? row.body_md });
  }

  const { data, error } = await admin
    .from("news_digests")
    .update(patch)
    .eq("id", id)
    .select(DIGEST_SELECT)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, digest: data });
}
