import Link from "next/link";

/**
 * The quiet YachtPics credit on buyer-facing pages (/s, /g, /d). Always placed
 * BELOW the broker's own brand or credit, never above it, and low contrast so
 * it never competes with the broker.
 */
export default function PresentedThrough({ tone = "light", className = "" }: { tone?: "light" | "dark"; className?: string }) {
  const color = tone === "dark" ? "text-white/30 hover:text-white/60" : "text-ink-400 hover:text-ink-600";
  return (
    <p className={`text-center text-[0.6875rem] leading-none ${className}`}>
      <Link href="/see" rel="noopener" className={`${color} transition-colors duration-fast`}>
        Presented through the YachtPics Portal
      </Link>
    </p>
  );
}
