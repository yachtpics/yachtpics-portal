import type { Metadata } from "next";
import Link from "next/link";
import { getSeeShowcase, getSeeStats, type SeeReel } from "@/lib/seeShowcase";
import { SEE_QUOTES } from "@/content/seeQuotes";
import { PLANS } from "@/lib/plans";
import ShowcaseReelVideo from "./_components/ShowcaseReelVideo";

/**
 * /see — the Portal's public showcase. One real listing (Short Story) shown
 * through every output the Portal makes. Public (middleware doesn't match it),
 * rebuilt at most once an hour; every link it carries lives 7 days or never
 * expires (see src/lib/seeShowcase.ts).
 */
export const revalidate = 3600;

const TITLE = "YachtPics Portal — See it";
const DESCRIPTION = "Photographs, reels and client galleries for yacht brokers, delivered in your brand.";

export async function generateMetadata(): Promise<Metadata> {
  const showcase = await getSeeShowcase().catch(() => null);
  const image = showcase?.og ?? null;
  const alt = showcase?.vessel ? `${showcase.vessel}, delivered through the YachtPics Portal` : "YachtPics Portal";
  return {
    title: TITLE,
    description: DESCRIPTION,
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      type: "website",
      siteName: "YachtPics Portal",
      ...(image ? { images: [{ url: image, width: 1200, height: 630, alt }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: TITLE,
      description: DESCRIPTION,
      ...(image ? { images: [image] } : {}),
    },
  };
}

const fmt = (n: number) => n.toLocaleString("en-US");

const quietLink =
  "inline-flex items-center min-h-[44px] text-sm text-accent-300 hover:text-accent-200 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 rounded-sm";

function Block({ index, title, lines, children }: { index: string; title: string; lines: [string, string]; children: React.ReactNode }) {
  return (
    <article className="py-14 sm:py-18 border-t border-hairline-inverse-soft first:border-t-0">
      <div className="grid gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12 md:items-start">
        <div>
          <p className="label-caps-inverse text-white/35 mb-3">{index}</p>
          <h3 className="text-display text-white mb-4">{title}</h3>
          <p className="text-ink-400 text-[0.9375rem] leading-relaxed max-w-md">{lines[0]}</p>
          <p className="text-ink-400 text-[0.9375rem] leading-relaxed max-w-md mt-2">{lines[1]}</p>
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </article>
  );
}

function Reel({ reel, poster }: { reel: SeeReel; poster: string | null }) {
  return (
    <figure className="min-w-0">
      <div className="relative aspect-[9/16] w-full overflow-hidden rounded-card bg-ink-900 border border-hairline-inverse-soft">
        {reel.url ? (
          <ShowcaseReelVideo src={reel.url} poster={poster} label={`${reel.label} reel`} />
        ) : (
          <>
            {poster && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={poster} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover opacity-60" />
            )}
            <span className="absolute inset-x-0 bottom-4 text-center label-caps-inverse text-white/70">Coming soon</span>
          </>
        )}
      </div>
      <figcaption className="mt-3 label-caps-inverse">{reel.label}</figcaption>
    </figure>
  );
}

export default async function SeePage() {
  const [showcase, stats] = await Promise.all([
    getSeeShowcase().catch(() => null),
    getSeeStats().catch(() => null),
  ]);
  const slideshowHref = showcase?.slideshowHref ?? "/s/r01b4xhu";
  const hero = showcase?.hero ?? null;
  const vessel = showcase?.vessel || "Short Story";
  const specs = showcase?.specs ?? "";
  const reels = showcase?.reels ?? [];
  const fromPrice = Math.min.apply(null, PLANS.map((p) => p.price));

  return (
    <main className="relative min-h-screen bg-ink-950 text-white overflow-x-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[32rem] overflow-hidden">
        <div className="absolute -top-48 left-1/2 h-96 w-[52rem] max-w-[200%] -translate-x-1/2 rounded-full bg-accent-500/[0.06] blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative border-b border-hairline-inverse-soft px-4 sm:px-8 py-5 flex items-center justify-between gap-4">
        <Link href="/" className="text-white text-lg font-light uppercase tracking-caps-wide leading-none">
          YachtPics
        </Link>
        <Link href="/auth/login" className="text-sm text-ink-300 hover:text-white transition-colors duration-fast min-h-[44px] inline-flex items-center">
          Broker Login →
        </Link>
      </header>

      {/* Opening */}
      <section className="relative px-4 sm:px-8 pt-20 pb-16 sm:pt-28 sm:pb-22">
        <div className="max-w-5xl mx-auto">
          <p className="text-[0.6875rem] font-medium uppercase tracking-caps-wide text-accent-300/90 mb-6">YachtPics Portal</p>
          <h1 className="text-white text-[2rem] sm:text-5xl font-semibold tracking-tight leading-[1.1] max-w-3xl">
            From the dock<br />to your buyer&rsquo;s phone.
          </h1>
          <p className="text-ink-400 text-base sm:text-lg leading-relaxed max-w-xl mt-6">
            Your photographs, reels and client galleries, delivered in your brand and ready to send.
          </p>
          <div className="mt-8 flex flex-wrap gap-x-8 gap-y-1">
            <a href={slideshowHref} target="_blank" rel="noopener noreferrer" className={quietLink}>See a delivered listing →</a>
            <Link href="/auth/signup" className={quietLink}>Request access →</Link>
          </div>
        </div>
      </section>

      {/* One listing, every output */}
      <section className="relative px-4 sm:px-8 pb-10 border-t border-hairline-inverse-soft">
        <div className="max-w-5xl mx-auto">
          <div className="pt-16 sm:pt-20 pb-2">
            <p className="label-caps-inverse mb-3">One listing, every output</p>
            <p className="text-ink-400 text-[0.9375rem] max-w-xl">
              {vessel}{specs ? `, a ${specs}` : ""}. One shoot, four ways it reaches a buyer.
            </p>
          </div>

          <Block
            index="01"
            title="Delivered."
            lines={[
              "The shoot arrives in the Portal ordered by area, profiles to master stateroom.",
              "Your name and logo are on every page a buyer opens.",
            ]}
          >
            <a href={slideshowHref} target="_blank" rel="noopener noreferrer" className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-4 focus-visible:ring-offset-ink-950 rounded-card">
              <div className="relative aspect-[3/2] w-full overflow-hidden rounded-card bg-ink-900 border border-hairline-inverse-soft">
                {hero && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={hero} alt={`${vessel}${specs ? `, ${specs}` : ""}`} decoding="async" className="absolute inset-0 h-full w-full object-cover transition-transform duration-slow ease-quiet group-hover:scale-[1.01]" />
                )}
              </div>
              <span className="mt-3 flex items-center justify-between gap-4 text-sm">
                <span className="text-white/80 truncate">{vessel}{specs ? ` · ${specs}` : ""}</span>
                <span className="text-accent-300 group-hover:text-accent-200 transition-colors duration-fast shrink-0">Open the slideshow →</span>
              </span>
            </a>
          </Block>

          <Block
            index="02"
            title="Reels."
            lines={[
              "Vertical reels made from the listing’s own photographs, sized for Instagram and Facebook.",
              "Two looks, Walkthrough and Underway, each with its own pace and music.",
            ]}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-sm sm:max-w-xl mx-auto md:mx-0">
              {reels.map((r) => <Reel key={r.look} reel={r} poster={hero} />)}
            </div>
          </Block>

          <Block
            index="03"
            title="Shared."
            lines={[
              "Send the slideshow link and it opens as a card: her name, her specifications, the cover photograph.",
              "Client galleries carry downloads that close on the date you set.",
            ]}
          >
            {/* An illustration of the link preview, built from the listing's real data. */}
            <div className="max-w-sm">
              <div className="ml-auto w-[85%] overflow-hidden rounded-[1.25rem] bg-white/[0.06] border border-hairline-inverse">
                <div className="relative aspect-[1200/630] bg-ink-900">
                  {hero && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={hero} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
                  )}
                </div>
                <div className="px-4 py-3">
                  <p className="text-white text-sm font-semibold truncate">{vessel}{specs ? ` — ${specs}` : ""}</p>
                  <p className="text-ink-400 text-xs mt-0.5">portal.yachtpics.com</p>
                </div>
              </div>
            </div>
            <a href={slideshowHref} target="_blank" rel="noopener noreferrer" className={`${quietLink} mt-4`}>See what the buyer sees →</a>
          </Block>

          <Block
            index="04"
            title="Posted."
            lines={[
              "Reels leave the Portal ready for Facebook and Instagram.",
              "Send one to your phone and it is posted in a minute.",
            ]}
          >
            <ol className="flex flex-wrap items-center gap-x-3 gap-y-3" aria-label="Reel, caption, live">
              {["Reel", "Caption", "Live"].map((step, i) => (
                <li key={step} className="flex items-center gap-3">
                  {i > 0 && <span aria-hidden className="text-white/25">→</span>}
                  <span className="label-caps-inverse text-white/70 border border-hairline-inverse rounded-ctl px-3 py-2">{step}</span>
                </li>
              ))}
            </ol>
          </Block>
        </div>
      </section>

      {/* In numbers — live, omitted if any figure can't be read */}
      {stats && (
        <section className="relative px-4 sm:px-8 py-16 sm:py-20 border-t border-hairline-inverse-soft">
          <div className="max-w-5xl mx-auto">
            <p className="label-caps-inverse mb-10">In numbers</p>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-10">
              {[
                { label: "Active brokers", value: stats.brokers },
                { label: "Listings delivered", value: stats.listings },
                { label: "Photos delivered", value: stats.photos },
              ].map((s) => (
                <div key={s.label}>
                  <dd className="text-white text-4xl sm:text-5xl font-light tracking-tight tabular-nums">{fmt(s.value)}</dd>
                  <dt className="label-caps-inverse mt-3">{s.label}</dt>
                </div>
              ))}
            </dl>
          </div>
        </section>
      )}

      {/* From the brokers who use it — hidden until quotes are supplied */}
      {SEE_QUOTES.length > 0 && (
        <section className="relative px-4 sm:px-8 py-16 sm:py-20 border-t border-hairline-inverse-soft">
          <div className="max-w-5xl mx-auto">
            <p className="label-caps-inverse mb-10">From the brokers who use it</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              {SEE_QUOTES.map((q) => (
                <figure key={`${q.name}-${q.quote.slice(0, 24)}`}>
                  <blockquote className="text-white/90 text-lg font-light leading-relaxed">&ldquo;{q.quote}&rdquo;</blockquote>
                  <figcaption className="mt-4 text-sm text-ink-400">
                    {q.name}<span className="text-ink-600"> · </span>{q.brokerage}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Plans */}
      <section className="relative px-4 sm:px-8 py-16 sm:py-20 border-t border-hairline-inverse-soft">
        <div className="max-w-5xl mx-auto">
          <p className="label-caps-inverse mb-4">Plans</p>
          <p className="text-white text-h1 font-medium max-w-xl">
            Plans from ${fromPrice} a month for individual brokers; office plans for brokerages.
          </p>
          <Link
            href="/auth/signup"
            className="mt-8 bg-accent-500 hover:bg-accent-400 text-ink-950 font-semibold px-8 py-3 min-h-[44px] inline-flex items-center rounded-ctl transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
          >
            Request access
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-hairline-inverse-soft px-4 sm:px-8 py-6 text-center">
        <p className="text-ink-500 text-sm">
          © YachtPics Enterprises LLC · North Palm Beach, Florida
        </p>
        <p className="text-ink-500 text-sm mt-2">
          <Link href="/privacy" className="hover:text-ink-300 transition-colors duration-fast">Privacy</Link>
          {" · "}
          <a href="https://www.yachtpics.com" className="hover:text-ink-300 transition-colors duration-fast">yachtpics.com</a>
        </p>
      </footer>
    </main>
  );
}
