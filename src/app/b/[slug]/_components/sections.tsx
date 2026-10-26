import { MessageCircle, Phone } from "lucide-react";
import type { PublicBrokerSite } from "@/lib/brokerSiteServer";
import type { SiteLayout } from "@/lib/siteStyle";
import { dialable, whatsappDigits } from "@/lib/brokerSite";
import YachtGrid from "./YachtGrid";
import LeadForm from "./LeadForm";
import ShowroomSlides from "./ShowroomSlides";
import { prettyPhone, type SiteSectionsShown } from "./SiteShell";

/**
 * The home page's sections, shared by the three layouts (Oct 26). Same
 * content everywhere; `layout` changes composition only. Colours are the
 * site's CSS variables (src/lib/siteStyle.ts); over photographs text is white.
 */

export type HomeProps = {
  s: PublicBrokerSite;
  layout: SiteLayout;
  display: string;
  shown: SiteSectionsShown;
};

const btnAccent =
  "min-h-[48px] inline-flex items-center px-7 bg-[var(--site-accent)] text-[var(--site-on-accent)] text-[0.9375rem] font-semibold tracking-wide hover:opacity-90 transition-opacity duration-fast";

function width(layout: SiteLayout, kind: "text" | "wide"): string {
  if (layout === "editorial") return kind === "text" ? "max-w-3xl" : "max-w-5xl";
  return "max-w-6xl";
}

export function SectionTitle({ display, kicker, title, id, center = false }: { display: string; kicker?: string; title: string; id?: string; center?: boolean }) {
  return (
    <div className={`mb-10 sm:mb-14 ${center ? "text-center" : ""}`}>
      {kicker && <p className="text-[0.6875rem] font-semibold uppercase tracking-caps-wide text-[var(--site-muted)] mb-3">{kicker}</p>}
      <h2 id={id} className={`${display} text-[2.25rem] sm:text-[2.875rem] leading-[1.05] text-[var(--site-ink)]`}>{title}</h2>
      <div className={`mt-5 h-px w-12 bg-[var(--site-accent)] ${center ? "mx-auto" : ""}`} />
    </div>
  );
}

// ── Heroes ───────────────────────────────────────────────────────────────────

export function Hero({ s, layout, display }: HomeProps) {
  const phone = dialable(s.phone);
  const { site } = s;
  const lines = (
    <>
      {(site.headline || site.specialty) && <p className="text-lg sm:text-xl mt-5 max-w-2xl leading-relaxed opacity-90">{site.headline || site.specialty}</p>}
      {site.headline && site.specialty && <p className="text-[0.9375rem] mt-2 max-w-2xl opacity-70">{site.specialty}</p>}
    </>
  );

  if (layout === "editorial") {
    return (
      <section className="px-4 sm:px-8 pt-10 sm:pt-16 pb-16 sm:pb-24">
        <div className="max-w-6xl mx-auto grid gap-10 md:grid-cols-12 md:items-center">
          <div className="md:col-span-6 lg:col-span-5 text-[var(--site-ink)]">
            {s.brokerageName && <p className="text-[0.6875rem] font-semibold uppercase tracking-caps-wide text-[var(--site-muted)] mb-6">{s.brokerageName}</p>}
            <h1 className={`${display} text-[3.25rem] sm:text-[4.5rem] lg:text-[5.25rem] leading-[0.98] tracking-[-0.015em]`}>{s.name}</h1>
            <div className="mt-6 h-px w-16 bg-[var(--site-accent)]" />
            <div className="text-[var(--site-muted)]">{lines}</div>
            <div className="mt-9 flex flex-wrap gap-3">
              {s.yachts.length > 0 && <a href="#yachts" className={btnAccent}>View yachts</a>}
              {phone && (
                <a href={`tel:${phone}`} className="min-h-[48px] inline-flex items-center px-7 border border-[var(--site-ink)] text-[var(--site-ink)] text-[0.9375rem] font-semibold tracking-wide hover:bg-[var(--site-surface)] transition-colors duration-fast">
                  Call {s.firstName}
                </a>
              )}
            </div>
          </div>
          <div className="md:col-span-6 lg:col-span-7">
            <div className="relative aspect-[4/5] md:aspect-auto md:h-[78vh] overflow-hidden bg-[var(--site-surface)]">
              {s.hero && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.hero} alt="" loading="eager" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (layout === "showroom") {
    const slides = s.heroSlides.length ? s.heroSlides : s.hero ? [s.hero] : [];
    return (
      <section className="relative h-[calc(100svh-4rem)] sm:h-[calc(100svh-4.5rem)] min-h-[520px] flex items-end overflow-hidden bg-[var(--site-band-bg)]">
        {slides.length > 0 && <ShowroomSlides urls={slides} />}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-black/30" />
        <div className="relative w-full max-w-6xl mx-auto px-4 sm:px-8 pb-16 sm:pb-24 text-white text-center">
          <h1 className={`${display} text-[2rem] sm:text-[2.75rem] leading-tight font-medium tracking-[0.04em]`}>{s.name}</h1>
          <div className="mx-auto mt-4 h-px w-12 bg-[var(--site-accent)]" />
          {(site.headline || site.specialty) && <p className="mt-4 text-[0.9375rem] sm:text-base text-white/80 max-w-xl mx-auto">{site.headline || site.specialty}</p>}
          {s.yachts.length > 0 && (
            <a href="#yachts" className="mt-8 inline-flex items-center min-h-[48px] px-7 border border-white/60 text-[0.8125rem] font-semibold uppercase tracking-caps-wide hover:bg-white/10 transition-colors duration-fast">
              View the yachts
            </a>
          )}
        </div>
      </section>
    );
  }

  // classic
  return (
    <section className="relative min-h-[78vh] sm:min-h-[86vh] flex items-end bg-[var(--site-band-bg)] overflow-hidden">
      {s.hero && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={s.hero} alt="" loading="eager" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/5" />
      <div className="relative w-full max-w-6xl mx-auto px-4 sm:px-8 pb-14 sm:pb-20 pt-32 text-white">
        {s.brokerageName && <p className="text-[0.6875rem] font-semibold uppercase tracking-caps-wide text-white/70 mb-4">{s.brokerageName}</p>}
        <h1 className={`${display} text-[3rem] sm:text-[5rem] lg:text-[5.75rem] leading-[0.95] font-medium tracking-[-0.01em] max-w-4xl`}>{s.name}</h1>
        {lines}
        <div className="mt-9 flex flex-wrap gap-3">
          {s.yachts.length > 0 && <a href="#yachts" className={btnAccent}>View yachts</a>}
          {phone && (
            <a href={`tel:${phone}`} className="min-h-[48px] inline-flex items-center px-7 border border-white/50 text-white text-[0.9375rem] font-semibold tracking-wide hover:bg-white/10 transition-colors duration-fast">
              Call {s.firstName}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Proof strip ──────────────────────────────────────────────────────────────

export function ProofStrip({ s, layout, display }: HomeProps) {
  const stats = s.site.stats.filter((x) => x.value && x.label);
  if (stats.length === 0) return null;
  const cols = stats.length >= 4 ? "md:grid-cols-4" : stats.length === 3 ? "md:grid-cols-3" : "";
  return (
    <section aria-label="At a glance" className={`border-b border-[var(--site-rule)] ${layout === "editorial" ? "border-t" : ""}`}>
      <div className={`${width(layout, "wide")} mx-auto px-4 sm:px-8 py-10 sm:py-12 grid gap-8 grid-cols-2 ${cols}`}>
        {stats.map((st, i) => (
          <div key={i} className={layout === "classic" ? "text-center md:text-left" : "text-center"}>
            <p className={`${display} text-[2.25rem] sm:text-[2.75rem] leading-none text-[var(--site-ink)]`}>{st.value}</p>
            <p className="text-[0.6875rem] font-semibold uppercase tracking-caps text-[var(--site-muted)] mt-3">{st.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Yachts / sold ────────────────────────────────────────────────────────────

export function Yachts({ s, layout, display }: HomeProps) {
  if (s.yachts.length === 0) return null;
  const variant = layout === "editorial" ? "rows" : layout === "showroom" ? "tiles" : "grid";
  return (
    <section id="yachts" aria-labelledby="yachts-title" className={`scroll-mt-20 py-18 sm:py-24 ${layout === "showroom" ? "px-3 sm:px-6" : "px-4 sm:px-8"}`}>
      <div className={`${layout === "showroom" ? "max-w-[96rem]" : width(layout, "wide")} mx-auto`}>
        <div className={layout === "showroom" ? "px-1 sm:px-2" : ""}>
          <SectionTitle
            display={display}
            id="yachts-title"
            kicker={`${s.yachts.length} ${s.yachts.length === 1 ? "yacht" : "yachts"}`}
            title="Yachts for sale"
            center={layout !== "classic"}
          />
        </div>
        <YachtGrid cards={s.yachts} slug={s.site.slug} firstName={s.firstName} serifClass={display} showPrices={s.site.show_prices} variant={variant} />
      </div>
    </section>
  );
}

export function Sold({ s, layout, display, shown }: HomeProps) {
  if (!shown.sold) return null;
  const variant = layout === "showroom" ? "tiles" : "grid";
  return (
    <section id="sold" aria-labelledby="sold-title" className="scroll-mt-20 px-4 sm:px-8 py-18 sm:py-24 bg-[var(--site-surface)]">
      <div className={`${width(layout, "wide")} mx-auto`}>
        <SectionTitle display={display} id="sold-title" title="Recent sales" center={layout !== "classic"} />
        <YachtGrid cards={s.sold} slug={s.site.slug} firstName={s.firstName} serifClass={display} sold variant={variant} />
      </div>
    </section>
  );
}

// ── About ────────────────────────────────────────────────────────────────────

export function About({ s, layout, display, shown }: HomeProps) {
  if (!shown.about) return null;
  const { site } = s;
  const narrow = layout === "editorial";
  return (
    <section id="about" aria-labelledby="about-title" className="scroll-mt-20 px-4 sm:px-8 py-18 sm:py-24">
      <div className={`${width(layout, narrow ? "text" : "wide")} mx-auto grid gap-12 ${s.portrait && !narrow ? "md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16 md:items-start" : ""}`}>
        {s.portrait && (
          <div className={`relative aspect-[4/5] overflow-hidden bg-[var(--site-surface)] ${narrow ? "max-w-sm mx-auto w-full" : "max-w-md"}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.portrait} alt={s.name} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
          </div>
        )}
        <div className={narrow ? "" : "max-w-2xl"}>
          <SectionTitle display={display} id="about-title" kicker="About" title={s.name} center={narrow} />
          {site.credentials && <p className={`text-[var(--site-ink)] text-[0.9375rem] font-medium tracking-wide mb-6 ${narrow ? "text-center" : ""}`}>{site.credentials}</p>}
          {s.bio && (
            <div className={`space-y-4 text-[var(--site-ink)] opacity-90 leading-[1.8] ${narrow ? "text-[1.125rem]" : "text-[1.0625rem]"}`}>
              {s.bio.split(/\n{2,}/).map((para, i) => <p key={i} className="whitespace-pre-line">{para}</p>)}
            </div>
          )}
          {(s.brokerageName || s.brokerageLogoUrl || s.license) && (
            <div className={`mt-10 pt-8 border-t border-[var(--site-rule)] flex items-center gap-5 ${narrow ? "justify-center" : ""}`}>
              {s.brokerageLogoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.brokerageLogoUrl} alt={s.brokerageName ?? ""} className="h-10 w-auto max-w-[160px] object-contain" />
              )}
              <div>
                {s.brokerageName && <p className="text-[var(--site-ink)] text-[0.9375rem] font-semibold">{s.brokerageName}</p>}
                {s.license && <p className="text-[var(--site-muted)] text-xs mt-0.5">License {s.license}</p>}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Testimonials ─────────────────────────────────────────────────────────────

export function Testimonials({ s, layout, display }: HomeProps) {
  const { site } = s;
  if (!site.sections.testimonials || site.testimonials.length === 0) return null;

  if (layout === "editorial") {
    return (
      <section aria-labelledby="words-title" className="px-4 sm:px-8 py-18 sm:py-28 bg-[var(--site-surface)]">
        <div className="max-w-3xl mx-auto text-center">
          <h2 id="words-title" className="sr-only">From clients</h2>
          <ul className="space-y-20">
            {site.testimonials.map((t, i) => (
              <li key={i}>
                <blockquote>
                  <span aria-hidden className={`${display} block text-[4rem] leading-none text-[var(--site-accent-text)]`}>&ldquo;</span>
                  <p className={`${display} -mt-4 text-[1.75rem] sm:text-[2.375rem] leading-[1.25] text-[var(--site-ink)]`}>{t.quote}</p>
                  <footer className="mt-6 text-[0.8125rem] uppercase tracking-caps text-[var(--site-muted)]">
                    {t.name}
                    {t.place ? <span> · {t.place}</span> : null}
                  </footer>
                </blockquote>
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="words-title" className="px-4 sm:px-8 py-18 sm:py-24 bg-[var(--site-band-bg)] text-[var(--site-band-ink)]">
      <div className={`${width(layout, "wide")} mx-auto ${layout === "showroom" ? "text-center" : ""}`}>
        <h2 id="words-title" className={`${display} text-[2.25rem] sm:text-[2.875rem] leading-[1.05]`}>From clients</h2>
        <div className={`mt-5 h-px w-12 bg-[var(--site-accent)] ${layout === "showroom" ? "mx-auto" : ""}`} />
        <ul className={`mt-12 grid gap-x-12 gap-y-14 ${site.testimonials.length > 1 ? "md:grid-cols-2" : ""}`}>
          {site.testimonials.map((t, i) => (
            <li key={i}>
              <blockquote>
                <p className={`${display} text-[1.5rem] sm:text-[1.75rem] leading-snug opacity-95`}>&ldquo;{t.quote}&rdquo;</p>
                <footer className="mt-5 text-[0.8125rem] uppercase tracking-caps opacity-60">
                  {t.name}
                  {t.place ? <span> · {t.place}</span> : null}
                </footer>
              </blockquote>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── Sell / Contact ───────────────────────────────────────────────────────────

export function Sell({ s, layout, display, shown }: HomeProps) {
  if (!shown.sell) return null;
  const narrow = layout === "editorial";
  return (
    <section id="sell" aria-labelledby="sell-title" className="scroll-mt-20 px-4 sm:px-8 py-18 sm:py-24 border-b border-[var(--site-rule)]">
      <div className={`${width(layout, narrow ? "text" : "wide")} mx-auto grid gap-12 ${narrow ? "" : "md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16"}`}>
        <div className={narrow ? "text-center" : ""}>
          <SectionTitle display={display} id="sell-title" kicker="Selling your yacht?" title="What's my boat worth?" center={narrow} />
          <p className={`text-[var(--site-muted)] text-[1.0625rem] leading-relaxed max-w-md ${narrow ? "mx-auto -mt-4" : ""}`}>
            Tell {s.firstName} about your boat and you&rsquo;ll get a considered view of today&rsquo;s market — no obligation.
          </p>
        </div>
        <div className={narrow ? "max-w-xl mx-auto w-full" : "max-w-xl"}>
          <LeadForm slug={s.site.slug} kind="valuation" firstName={s.firstName} submitLabel="Ask for a valuation" />
        </div>
      </div>
    </section>
  );
}

export function Contact({ s, layout, display }: HomeProps) {
  const phone = dialable(s.phone);
  const phoneDisplay = s.phone ? prettyPhone(s.phone) : null;
  const wa = whatsappDigits(s.site.whatsapp);
  const narrow = layout === "editorial";
  const link = "inline-flex items-center gap-3 min-h-[44px] text-[var(--site-ink)] hover:opacity-75";
  return (
    <section id="contact" aria-labelledby="contact-title" className="scroll-mt-20 px-4 sm:px-8 py-18 sm:py-24">
      <div className={`${width(layout, narrow ? "text" : "wide")} mx-auto grid gap-12 ${narrow ? "" : "md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16"}`}>
        <div className={narrow ? "text-center" : ""}>
          <SectionTitle display={display} id="contact-title" kicker="Contact" title={`Talk to ${s.firstName}`} center={narrow} />
          <ul className={`space-y-1 text-[1.0625rem] ${narrow ? "flex flex-wrap justify-center gap-x-8" : ""}`}>
            {phone && phoneDisplay && (
              <li>
                <a href={`tel:${phone}`} className={`${link} tabular-nums`}>
                  <Phone className="w-4 h-4 text-[var(--site-accent-text)]" aria-hidden />
                  {phoneDisplay}
                </a>
              </li>
            )}
            {s.email && (
              <li>
                <a href={`mailto:${s.email}`} className={`${link} break-all`}>
                  <span aria-hidden className="w-4 text-center text-[var(--site-accent-text)]">@</span>
                  {s.email}
                </a>
              </li>
            )}
            {wa && (
              <li>
                <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className={link}>
                  <MessageCircle className="w-4 h-4 text-[var(--site-accent-text)]" aria-hidden />
                  WhatsApp
                </a>
              </li>
            )}
          </ul>
        </div>
        <div className={narrow ? "max-w-xl mx-auto w-full" : "max-w-xl"}>
          <LeadForm slug={s.site.slug} kind="contact" firstName={s.firstName} submitLabel="Send message" />
        </div>
      </div>
    </section>
  );
}

/** The whole home page body for a layout (inside SiteShell). */
export function SiteHome(props: HomeProps) {
  if (props.layout === "showroom") {
    return (
      <>
        <Hero {...props} />
        <Yachts {...props} />
        <ProofStrip {...props} />
        <Sold {...props} />
        <About {...props} />
        <Testimonials {...props} />
        <Sell {...props} />
        <Contact {...props} />
      </>
    );
  }
  return (
    <>
      <Hero {...props} />
      <ProofStrip {...props} />
      <Yachts {...props} />
      <Sold {...props} />
      <About {...props} />
      <Testimonials {...props} />
      <Sell {...props} />
      <Contact {...props} />
    </>
  );
}
