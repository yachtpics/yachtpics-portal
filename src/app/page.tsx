import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#050b14] flex flex-col">
      {/* Header */}
      <header className="border-b border-[#0f2035] px-8 py-5 flex items-center justify-between">
        <span className="text-white text-xl font-semibold tracking-wide">
          YachtPics<span className="text-[#d4a843]"> Portal</span>
        </span>
        <Link href="/auth/login" className="text-sm text-gray-300 hover:text-white transition-colors">
          Broker Login →
        </Link>
      </header>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 text-center py-24">
        <p className="text-[#d4a843] text-sm font-medium tracking-widest uppercase mb-4">
          Professional Yacht Photography Delivery
        </p>
        <h1 className="text-white text-5xl font-bold max-w-2xl leading-tight mb-6">
          Your listings.<br />Presented perfectly.
        </h1>
        <p className="text-gray-400 text-lg max-w-xl mb-10">
          Download your professional shoot photos, build branded slideshows, and share polished presentations with buyers — all in under 60 seconds.
        </p>
        <div className="flex gap-4 flex-wrap justify-center">
          <Link
            href="/auth/login"
            className="bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] font-semibold px-8 py-3 rounded-lg transition-colors"
          >
            Broker Login
          </Link>
          <Link
            href="/auth/signup"
            className="border border-gray-600 hover:border-gray-400 text-white px-8 py-3 rounded-lg transition-colors"
          >
            Request Access
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="px-8 py-16 border-t border-[#0f2035]">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
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
              <h3 className="text-white font-semibold text-lg mb-2">{f.title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#0f2035] px-8 py-5 text-center">
        <p className="text-gray-500 text-sm">
          © {new Date().getFullYear()} YachtPics · North Palm Beach, Florida ·{" "}
          <a href="https://www.yachtpics.com" className="hover:text-gray-300 transition-colors">
            yachtpics.com
          </a>
        </p>
      </footer>
    </main>
  );
}
