import type { Metadata } from "next";
import { MessageCircle, Phone } from "lucide-react";
import { getPublicBrokerSite, type PublicBrokerSite } from "@/lib/brokerSiteServer";
import { dialable, whatsappDigits } from "@/lib/brokerSite";
import SiteShell, { prettyPhone, sectionsShown } from "./_components/SiteShell";
import { serif } from "./_components/fonts";
import YachtGrid from "./_components/YachtGrid";
import LeadForm from "./_components/LeadForm";
import Unavailable from "./_components/Unavailable";

/**
 * /b/[slug] — a broker's personal website (Oct 26). Public (the middleware
 * doesn't match /b), rebuilt at most hourly and on every save in the editor
 * (revalidatePath in /api/website). Everything comes from the broker's own
 * Portal data via src/lib/brokerSiteServer.ts; empty fields hide their
 * element — nothing placeholder is ever rendered.
 *
 * Not shown ("This page isn't available", noindex) when the slug is unknown,
 * the site is unpublished, or the broker isn't entitled: Portal access AND
 * (Elite, the $50 website line on their plan, or an admin comp) — websiteEntitlement in
 * src/lib/websiteAddon.ts.
 */
export const revalidate = 3600;

function description(s: PublicBrokerSite): string {
  return (
    s.site.headline ||
    s.site.specialty ||
    [`${s.name}, yacht broker`, s.brokerageName ? `with ${s.brokerageName}` : null].filter(Boolean).join(" ")
  );
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const s = await getPublicBrokerSite(params.slug).catch(() => null);
  if (!s) return { title: "This page isn't available", robots: { index: false, follow: false } };
  const title = `${s.name} — Yacht Broker`;
  const desc = description(s);
  return {
    title,
    description: desc,
    openGraph: {
      title,
      description: desc,
      type: "profile",
      ...(s.og ? { images: [{ url: s.og, width: 1200, height: 630, alt: s.name }] } : {}),
    },
    twitter: {
      card: s.og ? "summary_large_image" : "summary",
      title,
      description: desc,
      ...(s.og ? { images: [s.og] } : {}),
    },
  };
}

function SectionTitle({ kicker, title, id }: { kicker?: string; title: string; id?: string }) {
  return (
    <div className="mb-10 sm:mb-14">
      {kicker && <p className="text-[0.6875rem] font-semibold uppercase tracking-caps-wide text-ink-500 mb-3">{kicker}</p>}
      <h2 id={id} className={`${serif.className} text-[2.25rem] sm:text-[2.875rem] leading-[1.05] text-ink-950`}>{title}</h2>
      <div className="mt-5 h-px w-12 bg-[var(--site-accent)]" />
    </div>
  );
}

export default async function BrokerSitePage({ params }: { params: { slug: string } }) {
  const s = await getPublicBrokerSite(params.slug).catch(() => null);
  if (!s) return <Unavailable />;

  const { site } = s;
  const phone = dialable(s.phone);
  const phoneDisplay = s.phone ? prettyPhone(s.phone) : null;
  const wa = whatsappDigits(site.whatsapp);
  const stats = site.stats.filter((x) => x.value && x.label);
  const shown = sectionsShown(s, { yachts: s.yachts.length, sold: s.sold.length });
  const showSold = shown.sold;
  const showAbout = shown.about;
  const showTestimonials = site.sections.testimonials && site.testimonials.length > 0;
  const showSell = shown.sell;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "RealEstateAgent",
    name: s.name,
    ...(s.site.headline ? { description: s.site.headline } : {}),
    ...(s.phone ? { telephone: s.phone } : {}),
    ...(s.email ? { email: s.email } : {}),
    ...(s.portrait ? { image: s.portrait } : s.og ? { image: s.og } : {}),
    url: `https://portal.yachtpics.com/b/${site.slug}`,
    ...(s.brokerageName
      ? { parentOrganization: { "@type": "Organization", name: s.brokerageName, ...(s.brokerageWebsite ? { url: s.brokerageWebsite } : {}) } }
      : {}),
  };

  return (
    <SiteShell s={s} shown={shown} base="">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      {/* Hero */}
      <section className="relative min-h-[78vh] sm:min-h-[86vh] flex items-end bg-ink-950 overflow-hidden">
        {s.hero && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.hero} alt="" loading="eager" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
        )}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-ink-950/85 via-ink-950/35 to-ink-950/10" />
        <div className="relative w-full max-w-6xl mx-auto px-4 sm:px-8 pb-14 sm:pb-20 pt-32">
          {s.brokerageName && <p className="text-[0.6875rem] font-semibold uppercase tracking-caps-wide text-white/70 mb-4">{s.brokerageName}</p>}
          <h1 className={`${serif.className} text-white text-[3rem] sm:text-[5rem] lg:text-[5.75rem] leading-[0.95] font-medium tracking-[-0.01em] max-w-4xl`}>
            {s.name}
          </h1>
          {(site.headline || site.specialty) && (
            <p className="text-white/85 text-lg sm:text-xl mt-5 max-w-2xl leading-relaxed">{site.headline || site.specialty}</p>
          )}
          {site.headline && site.specialty && <p className="text-white/60 text-[0.9375rem] mt-2 max-w-2xl">{site.specialty}</p>}
          <div className="mt-9 flex flex-wrap gap-3">
            {s.yachts.length > 0 && (
              <a href="#yachts" className="min-h-[48px] inline-flex items-center px-7 bg-[var(--site-accent)] text-[var(--site-on-accent)] text-[0.9375rem] font-semibold tracking-wide hover:opacity-90 transition-opacity duration-fast">
                View yachts
              </a>
            )}
            {phone && (
              <a href={`tel:${phone}`} className="min-h-[48px] inline-flex items-center px-7 border border-white/50 text-white text-[0.9375rem] font-semibold tracking-wide hover:bg-white/10 transition-colors duration-fast">
                Call {s.firstName}
              </a>
            )}
          </div>
        </div>
      </section>

      {/* Proof strip */}
      {stats.length > 0 && (
        <section aria-label="At a glance" className="border-b border-hairline">
          <div className={`max-w-6xl mx-auto px-4 sm:px-8 py-10 sm:py-12 grid gap-8 grid-cols-2 ${stats.length >= 4 ? "md:grid-cols-4" : stats.length === 3 ? "md:grid-cols-3" : ""}`}>
            {stats.map((st, i) => (
              <div key={i} className="text-center md:text-left">
                <p className={`${serif.className} text-[2.25rem] sm:text-[2.75rem] leading-none text-ink-950`}>{st.value}</p>
                <p className="text-[0.6875rem] font-semibold uppercase tracking-caps text-ink-500 mt-3">{st.label}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Yachts */}
      {s.yachts.length > 0 && (
        <section id="yachts" aria-labelledby="yachts-title" className="scroll-mt-20 px-4 sm:px-8 py-18 sm:py-24">
          <div className="max-w-6xl mx-auto">
            <SectionTitle id="yachts-title" kicker={`${s.yachts.length} ${s.yachts.length === 1 ? "yacht" : "yachts"}`} title="Yachts for sale" />
            <YachtGrid cards={s.yachts} slug={site.slug} firstName={s.firstName} serifClass={serif.className} showPrices={site.show_prices} />
          </div>
        </section>
      )}

      {/* Recent sales */}
      {showSold && (
        <section id="sold" aria-labelledby="sold-title" className="scroll-mt-20 px-4 sm:px-8 py-18 sm:py-24 bg-ink-50">
          <div className="max-w-6xl mx-auto">
            <SectionTitle id="sold-title" title="Recent sales" />
            <YachtGrid cards={s.sold} slug={site.slug} firstName={s.firstName} serifClass={serif.className} sold />
          </div>
        </section>
      )}

      {/* About */}
      {showAbout && (
        <section id="about" aria-labelledby="about-title" className="scroll-mt-20 px-4 sm:px-8 py-18 sm:py-24">
          <div className={`max-w-6xl mx-auto grid gap-12 ${s.portrait ? "md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16 md:items-start" : ""}`}>
            {s.portrait && (
              <div className="relative aspect-[4/5] overflow-hidden bg-ink-100 max-w-md">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.portrait} alt={s.name} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
              </div>
            )}
            <div className="max-w-2xl">
              <SectionTitle id="about-title" kicker="About" title={s.name} />
              {site.credentials && <p className="text-ink-700 text-[0.9375rem] font-medium tracking-wide mb-6">{site.credentials}</p>}
              {s.bio && (
                <div className="space-y-4 text-ink-700 text-[1.0625rem] leading-[1.75]">
                  {s.bio.split(/\n{2,}/).map((para, i) => <p key={i} className="whitespace-pre-line">{para}</p>)}
                </div>
              )}
              {(s.brokerageName || s.brokerageLogoUrl || s.license) && (
                <div className="mt-10 pt-8 border-t border-hairline flex items-center gap-5">
                  {s.brokerageLogoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.brokerageLogoUrl} alt={s.brokerageName ?? ""} className="h-10 w-auto max-w-[160px] object-contain" />
                  )}
                  <div>
                    {s.brokerageName && <p className="text-ink-900 text-[0.9375rem] font-semibold">{s.brokerageName}</p>}
                    {s.license && <p className="text-ink-500 text-xs mt-0.5">License {s.license}</p>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Testimonials */}
      {showTestimonials && (
        <section aria-labelledby="words-title" className="px-4 sm:px-8 py-18 sm:py-24 bg-ink-950 text-white">
          <div className="max-w-6xl mx-auto">
            <h2 id="words-title" className={`${serif.className} text-[2.25rem] sm:text-[2.875rem] leading-[1.05]`}>From clients</h2>
            <div className="mt-5 h-px w-12 bg-[var(--site-accent)]" />
            <ul className={`mt-12 grid gap-x-12 gap-y-14 ${site.testimonials.length > 1 ? "md:grid-cols-2" : ""}`}>
              {site.testimonials.map((t, i) => (
                <li key={i}>
                  <blockquote>
                    <p className={`${serif.className} text-[1.5rem] sm:text-[1.75rem] leading-snug text-white/95`}>&ldquo;{t.quote}&rdquo;</p>
                    <footer className="mt-5 text-[0.8125rem] uppercase tracking-caps text-white/55">
                      {t.name}
                      {t.place ? <span className="text-white/40"> · {t.place}</span> : null}
                    </footer>
                  </blockquote>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Selling your yacht? */}
      {showSell && (
        <section id="sell" aria-labelledby="sell-title" className="scroll-mt-20 px-4 sm:px-8 py-18 sm:py-24 border-b border-hairline">
          <div className="max-w-6xl mx-auto grid gap-12 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16">
            <div>
              <SectionTitle id="sell-title" kicker="Selling your yacht?" title="What's my boat worth?" />
              <p className="text-ink-600 text-[1.0625rem] leading-relaxed max-w-md">
                Tell {s.firstName} about your boat and you&rsquo;ll get a considered view of today&rsquo;s market — no obligation.
              </p>
            </div>
            <div className="max-w-xl">
              <LeadForm slug={site.slug} kind="valuation" firstName={s.firstName} submitLabel="Ask for a valuation" />
            </div>
          </div>
        </section>
      )}

      {/* Contact */}
      <section id="contact" aria-labelledby="contact-title" className="scroll-mt-20 px-4 sm:px-8 py-18 sm:py-24">
        <div className="max-w-6xl mx-auto grid gap-12 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16">
          <div>
            <SectionTitle id="contact-title" kicker="Contact" title={`Talk to ${s.firstName}`} />
            <ul className="space-y-1 text-[1.0625rem]">
              {phone && phoneDisplay && (
                <li>
                  <a href={`tel:${phone}`} className="inline-flex items-center gap-3 min-h-[44px] text-ink-900 hover:text-ink-600 tabular-nums">
                    <Phone className="w-4 h-4 text-ink-400" aria-hidden />
                    {phoneDisplay}
                  </a>
                </li>
              )}
              {s.email && (
                <li>
                  <a href={`mailto:${s.email}`} className="inline-flex items-center gap-3 min-h-[44px] text-ink-900 hover:text-ink-600 break-all">
                    <span aria-hidden className="w-4 text-center text-ink-400">@</span>
                    {s.email}
                  </a>
                </li>
              )}
              {wa && (
                <li>
                  <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-3 min-h-[44px] text-ink-900 hover:text-ink-600">
                    <MessageCircle className="w-4 h-4 text-ink-400" aria-hidden />
                    WhatsApp
                  </a>
                </li>
              )}
            </ul>
          </div>
          <div className="max-w-xl">
            <LeadForm slug={site.slug} kind="contact" firstName={s.firstName} submitLabel="Send message" />
          </div>
        </div>
      </section>

    </SiteShell>
  );
}
