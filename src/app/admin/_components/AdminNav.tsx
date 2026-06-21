"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const navItems = [
  { label: "Overview", href: "/admin", icon: "⊞" },
  { label: "Brokers", href: "/admin/brokers", icon: "👥" },
  { label: "Trials", href: "/admin/trials", icon: "💳" },
  { label: "Assistants", href: "/admin/assistants", icon: "🤝" },
  { label: "Brokerages", href: "/admin/brokerages", icon: "🏢" },
  { label: "Listings", href: "/admin/listings", icon: "🚢" },
  { label: "Galleries", href: "/admin/galleries", icon: "🖼️" },
  { label: "Shoots & Invoices", href: "/admin/shoots", icon: "📋" },
  { label: "Metrics", href: "/admin/metrics", icon: "📊" },
  { label: "Email Log", href: "/admin/emails", icon: "✉️" },
  { label: "Announce", href: "/admin/announce", icon: "📣" },
  { label: "Admin Users", href: "/admin/users", icon: "🔐" },
];

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/admin" && pathname.startsWith(href));
}

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[#050b14] px-4 py-3 flex items-center justify-between border-b border-[#1e3a5f]">
        <span className="text-white font-semibold tracking-wide">
          YachtPics<span className="text-[#d4a843]"> Admin</span>
        </span>
        <button onClick={handleSignOut} className="text-gray-400 hover:text-white text-xs font-medium transition-colors px-2 py-1 rounded">
          Sign out
        </button>
      </div>

      {/* Mobile bottom tab bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#050b14] border-t border-[#1e3a5f] flex items-center">
        {navItems.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors ${active ? "text-[#d4a843]" : "text-gray-500"}`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              <span className="text-[9px] font-medium leading-none">{item.label.split(" ")[0]}</span>
            </Link>
          );
        })}
      </div>

      {/* Spacer so content clears the fixed top bar on mobile */}
      <div className="md:hidden h-12" />

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
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive(pathname, item.href)
                  ? "bg-[#d4a843]/10 text-[#d4a843]"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}
            >
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
