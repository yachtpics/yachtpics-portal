import { serif } from "./fonts";

/** "This page isn't available" — shown (noindex) when a site or boat can't be shown. */
export default function Unavailable() {
  return (
    <main className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <p className={`${serif.className} text-[2rem] text-ink-950 leading-tight`}>This page isn&rsquo;t available</p>
        <p className="text-ink-500 text-[0.9375rem] mt-3">The link may have changed, or the page has been taken down.</p>
      </div>
    </main>
  );
}
