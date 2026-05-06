"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function InviteBrokerPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [brokerage, setBrokerage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);

    try {
      const res = await fetch("/api/assistant/invite-broker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, brokerage }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
      } else {
        setSuccess(true);
        setFirstName("");
        setLastName("");
        setEmail("");
        setBrokerage("");
        setTimeout(() => {
          setSuccess(false);
          setOpen(false);
          router.refresh();
        }, 2500);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-4">
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Invite a New Broker</h3>
            <p className="text-xs text-gray-400">
              Set up a portal account for a broker who isn&apos;t in the system yet. They&apos;ll receive an email to create their password.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setOpen((v) => !v); setError(null); setSuccess(false); }}
            className="ml-4 shrink-0 text-xs font-semibold text-[#c49a35] hover:text-[#d4a843] transition-colors"
          >
            {open ? "Cancel" : "Invite broker"}
          </button>
        </div>

        {open && (
          <form onSubmit={handleInvite} className="mt-5 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">First name <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  placeholder="Jane"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#d4a843]/40 focus:border-[#d4a843] bg-white"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Last name <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  placeholder="Smith"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#d4a843]/40 focus:border-[#d4a843] bg-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Email address <span className="text-red-400">*</span></label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="jane@brokerage.com"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#d4a843]/40 focus:border-[#d4a843] bg-white"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Brokerage <span className="text-gray-400">(optional)</span></label>
              <input
                type="text"
                value={brokerage}
                onChange={(e) => setBrokerage(e.target.value)}
                placeholder="Ocean Blue Yachts"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#d4a843]/40 focus:border-[#d4a843] bg-white"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
                {error}
              </p>
            )}

            {success && (
              <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-4 py-3">
                Invite sent. You&apos;re now linked to their account.
              </p>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={sending || success}
                className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
              >
                {sending ? "Sending invite…" : "Send Invite"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
