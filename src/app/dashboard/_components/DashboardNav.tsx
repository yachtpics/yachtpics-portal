"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import type { AccessStatus } from "@/lib/subscriptionAccess";
import {
  LayoutGrid,
  Ship,
  Camera,
  Users,
  CreditCard,
  UserRound,
  Lightbulb,
  Newspaper,
  HelpCircle,
  Building2,
  Clapperboard,
  MoreHorizontal,
  Globe,
  X,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Short label for the cramped mobile tab bar. */
  short: string;
}

// Shoots & Invoices (/dashboard/shoots) is hidden from the nav: the shoots
// table is empty and invoicing lives in Zoho. The page itself stays in place.

const brokerNavItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutGrid, short: "Home" },
  { label: "My Listings", href: "/dashboard/listings", icon: Ship, short: "Listings" },
  { label: "Website", href: "/dashboard/website", icon: Globe, short: "Website" },
  { label: "Recently Photographed", href: "/dashboard/showcase", icon: Camera, short: "Recent" },
  { label: "Team", href: "/dashboard/team", icon: Users, short: "Team" },
  { label: "Billing", href: "/dashboard/billing", icon: CreditCard, short: "Billing" },
  { label: "My Profile", href: "/dashboard/profile", icon: UserRound, short: "Profile" },
  { label: "News", href: "/dashboard/news", icon: Newspaper, short: "News" },
  { label: "Tips", href: "/dashboard/tips", icon: Lightbulb, short: "Tips" },
  { label: "Help", href: "/dashboard/help", icon: HelpCircle, short: "Help" },
];

const assistantNavItems: NavItem[] = [
  { label: "Listings", href: "/dashboard/listings", icon: Ship, short: "Listings" },
  { label: "Website", href: "/dashboard/website", icon: Globe, short: "Website" },
  { label: "Recently Photographed", href: "/dashboard/showcase", icon: Camera, short: "Recent" },
  { label: "My Brokers", href: "/dashboard/brokers", icon: Users, short: "Brokers" },
  { label: "My Profile", href: "/dashboard/profile", icon: UserRound, short: "Profile" },
  { label: "News", href: "/dashboard/news", icon: Newspaper, short: "News" },
  { label: "Tips", href: "/dashboard/tips", icon: Lightbulb, short: "Tips" },
  { label: "Help", href: "/dashboard/help", icon: HelpCircle, short: "Help" },
];

// The phone tab bar shows at most five of these (in this order, when present);
// everything else goes under "More".
const MOBILE_PRIMARY = [
  "/dashboard",
  "/dashboard/listings",
  "/dashboard/showcase",
  "/dashboard/reels",
  "/dashboard/brokers",
  "/dashboard/profile",
];
const MOBILE_TAB_LIMIT = 5;

/** Highlight a nav item on its own page and on any page beneath it. */
function isActivePath(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}

interface Props {
  brokerName: string;
  role: string;
  plan: string;
  trialEndsAt: string | null;
  accessStatus: AccessStatus;
  isBrokerageAdmin?: boolean;
  /** Reel Service: the broker (or one an assistant works for) is enrolled or has delivered reels. */
  showReels?: boolean;
}

export default function DashboardNav({ brokerName, role, plan, trialEndsAt, accessStatus, isBrokerageAdmin, showReels }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the "More" sheet on navigation and on Escape.
  useEffect(() => { setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  const trialDaysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000))
    : null;

  const roleNavItems = role === "assistant" ? assistantNavItems : brokerNavItems;
  // "Your Reels" (Reel Service) sits right after the listings item.
  const listingsAt = roleNavItems.findIndex((i) => i.href === "/dashboard/listings");
  const baseNavItems = showReels
    ? [
        ...roleNavItems.slice(0, listingsAt + 1),
        { label: "Your Reels", href: "/dashboard/reels", icon: Clapperboard, short: "Reels" } as NavItem,
        ...roleNavItems.slice(listingsAt + 1),
      ]
    : roleNavItems;
  const navItems = isBrokerageAdmin
    ? [baseNavItems[0], { label: "Brokerage", href: "/dashboard/brokerage", icon: Building2, short: "Brokerage" } as NavItem, ...baseNavItems.slice(1)]
    : baseNavItems;

  const mobileTabs = MOBILE_PRIMARY
    .map((href) => navItems.find((i) => i.href === href))
    .filter((i): i is NavItem => !!i)
    .slice(0, MOBILE_TAB_LIMIT);
  const mobileMore = navItems.filter((i) => !mobileTabs.includes(i));
  const moreActive = mobileMore.some((i) => isActivePath(pathname, i.href));

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-ink-950 border-b border-hairline-inverse px-4 py-3 flex items-center justify-between">
        <span className="flex items-baseline gap-2.5">
          <span className="text-white text-[0.8125rem] font-light uppercase tracking-caps-wide leading-none">
            YachtPics
          </span>
          <span className="text-[0.5625rem] font-medium uppercase tracking-caps-wide text-accent-300/80 leading-none">
            Portal
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
      <nav aria-label="Main" className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-ink-950 border-t border-hairline-inverse flex items-stretch pb-[env(safe-area-inset-bottom)]">
        {mobileTabs.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex-1 min-w-0 flex flex-col items-center justify-center py-3 gap-1 transition-colors duration-base ease-quiet ${
                active ? "text-white" : "text-ink-400"
              }`}
            >
              {active && <span aria-hidden className="absolute top-0 inset-x-3 h-0.5 bg-accent-500" />}
              <item.icon size={17} strokeWidth={active ? 2 : 1.5} aria-hidden />
              <span className="text-[10px] font-medium leading-none truncate max-w-full px-0.5">{item.short}</span>
            </Link>
          );
        })}
        {mobileMore.length > 0 && (
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-controls="dashboard-more-sheet"
            className={`relative flex-1 min-w-0 flex flex-col items-center justify-center py-3 gap-1 transition-colors duration-base ease-quiet ${
              moreActive || menuOpen ? "text-white" : "text-ink-400"
            }`}
          >
            {moreActive && <span aria-hidden className="absolute top-0 inset-x-3 h-0.5 bg-accent-500" />}
            <MoreHorizontal size={17} strokeWidth={moreActive || menuOpen ? 2 : 1.5} aria-hidden />
            <span className="text-[10px] font-medium leading-none">More</span>
          </button>
        )}
      </nav>

      {/* Phone "More" sheet — the nav items that don't fit the tab bar */}
      {menuOpen && (
        <div className="md:hidden fixed inset-0 z-30">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-ink-950/60"
          />
          <div
            id="dashboard-more-sheet"
            role="dialog"
            aria-label="More"
            className="absolute left-0 right-0 bottom-0 bg-ink-950 border-t border-hairline-inverse rounded-t-card px-2 pt-3 pb-[calc(4.25rem+env(safe-area-inset-bottom))] shadow-elev-2"
          >
            <div className="flex items-center justify-between px-3 pb-2">
              <p className="label-caps-inverse">More</p>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Close"
                className="text-ink-400 hover:text-white p-1 rounded-ctl transition-colors duration-base ease-quiet"
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            <ul>
              {mobileMore.map((item) => {
                const active = isActivePath(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setMenuOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-3 px-3 py-3 rounded-ctl text-sm transition-colors duration-base ease-quiet ${
                        active ? "bg-white/[0.05] text-white font-medium" : "text-ink-300 hover:text-white hover:bg-white/[0.03]"
                      }`}
                    >
                      <item.icon size={17} strokeWidth={active ? 2 : 1.5} aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      <div className="md:hidden h-12" />

      {/* Desktop sidebar */}
      {/* Desktop sidebar — pinned. `self-start` stops the flex parent stretching
          it to full page height (a full-height element has nothing to stick to),
          `h-screen` holds it to the viewport, and `overflow-y-auto` lets the nav
          scroll on its own if the list outgrows a short window. */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 bg-ink-950 border-r border-hairline-inverse-soft sticky top-0 self-start h-screen overflow-y-auto px-4 py-7">
        {/* Wordmark lockup — thin, wide-tracked, hairline rule, small caps */}
        <div className="mb-9 px-3 pt-1">
          <span className="block text-white text-[0.9375rem] font-light uppercase tracking-caps-wide leading-none">
            YachtPics
          </span>
          <span aria-hidden className="mt-3.5 block h-px w-14 bg-white/25" />
          <span className="mt-3.5 block text-[0.625rem] font-medium uppercase tracking-caps-wide text-accent-300/80 leading-none">
            Portal
          </span>
          {role === "assistant" && (
            <p className="mt-4 text-[0.625rem] font-medium uppercase tracking-caps text-white/40 leading-none">
              Assistant
            </p>
          )}
        </div>
        <nav className="flex-1 space-y-0.5">
          {navItems.map((item) => {
            const active = isActivePath(pathname, item.href);
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
        <div className="border-t border-hairline-inverse pt-4 space-y-3">
          {role === "broker" && accessStatus === "trial_expired" && (
            <Link
              href="/dashboard/billing"
              className="block rounded-ctl border border-danger-500/40 bg-danger-500/[0.08] px-3 py-2.5 hover:bg-danger-500/[0.14] transition-colors duration-base ease-quiet"
            >
              <p className="text-danger-300 text-xs font-semibold">Trial Ended</p>
              <p className="text-danger-300/70 text-xs mt-0.5">See plans &#8594;</p>
            </Link>
          )}
          {role === "broker" && accessStatus === "trial_expiring" && trialDaysLeft !== null && (
            <Link
              href="/dashboard/billing"
              className="block rounded-ctl border border-warn-300/30 bg-warn-300/[0.06] px-3 py-2.5 hover:bg-warn-300/[0.12] transition-colors duration-base ease-quiet"
            >
              <p className="text-warn-300 text-xs font-semibold">Trial Expiring</p>
              <p className="text-warn-300/70 text-xs mt-0.5">{trialDaysLeft} {trialDaysLeft === 1 ? "day" : "days"} remaining</p>
            </Link>
          )}
          {role === "broker" && accessStatus === "trial_active" && trialDaysLeft !== null && (
            <div className="rounded-ctl border border-hairline-inverse-soft px-3 py-2.5">
              <p className="label-caps-inverse">Free Trial</p>
              <p className="text-ink-400 text-xs mt-1">{trialDaysLeft} days remaining</p>
            </div>
          )}
          <div className="px-2">
            <p className="text-white text-sm font-medium truncate">{brokerName}</p>
            <button
              onClick={handleSignOut}
              className="text-ink-400 hover:text-ink-200 text-xs transition-colors duration-base ease-quiet mt-0.5"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
