import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { logEmail } from "@/lib/logEmail";
import { rateLimited } from "@/lib/simpleRateLimit";
import { getEffectiveAccessStatus } from "@/lib/brokerAccess";
import { hasAccess } from "@/lib/subscriptionAccess";
import { getSiteBySlug, serviceClient, boatLabel } from "@/lib/brokerSiteServer";
import { CONTACT_PREFS, INQUIRY_TYPES, LEAD_KINDS, type LeadKind } from "@/lib/brokerSite";

export const runtime = "nodejs";

/**
 * POST /api/b/[slug]/lead — a visitor's form on a broker's website
 * (Request a showing / Contact / What's my boat worth?).
 *
 * Validates, rate-limits (5 an hour per IP + site), stores the lead with the
 * service role (IP kept only as a salted hash), then emails the broker at
 * once with Reply-To = the visitor. Answers { ok: true } — never anything
 * about the broker beyond what the page already shows.
 */

const PORTAL = "https://portal.yachtpics.com";

function esc(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] as string));
}

function clip(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

function hashIp(ip: string): string {
  const salt = process.env.LEAD_IP_SALT || process.env.CRON_SECRET || "yachtpics-site-leads";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // Honeypot: a hidden field real visitors never fill. Pretend success.
    if (clip(body.company_website, 200)) return NextResponse.json({ ok: true });

    const kind = clip(body.kind, 20) as LeadKind;
    if (!(LEAD_KINDS as readonly string[]).includes(kind)) {
      return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 400 });
    }

    const name = clip(body.name, 120);
    const email = clip(body.email, 160);
    const phone = clip(body.phone, 40);
    const message = clip(body.message, 2000);
    const contactPrefRaw = clip(body.contact_pref, 20);
    const inquiryRaw = clip(body.inquiry_type, 40);
    const contactPref = (CONTACT_PREFS as readonly string[]).includes(contactPrefRaw) ? contactPrefRaw : null;
    const inquiryType = (INQUIRY_TYPES as readonly string[]).includes(inquiryRaw) ? inquiryRaw : null;

    if (!name) return NextResponse.json({ error: "Please add your name." }, { status: 400 });
    if (email && !EMAIL_RE.test(email)) return NextResponse.json({ error: "That email doesn't look right." }, { status: 400 });
    if (!email && phone.replace(/\D/g, "").length < 7) {
      return NextResponse.json({ error: "Please add an email or a phone number so we can reach you." }, { status: 400 });
    }

    const slug = String(params.slug ?? "").toLowerCase().slice(0, 60);
    const ip = clientIp(req);
    if (rateLimited(`site-lead:${slug}:${ip}`, 5, 60 * 60 * 1000)) {
      return NextResponse.json({ error: "Thanks — we've already received your messages. Please try again a little later." }, { status: 429 });
    }

    const site = await getSiteBySlug(slug);
    if (!site || !site.published) return NextResponse.json({ error: "This page isn't available." }, { status: 404 });
    const svc = serviceClient();
    const { status } = await getEffectiveAccessStatus(svc, site.broker_id);
    if (!hasAccess(status)) return NextResponse.json({ error: "This page isn't available." }, { status: 404 });

    // A showing request must name one of this broker's boats on the site.
    let listing: { id: string; vessel_name: string | null; length_ft: number | string | null; make: string | null; model: string | null } | null = null;
    if (kind === "showing") {
      const listingId = clip(body.listing_id, 40);
      if (!/^[0-9a-f-]{36}$/i.test(listingId)) return NextResponse.json({ error: "Please choose a yacht." }, { status: 400 });
      const { data } = await svc
        .from("listings")
        .select("id, vessel_name, length_ft, make, model, broker_id, slideshow_published")
        .eq("id", listingId)
        .maybeSingle();
      if (!data || data.broker_id !== site.broker_id) return NextResponse.json({ error: "Please choose a yacht." }, { status: 400 });
      listing = data;
    }

    let boat: { builder: string; model: string; year: string; length: string } | null = null;
    if (kind === "valuation") {
      const b = (body.boat && typeof body.boat === "object" ? body.boat : {}) as Record<string, unknown>;
      boat = { builder: clip(b.builder, 60), model: clip(b.model, 60), year: clip(b.year, 8), length: clip(b.length, 16) };
      if (!boat.builder && !boat.model) return NextResponse.json({ error: "Please add the builder or model." }, { status: 400 });
    }

    const { error: insErr } = await svc.from("site_leads").insert({
      broker_id: site.broker_id,
      listing_id: listing?.id ?? null,
      kind,
      name,
      email: email || null,
      phone: phone || null,
      contact_pref: contactPref,
      inquiry_type: kind === "contact" ? inquiryType : null,
      message: message || null,
      boat,
      source: "site",
      ip_hash: hashIp(ip),
    });
    if (insErr) {
      console.error("site lead insert failed:", insErr.message);
      return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }

    // ── Tell the broker (best effort; never fails the visitor's submit) ──
    try {
      const { data: broker } = await svc.from("profiles").select("first_name, display_email").eq("id", site.broker_id).maybeSingle();

      const boatLine = boat ? [boat.year, boat.builder, boat.model].filter(Boolean).join(" ") || "a yacht" : "";
      const subject =
        kind === "showing" && listing
          ? `Showing request: ${boatLabel(listing)}`
          : kind === "valuation"
            ? `Valuation request: ${boatLine}`
            : "New inquiry from your website";
      const heading =
        kind === "showing" ? "Someone would like a showing" : kind === "valuation" ? "Someone wants to know what their boat is worth" : "New inquiry from your website";

      try {
        const { sendPushToUser } = await import("@/lib/sendPush");
        const payload = { title: subject, body: `${name} sent this from your website.`, url: "/dashboard/website#inquiries", tag: `site-lead-${site.broker_id}` };
        const recipients = new Set<string>([site.broker_id]);
        const { data: asst } = await svc.from("broker_assistants").select("assistant_id").eq("broker_id", site.broker_id);
        (asst ?? []).forEach((r) => recipients.add(r.assistant_id as string));
        await Promise.all(Array.from(recipients).map((id) => sendPushToUser(id, payload)));
      } catch { /* push not configured */ }

      if (broker?.display_email) {
        const row = (label: string, value: string, href?: string) =>
          value
            ? `<tr><td style="padding:6px 0;font-size:14px;color:#6b7280;width:110px;vertical-align:top;">${label}</td><td style="padding:6px 0;font-size:14px;color:#111827;line-height:1.5;">${href ? `<a href="${esc(href)}" style="color:#84662a;">${esc(value)}</a>` : esc(value)}</td></tr>`
            : "";
        const rows = [
          row("Name", name),
          row("Email", email, email ? `mailto:${email}` : undefined),
          row("Phone", phone, phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : undefined),
          row("Prefers", contactPref ?? ""),
          kind === "showing" && listing ? row("Yacht", boatLabel(listing)) : "",
          kind === "contact" ? row("About", inquiryType ?? "") : "",
          boat ? row("Builder", boat.builder) + row("Model", boat.model) + row("Year", boat.year) + row("Length", boat.length) : "",
          row("Message", message),
        ].join("");
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;"><p style="margin:0;font-size:20px;font-weight:600;color:#fff;letter-spacing:0.5px;">YachtPics <span style="color:#c39e4e;">Portal</span></p></div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">${esc(heading)}</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Sent from your website just now. Reply to this email to answer ${esc(name)} directly.</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 24px;">${rows}</table>
      <a href="${PORTAL}/dashboard/website#inquiries" style="display:inline-block;background:#c39e4e;color:#050b14;text-decoration:none;font-weight:700;font-size:15px;padding:13px 28px;border-radius:8px;">See your inquiries</a>
    </div>
  </div>
</body></html>`;
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "YachtPics <hello@yachtpics.com>",
            to: broker.display_email,
            ...(email ? { reply_to: email } : {}),
            subject,
            html,
          }),
        });
        await logEmail({
          emailType: "site_lead",
          recipientEmail: broker.display_email,
          recipientRole: "broker",
          recipientId: site.broker_id,
          brokerId: site.broker_id,
          listingId: listing?.id ?? null,
          subject,
          status: res.ok ? "sent" : "failed",
          metadata: { kind, leadName: name, leadEmail: email || null },
        });
      }
    } catch { /* never fail the visitor's submission on a notification error */ }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
