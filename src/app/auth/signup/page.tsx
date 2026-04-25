"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const [form, setForm] = useState({
    firstName: "", lastName: "", brokerage: "", email: "", password: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient();

    const { error: signUpError } = await supabase.auth.signUp({
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

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#050b14] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="text-[#d4a843] text-5xl mb-4">✓</div>
          <h2 className="text-white text-2xl font-semibold mb-3">Check your email</h2>
          <p className="text-gray-400 text-sm leading-relaxed">
            We sent a confirmation link to <span className="text-white">{form.email}</span>.
            Click it to activate your account, then sign in.
          </p>
          <Link
            href="/auth/login"
            className="inline-block mt-6 bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] font-semibold px-6 py-2.5 rounded-lg transition-colors text-sm"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  const inputClass = "w-full bg-[#0f2035] border border-[#1e3a5f] text-white placeholder-gray-500 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4a843] transition-colors";

  return (
    <div className="min-h-screen bg-[#050b14] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="text-white text-2xl font-semibold tracking-wide">
            YachtPics<span className="text-[#d4a843]"> Portal</span>
          </Link>
          <p className="text-gray-400 mt-2 text-sm">Create your broker account</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[#0a1628] rounded-xl p-8 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-1.5">First Name</label>
              <input
                type="text"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                required
                className={inputClass}
                placeholder="Jane"
              />
            </div>
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-1.5">Last Name</label>
              <input
                type="text"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                required
                className={inputClass}
                placeholder="Smith"
              />
            </div>
          </div>

          <div>
            <label className="block text-gray-300 text-sm font-medium mb-1.5">Brokerage</label>
            <input
              type="text"
              value={form.brokerage}
              onChange={(e) => setForm({ ...form, brokerage: e.target.value })}
              required
              className={inputClass}
              placeholder="HMY Yacht Sales"
            />
          </div>

          <div>
            <label className="block text-gray-300 text-sm font-medium mb-1.5">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              className={inputClass}
              placeholder="you@brokerage.com"
            />
          </div>

          <div>
            <label className="block text-gray-300 text-sm font-medium mb-1.5">Password</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              minLength={8}
              className={inputClass}
              placeholder="Min. 8 characters"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] font-semibold py-2.5 rounded-lg transition-colors text-sm mt-2"
          >
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <p className="text-center text-gray-500 text-sm mt-6">
          Already have an account?{" "}
          <Link href="/auth/login" className="text-[#d4a843] hover:text-[#c49a35] transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
