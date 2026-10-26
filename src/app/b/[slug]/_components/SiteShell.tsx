import { MessageCircle, MessageSquare, Phone } from "lucide-react";
import PresentedThrough from "@/components/PresentedThrough";
import type { SiteBase } from "@/lib/brokerSiteServer";
import { dialable, whatsappDigits, type SectionKey } from "@/lib/brokerSite";
import type { ResolvedSiteStyle } from "@/lib/siteStyle";
import SiteHeader from "./SiteHeader";

/**
 * The broker website's chrome, shared by the home page (/b/{slug}) and the
 * boat pages (/b/{slug}/yachts/{boat}): accent colours, sticky header with
 * the broker's logo or name and up to five anchors, footer with the
 * YachtPics credit, and the phone Call · Text · WhatsApp bar.
 *
 * Colours come from the resolved look (src/lib/siteStyle.ts) as CSS custom
 * properties on the root — every site component uses var(--site-…).
 */

/** "(561) 602-9710" for US numbers, else as typed. */
export function prettyPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return raw.trim();
}

export type SiteSectionsShown = { yachts: boolean; sold: boolean; about: boolean; sell: boolean };

/** Which sections the home page shows (and so which anchors the nav offers). */
export function sectionsShown(s: SiteBase, counts: { yachts: number; sold: number }): SiteSectionsShown {
  return {
    yachts: counts.yachts > 0,
    sold: s.site.sections.sold && counts.sold > 0,
    about: s.site.sections.about && !!(s.bio || s.portrait || s.site.credentials || s.brokerageName || s.license),
    sell: s.site.sections.sell,
  };
}

export default function SiteShell({
  s,
  shown,
  base,
  look,
  displayClass,
  order,
  children,
}: {
  s: SiteBase;
  look: ResolvedSiteStyle;
  /** The layout's display serif class (fonts.ts). */
  displayClass: string;
  /** Section order — the nav anchors follow it. */
  order: SectionKey[];
  shown: SiteSectionsShown;
  /** "" on the home page (plain #anchors); "/b/{slug}" on sub-pages. */
  base: string;
  children: React.ReactNode;
}) {
  const phone = dialable(s.phone);
  const phoneDisplay = s.phone ? prettyPhone(s.phone) : null;
  const wa = whatsappDigits(s.site.whatsapp);
  const year = new Date().getFullYear();

  // Anchors in the same order as the sections on the page (max 5 with Contact).
  const anchors: Partial<Record<SectionKey, { on: boolean; label: string }>> = {
    yachts: { on: shown.yachts, label: "Yachts" },
    sold: { on: shown.sold, label: "Sold" },
    about: { on: shown.about, label: "About" },
    sell: { on: shown.sell, label: "Sell" },
  };
  const nav = order
    .map((k) => (anchors[k]?.on ? { href: `${base}#${k}`, label: anchors[k]!.label } : null))
    .filter((n): n is { href: string; label: string } => !!n)
    .concat([{ href: `${base}#contact`, label: "Contact" }]);

  const mobileBar = [
    phone ? { href: `tel:${phone}`, label: "Call", icon: Phone } : null,
    phone ? { href: `sms:${phone}`, label: "Text", icon: MessageSquare } : null,
    wa ? { href: `https://wa.me/${wa}`, label: "WhatsApp", icon: MessageCircle } : null,
  ].filter((x): x is { href: string; label: string; icon: typeof Phone } => !!x);

  const rootStyle = { ...look.vars, colorScheme: look.dark ? "dark" : "light" } as React.CSSProperties;

  return (
    <div id="top" data-layout={look.layout} style={rootStyle} className={`min-h-screen bg-[var(--site-bg)] text-[var(--site-ink)] ${mobileBar.length ? "pb-20 md:pb-0" : ""}`}>
      <SiteHeader
        name={s.name}
        logoUrl={s.logoUrl}
        phone={phone}
        phoneDisplay={phoneDisplay}
        nav={nav}
        serifClass={displayClass}
        homeHref={base ? base : "#top"}
      />

      {children}

      {/* Footer */}
      <footer className="border-t border-[var(--site-rule)] px-4 sm:px-8 py-10">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
          <div className="text-sm text-[var(--site-muted)] space-y-1">
            {s.brokerageName && <p className="text-[var(--site-ink)]">{s.brokerageName}</p>}
            {s.license && <p>License {s.license}</p>}
            <p>&copy; {year} {s.name}</p>
          </div>
          <PresentedThrough tone={look.dark ? "dark" : "light"} className="sm:text-right" />
        </div>
      </footer>

      {/* Phone action bar */}
      {mobileBar.length > 0 && (
        <nav aria-label="Contact" className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--site-header-bg)] backdrop-blur border-t border-[var(--site-rule)] pb-[env(safe-area-inset-bottom)]">
          <div className="flex">
            {mobileBar.map((b) => (
              <a
                key={b.label}
                href={b.href}
                {...(b.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="flex-1 min-h-[56px] flex flex-col items-center justify-center gap-1 text-[0.6875rem] font-semibold uppercase tracking-caps text-[var(--site-ink)] border-r border-[var(--site-rule)] last:border-r-0"
              >
                <b.icon className="w-5 h-5 text-[var(--site-accent-text)]" aria-hidden />
                {b.label}
              </a>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
