import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-recipient results for one email type (Oct 29) — SERVER ONLY.
 * Rows come from email_log (status sent); opens, clicks and sign-ins from
 * email_events. "Opened" counts a click too (you can't click without opening),
 * so blocked images don't hide someone who clicked.
 */

export type EmailReportRow = {
  logId: string;
  recipientId: string | null;
  name: string;
  email: string;
  sentAt: string;
  firstOpenAt: string | null;
  opened: boolean;
  clicks: number;
  firstClickAt: string | null;
  signedInAt: string | null;
};

export type EmailReport = {
  type: string;
  rows: EmailReportRow[];
  totals: { sent: number; opened: number; clicked: number; signedIn: number };
};

export async function emailCampaignReport(svc: SupabaseClient, type: string): Promise<EmailReport> {
  const logs: { id: string; recipient_id: string | null; recipient_email: string; sent_at: string }[] = [];
  for (let from = 0; from < 10000; from += 1000) {
    const { data } = await svc
      .from("email_log")
      .select("id, recipient_id, recipient_email, sent_at")
      .eq("email_type", type)
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .range(from, from + 999);
    logs.push(...((data ?? []) as typeof logs));
    if (!data || data.length < 1000) break;
  }

  const events: { email_log_id: string; kind: string; created_at: string }[] = [];
  const ids = logs.map((l) => l.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await svc
      .from("email_events")
      .select("email_log_id, kind, created_at")
      .in("email_log_id", ids.slice(i, i + 200))
      .order("created_at", { ascending: true })
      .limit(10000);
    events.push(...((data ?? []) as typeof events));
  }

  const names = new Map<string, string>();
  const rids = Array.from(new Set(logs.map((l) => l.recipient_id).filter(Boolean) as string[]));
  for (let i = 0; i < rids.length; i += 200) {
    const { data } = await svc.from("profiles").select("id, first_name, last_name").in("id", rids.slice(i, i + 200));
    (data ?? []).forEach((p) => names.set(p.id as string, [p.first_name, p.last_name].filter(Boolean).join(" ")));
  }

  const byLog = new Map<string, { open: string | null; clicks: number; click: string | null; signin: string | null }>();
  for (const e of events) {
    const s = byLog.get(e.email_log_id) ?? { open: null, clicks: 0, click: null, signin: null };
    if (e.kind === "open") s.open = s.open ?? e.created_at;
    else if (e.kind === "click") { s.clicks++; s.click = s.click ?? e.created_at; }
    else if (e.kind === "signin") s.signin = s.signin ?? e.created_at;
    byLog.set(e.email_log_id, s);
  }

  const rows: EmailReportRow[] = logs.map((l) => {
    const s = byLog.get(l.id);
    return {
      logId: l.id,
      recipientId: l.recipient_id,
      name: (l.recipient_id && names.get(l.recipient_id)) || l.recipient_email,
      email: l.recipient_email,
      sentAt: l.sent_at,
      firstOpenAt: s?.open ?? null,
      opened: !!(s?.open || s?.clicks),
      clicks: s?.clicks ?? 0,
      firstClickAt: s?.click ?? null,
      signedInAt: s?.signin ?? null,
    };
  });
  // Most engaged first.
  const score = (r: EmailReportRow) => (r.signedInAt ? 4 : 0) + (r.clicks ? 2 : 0) + (r.opened ? 1 : 0);
  rows.sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));

  return {
    type,
    rows,
    totals: {
      sent: rows.length,
      opened: rows.filter((r) => r.opened).length,
      clicked: rows.filter((r) => r.clicks > 0).length,
      signedIn: rows.filter((r) => r.signedInAt).length,
    },
  };
}

/** Email types that have tracked sends (for the report picker), newest first. */
export async function trackedEmailTypes(svc: SupabaseClient): Promise<{ type: string; count: number; lastSentAt: string }[]> {
  const { data } = await svc
    .from("email_log")
    .select("email_type, sent_at")
    .eq("status", "sent")
    .or("metadata->>tracked.eq.true,email_type.eq.slideshow_ready_2026_10")
    .order("sent_at", { ascending: false })
    .limit(5000);
  const m = new Map<string, { type: string; count: number; lastSentAt: string }>();
  for (const r of data ?? []) {
    const t = r.email_type as string;
    const e = m.get(t) ?? { type: t, count: 0, lastSentAt: r.sent_at as string };
    e.count++;
    m.set(t, e);
  }
  return Array.from(m.values());
}
