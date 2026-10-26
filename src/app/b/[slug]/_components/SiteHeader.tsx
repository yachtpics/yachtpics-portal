"use client";

import { useEffect, useState } from "react";
import { Menu, Phone, X } from "lucide-react";

/** Sticky header: logo or wordmark, up to five anchors, phone; a menu on phones. */
export default function SiteHeader({
  name,
  logoUrl,
  phone,
  phoneDisplay,
  nav,
  serifClass,
  homeHref = "#top",
}: {
  name: string;
  logoUrl: string | null;
  phone: string | null;
  phoneDisplay: string | null;
  nav: { href: string; label: string }[];
  serifClass: string;
  /** Where the logo / name links: "#top" on the home page, "/b/{slug}" on sub-pages. */
  homeHref?: string;
}) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={`sticky top-0 z-50 transition-colors duration-slow ${
        scrolled || open ? "bg-white/95 backdrop-blur border-b border-hairline" : "bg-white border-b border-transparent"
      }`}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-8 h-16 sm:h-[4.5rem] flex items-center justify-between gap-6">
        <a href={homeHref} className="min-h-[44px] inline-flex items-center min-w-0" aria-label={name}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={name} className="h-9 sm:h-10 w-auto max-w-[180px] object-contain" />
          ) : (
            <span className={`${serifClass} text-[1.5rem] sm:text-[1.625rem] leading-none tracking-[0.01em] text-ink-950 truncate`}>{name}</span>
          )}
        </a>

        <nav aria-label="Sections" className="hidden md:flex items-center gap-8">
          {nav.map((n) => (
            <a key={n.href} href={n.href} className="text-[0.8125rem] font-medium uppercase tracking-caps text-ink-600 hover:text-ink-950 transition-colors duration-fast min-h-[44px] inline-flex items-center">
              {n.label}
            </a>
          ))}
          {phone && phoneDisplay && (
            <a href={`tel:${phone}`} className="inline-flex items-center gap-2 min-h-[44px] text-sm font-semibold text-ink-950 tabular-nums">
              <Phone className="w-4 h-4 text-[var(--site-accent)]" aria-hidden />
              {phoneDisplay}
            </a>
          )}
        </nav>

        <div className="md:hidden flex items-center gap-1">
          {phone && (
            <a href={`tel:${phone}`} aria-label={`Call ${name}`} className="inline-flex items-center justify-center w-11 h-11 rounded-full text-ink-900">
              <Phone className="w-5 h-5" aria-hidden />
            </a>
          )}
          <button
            type="button"
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center justify-center w-11 h-11 rounded-full text-ink-900"
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {open && (
        <nav id="site-menu" aria-label="Sections" className="md:hidden border-t border-hairline bg-white px-4 pb-4">
          {nav.map((n) => (
            <a key={n.href} href={n.href} onClick={() => setOpen(false)} className="flex items-center min-h-[48px] border-b border-hairline text-[0.9375rem] text-ink-900">
              {n.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}
