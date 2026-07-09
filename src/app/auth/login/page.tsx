"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Label } from "@/components/ui";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

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
      // Redirect admins directly to the admin panel
      const userId = authData.user?.id;
      let destination = "/dashboard";
      if (userId) {
        const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).single();
        if (profile?.role === "admin") destination = "/admin";
      }
      router.push(destination);
      router.refresh();
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
          <p className="text-ink-400 mt-6 text-sm">Sign in to your account</p>
        </div>

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
        </form>

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
