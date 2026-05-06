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
      <div className="bg-red-600 text-white px-5 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2.5 text-sm">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <span>
            <strong>Your free trial has ended.</strong> Subscribe to continue uploading photos and sharing slideshows.
          </span>
        </div>
        <Link
          href="/dashboard/billing"
          className="shrink-0 bg-white text-red-600 font-semibold text-xs px-4 py-1.5 rounded-full hover:bg-red-50 transition-colors"
        >
          Subscribe now
        </Link>
      </div>
    );
  }

  // trial_expiring — ≤ 5 days left
  return (
    <div className="bg-amber-500 text-white px-5 py-3 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-2.5 text-sm">
        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>
          <strong>{daysLeft} {daysLeft === 1 ? "day" : "days"} left on your free trial.</strong> Subscribe before it ends to keep access.
        </span>
      </div>
      <Link
        href="/dashboard/billing"
        className="shrink-0 bg-white text-amber-600 font-semibold text-xs px-4 py-1.5 rounded-full hover:bg-amber-50 transition-colors"
      >
        View plans
      </Link>
    </div>
  );
}
