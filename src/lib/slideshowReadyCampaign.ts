import type { SupabaseClient } from "@supabase/supabase-js";
import { getEffectiveAccessStatus } from "@/lib/brokerAccess";
import { hasAccess } from "@/lib/subscriptionAccess";
import { orderPhotos } from "@/lib/photoOrder";
import { emailCoverImage, type EmailImage } from "@/lib/emailCoverImage";
import { slideshowPublishUpdate } from "@/lib/slideshowPublish";
import { unsubscribeFooterHtml, unsubscribeHeaders } from "@/lib/unsubscribe";
import { sendResendBatch, type BatchEmail } from "@/lib/sendEmailBatch";
import { logEmail } from "@/lib/logEmail";
import { PLAN_FROM_PRICE } from "@/lib/planValue";

/**
 * "Slideshow ready" campaign (Oct 29) — SERVER ONLY. Driven by Charlie from
 * /admin/announce/slideshow-ready; nothing here runs on a schedule.
 *
 * Step 1 — prepare: for brokers with NO access (getEffectiveAccessStatus +
 * hasAccess — own plan incl. comped, Office plan, paid Reel Service), create
 * the buyer slideshow on their active, unsold, unpublished listings that have
 * at least one visible photo. Exactly the broker's own Create Slideshow change
 * (slideshowPublishUpdate), plus slideshow_prepared_by / _at so YachtPics-made
 * slideshows can be told apart. No email, push, website, showcase or social
 * side effects exist for that change (see src/lib/slideshowPublish.ts).
 *
 * Step 2 — email: one "Slideshow ready" email per broker without access who
 * has ≥ 1 active, unsold listing with a published slideshow, hasn't opted out
 * (profiles.email_opt_out, like the announcements) and hasn't had this email
 * before (email_log type SLIDESHOW_READY_TYPE, status sent).
 */

export const SLIDESHOW_READY_TYPE = "slideshow_ready_2026_10";
const FROM = "Charlie & Samantha at YachtPics <hello@yachtpics.com>";
const PORTAL = "https://portal.yachtpics.com";

type BrokerRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_email: string | null;
  email_opt_out: boolean | null;
  unsubscribe_token: string | null;
};

/** Looks like an internal/test account — shown unticked so Charlie decides. */
export function looksLikeTestAccount(b: { first_name: string | null; last_name: string | null; display_email: string | null }): boolean {
  const name = `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim().toLowerCase();
  const email = (b.display_email ?? "").toLowerCase();
  return (
    /\b(test|demo|sample|example)\b/.test(name) ||
    ["john doe", "jane doe", "brian nopper test"].includes(name) ||
    /test|demo|example\.com|\+|yachtpics/.test(email)
  );
}

/** Broker ids (role broker) with NO access, using the real access rule. */
export async function brokersWithoutAccess(svc: SupabaseClient): Promise<Map<string, BrokerRow>> {
  const { data } = await svc
    .from("profiles")
    .select("id, first_name, last_name, display_email, email_opt_out, unsubscribe_token")
    .eq("role", "broker");
  const rows = (data ?? []) as BrokerRow[];
  const out = new Map<string, BrokerRow>();
  for (let i = 0; i < rows.length; i += 10) {
    const slice = rows.slice(i, i + 10);
    const statuses = await Promise.all(slice.map((b) => getEffectiveAccessStatus(svc, b.id).then((r) => r.status).catch(() => null)));
    slice.forEach((b, j) => {
      const st = statuses[j];
      if (st && !hasAccess(st)) out.set(b.id, b);
    });
  }
  return out;
}

async function visiblePhotoCounts(svc: SupabaseClient, listingIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (let i = 0; i < listingIds.length; i += 25) {
    const chunk = listingIds.slice(i, i + 25);
    const res = await Promise.all(
      chunk.map((id) => svc.from("photos").select("id", { count: "exact", head: true }).eq("listing_id", id).eq("is_visible", true).then((r) => r.count ?? 0))
    );
    chunk.forEach((id, j) => counts.set(id, res[j]));
  }
  return counts;
}

export type PrepareCandidate = {
  listingId: string;
  brokerId: string;
  brokerName: string;
  brokerEmail: string | null;
  vessel: string;
  photos: number;
  /** Ticked by default unless it looks like a test account. */
  suggested: boolean;
  testLike: boolean;
};

function vesselOf(l: { vessel_name: string | null; year: number | null; make: string | null; model: string | null }): string {
  return (l.vessel_name ?? "").trim() || [l.year, l.make, l.model].filter(Boolean).join(" ") || "Untitled listing";
}

/** Step 1 list: unpublished, active, unsold listings with photos, of brokers without access. */
export async function findPrepareCandidates(svc: SupabaseClient, noAccess?: Map<string, BrokerRow>): Promise<PrepareCandidate[]> {
  const brokers = noAccess ?? (await brokersWithoutAccess(svc));
  const ids = Array.from(brokers.keys());
  if (ids.length === 0) return [];
  const listings: { id: string; broker_id: string; vessel_name: string | null; year: number | null; make: string | null; model: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await svc
      .from("listings")
      .select("id, broker_id, vessel_name, year, make, model, slideshow_published")
      .in("broker_id", ids.slice(i, i + 100))
      .eq("status", "active")
      .is("sold_at", null)
      .or("slideshow_published.is.null,slideshow_published.eq.false");
    listings.push(...((data ?? []) as typeof listings));
  }
  const counts = await visiblePhotoCounts(svc, listings.map((l) => l.id));
  return listings
    .filter((l) => (counts.get(l.id) ?? 0) > 0)
    .map((l) => {
      const b = brokers.get(l.broker_id)!;
      const testLike = looksLikeTestAccount(b);
      return {
        listingId: l.id,
        brokerId: l.broker_id,
        brokerName: [b.first_name, b.last_name].filter(Boolean).join(" ") || b.display_email || "Broker",
        brokerEmail: b.display_email,
        vessel: vesselOf(l),
        photos: counts.get(l.id) ?? 0,
        suggested: !testLike,
        testLike,
      };
    })
    .sort((a, b) => a.brokerName.localeCompare(b.brokerName) || a.vessel.localeCompare(b.vessel));
}

/**
 * Step 1 action: prepare the chosen listings. Each one is re-checked against
 * the candidate rule first (so a stale page can't publish something it
 * shouldn't), then gets exactly the Create Slideshow update.
 */
export async function prepareSlideshows(svc: SupabaseClient, listingIds: string[], adminId: string): Promise<{ prepared: number; skipped: number; failed: { listingId: string; error: string }[] }> {
  const wanted = new Set(listingIds.filter((x) => typeof x === "string"));
  const candidates = (await findPrepareCandidates(svc)).filter((c) => wanted.has(c.listingId));
  const failed: { listingId: string; error: string }[] = [];
  let prepared = 0;
  for (const c of candidates) {
    const { data: row } = await svc.from("listings").select("slideshow_slug").eq("id", c.listingId).maybeSingle();
    const update = slideshowPublishUpdate((row as { slideshow_slug: string | null } | null)?.slideshow_slug);
    const { error } = await svc
      .from("listings")
      .update({ ...update, slideshow_prepared_by: adminId, slideshow_prepared_at: new Date().toISOString() })
      .eq("id", c.listingId)
      .or("slideshow_published.is.null,slideshow_published.eq.false");
    if (error) failed.push({ listingId: c.listingId, error: error.message });
    else prepared++;
  }
  return { prepared, skipped: wanted.size - candidates.length, failed };
}

// ── Step 2 ───────────────────────────────────────────────────────────────────

export type ReadyRecipient = {
  brokerId: string;
  name: string;
  firstName: string;
  email: string;
  unsubToken: string | null;
  featured: { listingId: string; vessel: string; slug: string };
  readyCount: number;
  testLike: boolean;
};

export type ReadyPlan = { recipients: ReadyRecipient[]; alreadySent: number; optedOut: number };

export async function planSlideshowReady(svc: SupabaseClient, noAccess?: Map<string, BrokerRow>): Promise<ReadyPlan> {
  const brokers = noAccess ?? (await brokersWithoutAccess(svc));
  const ids = Array.from(brokers.keys());
  const published: { id: string; broker_id: string; vessel_name: string | null; year: number | null; make: string | null; model: string | null; slideshow_slug: string; photographed_at: string | null; created_at: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await svc
      .from("listings")
      .select("id, broker_id, vessel_name, year, make, model, slideshow_slug, photographed_at, created_at")
      .in("broker_id", ids.slice(i, i + 100))
      .eq("status", "active")
      .is("sold_at", null)
      .eq("slideshow_published", true)
      .not("slideshow_slug", "is", null);
    published.push(...((data ?? []) as typeof published));
  }
  const { data: logs } = await svc.from("email_log").select("recipient_id").eq("email_type", SLIDESHOW_READY_TYPE).eq("status", "sent");
  const sent = new Set(((logs ?? []) as { recipient_id: string | null }[]).map((l) => l.recipient_id).filter(Boolean) as string[]);

  const byBroker = new Map<string, typeof published>();
  published.forEach((l) => byBroker.set(l.broker_id, (byBroker.get(l.broker_id) ?? []).concat([l])));

  let alreadySent = 0;
  let optedOut = 0;
  const recipients: ReadyRecipient[] = [];
  byBroker.forEach((list, brokerId) => {
    const b = brokers.get(brokerId);
    if (!b || !b.display_email) return;
    if (b.email_opt_out) { optedOut++; return; }
    if (sent.has(brokerId)) { alreadySent++; return; }
    const when = (l: (typeof list)[number]) => Date.parse(l.photographed_at ?? l.created_at ?? "") || 0;
    const top = list.slice().sort((x, y) => when(y) - when(x))[0];
    recipients.push({
      brokerId,
      name: [b.first_name, b.last_name].filter(Boolean).join(" ") || b.display_email,
      firstName: (b.first_name ?? "").trim() || "there",
      email: b.display_email,
      unsubToken: b.unsubscribe_token,
      featured: { listingId: top.id, vessel: vesselOf(top), slug: top.slideshow_slug },
      readyCount: list.length,
      testLike: looksLikeTestAccount(b),
    });
  });
  recipients.sort((a, b) => a.name.localeCompare(b.name));
  return { recipients, alreadySent, optedOut };
}

/**
 * The featured listing's cover as an email-safe image: a public ~1200px JPEG
 * (src/lib/emailCoverImage.ts). Not the 2000px derivative — that is WebP,
 * which Outlook/Gmail often show as a broken image. null = send without it.
 */
export async function heroImage(svc: SupabaseClient, listingId: string): Promise<EmailImage | null> {
  try {
    const [{ data: l }, { data: photos }] = await Promise.all([
      svc.from("listings").select("hero_photo_id, photo_order_manual").eq("id", listingId).maybeSingle(),
      svc.from("photos").select("id, storage_path, storage_backend, category, filename, display_order, derivatives_at").eq("listing_id", listingId).eq("is_visible", true),
    ]);
    const ordered = orderPhotos((photos ?? []) as { id: string; storage_path: string; storage_backend: string | null; category: string | null; filename: string | null; display_order: number | null; derivatives_at: string | null }[], {
      manual: l?.photo_order_manual === true,
      heroId: l?.hero_photo_id ?? null,
    });
    const cover = ordered[0];
    if (!cover) return null;
    return await emailCoverImage(svc, "slideshow-ready", listingId, cover);
  } catch {
    return null;
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function slideshowReadySubject(vessel: string): string {
  return `${vessel}'s slideshow is ready`;
}

/** The email — announcement styling (dark header, white card, unsubscribe footer). */
export function slideshowReadyHtml(opts: { firstName: string; vessel: string; slug: string; readyCount: number; hero: EmailImage | null; unsubToken: string | null }): string {
  const { firstName, vessel, slug, readyCount, hero, unsubToken } = opts;
  const v = esc(vessel);
  // The slideshow itself, as the buyer receives it. ?preview=1 makes a
  // signed-out click go through sign-in and back (src/app/s/[slug]/page.tsx);
  // signed in, the owner sees it with the "this is what your buyer sees" bar.
  const link = `${PORTAL}/s/${encodeURIComponent(slug)}?preview=1`;
  const p = (t: string, muted = false) =>
    `<p style="margin:0 0 16px;font-size:15px;color:${muted ? "#6b7280" : "#374151"};line-height:1.65;">${t}</p>`;
  const more = readyCount > 1 ? p(`&hellip;and her slideshow is one of ${readyCount} ready for you.`) : "";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics</p>
    </div>
    ${hero ? `<a href="${link}" style="display:block;"><img src="${esc(hero.url)}" alt="${v} &mdash; the cover photo of her slideshow" width="560" height="${Math.round((560 * hero.height) / hero.width)}" style="display:block;width:100%;max-width:560px;height:auto;border:0;" /></a>` : ""}
    <div style="padding:40px;">
      ${p(`${esc(firstName)},`)}
      ${p(`Every photo from ${v}&rsquo;s shoot is now laid out as a buyer slideshow &mdash; branded to you, with a Seller Report that counts every view and shows what buyers linger on.`)}
      ${more}
      ${p("It&rsquo;s ready to send. Open it, take a look, and send it to your next buyer straight from the Portal.")}
      <a href="${link}" style="display:inline-block;background:#c39e4e;color:#050b14;text-decoration:none;font-weight:700;font-size:15px;padding:13px 28px;border-radius:8px;margin:4px 0 24px;">See her slideshow</a>
      ${p(`Sending, the share link and the dock card for the show are part of a Portal plan, from $${PLAN_FROM_PRICE} a month.`, true)}
      <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">Charlie<br><span style="color:#9ca3af;">YachtPics</span></p>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">YachtPics &middot; Professional yacht photography &amp; delivery<br>Questions? Just reply to this email.</p>
    </div>${unsubToken ? unsubscribeFooterHtml(unsubToken) : ""}
  </div>
</body>
</html>`;
}

export async function renderForRecipient(svc: SupabaseClient, r: ReadyRecipient): Promise<{ subject: string; html: string }> {
  const hero = await heroImage(svc, r.featured.listingId);
  return {
    subject: slideshowReadySubject(r.featured.vessel),
    html: slideshowReadyHtml({ firstName: r.firstName, vessel: r.featured.vessel, slug: r.featured.slug, readyCount: r.readyCount, hero, unsubToken: r.unsubToken }),
  };
}

/**
 * Send to the chosen brokers (ids from the page; recomputed here so only
 * eligible, not-yet-sent, opted-in brokers get it). Batched through Resend
 * (sendResendBatch: 100 per request, gap between chunks), every result logged
 * in email_log under SLIDESHOW_READY_TYPE — the dedup key, so a second run
 * never sends to the same broker twice.
 */
export async function sendSlideshowReady(svc: SupabaseClient, brokerIds: string[], sentBy: string): Promise<{ sent: number; failed: number; skipped: number }> {
  const wanted = new Set(brokerIds);
  const { recipients } = await planSlideshowReady(svc);
  const queue = recipients.filter((r) => wanted.has(r.brokerId));
  const rendered: { r: ReadyRecipient; subject: string; html: string }[] = [];
  for (let i = 0; i < queue.length; i += 10) {
    const chunk = await Promise.all(queue.slice(i, i + 10).map(async (r) => ({ r, ...(await renderForRecipient(svc, r)) })));
    rendered.push(...chunk);
  }
  const messages: BatchEmail[] = rendered.map(({ r, subject, html }) => ({
    from: FROM,
    to: r.email,
    subject,
    html,
    headers: r.unsubToken ? unsubscribeHeaders(r.unsubToken) : undefined,
  }));
  const results = await sendResendBatch(messages);
  let sent = 0;
  let failed = 0;
  await Promise.all(rendered.map(({ r, subject }, i) => {
    const ok = results[i]?.ok ?? false;
    if (ok) sent++; else failed++;
    return logEmail({
      emailType: SLIDESHOW_READY_TYPE,
      recipientEmail: r.email,
      recipientRole: "broker",
      recipientId: r.brokerId,
      brokerId: r.brokerId,
      listingId: r.featured.listingId,
      subject,
      status: ok ? "sent" : "failed",
      error: ok ? null : results[i]?.error ?? "Send failed",
      sentBy,
      metadata: { readyCount: r.readyCount, resendId: results[i]?.id ?? null },
    });
  }));
  return { sent, failed, skipped: wanted.size - queue.length };
}

/** A test copy to the admin (not logged under the campaign type, so it never counts as sent). */
export async function sendSlideshowReadyTest(svc: SupabaseClient, to: string, sentBy: string, sample?: ReadyRecipient): Promise<{ ok: boolean; error?: string }> {
  const r = sample ?? (await planSlideshowReady(svc)).recipients[0];
  if (!r) return { ok: false, error: "No recipients to base a test on yet — prepare some slideshows first." };
  const { subject, html } = await renderForRecipient(svc, r);
  const [res] = await sendResendBatch([{ from: FROM, to, subject: `[Test] ${subject}`, html }]);
  await logEmail({
    emailType: `${SLIDESHOW_READY_TYPE}_test`,
    recipientEmail: to,
    recipientRole: null,
    subject: `[Test] ${subject}`,
    status: res?.ok ? "sent" : "failed",
    error: res?.ok ? null : res?.error ?? null,
    sentBy,
    metadata: { sampleBroker: r.brokerId },
  });
  return res?.ok ? { ok: true } : { ok: false, error: res?.error ?? "Send failed" };
}
