"use client";

export default function PrintButton() {
  return (
    <div className="print:hidden fixed bottom-5 right-5 z-50 flex gap-2">
      <button
        onClick={() => window.print()}
        className="bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-5 py-3 rounded-ctl shadow-elev-2 transition-colors"
      >
        ⬇ Print / Save as PDF
      </button>
    </div>
  );
}
