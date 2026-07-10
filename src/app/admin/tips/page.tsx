import { createClient as createServiceClient } from "@supabase/supabase-js";
import { TIPS, tipEmailType, tipApprovalKey, tipEmailHtml } from "@/lib/portalTips";
import TipsControls, { type TipRow } from "./TipsControls";

export const dynamic = "force-dynamic";

export default async function AdminTipsPage() {
  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const [{ data: profiles }, { data: logs }, { data: settings }] = await Promise.all([
    service.from("profiles").select("id, display_email").in("role", ["broker", "assistant"]).eq("email_opt_out", false),
    service.from("email_log").select("email_type").in("email_type", TIPS.map((t) => tipEmailType(t.slug))).eq("status", "sent"),
    service.from("app_settings").select("key, value").in("key", TIPS.map((t) => tipApprovalKey(t.slug))),
  ]);

  const recipients = (profiles ?? []).filter((p) => p.display_email).length;

  const sentByType = new Map<string, number>();
  for (const l of logs ?? []) sentByType.set(l.email_type as string, (sentByType.get(l.email_type as string) ?? 0) + 1);

  const approvedKeys = new Set((settings ?? []).filter((s) => s.value === true).map((s) => s.key));

  const rows: TipRow[] = TIPS.map((t) => ({
    slug: t.slug,
    subject: t.subject,
    headline: t.headline,
    approved: approvedKeys.has(tipApprovalKey(t.slug)),
    sentCount: sentByType.get(tipEmailType(t.slug)) ?? 0,
    previewHtml: tipEmailHtml(t, { firstName: "Charlie", unsubToken: "preview" }),
  }));

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-display text-ink-900">Tips &amp; Tricks</h1>
        <p className="text-ink-500 text-sm mt-1">A weekly series that walks brokers through the portal&rsquo;s features, one tip at a time.</p>
      </div>
      <TipsControls tips={rows} recipients={recipients} />
    </div>
  );
}
