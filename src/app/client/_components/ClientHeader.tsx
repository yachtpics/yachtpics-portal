"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ClientHeader({ name }: { name: string | null }) {
  const router = useRouter();
  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  }
  return (
    <header className="bg-[#050b14] text-white">
      <div className="max-w-5xl mx-auto px-5 py-4 flex items-center justify-between">
        <span className="text-sm font-semibold tracking-wide">
          YachtPics <span className="text-[#d4a843]">Gallery</span>
        </span>
        <div className="flex items-center gap-3">
          {name && <span className="text-xs text-gray-400 hidden sm:inline">{name}</span>}
          <button onClick={signOut} className="text-xs text-gray-300 hover:text-white transition-colors">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
