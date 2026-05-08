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
        if (exchError) { fail(); return; }
        // onAuthStateChange should fire SIGNED_IN — but @supabase/ssr sometimes
        // doesn't emit it on the browser client. Add a fallback so we never spin forever.
        setTimeout(async () => {
          if (settled) return;
          const { data: { user } } = await supabase.auth.getUser();
          if (user) { await settle(user.id); }
          else { fail(); }
        }, 2000);
        return;
      }

      // Implicit flow: @supabase/ssr does NOT auto-process #access_token from the
      // URL hash the way the browser client does. Parse it explicitly and call
      // setSession() so Supabase creates the session from the tokens in the hash.
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
          if (sessErr || !sessData.session?.user) { fail(); return; }
          // onAuthStateChange should fire SIGNED_IN — add the same safety fallback.
          setTimeout(async () => {
            if (settled) return;
            const { data: { user } } = await supabase.auth.getUser();
            if (user) { await settle(user.id); }
            else { fail(); }
          }, 2000);
          return;
        }
      }

      // Fallback: check if getSession() already has a valid session
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await settle(session.user.id);
        return;
      }

      // Last resort — give onAuthStateChange up to 4 seconds
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
