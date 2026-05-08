"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

export default function SetPasswordClient() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [needsName, setNeedsName] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [linkInvalid, setLinkInvalid] = useState(false);
  // Keep a ref to the supabase instance so handleSubmit can reuse it
  const [supabaseInstance, setSupabaseInstance] = useState<SupabaseClient | null>(null);

  useEffect(() => {
    let settled = false;

    function settle(uid: string, supabase: SupabaseClient) {
      if (settled) return;
      settled = true;
      setUserId(uid);
      supabase.from("profiles").select("first_name, last_name").eq("id", uid).single()
        .then(({ data }) => {
          if (data?.first_name) {
            setFirstName(data.first_name);
            setLastName(data.last_name ?? "");
          } else {
            // No name on file — collect it during setup
            setNeedsName(true);
          }
        });
      window.history.replaceState(null, "", window.location.pathname);
      setChecking(false);
    }

    function fail(sub?: { unsubscribe: () => void }) {
      if (settled) return;
      settled = true;
      sub?.unsubscribe();
      setLinkInvalid(true);
      setChecking(false);
    }

    async function init() {
      // Defer client creation — createBrowserClient accesses browser APIs at init time
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      setSupabaseInstance(supabase);

      // Subscribe first to catch events that fire immediately on init
      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (settled) return;
        if ((event === "SIGNED_IN" || event === "PASSWORD_RECOVERY") && session?.user) {
          settle(session.user.id, supabase);
        }
      });

      const params = new URLSearchParams(window.location.search);

      // Error signalled in URL
      if (params.get("error")) { fail(subscription); return; }

      // PKCE flow — code arrives as ?code=
      const code = params.get("code");
      if (code) {
        const { error: exchError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchError) { fail(subscription); return; }
        setTimeout(async () => {
          if (settled) return;
          const { data: { user: u } } = await supabase.auth.getUser();
          if (u) settle(u.id, supabase); else fail(subscription);
        }, 3000);
        return;
      }

      // Implicit flow — tokens arrive as #access_token= in hash
      // (used by admin.generateLink invite links)
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
          if (sessErr || !sessData.session?.user) { fail(subscription); return; }
          setTimeout(async () => {
            if (settled) return;
            const { data: { user: u } } = await supabase.auth.getUser();
            if (u) settle(u.id, supabase); else fail(subscription);
          }, 3000);
          return;
        }
      }

      // Check for existing session (e.g. page reload after exchange)
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) { settle(session.user.id, supabase); return; }

      // Nothing found — give onAuthStateChange up to 5s to fire
      setTimeout(async () => {
        if (settled) return;
        const { data: { user: u } } = await supabase.auth.getUser();
        if (u) settle(u.id, supabase); else fail(subscription);
      }, 5000);
    }

    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (needsName && !firstName.trim()) { setError("Please enter your first name."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }

    setLoading(true);
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = supabaseInstance ?? createClient();

    // Save name to profile if it was collected here
    if (needsName && userId && firstName.trim()) {
      await supabase.from("profiles").update({
        first_name: firstName.trim(),
        last_name: lastName.trim() || null,
      }).eq("id", userId);
    }

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
            {needsName
              ? "Tell us your name and create a password to get started."
              : "Create a password to secure your account. You’ll use this each time you log in."}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {needsName && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                    First name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Jane"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                    Last name
                  </label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Smith"
                    className={inputClass}
                  />
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                autoFocus={!needsName}
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
