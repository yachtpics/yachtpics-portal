import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Resend webhook receiver. We subscribe to email.bounced + email.complained and
// flag the matching broker/assistant so admins see "email bouncing" and can fix
// the address. Signature is verified with the Svix scheme Resend uses.

function verifySignature(rawBody: string, headers: Headers, secret: string): boolean {
  const id = headers.get("svix-id");
  const ts = headers.get("svix-timestamp");
  const sigHeader = headers.get("svix-signature");
  if (!id || !ts || !sigHeader) return false;
  try {
    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const expected = crypto.createHmac("sha256", secretBytes).update(`${id}.${ts}.${rawBody}`).digest("base64");
    const expectedBuf = Buffer.from(expected);
    // Header is a space-separated list of "v1,<signature>" entries.
    return sigHeader.split(" ").some((entry) => {
      const sig = entry.split(",")[1];
      if (!sig) return false;
      const sigBuf = Buffer.from(sig);
      return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
    });
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    if (!verifySignature(rawBody, req.headers, secret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } else {
    // Fail-open until the signing secret is configured, so bounce flagging works
    // immediately. Set RESEND_WEBHOOK_SECRET to harden this endpoint.
    console.warn("RESEND_WEBHOOK_SECRET not set — processing webhook without signature verification.");
  }

  let event: { type?: string; data?: { to?: string[]; bounce?: { message?: string; type?: string } } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const type = event.type ?? "";
  if (type !== "email.bounced" && type !== "email.complained") {
    // Acknowledge anything else so Resend doesn't retry.
    return NextResponse.json({ ok: true, ignored: type });
  }

  const recipients = (event.data?.to ?? []).filter(Boolean);
  if (recipients.length === 0) return NextResponse.json({ ok: true });

  const reason = type === "email.complained"
    ? "Recipient marked it as spam"
    : (event.data?.bounce?.message ?? event.data?.bounce?.type ?? "Email bounced");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  for (const email of recipients) {
    await admin
      .from("profiles")
      .update({ email_bounced_at: new Date().toISOString(), email_bounce_reason: reason.slice(0, 300) })
      .ilike("display_email", email);
  }

  return NextResponse.json({ ok: true, flagged: recipients.length });
}
