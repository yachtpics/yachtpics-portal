"use client";

import Link from "next/link";
import type { AccessStatus } from "@/lib/subscriptionAccess";
import { trialDaysRemaining } from "@/lib/subscriptionAccess";

interface Props {
  accessStatus: AccessStatus;
  trialEndsAt: string | null;
}

export default function TrialBanner({ accessStatus, trialEndsAt }: Props) {
  if (accessStatus === "active" || accessStatus === "trial_active" || accessStatus === "no_access") {
    return null;
  }

  const daysLeft = trialDaysRemaining(trialEndsAt);

  if (accessStatus === "trial_expired") {
    return (
      <div className="bg-danger-50 border-b border-danger-200 px-5 py-2.5 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2.5 text-sm text-ink-700">
          <svg className="w-4 h-4 shrink-0 text-danger-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <span>
            <strong className="font-semibold text-danger-700">Your free trial has ended.</strong> Subscribe to continue uploading photos and sharing slideshows.
          </span>
        </div>
        <Link
          href="/dashboard/billing"
          className="shrink-0 bg-ink-950 text-white font-semibold text-xs px-4 py-2 rounded-ctl hover:bg-ink-800 transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2"
        >
          Subscribe now
        </Link>
      </div>
    );
  }

  // trial_expiring — ≤ 5 days left
  return (
    <div className="bg-warn-50 border-b border-warn-200 px-5 py-2.5 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-2.5 text-sm text-ink-700">
        <svg className="w-4 h-4 shrink-0 text-warn-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>
          <strong className="font-semibold text-warn-800">{daysLeft} {daysLeft === 1 ? "day" : "days"} left on your free trial.</strong> Subscribe before it ends to keep access.
        </span>
      </div>
      <Link
        href="/dashboard/billing"
        className="shrink-0 bg-white border border-hairline-strong text-ink-900 font-semibold text-xs px-4 py-2 rounded-ctl hover:border-ink-400 transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2"
      >
        View plans
      </Link>
    </div>
  );
}
