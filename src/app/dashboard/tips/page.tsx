import Link from "next/link";
import { TIPS } from "@/lib/portalTips";

export const dynamic = "force-dynamic";

// Browsable home for the weekly Tips & Tricks series. Pulls from the same TIPS
// source as the emails, so the two never drift — add a tip and it shows here.
export default function DashboardTipsPage() {
  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-7 pb-6 border-b border-hairline">
        <h1 className="text-display text-ink-900">Tips &amp; Tricks</h1>
        <p className="text-ink-500 text-sm mt-1">
          Quick ways to get more out of your portal. We send a new one each week — they all live here, so you can read ahead or catch up anytime.
        </p>
      </div>

      <div className="space-y-4">
        {TIPS.map((tip, i) => (
          <div key={tip.slug} className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <span className="shrink-0 mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full bg-accent-100 text-accent-700 text-sm font-bold">
                {i + 1}
              </span>
              <div className="min-w-0">
                <h2 className="text-h2 text-ink-900">{tip.headline}</h2>
                <div className="mt-2 space-y-2">
                  {tip.body.map((p, j) => (
                    <p key={j} className="text-sm text-ink-600 leading-relaxed">{p}</p>
                  ))}
                </div>
                <Link
                  href={tip.ctaPath}
                  className="inline-block mt-4 bg-ink-950 hover:bg-ink-800 text-white text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2"
                >
                  {tip.ctaLabel} →
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-center text-ink-500 text-xs mt-8">More tips added regularly. Have an idea? Just reply to any of our emails.</p>
    </div>
  );
}
