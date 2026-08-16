"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Input, Label } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    // Use implicit flow so the reset link works on any device/browser —
    // PKCE requires the code verifier to be on the same browser session.
    const { createBrowserClient } = await import("@supabase/ssr");
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { flowType: "implicit" } }
    );
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setSent(true);
    }
  };

  return (
    <div className="relative min-h-screen bg-ink-950 flex items-center justify-center px-4 py-16 overflow-hidden">
      {/* Ambient composition — a faint champagne glow and structural hairlines */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-48 left-1/2 h-96 w-[52rem] -translate-x-1/2 rounded-full bg-accent-500/[0.06] blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-hairline-inverse-soft" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-hairline-inverse-soft" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Wordmark lockup — thin, wide-tracked, hairline rule, small caps */}
        <div className="text-center mb-10">
          <Link
            href="/"
            className="inline-block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 rounded-sm"
          >
            <span className="block text-white text-[1.625rem] font-light uppercase tracking-caps-wide [text-indent:0.24em] leading-none">
              YachtPics
            </span>
            <span className="mx-auto mt-4 block h-px w-28 bg-white/25" />
            <span className="mt-4 block text-[0.6875rem] font-medium uppercase tracking-caps-wide [text-indent:0.24em] text-accent-300/90">
              Portal
            </span>
          </Link>
          <p className="text-ink-400 mt-6 text-sm">Reset your password</p>
        </div>

        <div className="bg-white/[0.03] border border-hairline-inverse rounded-surface p-8 backdrop-blur-sm">
          {sent ? (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-accent-500/10 border border-accent-500/30 flex items-center justify-center mx-auto mb-4">
                <span className="text-accent-300 text-xl">✓</span>
              </div>
              <h2 className="text-white text-h2 mb-2">Check your email</h2>
              <p className="text-ink-400 text-sm leading-relaxed mb-6">
                We sent a reset link to <span className="text-white">{email}</span>. It expires in 24 hours.
              </p>
              <Link
                href="/auth/login"
                className="text-accent-300 hover:text-accent-200 text-sm transition-colors duration-fast inline-flex items-center min-h-[44px]"
              >
                ← Back to login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <p className="text-ink-400 text-sm leading-relaxed">
                Enter your email and we&apos;ll send you a link to reset your password.
              </p>
              {error && (
                <div className="bg-danger-500/10 border border-danger-500/30 text-danger-300 text-sm px-4 py-3 rounded-ctl">
                  {error}
                </div>
              )}
              <div>
                <Label tone="dark" className="mb-2">Email</Label>
                <Input
                  tone="dark"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  placeholder="you@brokerage.com"
                />
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full focus-visible:ring-offset-ink-950"
              >
                {loading ? "Sending..." : "Send Reset Link"}
              </Button>
              <p className="text-center">
                <Link href="/auth/login" className="text-ink-500 hover:text-ink-300 text-sm transition-colors duration-fast inline-flex items-center min-h-[44px]">
                  ← Back to login
                </Link>
              </p>
            </form>
          )}
        </div>

        <p className="mt-12 text-center text-[0.625rem] font-medium uppercase tracking-caps-wide [text-indent:0.24em] text-white/25">
          Yacht Photography
        </p>
      </div>
    </div>
  );
}
