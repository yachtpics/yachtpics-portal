"use client";

import { useState } from "react";

export default function ResendInviteButton({ brokerId }: { brokerId: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleResend() {
    setStatus("loading");
    setMessage(null);
    setTempPassword(null);
    try {
      const res = await fetch("/api/admin/resend-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brokerId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? "Failed to send.");
        return;
      }
      setStatus("sent");
      setTempPassword(data.tempPassword ?? null);
    } catch {
      setStatus("error");
      setMessage("Unexpected error. Please try again.");
    }
  }

  function handleCopy() {
    if (tempPassword) {
      navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleDismiss() {
    setStatus("idle");
    setTempPassword(null);
    setMessage(null);
    setCopied(false);
  }

  if (status === "sent" && tempPassword) {
    return (
      <div className="flex flex-col gap-1.5 py-1">
        <span className="text-xs text-green-600 font-medium">Done &mdash; new login details sent</span>
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <span className="text-xs text-gray-500">Temp password:</span>
          <span className="font-mono text-sm font-semibold text-gray-900">{tempPassword}</span>
          <button
            onClick={handleCopy}
            className="text-xs text-[#c49a35] hover:text-[#b08c2a] transition-colors ml-1"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <button onClick={handleDismiss} className="text-xs text-gray-400 hover:text-gray-600 text-left">
          Dismiss
        </button>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-red-500">{message}</span>
        <button onClick={handleDismiss} className="text-xs text-gray-400 hover:text-gray-600">
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleResend}
      disabled={status === "loading"}
      className="text-xs text-[#c49a35] hover:text-[#b08c2a] transition-colors disabled:opacity-50"
    >
      {status === "loading" ? "Sending..." : "Resend login details"}
    </button>
  );
}
