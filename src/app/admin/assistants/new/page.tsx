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
        <Link href="/admin/assistants" className="text-ink-400 hover:text-ink-600 text-sm transition-colors duration-fast ease-quiet">
          ← Back to Assistants
        </Link>
        <h1 className="text-display text-ink-900 mt-4">Invite an Assistant</h1>
        <p className="text-ink-500 mt-1 text-sm">
          Send an invite email and set up their account. You can link them to brokers after.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white border border-hairline rounded-card shadow-elev-1 p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block label-caps mb-1.5">First name</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Jane"
              className="w-full border border-hairline-strong rounded-ctl px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500"
            />
          </div>
          <div>
            <label className="block label-caps mb-1.5">Last name</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Smith"
              className="w-full border border-hairline-strong rounded-ctl px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500"
            />
          </div>
        </div>

        <div>
          <label className="block label-caps mb-1.5">Email address <span className="text-danger-500">*</span></label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@brokerage.com"
            required
            className="w-full border border-hairline-strong rounded-ctl px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500"
          />
        </div>

        {error && (
          <p className="text-sm text-danger-600 bg-danger-50 border border-danger-200 rounded-ctl px-4 py-3">{error}</p>
        )}

        <div className="pt-1 flex gap-3">
          <button
            type="submit"
            disabled={loading || !email}
            className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold px-5 py-2.5 rounded-ctl transition-colors duration-fast ease-quiet"
          >
            {loading ? "Sending invite…" : "Send Invite"}
          </button>
          <Link
            href="/admin/assistants"
            className="text-ink-500 hover:text-ink-700 text-sm font-medium px-4 py-2.5 transition-colors duration-fast ease-quiet"
          >
            Cancel
          </Link>
        </div>
      </form>

      <p className="text-xs text-ink-500 mt-4">
        If this email is already registered, they&apos;ll be linked as an assistant without receiving another invite email.
      </p>
    </div>
  );
}
