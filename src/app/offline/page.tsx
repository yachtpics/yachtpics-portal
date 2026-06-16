import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline · YachtPics Portal",
};

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0b1f33] px-6 text-center text-white">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2 12h20" />
          <path d="M5 12a7 7 0 0 1 14 0" />
          <path d="M12 19v.01" />
          <line x1="3" y1="3" x2="21" y2="21" />
        </svg>
      </div>
      <h1 className="text-xl font-semibold">You&apos;re offline</h1>
      <p className="max-w-sm text-sm text-white/70">
        We can&apos;t reach the YachtPics Portal right now. Check your connection —
        your work will load again as soon as you&apos;re back online.
      </p>
      <a
        href="/dashboard"
        className="mt-2 rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-[#0b1f33] transition hover:bg-white/90"
      >
        Try again
      </a>
    </main>
  );
}
