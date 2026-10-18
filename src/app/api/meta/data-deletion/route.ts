import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { parseSignedRequest } from "@/lib/meta/oauth";
import { serviceClient } from "@/lib/meta/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_BASE = "https://portal.yachtpics.com";

/**
 * POST /api/meta/data-deletion — Meta's Data Deletion Request Callback.
 *
 * Meta posts a form with `signed_request` (HMAC-SHA256 with the app secret)
 * when someone removes the app from their Facebook settings and asks for
 * their data to be deleted. We delete every social connection (and its
 * encrypted Page token) for that Facebook user, cancel their unsent posts,
 * and answer with a status URL + confirmation code, as Meta requires.
 * Public: no portal login.
 */
export async function POST(req: NextRequest) {
  let signed = "";
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const b = await req.json();
      signed = String(b?.signed_request ?? "");
    } else {
      const form = await req.formData();
      signed = String(form.get("signed_request") ?? "");
    }
  } catch {
    signed = "";
  }

  const data = parseSignedRequest(signed);
  if (!data?.user_id) return NextResponse.json({ error: "Invalid signed_request." }, { status: 400 });

  const fbUserId = String(data.user_id);
  const svc = serviceClient();
  const { data: rows } = await svc.from("social_connections").select("id").eq("fb_user_id", fbUserId);
  const ids = (rows ?? []).map((r: { id: string }) => r.id);
  if (ids.length) {
    await svc.from("social_posts").update({ status: "cancelled", error: "Facebook data deletion request", updated_at: new Date().toISOString() })
      .in("connection_id", ids).eq("status", "scheduled");
    await svc.from("social_connections").delete().in("id", ids);
  }

  const code = `YP-${randomBytes(6).toString("hex").toUpperCase()}`;
  console.log(`[meta data-deletion] ${code}: removed ${ids.length} connection(s) for a Facebook user`);
  return NextResponse.json({
    url: `${PUBLIC_BASE}/data-deletion?code=${encodeURIComponent(code)}`,
    confirmation_code: code,
  });
}
