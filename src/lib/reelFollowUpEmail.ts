/**
 * The two follow-ups to the Reel open house.
 *
 *   Week one  — "here's what brokers made", carrying REAL numbers from
 *               reel_events. Social proof a written email can't fake.
 *   Last call — two days before the window shuts.
 *
 * The week-one email has a quiet variant, and that is the important part of
 * this file. If only a handful of brokers have made a reel, broadcasting the
 * count does the opposite of what social proof is for — it tells 140 people
 * that nobody else bothered. So the numbers only appear when they carry
 * themselves (see THIN_WEEK); otherwise the same email goes out making the
 * case on the tool rather than on the crowd. Neither variant ever sends on a
 * schedule: Charlie reads the numbers on /admin/reels and presses the button.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { unsubscribeFooterHtml } from "@/lib/unsubscribe";
import { reelPromoEndsOn, reelPromoDaysLeft, REEL_PROMO_START } from "@/lib/reelPromo";
import { ANNOUNCEMENT_TYPE } from "@/lib/announcementEmail";
import { REEL_STYLES, type StyleKey } from "@/lib/reelStyles";

const PORTAL = "https://portal.yachtpics.com";

export type FollowUpKey = "week1" | "lastcall";

/**
 * Own email_log types so each send dedups separately from the announcement and
 * from each other. Reusing a type would silently skip everyone who got the
 * earlier one.
 */
export const FOLLOWUP_TYPE: Record<FollowUpKey, string> = {
  week1: "announcement_reel_2026_09_wk1",
  lastcall: "announcement_reel_2026_09_final",
};

/**
 * Send windows. Narrow on purpose — a "two days left" email that arrives four
 * days after the window shut is worse than no email, and these are the only
 * guard against a mistimed press of the button.
 */
export const FOLLOWUP_WINDOW: Record<FollowUpKey, { after: string; before: string }> = {
  week1:    { after: "2026-09-21T00:00:00Z", before: "2026-09-26T04:00:00Z" },
  lastcall: { after: "2026-09-27T00:00:00Z", before: "2026-10-01T04:00:00Z" },
};

export function followUpWindowOpen(key: FollowUpKey, now: Date = new Date()): boolean {
  const w = FOLLOWUP_WINDOW[key];
  const t = now.getTime();
  return t >= Date.parse(w.after) && t <= Date.parse(w.before);
}

// ── The numbers ───────────────────────────────────────────────────────────

export type ReelStats = {
  reels: number;      // vertical renders
  films: number;      // widescreen renders
  total: number;
  brokers: number;    // distinct brokers with at least one
  boats: number;      // distinct listings
  taken: number;      // downloaded, sent to a phone, or added to a listing
  topLook: string | null;
};

/**
 * Below this the week-one email drops the numbers and makes the case on the
 * tool instead. Five brokers is the point where "brokers are using this" reads
 * as a fact about the group rather than a fact about five people.
 */
export const THIN_WEEK = { brokers: 5, reels: 10 };

export function statsAreWorthSharing(s: ReelStats): boolean {
  return s.brokers >= THIN_WEEK.brokers && s.total >= THIN_WEEK.reels;
}

/**
 * Read what brokers have made since the announcement landed. Admin rows are
 * excluded — Charlie's test renders are not social proof.
 */
export async function readReelStats(admin: SupabaseClient): Promise<ReelStats> {
  const { data: announceRow } = await admin
    .from("email_log")
    .select("sent_at")
    .eq("email_type", ANNOUNCEMENT_TYPE)
    .eq("status", "sent")
    .order("sent_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const since: string = announceRow?.sent_at ?? REEL_PROMO_START;

  const { data: rows } = await admin
    .from("reel_events")
    .select("kind, role, format, look, broker_id, user_id, listing_id")
    .gte("created_at", since)
    .neq("role", "admin");

  const events = rows ?? [];
  const renders = events.filter((e) => e.kind === "render");

  const distinct = (vals: (string | null)[]) => {
    const seen: Record<string, true> = {};
    for (const v of vals) if (v) seen[v] = true;
    return Object.keys(seen).length;
  };

  const lookCounts: Record<string, number> = {};
  for (const r of renders) if (r.look) lookCounts[r.look] = (lookCounts[r.look] ?? 0) + 1;
  const ranked = Object.entries(lookCounts).sort((a, b) => b[1] - a[1]);
  const topKey = ranked[0]?.[0] ?? null;

  return {
    reels: renders.filter((e) => e.format === "reel").length,
    films: renders.filter((e) => e.format === "film").length,
    total: renders.length,
    brokers: distinct(renders.map((e) => e.broker_id ?? e.user_id)),
    boats: distinct(renders.map((e) => e.listing_id)),
    taken: distinct(
      events
        .filter((e) => e.kind === "download" || e.kind === "send_to_phone" || e.kind === "added_to_listing")
        .map((e) => e.listing_id)
    ),
    topLook: topKey ? REEL_STYLES[topKey as StyleKey]?.name ?? null : null,
  };
}

// ── The shell ─────────────────────────────────────────────────────────────

function shell(inner: string, unsubFooter: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#050b14;padding:32px 40px;">
      <p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#c39e4e;">Portal</span></p>
    </div>
    <div style="padding:40px;">${inner}</div>
    <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">YachtPics &middot; Professional yacht photography &amp; delivery<br>Questions? Just reply to this email.</p>
    </div>${unsubFooter}
  </div>
</body>
</html>`;
}

const p = (html: string, muted = false) =>
  `<p style="margin:0 0 20px;font-size:15px;color:${muted ? "#6b7280" : "#374151"};line-height:1.6;">${html}</p>`;

const cta = (label: string) =>
  `<div style="margin:26px 0;">
    <a href="${PORTAL}/dashboard/listings" style="display:inline-block;background:#c39e4e;color:#050b14;font-size:15px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:8px;">${label}</a>
  </div>`;

const signoff =
  `<p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">— Charlie &amp; Samantha<br><span style="color:#9ca3af;">YachtPics</span></p>`;

// ── Subjects ──────────────────────────────────────────────────────────────

export function followUpSubject(key: FollowUpKey, stats: ReelStats): string {
  const closes = reelPromoEndsOn();
  if (key === "lastcall") {
    const days = reelPromoDaysLeft();
    return days <= 1 ? "Last day to make a reel on the house" : `Two days left — the reel open house closes ${closes}`;
  }
  return statsAreWorthSharing(stats)
    ? `${stats.total} reels made this week — the open house runs to ${closes}`
    : `Your photographs, as a reel — free until ${closes}`;
}

// ── Week one ──────────────────────────────────────────────────────────────

export function weekOneHtml(opts: { firstName: string; stats: ReelStats; unsubToken?: string }): string {
  const { firstName, stats, unsubToken } = opts;
  const closes = reelPromoEndsOn();
  const proof = statsAreWorthSharing(stats);

  const numbers = `
    <div style="margin:0 0 26px;padding:18px 20px;background:#f8f3ea;border:1px solid #eaddc1;border-radius:8px;">
      <p style="margin:0 0 6px;font-size:15px;color:#4a3d17;line-height:1.6;"><strong>${stats.total} reels, ${stats.boats} boats, ${stats.brokers} brokers</strong> &mdash; in the first week.</p>
      <p style="margin:0;font-size:14px;color:#6b5a2a;line-height:1.6;">${
        stats.topLook ? `${stats.topLook} is the look they keep reaching for. ` : ""
      }They&rsquo;re on Instagram now, made from photographs that were already sitting in the Portal.</p>
    </div>`;

  const inner = proof
    ? `
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#84662a;text-transform:uppercase;">One week in</p>
      <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#111827;">What brokers made this week</h1>
      ${p(`Hi ${firstName},`)}
      ${numbers}
      ${p(`If you haven&rsquo;t made one yet, it takes about a minute. Open a listing, press <strong style="color:#111827;">Reel</strong>, pick a look. The photographs are already there &mdash; you don&rsquo;t upload anything, write anything or edit anything.`)}
      ${p(`It&rsquo;s open to every account until <strong style="color:#111827;">${closes}</strong>, and anything you make is yours to keep whatever you decide after that.`)}
      ${cta("Make one for your best boat")}
      ${p(`If you&rsquo;ve already made one, we&rsquo;d like to see it &mdash; just reply with the link.`, true)}
      ${signoff}`
    : `
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#84662a;text-transform:uppercase;">A reminder</p>
      <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#111827;">It takes about a minute</h1>
      ${p(`Hi ${firstName},`)}
      ${p(`The reel builder is open to every account until <strong style="color:#111827;">${closes}</strong>, and it may be the least work anything on the Portal has ever asked of you: open a listing, press <strong style="color:#111827;">Reel</strong>, pick a look. Nothing to upload, nothing to write, nothing to edit. Around forty seconds of finished video, in under a minute.`)}
      ${p(`Press <strong style="color:#111827;">Send to my phone</strong> when it&rsquo;s done and it&rsquo;s in your camera roll, ready to post with whatever audio you like.`)}
      ${p(`Anything you make is yours to keep &mdash; whatever you decide after ${closes}.`)}
      ${cta("Make a reel")}
      ${p(`Not sure which boat? Pick the one with the best exterior shots. That&rsquo;s the one it flatters most.`, true)}
      ${signoff}`;

  return shell(inner, unsubToken ? unsubscribeFooterHtml(unsubToken) : "");
}

// ── Last call ─────────────────────────────────────────────────────────────

export function lastCallHtml(opts: { firstName: string; stats: ReelStats; unsubToken?: string }): string {
  const { firstName, stats, unsubToken } = opts;
  const closes = reelPromoEndsOn();
  const days = reelPromoDaysLeft();
  const proof = statsAreWorthSharing(stats);

  // Short on purpose. A deadline email that argues its case has already lost;
  // the only job here is to say when it ends and make the button easy to find.
  const inner = `
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#84662a;text-transform:uppercase;">${days <= 1 ? "Last day" : "Closing " + closes}</p>
    <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#111827;">${days <= 1 ? "Last day for a reel on the house" : "Two days left"}</h1>
    ${p(`Hi ${firstName},`)}
    ${p(`The reel builder goes back behind the subscription on <strong style="color:#111827;">${closes}</strong>. ${
      proof
        ? `${stats.brokers} brokers have made ${stats.total} between them so far.`
        : `If you haven&rsquo;t tried it, this is the window.`
    }`)}
    ${p(`One listing, one press, about a minute. And whatever you make in the next ${days <= 1 ? "day" : "two days"} stays yours &mdash; to post and re-post long after the window shuts.`)}
    ${cta(days <= 1 ? "Make one today" : "Make one before it closes")}
    ${p(`If you&rsquo;ve been meaning to and haven&rsquo;t, your best boat takes a minute.`, true)}
    ${signoff}`;

  return shell(inner, unsubToken ? unsubscribeFooterHtml(unsubToken) : "");
}

export function followUpHtml(
  key: FollowUpKey,
  opts: { firstName: string; stats: ReelStats; unsubToken?: string }
): string {
  return key === "lastcall" ? lastCallHtml(opts) : weekOneHtml(opts);
}
