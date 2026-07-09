"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  LayoutGrid,
  Users,
  CreditCard,
  UserCheck,
  Building2,
  Ship,
  Image as ImageIcon,
  ClipboardList,
  BarChart3,
  Mail,
  Megaphone,
  Lightbulb,
  Lock,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { label: "Overview", href: "/admin", icon: LayoutGrid },
  { label: "Brokers", href: "/admin/brokers", icon: Users },
  { label: "Trials", href: "/admin/trials", icon: CreditCard },
  { label: "Assistants", href: "/admin/assistants", icon: UserCheck },
  { label: "Brokerages", href: "/admin/brokerages", icon: Building2 },
  { label: "Listings", href: "/admin/listings", icon: Ship },
  { label: "Galleries", href: "/admin/galleries", icon: ImageIcon },
  { label: "Shoots & Invoices", href: "/admin/shoots", icon: ClipboardList },
  { label: "Metrics", href: "/admin/metrics", icon: BarChart3 },
  { label: "Email Log", href: "/admin/emails", icon: Mail },
  { label: "Announce", href: "/admin/announce", icon: Megaphone },
  { label: "Tips", href: "/admin/tips", icon: Lightbulb },
  { label: "Admin Users", href: "/admin/users", icon: Lock },
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
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-ink-950 border-b border-hairline-inverse px-4 py-3 flex items-center justify-between">
        <span className="flex items-baseline gap-2.5">
          <span className="text-white text-[0.8125rem] font-light uppercase tracking-caps-wide leading-none">
            YachtPics
          </span>
          <span className="text-[0.5625rem] font-medium uppercase tracking-caps-wide text-accent-300/80 leading-none">
            Admin
          </span>
        </span>
        <button
          onClick={handleSignOut}
          className="text-ink-400 hover:text-white text-xs font-medium transition-colors duration-base ease-quiet px-2 py-1 rounded-ctl"
        >
          Sign out
        </button>
      </div>

      {/* Mobile bottom tab bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-ink-950 border-t border-hairline-inverse flex items-stretch overflow-x-auto">
        {navItems.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex-1 min-w-[3.5rem] flex flex-col items-center justify-center py-2.5 gap-1 transition-colors duration-base ease-quiet ${
                active ? "text-white" : "text-ink-400"
              }`}
            >
              {active && <span aria-hidden className="absolute top-0 inset-x-2 h-0.5 bg-accent-500" />}
              <item.icon size={16} strokeWidth={active ? 2 : 1.5} aria-hidden />
              <span className="text-[9px] font-medium leading-none">{item.label.split(" ")[0]}</span>
            </Link>
          );
        })}
      </div>

      {/* Spacer so content clears the fixed top bar on mobile */}
      <div className="md:hidden h-12" />

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 bg-ink-950 border-r border-hairline-inverse-soft min-h-screen px-4 py-7">
        {/* Wordmark lockup — thin, wide-tracked, hairline rule, small caps */}
        <div className="px-3 pt-1">
          <span className="block text-white text-[0.9375rem] font-light uppercase tracking-caps-wide leading-none">
            YachtPics
          </span>
          <span aria-hidden className="mt-3.5 block h-px w-14 bg-white/25" />
          <span className="mt-3.5 block text-[0.625rem] font-medium uppercase tracking-caps-wide text-accent-300/80 leading-none">
            Admin
          </span>
          <p className="text-ink-400 text-xs mt-3">Internal panel</p>
        </div>

        <div className="border-t border-hairline-inverse-soft my-4" />

        <nav className="flex-1 space-y-0.5">
          {navItems.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex items-center px-3 py-2 rounded-ctl text-sm transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
                  active
                    ? "bg-white/[0.05] text-white font-medium"
                    : "text-ink-400 hover:text-white hover:bg-white/[0.03]"
                }`}
              >
                {active && <span aria-hidden className="absolute left-0 top-2 bottom-2 w-px bg-accent-400" />}
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-hairline-inverse pt-4">
          <button
            onClick={handleSignOut}
            className="text-ink-400 hover:text-ink-200 text-xs transition-colors duration-base ease-quiet px-2"
          >
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
