"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";
import type { AccessStatus } from "@/lib/subscriptionAccess";
import {
  LayoutGrid,
  Ship,
  ClipboardList,
  Users,
  CreditCard,
  UserRound,
  Lightbulb,
  HelpCircle,
  Building2,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

const brokerNavItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutGrid },
  { label: "My Listings", href: "/dashboard/listings", icon: Ship },
  { label: "Shoots & Invoices", href: "/dashboard/shoots", icon: ClipboardList },
  { label: "Team", href: "/dashboard/team", icon: Users },
  { label: "Billing", href: "/dashboard/billing", icon: CreditCard },
  { label: "My Profile", href: "/dashboard/profile", icon: UserRound },
  { label: "Tips", href: "/dashboard/tips", icon: Lightbulb },
  { label: "Help", href: "/dashboard/help", icon: HelpCircle },
];

const assistantNavItems: NavItem[] = [
  { label: "Listings", href: "/dashboard/listings", icon: Ship },
  { label: "My Brokers", href: "/dashboard/brokers", icon: Users },
  { label: "My Profile", href: "/dashboard/profile", icon: UserRound },
  { label: "Tips", href: "/dashboard/tips", icon: Lightbulb },
  { label: "Help", href: "/dashboard/help", icon: HelpCircle },
];

interface Props {
  brokerName: string;
  role: string;
  plan: string;
  trialEndsAt: string | null;
  accessStatus: AccessStatus;
  isBrokerageAdmin?: boolean;
}

export default function DashboardNav({ brokerName, role, plan, trialEndsAt, accessStatus, isBrokerageAdmin }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  const trialDaysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000))
    : null;

  const baseNavItems = role === "assistant" ? assistantNavItems : brokerNavItems;
  const navItems = isBrokerageAdmin
    ? [baseNavItems[0], { label: "Brokerage", href: "/dashboard/brokerage", icon: Building2 }, ...baseNavItems.slice(1)]
    : baseNavItems;

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
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-ink-950 border-t border-hairline-inverse flex items-stretch">
        {navItems.map((item) => {
          const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-colors duration-base ease-quiet ${
                active ? "text-white" : "text-ink-400"
              }`}
            >
              {active && <span aria-hidden className="absolute top-0 inset-x-3 h-0.5 bg-accent-500" />}
              <item.icon size={17} strokeWidth={active ? 2 : 1.5} aria-hidden />
              <span className="text-[10px] font-medium leading-none">{item.label.split(" ")[0]}</span>
            </Link>
          );
        })}
      </div>

      <div className="md:hidden h-12" />

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 bg-ink-950 border-r border-hairline-inverse-soft min-h-screen px-4 py-7">
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
            const active = pathname === item.href;
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
              <p className="text-danger-300/70 text-xs mt-0.5">Subscribe to continue &#8594;</p>
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
