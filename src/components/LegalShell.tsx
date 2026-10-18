import Link from "next/link";

/** Plain public shell for the legal pages (/privacy, /data-deletion): no login, no app nav. */
export default function LegalShell({ eyebrow, title, updated, children }: { eyebrow: string; title: string; updated?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ink-50">
      <header className="border-b border-hairline bg-white">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-sm font-semibold tracking-caps-wide uppercase text-ink-900">YachtPics Portal</Link>
          <Link href="/auth/login" className="text-sm text-ink-500 hover:text-ink-800 transition-colors duration-fast">Sign in</Link>
        </div>
      </header>
      <main className="px-6 py-10 max-w-3xl mx-auto">
        <p className="label-caps mb-2">{eyebrow}</p>
        <h1 className="text-display text-ink-900 mb-1">{title}</h1>
        {updated && <p className="text-sm text-ink-500 mb-10">Last updated {updated}</p>}
        <div className="space-y-8">{children}</div>
      </main>
      <footer className="border-t border-hairline px-6 py-5 text-center text-xs text-ink-500">
        © {new Date().getFullYear()} YachtPics Enterprises LLC · North Palm Beach, Florida ·{" "}
        <Link href="/privacy" className="hover:text-ink-800">Privacy</Link> ·{" "}
        <Link href="/data-deletion" className="hover:text-ink-800">Data deletion</Link>
      </footer>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-hairline pt-6">
      <h2 className="text-h2 text-ink-900 mb-2">{title}</h2>
      <div className="text-sm text-ink-600 leading-relaxed space-y-3">{children}</div>
    </section>
  );
}
