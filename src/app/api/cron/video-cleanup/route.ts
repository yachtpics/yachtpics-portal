import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { r2VideoSize } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The second half of the video migration, run automatically: delete the
 * Supabase safety copies of videos that now serve from Cloudflare.
 *
 * The migration itself finished on Aug 30 and deliberately deleted nothing —
 * video links emailed to clients before the move point at Supabase and stay
 * valid for 7 days, so the copies had to sit for a week. The manual "Free up
 * Supabase space" button exists for this, but Charlie is shooting in Grenada
 * when the week is up, so the daily cron does the clicking:
 *
 *   • Sleeps until Sept 7 (7 days after the migration), stops after Sept 30.
 *   • Each run: verify up to 60 videos still exist on Cloudflare — checked
 *     file by file, immediately before deletion — then remove their Supabase
 *     copies. A video Cloudflare can't confirm is SKIPPED, never deleted.
 *   • Emails Charlie a summary on any run that actually freed space.
 *
 * Safe to run every day: once the copies are gone, removals find nothing and
 * the run reports zero. After Sept 30 the route no-ops entirely — the window
 * exists so a long-forgotten cron can't surprise anyone months later.
 */

const START = "2026-09-07"; // 7 days after the Aug 30 migration
const END = "2026-09-30";
// The whole library fits one run (106 videos, checked in parallel fives —
// well inside the 60s budget). A LIMIT smaller than the library would re-check
// the same first rows every day and never reach the rest.
const BATCH = 500;
const REPORT_TO = "charlie@yachtpics.com";
const GB = 1024 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization");
    const querySecret = req.nextUrl.searchParams.get("secret");
    if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Eastern calendar date, so "the 7th" means the 7th at home, not in UTC.
  const todayET = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  if (todayET < START) return NextResponse.json({ ok: true, waiting: `starts ${START}` });
  if (todayET > END) return NextResponse.json({ ok: true, done: `window closed ${END}` });

  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: videos } = await svc
    .from("videos")
    .select("id, storage_path, filename")
    .eq("storage_host", "r2")
    .order("created_at", { ascending: true })
    .limit(BATCH);

  let removed = 0;
  let freedBytes = 0;
  const skipped: string[] = [];

  // Small parallel groups — quick without hammering either store.
  const queue = [...(videos ?? [])];
  while (queue.length > 0) {
    const group = queue.splice(0, 5);
    await Promise.all(
      group.map(async (v) => {
        const path = v.storage_path as string;
        if (!path) return;
        // The last look before the only irreversible step: Cloudflare must
        // confirm it holds the file, right now, or the Supabase copy stays.
        const size = await r2VideoSize(path);
        if (!size) {
          skipped.push(v.filename ?? path);
          return;
        }
        const { data: gone } = await svc.storage.from("listing-videos").remove([path]);
        if ((gone?.length ?? 0) > 0) {
          removed += 1;
          freedBytes += size;
        }
      })
    );
  }

  const freedGB = freedBytes / GB;

  // Tell Charlie only when something actually happened — a daily "nothing to
  // do" email would teach him to ignore the ones that matter.
  let emailed = false;
  if (removed > 0 && process.env.RESEND_API_KEY) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <div style="background:#050b14;padding:28px 40px;">
          <p style="margin:0;font-size:18px;font-weight:600;color:#ffffff;">YachtPics <span style="color:#c39e4e;">Portal</span> — Storage cleanup</p>
        </div>
        <div style="padding:32px 40px;">
          <p style="margin:0 0 4px;font-size:32px;font-weight:700;color:#111827;">${freedGB.toFixed(1)} GB freed</p>
          <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">
            Deleted the Supabase copies of ${removed} migrated video${removed !== 1 ? "s" : ""} — each one
            verified on Cloudflare immediately before its copy was removed. The portal keeps serving all
            video from Cloudflare exactly as it has since the migration.
          </p>
          ${skipped.length > 0 ? `<p style="margin:0;font-size:13px;color:#b54708;line-height:1.6;"><strong>${skipped.length} kept on Supabase</strong> because Cloudflare couldn't confirm the file just now — they'll be retried tomorrow, and nothing was deleted for them.</p>` : ""}
          <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">Automatic cleanup, scheduled while you're in Grenada. Nothing to do — this is just the receipt.</p>
        </div>
      </div>
    </body></html>`;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "YachtPics Portal <hello@yachtpics.com>",
          to: REPORT_TO,
          subject: `Supabase cleanup: ${freedGB.toFixed(1)} GB freed (${removed} video cop${removed !== 1 ? "ies" : "y"} removed)`,
          html,
        }),
      });
      emailed = res.ok;
    } catch { /* the cleanup already happened; the receipt is a nicety */ }
  }

  return NextResponse.json({
    ok: true,
    date: todayET,
    checked: (videos ?? []).length,
    removed,
    freedGB: Number(freedGB.toFixed(2)),
    skipped: skipped.length,
    emailed,
  });
}
