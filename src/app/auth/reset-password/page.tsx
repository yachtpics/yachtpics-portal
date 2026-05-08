"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ResetPasswordPage() {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Defer client creation — createBrowserClient accesses browser APIs at construction time.
    import("@/lib/supabase/client").then(async ({ createClient }) => {
      const supabase = createClient();

      // If there's a ?code= in the URL, exchange it for a session here in the browser.
      // This keeps the code verifier in the same JS context where it was stored.
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      // PKCE flow: ?code= in URL
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
          window.history.replaceState({}, "", "/auth/reset-password");
          setReady(true);
        }
        setChecking(false);
        return;
      }

      // Implicit flow: tokens in URL hash (cross-device reset links)
      const hash = window.location.hash;
      if (hash.includes("access_token=")) {
        const hashParams = new URLSearchParams(hash.substring(1));
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token") ?? "";
        if (accessToken) {
          const { data: sessData, error: sessErr } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (!sessErr && sessData.session?.user) {
            window.history.replaceState({}, "", "/auth/reset-password");
            setReady(true);
          }
        }
        setChecking(false);
        return;
      }

      // No code or hash — check for existing session
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setReady(true);
      }
      setChecking(false);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);

    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
  };

  const inputClass =
    "w-full bg-[#0f2035] border border-[#1e3a5f] text-white placeholder-gray-500 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4a843] transition-colors";

  if (checking) {
    return (
      <div className="min-h-screen bg-[#050b14] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[#d4a843] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-[#050b14] flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <p className="text-white text-xl font-semibold tracking-wide mb-8">
            YachtPics <span className="text-[#d4a843]">Portal</span>
          </p>
          <div className="bg-[#0a1628] rounded-xl p-8">
            <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto mb-4">
              <span className="text-amber-400 text-lg">!</span>
            </div>
            <h1 className="text-lg font-bold text-white mb-2">Link expired</h1>
            <p className="text-sm text-gray-400 leading-relaxed mb-6">
              This reset link has already been used or has expired.{" "}
              <a href="/auth/forgot-password" className="text-[#d4a843] hover:underline">
                Request a new one
              </a>
              .
            </p>
            <a
              href="/auth/login"
              className="block w-full bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] font-semibold text-sm py-2.5 rounded-lg transition-colors text-center"
            >
              Back to Login
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050b14] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <p className="text-white text-2xl font-semibold tracking-wide">
            YachtPics<span className="text-[#d4a843]"> Portal</span>
          </p>
          <p className="text-gray-400 mt-2 text-sm">Choose a new password</p>
        </div>

        <div className="bg-[#0a1628] rounded-xl p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-1.5">New Password</label>
              <input
                type="password"
                required
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-1.5">Confirm Password</label>
              <input
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat your password"
                className={inputClass}
              />
            </div>
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-lg">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] font-semibold py-2.5 rounded-lg transition-colors text-sm"
            >
              {loading ? "Updating..." : "Set New Password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
