import Link from "next/link";

export default function Home() {
  return (
    <main className="relative min-h-screen bg-ink-950 flex flex-col overflow-hidden">
      {/* Ambient composition — a faint champagne glow behind the hero */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-48 left-1/2 h-96 w-[52rem] -translate-x-1/2 rounded-full bg-accent-500/[0.06] blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative border-b border-hairline-inverse-soft px-6 sm:px-8 py-5 flex items-center justify-between gap-4">
        <span className="text-white text-lg font-light uppercase tracking-caps-wide leading-none">
          YachtPics
        </span>
        <Link
          href="/auth/login"
          className="text-sm text-ink-300 hover:text-white transition-colors duration-fast min-h-[44px] inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 rounded-sm px-1"
        >
          Broker Login →
        </Link>
      </header>

      {/* Hero */}
      <section className="relative flex-1 flex flex-col items-center justify-center px-6 text-center py-24">
        <p className="text-[0.6875rem] font-medium uppercase tracking-caps-wide [text-indent:0.24em] text-accent-300/90 mb-6">
          Professional Yacht Photography Delivery
        </p>
        <h1 className="text-white text-4xl sm:text-5xl font-semibold tracking-tight max-w-2xl leading-tight mb-6">
          Your listings.<br />Presented perfectly.
        </h1>
        <p className="text-ink-400 text-lg max-w-xl mb-10">
          Download your professional shoot photos, build branded slideshows, and share polished presentations with buyers — all in under 60 seconds.
        </p>
        <div className="flex gap-4 flex-wrap justify-center">
          <Link
            href="/auth/login"
            className="bg-accent-500 hover:bg-accent-400 text-ink-950 font-semibold px-8 py-3 min-h-[44px] inline-flex items-center rounded-ctl transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
          >
            Broker Login
          </Link>
          <Link
            href="/auth/signup"
            className="border border-hairline-inverse hover:border-white/40 text-white px-8 py-3 min-h-[44px] inline-flex items-center rounded-ctl transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
          >
            Request Access
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="relative px-6 sm:px-8 py-16 border-t border-hairline-inverse-soft">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-8">
          {[
            {
              title: "Photo Delivery",
              desc: "Your shoot photos organized by category — exterior, interior, detail, aerial. Download any or all in one click.",
            },
            {
              title: "Slideshow Builder",
              desc: "Select photos, your logo appears automatically. One click generates a branded, mobile-optimized link for any buyer.",
            },
            {
              title: "Any Listing",
              desc: "Upload photos from listings YachtPics did not shoot. Manage your full portfolio in one place.",
            },
          ].map((f) => (
            <div key={f.title} className="text-center">
              <span aria-hidden className="mx-auto mb-4 block h-px w-10 bg-white/25" />
              <h3 className="label-caps-inverse text-white/80 mb-3">{f.title}</h3>
              <p className="text-ink-400 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-hairline-inverse-soft px-6 sm:px-8 py-5 text-center">
        <p className="text-ink-500 text-sm">
          © {new Date().getFullYear()} YachtPics · North Palm Beach, Florida ·{" "}
          <a href="https://www.yachtpics.com" className="hover:text-ink-300 transition-colors duration-fast">
            yachtpics.com
          </a>
        </p>
      </footer>
    </main>
  );
}
