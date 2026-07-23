"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@/components/ui";

/** The login page's wordmark lockup — thin, wide-tracked, hairline rule, small caps. */
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

export default function ResetPasswordPage() {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [resendEmail, setResendEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [resendErr, setResendErr] = useState<string | null>(null);

  // From the expired-link screen: send a fresh reset link right here, so the
  // person never has to hunt for the forgot-password page. Common trigger is a
  // corporate mail scanner pre-opening (and burning) the one-time link.
  async function resendReset(e: React.FormEvent) {
    e.preventDefault();
    if (!resendEmail.trim() || resending) return;
    setResending(true);
    setResendErr(null);
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(resendEmail.trim(), {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    setResending(false);
    if (error) { setResendErr(error.message); return; }
    setResent(true);
  }

  useEffect(() => {
    // Defer client creation — createBrowserClient accesses browser APIs at construction time.
    import("@/lib/supabase/client").then(async ({ createClient }) => {
      const supabase = createClient();

      // If there's a ?code= in the URL, exchange it for a session here in the browser.
      // This keeps the code verifier in the same JS context where it was stored.
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      // PKCE flow: ?code= in URL
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
          window.history.replaceState({}, "", "/auth/reset-password");
          setReady(true);
        }
        setChecking(false);
        return;
      }

      // Implicit flow: tokens in URL hash (cross-device reset links)
      const hash = window.location.hash;
      if (hash.includes("access_token=")) {
        const hashParams = new URLSearchParams(hash.substring(1));
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token") ?? "";
        if (accessToken) {
          const { data: sessData, error: sessErr } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (!sessErr && sessData.session?.user) {
            window.history.replaceState({}, "", "/auth/reset-password");
            setReady(true);
          }
        }
        setChecking(false);
        return;
      }

      // No code or hash — check for existing session
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setReady(true);
      }
      setChecking(false);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);

    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    // Land where they'd want to be: brokers/assistants on their Listings,
    // admins on the admin panel.
    const { data: { user } } = await supabase.auth.getUser();
    let destination = "/dashboard/listings";
    if (user) {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      if (profile?.role === "admin") destination = "/admin";
    }
    router.push(destination);
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-ink-950 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!ready) {
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
            {resent ? (
              <>
                <p className="text-accent-300 text-3xl font-light text-center mb-3">✓</p>
                <h1 className="text-h2 text-white mb-2 text-center">Check your email</h1>
                <p className="text-sm text-ink-400 leading-relaxed text-center">
                  We sent a fresh reset link to <span className="text-white">{resendEmail}</span>.
                  Open it and set your password. If it still says expired, open the link on your
                  phone instead — some company email systems open (and use up) links automatically.
                </p>
              </>
            ) : (
              <>
                <div className="w-10 h-10 rounded-full bg-warn-300/10 border border-warn-300/30 flex items-center justify-center mx-auto mb-4">
                  <span className="text-warn-300 text-lg">!</span>
                </div>
                <h1 className="text-h2 text-white mb-2 text-center">Link expired</h1>
                <p className="text-sm text-ink-400 leading-relaxed mb-5 text-center">
                  This reset link was already used or has expired. Enter your email and we&apos;ll
                  send a fresh one — open it right away.
                </p>
                <form onSubmit={resendReset} className="space-y-3">
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
                  {resendErr && (
                    <div className="bg-danger-500/10 border border-danger-500/30 text-danger-300 text-sm px-4 py-3 rounded-ctl">
                      {resendErr}
                    </div>
                  )}
                  <Button type="submit" disabled={resending} className="w-full focus-visible:ring-offset-ink-950">
                    {resending ? "Sending…" : "Send me a new link"}
                  </Button>
                </form>
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

  return (
    <div className="relative min-h-screen bg-ink-950 flex items-center justify-center px-4 py-16 overflow-hidden">
      {/* Ambient composition — a faint champagne glow and structural hairlines */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-48 left-1/2 h-96 w-[52rem] -translate-x-1/2 rounded-full bg-accent-500/[0.06] blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-hairline-inverse-soft" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-hairline-inverse-soft" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-10">
          <WordmarkLockup />
          <p className="text-ink-400 mt-6 text-sm">Choose a new password</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white/[0.03] border border-hairline-inverse rounded-surface p-8 space-y-5 backdrop-blur-sm"
        >
          <div>
            <Label tone="dark" className="mb-2">New Password</Label>
            <Input
              tone="dark"
              type="password"
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
          <div>
            <Label tone="dark" className="mb-2">Confirm Password</Label>
            <Input
              tone="dark"
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat your password"
            />
          </div>
          {error && (
            <div className="bg-danger-500/10 border border-danger-500/30 text-danger-300 text-sm px-4 py-3 rounded-ctl">
              {error}
            </div>
          )}
          <Button
            type="submit"
            disabled={loading}
            className="w-full focus-visible:ring-offset-ink-950"
          >
            {loading ? "Updating..." : "Set New Password"}
          </Button>
        </form>

        <p className="mt-12 text-center text-[0.625rem] font-medium uppercase tracking-caps-wide [text-indent:0.24em] text-white/25">
          Yacht Photography
        </p>
      </div>
    </div>
  );
}
