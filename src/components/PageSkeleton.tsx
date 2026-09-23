/**
 * The placeholder a `loading.tsx` shows while a server-rendered page is
 * fetching its data.
 *
 * Without one, the App Router keeps the OLD page on screen until the new one
 * has finished every query — so a click looked like it did nothing. With one,
 * the new route's shell appears at once and the real content streams in over
 * it. Deliberately plain: a title block and either a list of rows or a detail
 * layout, in the Portal's own tokens, pulsing.
 *
 * Server component, no data, no client JS.
 */
type Variant = "list" | "detail";

const bar = "rounded bg-ink-950/[0.07]";
const faint = "rounded bg-ink-950/[0.04]";

function Header() {
  return (
    <div className="mb-8 pb-6 border-b border-hairline flex items-end justify-between gap-4">
      <div className="min-w-0">
        <div className={`h-8 w-64 max-w-full ${bar}`} />
        <div className={`mt-3 h-4 w-48 max-w-full ${faint}`} />
      </div>
      <div className="h-10 w-32 shrink-0 rounded-ctl bg-ink-950/[0.05]" />
    </div>
  );
}

function ListBody() {
  return (
    <div className="bg-white border border-hairline rounded-card shadow-elev-1 divide-y divide-hairline">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <div className="h-12 w-16 shrink-0 rounded-ctl bg-ink-950/[0.05]" />
          <div className="flex-1 min-w-0">
            <div className={`h-4 w-1/2 max-w-xs ${bar}`} />
            <div className={`mt-2 h-3 w-1/3 max-w-[12rem] ${faint}`} />
          </div>
          <div className="h-6 w-16 shrink-0 rounded-full bg-ink-950/[0.05]" />
        </div>
      ))}
    </div>
  );
}

function DetailBody() {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
            <div className={`h-3 w-24 ${faint}`} />
            <div className={`mt-4 h-5 w-3/4 ${bar}`} />
            <div className={`mt-3 h-3 w-1/2 ${faint}`} />
            <div className={`mt-2 h-3 w-2/3 ${faint}`} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-[4/3] rounded-card bg-ink-950/[0.05]" />
        ))}
      </div>
    </>
  );
}

export default function PageSkeleton({ variant = "list" }: { variant?: Variant }) {
  return (
    <div
      className="px-4 sm:px-6 py-8 max-w-5xl mx-auto animate-pulse"
      aria-busy="true"
      aria-label="Loading"
    >
      <Header />
      {variant === "detail" ? <DetailBody /> : <ListBody />}
    </div>
  );
}
