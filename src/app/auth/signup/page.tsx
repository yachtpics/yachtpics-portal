"use client";

import { useState } from "react";
import Link from "next/link";

export default function SignupPage() {
  const [form, setForm] = useState({ name: "", email: "", brokerage: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => { setLoading(false); setSubmitted(true); }, 1000);
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#050b14] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="text-[#d4a843] text-5xl mb-4">✓</div>
          <h2 className="text-white text-2xl font-semibold mb-3">Request received</h2>
          <p className="text-gray-400 text-sm">
            We will review your request and be in touch within 24 hours to set up your account.
          </p>
          <Link href="/" className="inline-block mt-6 text-[#d4a843] hover:text-[#c49a35] text-sm transition-colors">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050b14] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="text-white text-2xl font-semibold tracking-wide">
            YachtPics<span className="text-[#d4a843]"> Portal</span>
          </Link>
          <p className="text-gray-400 mt-2 text-sm">Request broker access</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[#0a1628] rounded-xl p-8 space-y-5">
          {[
            { label: "Full Name", key: "name", type: "text", placeholder: "John Smith" },
            { label: "Brokerage", key: "brokerage", type: "text", placeholder: "HMY Yacht Sales" },
            { label: "Email", key: "email", type: "email", placeholder: "you@brokerage.com" },
            { label: "Password", key: "password", type: "password", placeholder: "Min. 8 characters" },
          ].map((field) => (
            <div key={field.key}>
              <label className="block text-gray-300 text-sm font-medium mb-1.5">{field.label}</label>
              <input
                type={field.type}
                value={form[field.key as keyof typeof form]}
                onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                required
                className="w-full bg-[#0f2035] border border-[#1e3a5f] text-white placeholder-gray-500 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4a843] transition-colors"
                placeholder={field.placeholder}
              />
            </div>
          ))}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] font-semibold py-2.5 rounded-lg transition-colors text-sm"
          >
            {loading ? "Submitting..." : "Request Access"}
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
