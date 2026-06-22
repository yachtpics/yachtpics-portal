import Link from "next/link";
import { TIPS } from "@/lib/portalTips";

export const dynamic = "force-dynamic";

// Browsable home for the weekly Tips & Tricks series. Pulls from the same TIPS
// source as the emails, so the two never drift — add a tip and it shows here.
export default function DashboardTipsPage() {
  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-gray-900">Tips &amp; Tricks</h1>
        <p className="text-gray-500 text-sm mt-1">
          Quick ways to get more out of your portal. We send a new one each week — they all live here, so you can read ahead or catch up anytime.
        </p>
      </div>

      <div className="space-y-4">
        {TIPS.map((tip, i) => (
          <div key={tip.slug} className="bg-white border border-gray-200 rounded-xl p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <span className="shrink-0 mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full bg-[#d4a843]/15 text-[#a07820] text-sm font-bold">
                {i + 1}
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-gray-900">{tip.headline}</h2>
                <div className="mt-2 space-y-2">
                  {tip.body.map((p, j) => (
                    <p key={j} className="text-sm text-gray-600 leading-relaxed">{p}</p>
                  ))}
                </div>
                <Link
                  href={tip.ctaPath}
                  className="inline-block mt-4 bg-[#050b14] hover:bg-[#0a1628] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                >
                  {tip.ctaLabel} →
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-center text-gray-400 text-xs mt-8">More tips added regularly. Have an idea? Just reply to any of our emails.</p>
    </div>
  );
}
