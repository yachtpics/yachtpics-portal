"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui";
import LinkExpiredPanel from "@/components/auth/LinkExpiredPanel";
import { safeNextPath } from "@/lib/safeNext";

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
  // Where the sign-in link was meant to take them (validated, same-site only).
  const [next, setNext] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setTokenHash(params.get("token_hash"));
    const t = params.get("type");
    if (t === "recovery" || t === "email" || t === "magiclink") setTokenType(t);
    setNext(safeNextPath(params.get("next")));
    // A missing token means the link is malformed or was already stripped.
    if (!params.get("token_hash")) setExpired(true);
  }, []);

  // Older magic-link emails (before Nov 11, 2026) land here; new ones open
  // /auth/continue. The token is consumed only here, on an explicit click — not on page load —
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
    // Credit a recent campaign email with this sign-in (fire-and-forget;
    // keepalive lets it finish while the page navigates).
    void fetch("/api/e/signin", { method: "POST", keepalive: true }).catch(() => {});
    window.location.assign(next ?? destination);
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
            <LinkExpiredPanel next={next} />
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

          {!expired && <a
            href="/auth/login"
            className="mt-6 block text-center text-sm text-accent-300 hover:text-accent-200 hover:underline transition-colors duration-fast"
          >
            Back to sign in
          </a>}
        </div>
      </div>
    </div>
  );
}
