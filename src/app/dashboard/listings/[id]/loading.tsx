/**
 * Shown the instant a listing is clicked, before the page itself has loaded.
 *
 * Without this the browser stayed on the listings page with nothing changing
 * while the next page's code was fetched — which reads as "my click didn't
 * register", and leads to clicking a second time. Next renders this the moment
 * navigation starts, so there is always an immediate response on screen.
 *
 * It deliberately mirrors the real page's shape (title block, action row, photo
 * grid) so the layout doesn't jump when the content arrives.
 */
export default function Loading() {
  return (
    <div className="px-4 sm:px-6 py-8 max-w-5xl mx-auto animate-pulse" aria-busy="true" aria-label="Loading listing">
      {/* Title block */}
      <div className="mb-8 pb-6 border-b border-hairline">
        <div className="h-8 w-64 rounded bg-ink-950/[0.06]" />
        <div className="mt-3 h-4 w-40 rounded bg-ink-950/[0.04]" />
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
