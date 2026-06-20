import { createClient } from "@supabase/supabase-js";
import UnsubscribeClient from "./UnsubscribeClient";

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({ searchParams }: { searchParams: { token?: string } }) {
  const token = searchParams.token ?? "";

  let email: string | null = null;
  let optedOut = false;
  let valid = false;

  if (token) {
    const service = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data } = await service
      .from("profiles")
      .select("display_email, email_opt_out")
      .eq("unsubscribe_token", token)
      .maybeSingle();
    if (data) {
      valid = true;
      email = data.display_email ?? null;
      optedOut = data.email_opt_out === true;
    }
  }

  if (!valid) {
    return (
      <div style={{ minHeight: "100vh", background: "#f8f9fa", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
        <div style={{ maxWidth: 460, width: "100%", background: "#fff", borderRadius: 12, padding: 40, textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700, color: "#111827" }}>Link not recognized</h1>
          <p style={{ margin: 0, fontSize: 14, color: "#6b7280", lineHeight: 1.6 }}>This unsubscribe link is invalid or has expired. To change your email preferences, sign in and visit your profile, or reply to any email and we&rsquo;ll take care of it.</p>
        </div>
      </div>
    );
  }

  return <UnsubscribeClient token={token} email={email} initialOptedOut={optedOut} />;
}
