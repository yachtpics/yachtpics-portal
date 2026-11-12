"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { scrubAnalyticsUrl } from "@/lib/analyticsScrub";

/** Vercel Analytics with token-bearing auth/demo URLs scrubbed (beforeSend must run client-side). */
function beforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  return { ...event, url: scrubAnalyticsUrl(event.url) };
}

export default function ScrubbedAnalytics() {
  return <Analytics beforeSend={beforeSend} />;
}
