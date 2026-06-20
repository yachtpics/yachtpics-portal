"use client";

import { useState } from "react";

export default function UnsubscribeClient({
  token,
  email,
  initialOptedOut,
}: {
  token: string;
  email: string | null;
  initialOptedOut: boolean;
}) {
  const [optedOut, setOptedOut] = useState(initialOptedOut);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function update(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/unsubscribe?token=${encodeURIComponent(token)}${next ? "" : "&action=resubscribe"}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      setOptedOut(next);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8f9fa", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <div style={{ maxWidth: 460, width: "100%", background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
        <div style={{ background: "#050b14", padding: "28px 40px" }}>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "#fff", letterSpacing: "0.5px" }}>YachtPics <span style={{ color: "#d4a843" }}>Portal</span></p>
        </div>
        <div style={{ padding: 40 }}>
          {optedOut ? (
            <>
              <h1 style={{ margin: "0 0 12px", fontSize: 20, fontWeight: 700, color: "#111827" }}>You&rsquo;re unsubscribed</h1>
              <p style={{ margin: "0 0 24px", fontSize: 14, color: "#6b7280", lineHeight: 1.6 }}>
                {email ? <>We won&rsquo;t send product news or trial reminders to <strong style={{ color: "#111827" }}>{email}</strong>.</> : "We won't send you product news or trial reminders."} You&rsquo;ll still receive essential account emails — things like client delivery confirmations and password resets.
              </p>
              <button onClick={() => update(false)} disabled={busy}
                style={{ background: "#d4a843", color: "#050b14", border: "none", fontSize: 14, fontWeight: 600, padding: "12px 24px", borderRadius: 8, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
                {busy ? "Working…" : "Resubscribe"}
              </button>
            </>
          ) : (
            <>
              <h1 style={{ margin: "0 0 12px", fontSize: 20, fontWeight: 700, color: "#111827" }}>Unsubscribe from updates</h1>
              <p style={{ margin: "0 0 24px", fontSize: 14, color: "#6b7280", lineHeight: 1.6 }}>
                {email ? <>This stops product news and trial reminders to <strong style={{ color: "#111827" }}>{email}</strong>.</> : "This stops product news and trial reminders."} You&rsquo;ll still get essential account emails.
              </p>
              <button onClick={() => update(true)} disabled={busy}
                style={{ background: "#050b14", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, padding: "12px 24px", borderRadius: 8, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
                {busy ? "Working…" : "Unsubscribe"}
              </button>
            </>
          )}
          {error && <p style={{ margin: "16px 0 0", fontSize: 13, color: "#dc2626" }}>{error}</p>}
        </div>
      </div>
    </div>
  );
}
