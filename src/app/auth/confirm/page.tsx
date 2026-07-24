"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { Button, Input, Label } from "@/components/ui";

/** Login-page wordmark lockup — thin, wide-tracked, hairline rule, small caps. */
function WordmarkLockup() {
  return (
    <div>
      <p className="text-white text-[1.625rem] font-light uppercase tracking-caps-wide [text-indent:0.24em] leading-none">
        YachtPics
      </p>
      <span aria-hidden className="mx-auto mt-4 block h-px w-28 bg-white/25" />
      <p className="mt-4 text-[0.6875rem] font-medium uppercase tracking-caps-wide [text-indent:0.24em] text-accent-300/90">
        Portal
      </p>
    </div>
  );
}

export default function ConfirmSignInPage() {
  const [tokenHash, setTokenHash] = useState<string | null>(null);
  const [tokenType, setTokenType] = useState<"magiclink" | "recovery" | "email">("magiclink");
  const [signingIn, setSigningIn] = useState(false);
  const [expired, setExpired] = useState(false);

  // Inline resend from the expired screen.
  const [resendEmail, setResendEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setTokenHash(params.get("token_hash"));
    const t = params.get("type");
    if (t === "recovery" || t === "email" || t === "magiclink") setTokenType(t);
    // A missing token means the link is malformed or was already stripped.
    if (!params.get("token_hash")) setExpired(true);
  }, []);

  // The token is consumed only here, on an explicit click — not on page load —
  // so a mail scanner's silent pre-fetch can't burn the link before the user.
  async function handleSignIn() {
    if (!tokenHash || signingIn) return;
    setSigningIn(true);

    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();

    const { error } = await supabase.auth.verifyOtp({
      type: tokenType,
      token_hash: tokenHash,
    });

    if (error) {
      setExpired(true);
      setSigningIn(false);
      return;
    }

    // Route where they want to be: brokers/assistants on Listings, admins on
    // the admin panel. Hard navigation so the destination renders fresh with
    // the new session (avoids Next's client router cache).
    let destination = "/dashboard/listings";
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      if (profile?.role === "admin") destination = "/admin";
    }
    window.location.assign(destination);
  }

  async function resendLink(e: React.FormEvent) {
    e.preventDefault();
    if (!resendEmail.trim() || resending) return;
    setResending(true);
    await fetch("/api/auth/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: resendEmail.trim() }),
    });
    setResending(false);
    setResent(true);
  }

  return (
    <div className="relative min-h-screen bg-ink-950 flex items-center justify-center px-4 py-16 overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-48 left-1/2 h-96 w-[52rem] -translate-x-1/2 rounded-full bg-accent-500/[0.06] blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-hairline-inverse-soft" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-hairline-inverse-soft" />
      </div>

      <div className="relative w-full max-w-sm text-center">
        <div className="mb-10">
          <WordmarkLockup />
        </div>

        <div className="bg-white/[0.03] border border-hairline-inverse rounded-surface p-8 backdrop-blur-sm text-left">
          {expired ? (
            resent ? (
              <>
                <p className="text-accent-300 text-3xl font-light text-center mb-3">✓</p>
                <h1 className="text-h2 text-white mb-2 text-center">Check your email</h1>
                <p className="text-sm text-ink-400 leading-relaxed text-center">
                  We sent a fresh sign-in link to <span className="text-white">{resendEmail}</span>.
                  Open it and press the button to sign in.
                </p>
              </>
            ) : (
              <>
                <div className="w-10 h-10 rounded-full bg-warn-300/10 border border-warn-300/30 flex items-center justify-center mx-auto mb-4">
                  <span className="text-warn-300 text-lg">!</span>
                </div>
                <h1 className="text-h2 text-white mb-2 text-center">Link expired</h1>
                <p className="text-sm text-ink-400 leading-relaxed mb-5 text-center">
                  This sign-in link has expired or was already used. Enter your email and we&apos;ll
                  send a fresh one.
                </p>
                <form onSubmit={resendLink} className="space-y-3">
                  <div>
                    <Label tone="dark" className="mb-2">Email</Label>
                    <Input
                      tone="dark"
                      type="email"
                      required
                      autoFocus
                      value={resendEmail}
                      onChange={(e) => setResendEmail(e.target.value)}
                      placeholder="you@brokerage.com"
                    />
                  </div>
                  <Button type="submit" disabled={resending} className="w-full focus-visible:ring-offset-ink-950">
                    {resending ? "Sending…" : "Send me a new link"}
                  </Button>
                </form>
              </>
            )
          ) : (
            <>
              <h1 className="text-h2 text-white mb-2 text-center">Sign in to YachtPics</h1>
              <p className="text-sm text-ink-400 leading-relaxed mb-6 text-center">
                Press the button below to finish signing in. No password needed.
              </p>
              <Button
                type="button"
                onClick={handleSignIn}
                disabled={signingIn}
                className="w-full focus-visible:ring-offset-ink-950"
              >
                {signingIn ? "Signing in…" : "Sign In"}
              </Button>
            </>
          )}

          <a
            href="/auth/login"
            className="mt-6 block text-center text-sm text-accent-300 hover:text-accent-200 hover:underline transition-colors duration-fast"
          >
            Back to sign in
          </a>
        </div>
      </div>
    </div>
  );
}
