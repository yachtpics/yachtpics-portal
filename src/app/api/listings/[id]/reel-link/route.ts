import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { assertListingAccess } from "@/lib/assertListingAccess";
import { r2SignedGetUrl, r2VideoConfigured } from "@/lib/r2";
import { REEL_SHARE_PREFIX } from "@/lib/videoUploadTarget";
import { logEmail } from "@/lib/logEmail";

export const runtime = "nodejs";

const LINK_HOURS = 24;

/**
 * POST /api/listings/[id]/reel-link  { path, filename?, email?: boolean }
 *   → { url, expiresAt, emailedTo }
 *
 * The last yard between a rendered reel and a phone. The browser has already
 * put the file in the private bucket under the reel-shares prefix; this signs
 * a 24-hour download link for it, and — if asked — emails that link to the
 * person who made it. On the page the same link becomes a QR code, which is
 * usually the faster route: point the phone at the screen, tap, it's in the
 * camera roll.
 *
 * The path is checked against this listing's share prefix before signing, so a
 * caller can't turn the signer against any other file in the bucket.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!r2VideoConfigured()) return NextResponse.json({ error: "Video storage isn't configured." }, { status: 500 });

  const svc = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const access = await assertListingAccess(svc, params.id, user.id, { includeCoBroker: true });
  if (access instanceof NextResponse) return access;

  const body = await req.json().catch(() => ({}));
  const path = typeof body?.path === "string" ? body.path : "";
  const expectedPrefix = `${REEL_SHARE_PREFIX}${params.id}/`;
  if (!path.startsWith(expectedPrefix) || path.includes("..")) {
    return NextResponse.json({ error: "That file doesn't belong to this listing." }, { status: 403 });
  }

  const filename = typeof body?.filename === "string" && body.filename.trim()
    ? body.filename.trim().replace(/[\/\\]/g, "_")
    : "reel.mp4";

  let url: string;
  try {
    url = await r2SignedGetUrl(path, { expiresIn: LINK_HOURS * 3600, downloadAs: filename });
  } catch {
    return NextResponse.json({ error: "Couldn't create the link." }, { status: 502 });
  }
  const expiresAt = new Date(Date.now() + LINK_HOURS * 3600 * 1000).toISOString();

  // The email is a backup for when the phone isn't in hand — the QR code on
  // screen is the intended path. Sent to the maker's own address, never to a
  // supplied one: this is a hand-off to yourself, not a send to a client.
  let emailedTo: string | null = null;
  if (body?.email === true && process.env.RESEND_API_KEY) {
    const { data: me } = await svc
      .from("profiles").select("first_name, display_email").eq("id", user.id).maybeSingle();
    const to = me?.display_email as string | undefined;
    if (to) {
      const { data: listing } = await svc
        .from("listings").select("vessel_name").eq("id", params.id).maybeSingle();
      const boat = (listing?.vessel_name as string | null) ?? "your listing";
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:28px 40px;"><p style="margin:0;font-size:18px;font-weight:600;color:#ffffff;">YachtPics <span style="color:#c39e4e;">Portal</span></p></div>
    <div style="padding:32px 40px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#84662a;text-transform:uppercase;">Your reel</p>
      <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#111827;">${boat}</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Open this on your phone and tap the button — the reel saves to your camera roll, ready to post with whatever audio you like.</p>
      <div style="margin:0 0 22px;"><a href="${url}" style="display:inline-block;background:#c39e4e;color:#050b14;font-size:15px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:8px;">Save the reel</a></div>
      <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">This link works for ${LINK_HOURS} hours. On iPhone: tap, then use the share icon → Save Video. On Android it downloads straight to your gallery.</p>
    </div>
  </div>
</body></html>`;
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "YachtPics Portal <hello@yachtpics.com>",
            to,
            subject: `Your reel for ${boat}`,
            html,
          }),
        });
        if (res.ok) emailedTo = to;
        await logEmail({
          emailType: "reel_to_phone",
          recipientEmail: to,
          recipientId: user.id,
          listingId: params.id,
          subject: `Your reel for ${boat}`,
          status: res.ok ? "sent" : "failed",
          sentBy: user.id,
        });
      } catch { /* the link still works; the email was the backup */ }
    }
  }

  return NextResponse.json({ url, expiresAt, emailedTo });
}
