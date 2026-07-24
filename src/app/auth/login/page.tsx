"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Label } from "@/components/ui";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // "password" is the classic email + password (temp password still works).
  // "magic" sends a one-click sign-in link — the zero-typing path for anyone
  // who can't get the password to take.
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [magicSent, setMagicSent] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      // Brokers/assistants land straight on their Listings — login + one click to
      // a boat's photos, which is what they're almost always here for. Admins go
      // to the admin panel.
      const userId = authData.user?.id;
      let destination = "/dashboard/listings";
      if (userId) {
        const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).single();
        if (profile?.role === "admin") destination = "/admin";
      }
      // Hard navigation (not router.push) so the destination renders fresh
      // from the server with the new session — avoids Next's client-side
      // router cache serving stale pages (e.g. a gallery added since the last
      // session wouldn't appear until a manual refresh).
      window.location.assign(destination);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    // Always succeeds from the user's view — the API never reveals whether an
    // account exists, and delivery is fire-and-forget through Resend.
    await fetch("/api/auth/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setLoading(false);
    setMagicSent(true);
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
          <p className="text-ink-400 mt-6 text-sm">Sign in to your account</p>
        </div>

        {magicSent ? (
          <div className="bg-white/[0.03] border border-hairline-inverse rounded-surface p-8 backdrop-blur-sm text-center">
            <p className="text-accent-300 text-3xl font-light mb-3">✓</p>
            <h1 className="text-h2 text-white mb-2">Check your email</h1>
            <p className="text-sm text-ink-400 leading-relaxed">
              If an account exists for <span className="text-white">{email}</span>, we just sent a
              sign-in link. Open it and press the button — no password needed.
            </p>
            <button
              type="button"
              onClick={() => { setMagicSent(false); setMode("password"); }}
              className="mt-6 text-sm text-accent-300 hover:text-accent-200 hover:underline transition-colors duration-fast"
            >
              Back to sign in
            </button>
          </div>
        ) : mode === "magic" ? (
          <form
            onSubmit={handleMagicLink}
            className="bg-white/[0.03] border border-hairline-inverse rounded-surface p-8 space-y-5 backdrop-blur-sm"
          >
            {error && (
              <div className="bg-danger-500/10 border border-danger-500/30 text-danger-300 text-sm px-4 py-3 rounded-ctl">
                {error}
              </div>
            )}
            <p className="text-sm text-ink-400 leading-relaxed">
              Enter your email and we&apos;ll send a link that signs you in with one click — no
              password to remember.
            </p>
            <div>
              <Label tone="dark" className="mb-2">Email</Label>
              <Input
                tone="dark"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@brokerage.com"
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full focus-visible:ring-offset-ink-950"
            >
              {loading ? "Sending..." : "Email me a sign-in link"}
            </Button>
            <button
              type="button"
              onClick={() => { setMode("password"); setError(""); }}
              className="w-full text-center text-sm text-accent-300 hover:text-accent-200 transition-colors duration-fast"
            >
              Sign in with a password instead
            </button>
          </form>
        ) : (
          <form
            onSubmit={handleLogin}
            className="bg-white/[0.03] border border-hairline-inverse rounded-surface p-8 space-y-5 backdrop-blur-sm"
          >
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
                placeholder="you@brokerage.com"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label tone="dark">Password</Label>
                <Link
                  href="/auth/forgot-password"
                  className="text-xs text-accent-300 hover:text-accent-200 transition-colors duration-fast"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                tone="dark"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full focus-visible:ring-offset-ink-950"
            >
              {loading ? "Signing in..." : "Sign In"}
            </Button>
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-hairline-inverse-soft" />
              <span className="text-[0.6875rem] font-medium uppercase tracking-caps-wide text-ink-500">or</span>
              <span className="h-px flex-1 bg-hairline-inverse-soft" />
            </div>
            <button
              type="button"
              onClick={() => { setMode("magic"); setError(""); }}
              className="w-full text-center text-sm text-accent-300 hover:text-accent-200 transition-colors duration-fast"
            >
              Email me a sign-in link instead
            </button>
          </form>
        )}

        <p className="text-center text-ink-500 text-sm mt-8">
          Need access?{" "}
          <Link href="/auth/signup" className="text-accent-300 hover:text-accent-200 transition-colors duration-fast">
            Request an account
          </Link>
        </p>

        <p className="mt-12 text-center text-[0.625rem] font-medium uppercase tracking-caps-wide [text-indent:0.24em] text-white/25">
          Yacht Photography
        </p>
      </div>
    </div>
  );
}
