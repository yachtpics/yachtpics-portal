"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Label } from "@/components/ui";

/** The login page's wordmark lockup — thin, wide-tracked, hairline rule, small caps. */
function WordmarkLockup({ subtitle = "Portal" }: { subtitle?: string }) {
  return (
    <Link
      href="/"
      className="inline-block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 rounded-sm"
    >
      <span className="block text-white text-[1.625rem] font-light uppercase tracking-caps-wide [text-indent:0.24em] leading-none">
        YachtPics
      </span>
      <span className="mx-auto mt-4 block h-px w-28 bg-white/25" />
      <span className="mt-4 block text-[0.6875rem] font-medium uppercase tracking-caps-wide [text-indent:0.24em] text-accent-300/90">
        {subtitle}
      </span>
    </Link>
  );
}

export default function SignupPage() {
  const [form, setForm] = useState({
    firstName: "", lastName: "", brokerage: "", email: "", password: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [existingAccount, setExistingAccount] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient();

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: {
          role: "broker",
          first_name: form.firstName,
          last_name: form.lastName,
          brokerage_name: form.brokerage,
        },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // Supabase deliberately hides whether an email is already registered (to
    // stop attackers probing the user list): signing up with an existing,
    // confirmed email returns a fake "success" with an EMPTY identities array
    // and sends no email. Detect that and steer the person to sign in / reset,
    // instead of showing a "check your email" screen for a mail that never comes.
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      setExistingAccount(true);
      setLoading(false);
      return;
    }

    // Pre-populate profile with name and brokerage from signup form
    // (The trigger seeds the row; we update immediately after)
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("profiles").update({
        first_name: form.firstName,
        last_name: form.lastName,
        display_email: form.email,
      }).eq("id", user.id);

      await supabase.from("broker_details").update({
        brokerage_name: form.brokerage,
      }).eq("id", user.id);
    }

    setLoading(false);
    setSubmitted(true);
  };

  if (existingAccount) {
    return (
      <div className="relative min-h-screen bg-ink-950 flex items-center justify-center px-4 py-16 overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-48 left-1/2 h-96 w-[52rem] -translate-x-1/2 rounded-full bg-accent-500/[0.06] blur-3xl" />
          <div className="absolute inset-x-0 top-0 h-px bg-hairline-inverse-soft" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-hairline-inverse-soft" />
        </div>
        <div className="relative text-center max-w-sm">
          <WordmarkLockup />
          <h2 className="text-white text-h1 mt-10 mb-3">You already have an account</h2>
          <p className="text-ink-400 text-sm leading-relaxed">
            There&apos;s already a YachtPics account for <span className="text-white">{form.email}</span>.
            No need to sign up again &mdash; just sign in. If you don&apos;t remember your password,
            reset it and you&apos;ll be right in.
          </p>
          <div className="mt-8 flex flex-col gap-3">
            <Link
              href="/auth/login"
              className="inline-flex items-center justify-center bg-accent-500 hover:bg-accent-400 text-ink-950 font-semibold text-sm px-6 py-2.5 min-h-[44px] rounded-ctl transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
            >
              Go to sign in
            </Link>
            <Link
              href="/auth/forgot-password"
              className="inline-flex items-center justify-center text-accent-300 hover:text-accent-200 font-medium text-sm min-h-[44px] transition-colors duration-fast"
            >
              Forgot your password?
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="relative min-h-screen bg-ink-950 flex items-center justify-center px-4 py-16 overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-48 left-1/2 h-96 w-[52rem] -translate-x-1/2 rounded-full bg-accent-500/[0.06] blur-3xl" />
          <div className="absolute inset-x-0 top-0 h-px bg-hairline-inverse-soft" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-hairline-inverse-soft" />
        </div>
        <div className="relative text-center max-w-sm">
          <WordmarkLockup />
          <p className="text-accent-300 text-4xl font-light mt-10 mb-4">✓</p>
          <h2 className="text-white text-h1 mb-3">Check your email</h2>
          <p className="text-ink-400 text-sm leading-relaxed">
            We sent a confirmation link to <span className="text-white">{form.email}</span>.
            Click it to activate your account, then sign in.
          </p>
          <Link
            href="/auth/login"
            className="inline-flex items-center justify-center mt-8 bg-accent-500 hover:bg-accent-400 text-ink-950 font-semibold text-sm px-6 py-2.5 min-h-[44px] rounded-ctl transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
          >
            Go to sign in
          </Link>
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
          <p className="text-ink-400 mt-6 text-sm">Create your broker account</p>
          <p className="text-ink-500 mt-1.5 text-xs leading-relaxed">
            Signing up is for brokers. Assistants don&apos;t sign up here &mdash; your broker adds you to their team and you&apos;ll get an email to log in.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white/[0.03] border border-hairline-inverse rounded-surface p-8 space-y-5 backdrop-blur-sm"
        >
          {error && (
            <div className="bg-danger-500/10 border border-danger-500/30 text-danger-300 text-sm px-4 py-3 rounded-ctl">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label tone="dark" className="mb-2">First Name</Label>
              <Input
                tone="dark"
                type="text"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                required
                placeholder="Jane"
              />
            </div>
            <div>
              <Label tone="dark" className="mb-2">Last Name</Label>
              <Input
                tone="dark"
                type="text"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                required
                placeholder="Smith"
              />
            </div>
          </div>

          <div>
            <Label tone="dark" className="mb-2">Brokerage</Label>
            <Input
              tone="dark"
              type="text"
              value={form.brokerage}
              onChange={(e) => setForm({ ...form, brokerage: e.target.value })}
              required
            />
          </div>

          <div>
            <Label tone="dark" className="mb-2">Email</Label>
            <Input
              tone="dark"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              placeholder="you@brokerage.com"
            />
          </div>

          <div>
            <Label tone="dark" className="mb-2">Password</Label>
            <Input
              tone="dark"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              minLength={8}
              placeholder="Min. 8 characters"
            />
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full focus-visible:ring-offset-ink-950"
          >
            {loading ? "Creating account..." : "Create Account"}
          </Button>
        </form>

        <p className="text-center text-ink-500 text-sm mt-8">
          Already have an account?{" "}
          <Link href="/auth/login" className="text-accent-300 hover:text-accent-200 transition-colors duration-fast">
            Sign in
          </Link>
        </p>

        <p className="mt-12 text-center text-[0.625rem] font-medium uppercase tracking-caps-wide [text-indent:0.24em] text-white/25">
          Yacht Photography
        </p>
      </div>
    </div>
  );
}
