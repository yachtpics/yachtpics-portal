/**
 * The placeholder shown while a listing is opening.
 *
 * Used in two places, and it matters that they match:
 *  - `loading.tsx`, which Next shows if the route itself has to be fetched
 *  - the page's own loading state, which is what you actually see in practice
 *
 * That second one is the important one. The Manage page is a client component,
 * so once its code is in the browser the route transition resolves instantly
 * and `loading.tsx` never appears — the wait people actually experience is the
 * page sitting in its own loading state while it fetches. That state used to
 * render the single word "Loading...", which reads as nothing happening.
 *
 * Shaped like the real page so the layout doesn't jump when content lands.
 */
export default function ListingSkeleton() {
  return (
    <div className="px-4 sm:px-6 py-8 max-w-6xl mx-auto animate-pulse" aria-busy="true" aria-label="Opening listing">
      {/* Title block */}
      <div className="mb-8 pb-6 border-b border-hairline">
        <div className="h-8 w-64 max-w-full rounded bg-ink-950/[0.07]" />
        <div className="mt-3 h-4 w-40 max-w-full rounded bg-ink-950/[0.04]" />
      </div>

      {/* Action row */}
      <div className="flex flex-wrap gap-2 mb-8">
        {[88, 104, 76, 96].map((w, i) => (
          <div key={i} className="h-9 rounded-ctl bg-ink-950/[0.05]" style={{ width: w }} />
        ))}
      </div>

      {/* Photo grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="aspect-[4/3] rounded-card bg-ink-950/[0.05]" />
        ))}
      </div>
    </div>
  );
}
