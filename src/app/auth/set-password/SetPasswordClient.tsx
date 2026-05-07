"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SetPasswordClient() {
  const router = useRouter();
  const supabase = createClient();

  const [firstName, setFirstName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [linkInvalid, setLinkInvalid] = useState(false);

  useEffect(() => {
    let settled = false;

    async function loadProfile(userId: string) {
      const { data } = await supabase
        .from("profiles")
        .select("first_name")
        .eq("id", userId)
        .single();
      if (data?.first_name) setFirstName(data.first_name);
    }

    async function settle(userId: string) {
      if (settled) return;
      settled = true;
      await loadProfile(userId);
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", window.location.pathname);
      }
      setChecking(false);
    }

    function fail() {
      if (settled) return;
      settled = true;
      setLinkInvalid(true);
      setChecking(false);
    }

    // Subscribe FIRST before any async work — avoids missing events that fire
    // immediately when Supabase detects hash tokens on page load
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (settled) return;
      if ((event === "SIGNED_IN" || event === "PASSWORD_RECOVERY") && session?.user) {
        await settle(session.user.id);
      }
    });

    async function handleInit() {
      if (typeof window === "undefined") return;

      const params = new URLSearchParams(window.location.search);

      // Supabase reports genuine token expiry/invalid via ?error= on the redirect
      if (params.get("error")) {
        fail();
        return;
      }

      // PKCE flow: code arrives as ?code=
      const code = params.get("code");
      if (code) {
        const { error: exchError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchError) { fail(); }
        // On success, onAuthStateChange fires SIGNED_IN -> settle()
        return;
      }

      // Implicit flow: Supabase client auto-detects #access_token in hash.
      // Check getSession() immediately in case it already processed the hash
      // before our onAuthStateChange listener was registered.
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await settle(session.user.id);
        return;
      }

      // Still no session — give onAuthStateChange up to 4 seconds
      setTimeout(async () => {
        if (settled) return;
        const { data: { user } } = await supabase.auth.getUser();
        if (user) { await settle(user.id); }
        else { fail(); }
      }, 4000);
    }

    handleInit();

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
  };

  const inputClass =
    "w-full border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-[#d4a843] focus:ring-1 focus:ring-[#d4a843]/30";

  if (checking) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[#d4a843] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (linkInvalid) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <p className="text-xl font-semibold text-gray-900 tracking-tight mb-8">
            YachtPics <span className="text-[#d4a843]">Portal</span>
          </p>
          <div className="bg-white rounded-2xl border border-gray-200 p-8 shadow-sm">
            <div className="w-10 h-10 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto mb-4">
              <span className="text-amber-500 text-lg">!</span>
            </div>
            <h1 className="text-lg font-bold text-gray-900 mb-2">Link expired</h1>
            <p className="text-sm text-gray-500 leading-relaxed mb-6">
              This invite link has already been used or has expired. Contact your broker or{" "}
              <a href="mailto:hello@yachtpics.com" className="text-[#d4a843] hover:underline">
                hello@yachtpics.com
              </a>{" "}
              to request a new one.
            </p>
            <a
              href="/auth/login"
              className="block w-full bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] font-semibold text-sm py-3 rounded-lg transition-colors text-center"
            >
              Go to Login
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <p className="text-xl font-semibold text-gray-900 tracking-tight">
            YachtPics <span className="text-[#d4a843]">Portal</span>
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-8 shadow-sm">
          <h1 className="text-xl font-bold text-gray-900 mb-1">
            {firstName ? "Welcome, " + firstName : "Welcome"}
          </h1>
          <p className="text-sm text-gray-500 mb-6 leading-relaxed">
            Create a password to secure your account. You&apos;ll use this each time you log in.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                Password
              </label>
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
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                Confirm Password
              </label>
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
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-60 text-[#050b14] font-semibold text-sm py-3 rounded-lg transition-colors mt-2"
            >
              {loading ? "Setting up..." : "Set Password & Go to Dashboard"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Need help?{" "}
          <a href="mailto:hello@yachtpics.com" className="text-[#d4a843] hover:underline">
            hello@yachtpics.com
          </a>
        </p>
      </div>
    </div>
  );
}
