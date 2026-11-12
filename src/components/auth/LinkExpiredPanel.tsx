"use client";

import { useState } from "react";
import { Button, Input, Label } from "@/components/ui";
import { safeNextPath } from "@/lib/safeNext";

/**
 * The helpful dead end for a used-up or expired one-time sign-in link (Nov 11,
 * 2026). Used by /auth/continue, /auth/confirm (older magic-link emails) and
 * /auth/set-password (older invitation emails). "Email me a new link" calls
 * /api/auth/magic-link, which answers the same whether or not the account
 * exists, so this screen never reveals that either.
 */
export default function LinkExpiredPanel({ email, next }: { email?: string | null; next?: string | null }) {
  const [value, setValue] = useState(email ?? "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const safeNext = safeNextPath(next ?? null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || sending) return;
    setSending(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value.trim(), next: safeNext }),
      });
      if (res.status === 429) {
        setErr("Too many requests — wait a few minutes, then try again.");
      } else if (!res.ok) {
        setErr("That didn't go through. Check the email address and try again.");
      } else {
        setSent(true);
      }
    } catch {
      setErr("That didn't go through. Check your connection and try again.");
    }
    setSending(false);
  }

  if (sent) {
    return (
      <div className="text-center">
        <p className="text-accent-300 text-3xl font-light mb-3">✓</p>
        <h1 className="text-h2 text-white mb-2">Check your email</h1>
        <p className="text-sm text-ink-400 leading-relaxed">
          If there&apos;s a YachtPics Portal account for <span className="text-white">{value.trim()}</span>, a new
          sign-in link is on its way. Open it and press Continue.
        </p>
        <a
          href="/auth/login"
          className="mt-6 inline-block text-sm text-accent-300 hover:text-accent-200 hover:underline transition-colors duration-fast"
        >
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <div>
      <div className="w-10 h-10 rounded-full bg-warn-300/10 border border-warn-300/30 flex items-center justify-center mx-auto mb-4">
        <span className="text-warn-300 text-lg">!</span>
      </div>
      <h1 className="text-h2 text-white mb-2 text-center">
        This sign-in link has already been used or has expired.
      </h1>
      <p className="text-sm text-ink-400 leading-relaxed mb-5 text-center">
        We&apos;ll email you a new one — it only takes a moment.
      </p>
      <form onSubmit={send} className="space-y-3">
        <div>
          <Label tone="dark" className="mb-2">Email</Label>
          <Input
            tone="dark"
            type="email"
            required
            autoComplete="email"
            autoFocus={!email}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="you@brokerage.com"
          />
        </div>
        {err && (
          <div className="bg-danger-500/10 border border-danger-500/30 text-danger-300 text-sm px-4 py-3 rounded-ctl">{err}</div>
        )}
        <Button type="submit" disabled={sending} className="w-full min-h-[44px] focus-visible:ring-offset-ink-950">
          {sending ? "Sending…" : "Email me a new link"}
        </Button>
      </form>
      <a
        href={safeNext && !safeNext.startsWith("/auth/") ? `/auth/login?next=${encodeURIComponent(safeNext)}` : "/auth/login"}
        className="mt-6 block text-center text-sm text-accent-300 hover:text-accent-200 hover:underline transition-colors duration-fast"
      >
        or sign in with your password
      </a>
    </div>
  );
}
