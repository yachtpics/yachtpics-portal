"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Input } from "@/components/ui";

export default function ClientHeader({ name }: { name: string | null }) {
  const router = useRouter();
  const [pwOpen, setPwOpen] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  }

  async function changePassword() {
    setMsg("");
    if (newPw.length < 8) {
      setMsg("Password must be at least 8 characters.");
      return;
    }
    if (newPw !== confirmPw) {
      setMsg("Passwords don't match.");
      return;
    }
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
      setMsg("Password updated ✓");
      setNewPw("");
      setConfirmPw("");
      setTimeout(() => {
        setPwOpen(false);
        setMsg("");
      }, 1500);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't update password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="bg-ink-950 border-b border-hairline-inverse">
        <div className="max-w-5xl mx-auto px-5 py-4 flex items-center justify-between">
          <span className="flex items-baseline gap-2.5">
            <span className="text-white text-[0.8125rem] font-light uppercase tracking-caps-wide leading-none">
              YachtPics
            </span>
            <span className="text-[0.5625rem] font-medium uppercase tracking-caps-wide text-accent-300/80 leading-none">
              Gallery
            </span>
          </span>
          <div className="flex items-center gap-3">
            {name && <span className="text-xs text-ink-400 hidden sm:inline">{name}</span>}
            <a href="/client/help" className="text-xs text-ink-300 hover:text-white transition-colors duration-base ease-quiet">
              Help
            </a>
            <button onClick={() => setPwOpen(true)} className="text-xs text-ink-300 hover:text-white transition-colors duration-base ease-quiet">
              Change password
            </button>
            <button onClick={signOut} className="text-xs text-ink-300 hover:text-white transition-colors duration-base ease-quiet">
              Sign out
            </button>
          </div>
        </div>
      </header>

      {pwOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 px-4" onClick={() => setPwOpen(false)}>
          <div className="bg-white rounded-surface shadow-elev-3 max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-h2 text-ink-900 mb-1">Change password</h2>
            <p className="text-sm text-ink-500 mb-4">Set a new password for your account.</p>
            <Input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="New password"
              className="mb-2"
            />
            <Input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="Confirm new password"
              className="mb-2"
            />
            {msg && <p className="text-xs text-ink-600 mb-2">{msg}</p>}
            <div className="flex gap-2 mt-2">
              <Button onClick={changePassword} disabled={saving}>
                {saving ? "Saving…" : "Update password"}
              </Button>
              <Button variant="ghost" onClick={() => setPwOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
