"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button, Input, Label } from "@/components/ui";

/** The login page's wordmark lockup — thin, wide-tracked, hairline rule, small caps. */
function WordmarkLockup() {
  return (
    <div>
      <p className="text-white text-[1.625rem] font-light uppercase tracking-caps-wide [text-indent:0.24em] leading-none">
        YachtPics
      </p>
      <span aria-hidden className="mx-auto mt-4 block h-px w-28 bg-white/25" />
      <p className="mt-4 text-[0.6875rem] font-medium uppercase tracking-caps-wide [text-indent:0.24em] text-accent-300/90">
        Portal
      </p>
    </div>
  );
}

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

    // New brokers/assistants set up via invite — send them straight to their
    // Listings, the one-click-to-photos landing.
    router.push("/dashboard/listings");
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-ink-950 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (linkInvalid) {
    return (
      <div className="relative min-h-screen bg-ink-950 flex items-center justify-center px-4 py-16 overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-48 left-1/2 h-96 w-[52rem] -translate-x-1/2 rounded-full bg-accent-500/[0.06] blur-3xl" />
          <div className="absolute inset-x-0 top-0 h-px bg-hairline-inverse-soft" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-hairline-inverse-soft" />
        </div>
        <div className="relative w-full max-w-sm text-center">
          <div className="mb-10">
            <WordmarkLockup />
          </div>
          <div className="bg-white/[0.03] border border-hairline-inverse rounded-surface p-8 backdrop-blur-sm">
            <div className="w-10 h-10 rounded-full bg-warn-300/10 border border-warn-300/30 flex items-center justify-center mx-auto mb-4">
              <span className="text-warn-300 text-lg">!</span>
            </div>
            <h1 className="text-h2 text-white mb-2">Link expired</h1>
            <p className="text-sm text-ink-400 leading-relaxed mb-6">
              This invite link has already been used or has expired. Contact your broker or{" "}
              <a href="mailto:hello@yachtpics.com" className="text-accent-300 hover:text-accent-200 hover:underline transition-colors duration-fast">
                hello@yachtpics.com
              </a>{" "}
              to request a new one.
            </p>
            <a
              href="/auth/login"
              className="flex w-full items-center justify-center bg-accent-500 hover:bg-accent-400 text-ink-950 font-semibold text-sm py-3 min-h-[44px] rounded-ctl transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
            >
              Go to Login
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-ink-950 flex items-center justify-center px-4 py-16 overflow-hidden">
      {/* Ambient composition — a faint champagne glow and structural hairlines */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-48 left-1/2 h-96 w-[52rem] -translate-x-1/2 rounded-full bg-accent-500/[0.06] blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-hairline-inverse-soft" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-hairline-inverse-soft" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-10">
          <WordmarkLockup />
        </div>

        <div className="bg-white/[0.03] border border-hairline-inverse rounded-surface p-8 backdrop-blur-sm">
          <h1 className="text-h1 text-white mb-1">
            {firstName ? "Welcome, " + firstName : "Welcome"}
          </h1>
          <p className="text-sm text-ink-400 mb-6 leading-relaxed">
            {needsName
              ? "Tell us your name and create a password to get started."
              : "Create a password to secure your account. You’ll use this each time you log in."}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {needsName && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label tone="dark" className="mb-2">
                    First name <span className="text-danger-300">*</span>
                  </Label>
                  <Input
                    tone="dark"
                    type="text"
                    required
                    autoFocus
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Jane"
                  />
                </div>
                <div>
                  <Label tone="dark" className="mb-2">Last name</Label>
                  <Input
                    tone="dark"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Smith"
                  />
                </div>
              </div>
            )}
            <div>
              <Label tone="dark" className="mb-2">Password</Label>
              <Input
                tone="dark"
                type="password"
                required
                autoFocus={!needsName}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <Label tone="dark" className="mb-2">Confirm Password</Label>
              <Input
                tone="dark"
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat your password"
              />
            </div>
            {error && (
              <div className="bg-danger-500/10 border border-danger-500/30 text-danger-300 text-sm px-4 py-3 rounded-ctl">
                {error}
              </div>
            )}
            <Button
              type="submit"
              disabled={loading}
              className="w-full mt-2 focus-visible:ring-offset-ink-950"
            >
              {loading ? "Setting up..." : "Set Password & Go to Dashboard"}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-ink-500 mt-6">
          Need help?{" "}
          <a href="mailto:hello@yachtpics.com" className="text-accent-300 hover:text-accent-200 hover:underline transition-colors duration-fast">
            hello@yachtpics.com
          </a>
        </p>

        <p className="mt-12 text-center text-[0.625rem] font-medium uppercase tracking-caps-wide [text-indent:0.24em] text-white/25">
          Yacht Photography
        </p>
      </div>
    </div>
  );
}
