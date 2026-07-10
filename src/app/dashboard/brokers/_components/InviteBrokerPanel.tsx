"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@/components/ui";

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
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-ink-900 mb-1">Invite a New Broker</h3>
            <p className="text-xs text-ink-500">
              Set up a portal account for a broker who isn&apos;t in the system yet. They&apos;ll receive an email to create their password.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setOpen((v) => !v); setError(null); setSuccess(false); }}
            className="ml-4 shrink-0 text-xs font-semibold text-accent-700 hover:text-accent-600 transition-colors duration-fast py-2"
          >
            {open ? "Cancel" : "Invite broker"}
          </button>
        </div>

        {open && (
          <form onSubmit={handleInvite} className="mt-5 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1">First name <span className="text-danger-600">*</span></Label>
                <Input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  placeholder="Jane"
                />
              </div>
              <div>
                <Label className="mb-1">Last name <span className="text-danger-600">*</span></Label>
                <Input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  placeholder="Smith"
                />
              </div>
            </div>

            <div>
              <Label className="mb-1">Email address <span className="text-danger-600">*</span></Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="jane@brokerage.com"
              />
            </div>

            <div>
              <Label className="mb-1">Brokerage <span className="text-ink-400">(optional)</span></Label>
              <Input
                type="text"
                value={brokerage}
                onChange={(e) => setBrokerage(e.target.value)}
                placeholder="Ocean Blue Yachts"
              />
            </div>

            {error && (
              <p className="text-sm text-danger-600 bg-danger-50 border border-danger-200 rounded-card px-4 py-3">
                {error}
              </p>
            )}

            {success && (
              <p className="text-sm text-success-700 bg-success-50 border border-success-200 rounded-card px-4 py-3">
                Invite sent. You&apos;re now linked to their account.
              </p>
            )}

            <div className="flex justify-end pt-1">
              <Button type="submit" disabled={sending || success} className="px-5">
                {sending ? "Sending invite…" : "Send Invite"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
