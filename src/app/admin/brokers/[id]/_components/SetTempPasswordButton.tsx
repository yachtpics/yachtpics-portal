"use client";

import { useState } from "react";

const DEFAULT_TEMP_PASSWORD = process.env.NEXT_PUBLIC_DEFAULT_TEMP_PASSWORD ?? "";

export default function SetTempPasswordButton({ brokerId }: { brokerId: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState(DEFAULT_TEMP_PASSWORD);
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleOpen() {
    setPassword(DEFAULT_TEMP_PASSWORD);
    setStatus("idle");
    setError(null);
    setOpen(true);
  }

  async function handleSet() {
    if (!password.trim()) return;
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/admin/set-temp-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brokerId, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setError(data.error ?? "Failed to set password.");
        return;
      }
      setStatus("done");
    } catch {
      setStatus("error");
      setError("Unexpected error. Please try again.");
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (!open) {
    return (
      <button
        onClick={handleOpen}
        className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
      >
        Set temp password
      </button>
    );
  }

  if (status === "done") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-green-600 font-medium">✓ Password updated</p>
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
          <span className="text-sm font-mono text-gray-800 flex-1">{password}</span>
          <button
            onClick={handleCopy}
            className="text-xs text-[#c49a35] hover:text-[#b08c2a] font-medium transition-colors"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <p className="text-xs text-gray-400">Tell them to log in and change it from their profile.</p>
        <button
          onClick={() => { setOpen(false); setStatus("idle"); }}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors self-start"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-gray-700">Set temporary password</p>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Temp password"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 pr-14 focus:outline-none focus:ring-2 focus:ring-[#d4a843] focus:border-transparent"
            onKeyDown={(e) => e.key === "Enter" && handleSet()}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSet}
          disabled={status === "loading" || !password.trim()}
          className="text-xs font-semibold bg-gray-800 hover:bg-gray-900 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors"
        >
          {status === "loading" ? "Setting…" : "Set password"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
