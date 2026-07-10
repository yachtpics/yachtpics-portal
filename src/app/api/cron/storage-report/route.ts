import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GB = 1024 * 1024 * 1024;
const INCLUDED_GB = 100; // Supabase Pro included storage
const REPORT_TO = "charlie@yachtpics.com";

function gb(bytes: number) {
  return bytes / GB;
}
function fmtGB(bytes: number) {
  return `${gb(bytes).toFixed(1)} GB`;
}

export async function GET(req: NextRequest) {
  // Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set.
  // A `?secret=` query param is also accepted for manual testing.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization");
    const querySecret = req.nextUrl.searchParams.get("secret");
    if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Current usage per bucket
  const { data: usage, error } = await supabase.rpc("storage_usage");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (usage ?? []) as { bucket_id: string; files: number; bytes: number }[];
  const byBucket = (id: string) => rows.find((r) => r.bucket_id === id);
  const photos = byBucket("listing-photos");
  const videos = byBucket("listing-videos");
  const documents = byBucket("listing-documents");
  const logos = byBucket("broker-logos");

  const totalBytes = rows.reduce((s, r) => s + Number(r.bytes), 0);
  const totalFiles = rows.reduce((s, r) => s + Number(r.files), 0);
  const currentGB = gb(totalBytes);
  const pct = (currentGB / INCLUDED_GB) * 100;

  // Prior history (before inserting today's reading)
  const { data: history } = await supabase
    .from("storage_usage_history")
    .select("captured_at, total_bytes")
    .order("captured_at", { ascending: true });

  const prior = history ?? [];
  const last = prior.length > 0 ? prior[prior.length - 1] : null;
  const earliest = prior.length > 0 ? prior[0] : null;

  // Record today's reading
  await supabase.from("storage_usage_history").insert({
    total_bytes: totalBytes,
    photos_bytes: Number(photos?.bytes ?? 0),
    videos_bytes: Number(videos?.bytes ?? 0),
    documents_bytes: Number(documents?.bytes ?? 0),
    total_files: totalFiles,
  });

  // Since last run
  let sinceLast = "";
  if (last) {
    const deltaGB = gb(totalBytes - Number(last.total_bytes));
    const days = Math.max(
      0.1,
      (Date.now() - new Date(last.captured_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    sinceLast = `${deltaGB >= 0 ? "+" : ""}${deltaGB.toFixed(1)} GB since last check (${days.toFixed(0)} day${days >= 1.5 ? "s" : ""} ago)`;
  }

  // Growth rate + projection (earliest → now)
  let ratePerWeek = 0;
  let projection = "";
  if (earliest) {
    const weeks =
      (Date.now() - new Date(earliest.captured_at).getTime()) / (1000 * 60 * 60 * 24 * 7);
    if (weeks > 0.1) {
      ratePerWeek = gb(totalBytes - Number(earliest.total_bytes)) / weeks;
      if (ratePerWeek > 0.05) {
        const weeksTo100 = (INCLUDED_GB - currentGB) / ratePerWeek;
        if (weeksTo100 > 0) {
          const date = new Date(Date.now() + weeksTo100 * 7 * 24 * 60 * 60 * 1000);
          projection = `Averaging ~${ratePerWeek.toFixed(1)} GB/week. At this pace you'd reach ${INCLUDED_GB} GB around ${date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} (~${Math.round(weeksTo100)} weeks).`;
        }
      }
    }
  }

  // Threshold / status
  const within6Weeks =
    ratePerWeek > 0.05 && (INCLUDED_GB - currentGB) / ratePerWeek <= 6;
  let level: "ok" | "warn" | "urgent" = "ok";
  let banner = `Plenty of headroom — ${(INCLUDED_GB - currentGB).toFixed(1)} GB free of ${INCLUDED_GB} GB.`;
  let bannerColor = "#0f7a3d";
  if (currentGB >= 95) {
    level = "urgent";
    banner = `URGENT: ${currentGB.toFixed(1)} GB used of ${INCLUDED_GB} GB. You're about to exceed the included quota.`;
    bannerColor = "#b42318";
  } else if (currentGB >= 80 || within6Weeks) {
    level = "warn";
    banner = `Heads up: ${currentGB.toFixed(1)} GB of ${INCLUDED_GB} GB used${within6Weeks ? ", and the trend points at the limit within ~6 weeks" : ""}. Overage runs ~$0.021/GB/month beyond ${INCLUDED_GB} GB — a good time to consider moving media to Cloudflare R2 (free egress).`;
    bannerColor = "#b54708";
  }

  const row = (label: string, b?: { files: number; bytes: number }) =>
    `<tr>
       <td style="padding:8px 0;color:#374151;">${label}</td>
       <td style="padding:8px 0;color:#6b7280;text-align:right;">${b ? b.files.toLocaleString() : 0} files</td>
       <td style="padding:8px 0;color:#111827;text-align:right;font-weight:600;">${fmtGB(Number(b?.bytes ?? 0))}</td>
     </tr>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f8f9;margin:0;padding:40px 20px;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <div style="background:#050b14;padding:28px 40px;">
        <p style="margin:0;font-size:18px;font-weight:600;color:#ffffff;">YachtPics <span style="color:#c39e4e;">Portal</span> — Storage</p>
      </div>
      <div style="padding:32px 40px;">
        <div style="background:${bannerColor}1a;border:1px solid ${bannerColor}55;border-radius:8px;padding:14px 16px;margin-bottom:24px;">
          <p style="margin:0;font-size:14px;color:${bannerColor};font-weight:600;line-height:1.5;">${banner}</p>
        </div>
        <p style="margin:0 0 4px;font-size:32px;font-weight:700;color:#111827;">${currentGB.toFixed(1)} GB</p>
        <p style="margin:0 0 20px;font-size:13px;color:#6b7280;">${pct.toFixed(0)}% of your ${INCLUDED_GB} GB included plan${sinceLast ? ` · ${sinceLast}` : ""}</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;border-top:1px solid #f3f4f6;">
          ${row("Photos", photos)}
          ${row("Videos", videos)}
          ${row("Documents", documents)}
          ${row("Broker logos", logos)}
        </table>
        ${projection ? `<p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">${projection}</p>` : `<p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">Growth trend will appear once there are a couple more readings.</p>`}
      </div>
      <div style="padding:20px 40px;border-top:1px solid #f3f4f6;">
        <p style="margin:0;font-size:11px;color:#d1d5db;">Automated twice-weekly storage report · &copy; ${new Date().getFullYear()} YachtPics</p>
      </div>
    </div>
  </body></html>`;

  let emailed = false;
  let emailError: string | null = null;
  if (process.env.RESEND_API_KEY) {
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
          subject: `Portal storage: ${currentGB.toFixed(1)} GB / ${INCLUDED_GB} GB${level === "urgent" ? " — URGENT" : level === "warn" ? " — heads up" : ""}`,
          html,
        }),
      });
      const data = await res.json();
      emailed = res.ok;
      if (!res.ok) emailError = data.message ?? "Resend error";
    } catch (e) {
      emailError = e instanceof Error ? e.message : String(e);
    }
  } else {
    emailError = "RESEND_API_KEY not set";
  }

  return NextResponse.json({
    ok: true,
    totalGB: Number(currentGB.toFixed(2)),
    pct: Number(pct.toFixed(1)),
    level,
    ratePerWeekGB: Number(ratePerWeek.toFixed(2)),
    emailed,
    emailError,
  });
}
