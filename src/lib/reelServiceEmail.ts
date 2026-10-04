import type { SupabaseClient } from "@supabase/supabase-js";
import { logEmail } from "@/lib/logEmail";
import { sendResendBatch, type BatchEmail } from "@/lib/sendEmailBatch";
import { unsubscribeFooterHtml, unsubscribeHeaders } from "@/lib/unsubscribe";
import { ANGLE_LABEL, type ReelServiceAngle } from "@/lib/reelService";

/**
 * Reel Service delivery: mark ready reels delivered and tell the broker (and
 * the assistants linked to them in broker_assistants) — one email per person
 * per delivery, listing each new reel with its caption and a link to
 * /dashboard/reels, where it plays and downloads.
 *
 * Respects email_opt_out (the reels are on the Portal page either way).
 * Dedup: email_log rows of type REEL_SERVICE_EMAIL_TYPE carry the job ids in
 * metadata.jobIds; a person is never emailed about the same reel twice.
 */

export const REEL_SERVICE_EMAIL_TYPE = "reel_service_delivery";
const FROM = "Charlie & Samantha at YachtPics <hello@yachtpics.com>";
const PORTAL = "https://portal.yachtpics.com";

type JobForEmail = {
  id: string; broker_id: string; listing_id: string; slot: number; angle: string; caption: string | null; status: string;
  listings: { vessel_name: string | null; year: number | null; make: string | null; model: string | null } | null;
};

type Person = {
  id: string; first_name: string | null; display_email: string | null; role: string | null;
  email_opt_out: boolean | null; unsubscribe_token: string | null;
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function boatName(j: JobForEmail): string {
  const l = j.listings;
  if (!l) return "Your listing";
  return l.vessel_name || [l.year, l.make, l.model].filter(Boolean).join(" ") || "Your listing";
}

export function reelServiceEmailHtml(opts: { firstName: string; jobs: JobForEmail[]; unsubToken?: string | null; forBroker?: string | null }): string {
  const { firstName, jobs, unsubToken, forBroker } = opts;
  const n = jobs.length;
  // Grouped by listing: the boat once, then each of its new reels.
  const groups: { boat: string; jobs: JobForEmail[] }[] = [];
  jobs.forEach((j) => {
    const boat = boatName(j);
    let g = groups.find((x) => x.jobs[0].listing_id === j.listing_id);
    if (!g) { g = { boat, jobs: [] }; groups.push(g); }
    g.jobs.push(j);
  });
  groups.forEach((g) => g.jobs.sort((a, b) => a.slot - b.slot));
  const reelBlock = (j: JobForEmail) => {
    const angle = ANGLE_LABEL[j.angle as ReelServiceAngle] ?? j.angle;
    const caption = esc(j.caption ?? "").replace(/\n/g, "<br>");
    return `
        <div style="border-top:1px solid #f3f4f6;padding:14px 0 4px;">
          <p style="margin:0 0 10px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.6px;">${esc(angle)}</p>
          <a href="${PORTAL}/dashboard/reels#reel-${j.id}" style="display:inline-block;background:#c39e4e;color:#050b14;font-size:14px;font-weight:700;text-decoration:none;padding:10px 20px;border-radius:8px;">Watch &amp; download</a>
          ${caption ? `<p style="margin:14px 0 6px;font-size:12px;font-weight:700;color:#111827;text-transform:uppercase;">Caption to post</p>
          <div style="background:#f7f8f9;border-radius:8px;padding:12px 14px;font-size:14px;color:#374151;line-height:1.55;margin:0 0 10px;">${caption}</div>` : ""}
        </div>`;
  };
  const items = groups.map((g) => `
      <div style="border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px 8px;margin:0 0 16px;">
        <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#111827;">${esc(g.boat)}${g.jobs.length > 1 ? ` <span style="font-weight:400;color:#6b7280;font-size:14px;">&middot; ${g.jobs.length} reels</span>` : ""}</p>
        ${g.jobs.map(reelBlock).join("")}
      </div>`).join("");
  const intro = forBroker
    ? `${n === 1 ? "A new reel is" : `${n} new reels are`} ready for ${esc(forBroker)}, made from their current listings.`
    : `${n === 1 ? "Your new reel is" : `Your ${n} new reels are`} ready, made from your current listings.`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#c39e4e;">Portal</span></p>
    </div>
    <div style="padding:40px;">
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">${n === 1 ? "Your reel is ready" : "Your reels are ready"}${firstName ? `, ${esc(firstName)}` : ""}</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">${intro} Each one is silent on purpose: add a trending track when you post.</p>
      ${items}
      <p style="margin:20px 0 0;font-size:14px;color:#6b7280;line-height:1.6;">On your phone, open the link and tap <strong>Save or share</strong> to put the reel straight into Instagram or your camera roll.</p>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">YachtPics &middot; Reel Service<br>Questions? Just reply to this email.</p>
    </div>${unsubToken ? unsubscribeFooterHtml(unsubToken) : ""}
  </div>
</body>
</html>`;
}

export type DeliverResult = { delivered: number; emailed: number; skipped: number; failed: number; errors: string[] };

/**
 * Deliver these jobs: every one still 'ready' becomes 'delivered', then the
 * emails go out, grouped by broker. Jobs that are already delivered are
 * included in the email only for people who haven't been told about them.
 */
export async function deliverReelServiceJobs(admin: SupabaseClient, jobIds: string[], sentBy: string): Promise<DeliverResult> {
  const out: DeliverResult = { delivered: 0, emailed: 0, skipped: 0, failed: 0, errors: [] };
  if (jobIds.length === 0) return out;

  const { data: rows, error } = await admin.from("reel_service_jobs")
    .select("id, broker_id, listing_id, slot, angle, caption, status, listings:listing_id(vessel_name, year, make, model)")
    .in("id", jobIds);
  if (error) { out.errors.push(error.message); return out; }
  const jobs = ((rows ?? []) as unknown as JobForEmail[]).filter((j) => j.status === "ready" || j.status === "delivered");

  const readyIds = jobs.filter((j) => j.status === "ready").map((j) => j.id);
  if (readyIds.length) {
    const { error: upErr } = await admin.from("reel_service_jobs")
      .update({ status: "delivered", delivered_at: new Date().toISOString() })
      .in("id", readyIds).eq("status", "ready");
    if (upErr) { out.errors.push(upErr.message); return out; }
    out.delivered = readyIds.length;
  }

  const brokerIds = jobs.map((j) => j.broker_id).filter((b, i, a) => a.indexOf(b) === i);
  const messages: BatchEmail[] = [];
  const meta: { person: Person; brokerId: string; jobIds: string[]; subject: string }[] = [];

  for (const brokerId of brokerIds) {
    const mine = jobs.filter((j) => j.broker_id === brokerId);
    const { data: links } = await admin.from("broker_assistants").select("assistant_id").eq("broker_id", brokerId);
    const personIds = [brokerId, ...((links ?? []) as { assistant_id: string }[]).map((l) => l.assistant_id)];
    const { data: people } = await admin.from("profiles")
      .select("id, first_name, last_name, display_email, role, email_opt_out, unsubscribe_token")
      .in("id", personIds);
    const broker = ((people ?? []) as (Person & { last_name: string | null })[]).find((p) => p.id === brokerId);
    const brokerName = broker ? [broker.first_name, broker.last_name].filter(Boolean).join(" ") : null;

    const { data: prior } = await admin.from("email_log")
      .select("recipient_id, metadata")
      .eq("email_type", REEL_SERVICE_EMAIL_TYPE)
      .eq("status", "sent")
      .in("recipient_id", personIds);
    const told = (pid: string, jid: string) => ((prior ?? []) as { recipient_id: string | null; metadata: { jobIds?: string[] } | null }[])
      .some((r) => r.recipient_id === pid && Array.isArray(r.metadata?.jobIds) && r.metadata!.jobIds!.indexOf(jid) >= 0);

    for (const person of (people ?? []) as Person[]) {
      if (!person.display_email || person.email_opt_out) { out.skipped++; continue; }
      const fresh = mine.filter((j) => !told(person.id, j.id));
      if (fresh.length === 0) { out.skipped++; continue; }
      const isBroker = person.id === brokerId;
      const boats = fresh.map(boatName).filter((b, i, a) => a.indexOf(b) === i);
      const subject = fresh.length === 1
        ? `Your new reel of ${boats[0]} is ready`
        : `${fresh.length} new reels ready${boats.length === 1 ? ` for ${boats[0]}` : ""}`;
      messages.push({
        from: FROM,
        to: person.display_email,
        subject,
        html: reelServiceEmailHtml({
          firstName: person.first_name ?? "",
          jobs: fresh,
          unsubToken: person.unsubscribe_token,
          forBroker: isBroker ? null : brokerName,
        }),
        ...(person.unsubscribe_token ? { headers: unsubscribeHeaders(person.unsubscribe_token) } : {}),
      });
      meta.push({ person, brokerId, jobIds: fresh.map((j) => j.id), subject });
    }
  }

  if (messages.length === 0) return out;
  const results = await sendResendBatch(messages);
  await Promise.all(results.map((r, i) => {
    const m = meta[i];
    if (r.ok) out.emailed++; else { out.failed++; if (r.error) out.errors.push(r.error); }
    return logEmail({
      emailType: REEL_SERVICE_EMAIL_TYPE,
      recipientEmail: messages[i].to,
      recipientRole: m.person.id === m.brokerId ? "broker" : "assistant",
      recipientId: m.person.id,
      brokerId: m.brokerId,
      subject: m.subject,
      status: r.ok ? "sent" : "failed",
      error: r.ok ? null : r.error ?? null,
      sentBy,
      metadata: { jobIds: m.jobIds, resendId: r.id ?? null },
    });
  }));
  return out;
}
