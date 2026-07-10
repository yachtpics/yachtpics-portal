"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

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
    <div className="min-h-screen bg-ink-50 flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-[460px] bg-white rounded-surface border border-hairline shadow-elev-2 overflow-hidden">
        {/* Ink band with the wordmark treatment */}
        <div className="bg-ink-950 px-10 py-7">
          <p className="text-white text-base font-light uppercase tracking-caps-wide leading-none">
            YachtPics
          </p>
          <p className="mt-2 text-[0.625rem] font-medium uppercase tracking-caps-wide text-accent-300/90">
            Portal
          </p>
        </div>
        <div className="p-10">
          {optedOut ? (
            <>
              <h1 className="text-h1 text-ink-900 mb-3">You&rsquo;re unsubscribed</h1>
              <p className="text-sm text-ink-600 leading-relaxed mb-6">
                {email ? <>We won&rsquo;t send product news or trial reminders to <strong className="text-ink-900">{email}</strong>.</> : "We won't send you product news or trial reminders."} You&rsquo;ll still receive essential account emails — things like client delivery confirmations and password resets.
              </p>
              <Button onClick={() => update(false)} disabled={busy}>
                {busy ? "Working…" : "Resubscribe"}
              </Button>
            </>
          ) : (
            <>
              <h1 className="text-h1 text-ink-900 mb-3">Unsubscribe from updates</h1>
              <p className="text-sm text-ink-600 leading-relaxed mb-6">
                {email ? <>This stops product news and trial reminders to <strong className="text-ink-900">{email}</strong>.</> : "This stops product news and trial reminders."} You&rsquo;ll still get essential account emails.
              </p>
              <Button
                onClick={() => update(true)}
                disabled={busy}
                className="bg-ink-950 text-white hover:bg-ink-800"
              >
                {busy ? "Working…" : "Unsubscribe"}
              </Button>
            </>
          )}
          {error && <p className="mt-4 text-[13px] text-danger-600">{error}</p>}
        </div>
      </div>
    </div>
  );
}
