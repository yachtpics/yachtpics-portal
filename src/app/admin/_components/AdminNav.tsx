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
  Camera,
  Image as ImageIcon,
  ClipboardList,
  BarChart3,
  Mail,
  Film,
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
  { label: "Recently Photographed", href: "/admin/showcase", icon: Camera },
  { label: "Galleries", href: "/admin/galleries", icon: ImageIcon },
  { label: "Shoots & Invoices", href: "/admin/shoots", icon: ClipboardList },
  { label: "Metrics", href: "/admin/metrics", icon: BarChart3 },
  { label: "Email Log", href: "/admin/emails", icon: Mail },
  { label: "Video Migration", href: "/admin/media", icon: Film },
  { label: "Announce", href: "/admin/announce", icon: Megaphone },
  { label: "Tips", href: "/admin/tips", icon: Lightbulb },
  { label: "Admin Users", href: "/admin/users", icon: Lock },
];

/**
 * Nav order — most-used first, so the pages Charlie actually lives in are
 * reachable immediately (and on mobile, without swiping the bar sideways).
 *
 * Desktop and mobile are kept as SEPARATE lists even though they're currently
 * identical. They serve different constraints — the sidebar shows everything at
 * once, the mobile bar only shows the first few — so when one needs to change,
 * it can move without dragging the other with it.
 *
 * Anything not listed keeps its `navItems` order and follows on behind.
 */
const SIDEBAR_PRIORITY = [
  "/admin/brokers",
  "/admin/assistants",
  "/admin/listings",
  "/admin/metrics",
  "/admin/emails",
];

const MOBILE_PRIORITY = [
  "/admin/brokers",
  "/admin/assistants",
  "/admin/listings",
  "/admin/metrics",
  "/admin/emails",
];

/** Stable sort: listed hrefs lead in the given order, the rest keep theirs. */
function orderBy(priority: string[]): NavItem[] {
  return [...navItems].sort((a, b) => {
    const ia = priority.indexOf(a.href);
    const ib = priority.indexOf(b.href);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return 0;
  });
}

const sidebarNavItems = orderBy(SIDEBAR_PRIORITY);
const mobileNavItems = orderBy(MOBILE_PRIORITY);

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
        {mobileNavItems.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex-1 min-w-[5rem] flex flex-col items-center justify-center py-3.5 gap-1.5 transition-colors duration-base ease-quiet ${
                active ? "text-white" : "text-ink-400"
              }`}
            >
              {active && <span aria-hidden className="absolute top-0 inset-x-2 h-0.5 bg-accent-500" />}
              <item.icon size={28} strokeWidth={active ? 2 : 1.75} aria-hidden />
              <span className="text-[11.5px] font-medium leading-none">{item.label.split(" ")[0]}</span>
            </Link>
          );
        })}
      </div>

      {/* Spacer so content clears the fixed top bar on mobile */}
      <div className="md:hidden h-12" />

      {/* Desktop sidebar */}
      {/* Desktop sidebar — pinned. `self-start` stops the flex parent stretching
          it to full page height (a full-height element has nothing to stick to),
          `h-screen` holds it to the viewport, and `overflow-y-auto` lets the nav
          scroll on its own if the list outgrows a short window. Without this the
          nav scrolled away and you had to scroll a 200-photo listing back to the
          top just to change page. */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 bg-ink-950 border-r border-hairline-inverse-soft sticky top-0 self-start h-screen overflow-y-auto px-4 py-7">
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
          {sidebarNavItems.map((item) => {
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
