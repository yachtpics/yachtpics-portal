import type { Metadata } from "next";
import Link from "next/link";
import { REEL_SERVICE_PRICE } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Reel Service by YachtPics",
  description: `Four social reels a month for your listing, made from our shoot. $${REEL_SERVICE_PRICE} a month, cancel anytime.`,
};

/**
 * /rs — public landing for the boat-show QR (Admin → Shows → Reel Service
 * QR). Three lines and one button: sign in, then pick the boat on
 * /dashboard/reel-service. Not behind the middleware (its matcher only
 * covers /dashboard, /admin, /client and the auth pages).
 */
export default function ReelServiceLanding() {
  return (
    <main className="min-h-screen bg-ink-950 text-white flex items-center justify-center px-6 py-16">
      <div className="max-w-md w-full text-center">
        <p className="text-sm tracking-[0.2em] uppercase text-accent-400">YachtPics Portal</p>
        <h1 className="mt-4 text-3xl font-semibold leading-tight">Reel Service by YachtPics</h1>
        <p className="mt-4 text-base text-ink-200 leading-relaxed">
          Four social reels a month for your listing, made from our shoot. ${REEL_SERVICE_PRICE} a month, cancel anytime.
        </p>
        <Link
          href="/auth/login?next=/dashboard/reel-service"
          className="mt-8 inline-block bg-accent-500 hover:bg-accent-400 text-ink-950 text-base font-semibold px-6 py-3 rounded-ctl transition-colors"
        >
          Sign in to pick your boat
        </Link>
      </div>
    </main>
  );
}
