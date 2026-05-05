"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function InviteAssistantPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/assistants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, firstName, lastName }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        setLoading(false);
        return;
      }

      // Redirect to the assistant's detail page
      router.push(`/admin/assistants/${data.assistantId}`);
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="px-6 py-8 max-w-xl mx-auto">
      <div className="mb-8">
        <Link href="/admin/assistants" className="text-gray-400 hover:text-gray-600 text-sm transition-colors">
          ← Back to Assistants
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-4">Invite an Assistant</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Send an invite email and set up their account. You can link them to brokers after.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">First name</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Jane"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#d4a843]/40 focus:border-[#d4a843]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Last name</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Smith"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#d4a843]/40 focus:border-[#d4a843]"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Email address <span className="text-red-400">*</span></label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@brokerage.com"
            required
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#d4a843]/40 focus:border-[#d4a843]"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">{error}</p>
        )}

        <div className="pt-1 flex gap-3">
          <button
            type="submit"
            disabled={loading || !email}
            className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
          >
            {loading ? "Sending invite…" : "Send Invite"}
          </button>
          <Link
            href="/admin/assistants"
            className="text-gray-500 hover:text-gray-700 text-sm font-medium px-4 py-2.5 transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>

      <p className="text-xs text-gray-400 mt-4">
        If this email is already registered, they&apos;ll be linked as an assistant without receiving another invite email.
      </p>
    </div>
  );
}
