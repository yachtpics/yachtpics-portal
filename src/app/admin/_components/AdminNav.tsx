"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

const navItems = [
  { label: "Overview", href: "/admin", icon: "⊞" },
  { label: "Brokers", href: "/admin/brokers", icon: "👥" },
  { label: "Listings", href: "/admin/listings", icon: "🚢" },
  { label: "Shoots & Invoices", href: "/admin/shoots", icon: "📋" },
  { label: "Metrics", href: "/admin/metrics", icon: "📊" },
];

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden bg-[#050b14] px-4 py-3 flex items-center justify-between border-b border-[#1e3a5f]">
        <span className="text-white font-semibold tracking-wide">
          YachtPics<span className="text-[#d4a843]"> Admin</span>
        </span>
        <button onClick={() => setMenuOpen(!menuOpen)} className="text-gray-400 hover:text-white p-1">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {menuOpen
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            }
          </svg>
        </button>
      </div>

      {menuOpen && (
        <div className="md:hidden bg-[#0a1628] border-b border-[#1e3a5f] px-4 pb-4">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors mt-1 ${
                pathname === item.href ? "bg-[#d4a843]/10 text-[#d4a843]" : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}>
              <span>{item.icon}</span>{item.label}
            </Link>
          ))}
          <button onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors mt-1 w-full text-left">
            <span>→</span> Sign out
          </button>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 bg-[#050b14] border-r border-[#1e3a5f] min-h-screen px-4 py-6">
        <div className="mb-2 px-2">
          <span className="text-white font-semibold tracking-wide text-lg">
            YachtPics<span className="text-[#d4a843]"> Admin</span>
          </span>
          <p className="text-gray-500 text-xs mt-0.5">Internal panel</p>
        </div>

        <div className="border-t border-[#1e3a5f] my-4" />

        <nav className="flex-1 space-y-1">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href))
                  ? "bg-[#d4a843]/10 text-[#d4a843]"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}>
              <span>{item.icon}</span>{item.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-[#1e3a5f] pt-4">
          <button onClick={handleSignOut}
            className="text-gray-500 hover:text-gray-300 text-xs transition-colors px-2">
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
