"use client";

import { useState } from "react";

export default function ResendInviteButton({ assistantId }: { assistantId: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleResend() {
    setStatus("loading");
    setMessage(null);
    try {
      const res = await fetch("/api/admin/resend-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brokerId: assistantId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? "Failed to send invite.");
        return;
      }
      setStatus("sent");
      setMessage(data.message ?? "Email sent.");
      setTimeout(() => {
        setStatus("idle");
        setMessage(null);
      }, 4000);
    } catch {
      setStatus("error");
      setMessage("Unexpected error. Please try again.");
    }
  }

  if (status === "sent") {
    return (
      <span className="text-xs text-success-600 font-medium">✓ {message}</span>
    );
  }

  if (status === "error") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-danger-600">{message}</span>
        <button
          onClick={() => { setStatus("idle"); setMessage(null); }}
          className="text-xs text-ink-400 hover:text-ink-600"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleResend}
      disabled={status === "loading"}
      className="text-xs text-accent-700 hover:text-accent-800 transition-colors duration-fast ease-quiet disabled:opacity-50"
    >
      {status === "loading" ? "Sending…" : "Resend invite"}
    </button>
  );
}
