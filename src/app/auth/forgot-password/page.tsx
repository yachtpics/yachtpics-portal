"use client";

import { useState } from "react";
import Link from "next/link";
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
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

  const inputClass =
    "w-full bg-[#0f2035] border border-[#1e3a5f] text-white placeholder-gray-500 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4a843] transition-colors";

  return (
    <div className="min-h-screen bg-[#050b14] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="text-white text-2xl font-semibold tracking-wide">
            YachtPics<span className="text-[#d4a843]"> Portal</span>
          </Link>
          <p className="text-gray-400 mt-2 text-sm">Reset your password</p>
        </div>

        <div className="bg-[#0a1628] rounded-xl p-8">
          {sent ? (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-[#d4a843]/10 border border-[#d4a843]/30 flex items-center justify-center mx-auto mb-4">
                <span className="text-[#d4a843] text-xl">✓</span>
              </div>
              <h2 className="text-white font-semibold text-lg mb-2">Check your email</h2>
              <p className="text-gray-400 text-sm leading-relaxed mb-6">
                We sent a reset link to <span className="text-white">{email}</span>. It expires in 24 hours.
              </p>
              <Link
                href="/auth/login"
                className="text-[#d4a843] hover:text-[#c49a35] text-sm transition-colors"
              >
                ← Back to login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <p className="text-gray-400 text-sm leading-relaxed">
                Enter your email and we&apos;ll send you a link to reset your password.
              </p>
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-lg">
                  {error}
                </div>
              )}
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  className={inputClass}
                  placeholder="you@brokerage.com"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] font-semibold py-2.5 rounded-lg transition-colors text-sm"
              >
                {loading ? "Sending..." : "Send Reset Link"}
              </button>
              <p className="text-center">
                <Link href="/auth/login" className="text-gray-500 hover:text-gray-400 text-sm transition-colors">
                  ← Back to login
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
