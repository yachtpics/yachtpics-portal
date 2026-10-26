import { MessageCircle, MessageSquare, Phone } from "lucide-react";
import PresentedThrough from "@/components/PresentedThrough";
import type { SiteBase } from "@/lib/brokerSiteServer";
import { dialable, whatsappDigits } from "@/lib/brokerSite";
import SiteHeader from "./SiteHeader";
import { serif } from "./fonts";

/**
 * The broker website's chrome, shared by the home page (/b/{slug}) and the
 * boat pages (/b/{slug}/yachts/{boat}): accent colours, sticky header with
 * the broker's logo or name and up to five anchors, footer with the
 * YachtPics credit, and the phone Call · Text · WhatsApp bar.
 */

function onAccent(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return lum > 0.35 ? "#050b14" : "#ffffff";
}

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
  children,
}: {
  s: SiteBase;
  shown: SiteSectionsShown;
  /** "" on the home page (plain #anchors); "/b/{slug}" on sub-pages. */
  base: string;
  children: React.ReactNode;
}) {
  const phone = dialable(s.phone);
  const phoneDisplay = s.phone ? prettyPhone(s.phone) : null;
  const wa = whatsappDigits(s.site.whatsapp);
  const year = new Date().getFullYear();

  const nav = [
    shown.yachts ? { href: `${base}#yachts`, label: "Yachts" } : null,
    shown.sold ? { href: `${base}#sold`, label: "Sold" } : null,
    shown.about ? { href: `${base}#about`, label: "About" } : null,
    shown.sell ? { href: `${base}#sell`, label: "Sell" } : null,
    { href: `${base}#contact`, label: "Contact" },
  ].filter((n): n is { href: string; label: string } => !!n);

  const mobileBar = [
    phone ? { href: `tel:${phone}`, label: "Call", icon: Phone } : null,
    phone ? { href: `sms:${phone}`, label: "Text", icon: MessageSquare } : null,
    wa ? { href: `https://wa.me/${wa}`, label: "WhatsApp", icon: MessageCircle } : null,
  ].filter((x): x is { href: string; label: string; icon: typeof Phone } => !!x);

  const accentStyle = { "--site-accent": s.accent, "--site-on-accent": onAccent(s.accent) } as React.CSSProperties;

  return (
    <div id="top" style={accentStyle} className={`min-h-screen bg-white text-ink-900 ${mobileBar.length ? "pb-20 md:pb-0" : ""}`}>
      <SiteHeader
        name={s.name}
        logoUrl={s.logoUrl}
        phone={phone}
        phoneDisplay={phoneDisplay}
        nav={nav}
        serifClass={serif.className}
        homeHref={base ? base : "#top"}
      />

      {children}

      {/* Footer */}
      <footer className="border-t border-hairline px-4 sm:px-8 py-10">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
          <div className="text-sm text-ink-500 space-y-1">
            {s.brokerageName && <p className="text-ink-700">{s.brokerageName}</p>}
            {s.license && <p>License {s.license}</p>}
            <p>&copy; {year} {s.name}</p>
          </div>
          <PresentedThrough className="sm:text-right" />
        </div>
      </footer>

      {/* Phone action bar */}
      {mobileBar.length > 0 && (
        <nav aria-label="Contact" className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-hairline pb-[env(safe-area-inset-bottom)]">
          <div className="flex">
            {mobileBar.map((b) => (
              <a
                key={b.label}
                href={b.href}
                {...(b.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="flex-1 min-h-[56px] flex flex-col items-center justify-center gap-1 text-[0.6875rem] font-semibold uppercase tracking-caps text-ink-900 border-r border-hairline last:border-r-0"
              >
                <b.icon className="w-5 h-5 text-[var(--site-accent)]" aria-hidden />
                {b.label}
              </a>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
