"use client";

export default function PrintButton() {
  return (
    <div className="print:hidden fixed bottom-5 right-5 z-50 flex gap-2">
      <button
        onClick={() => window.print()}
        className="bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] text-sm font-semibold px-5 py-3 rounded-lg shadow-lg transition-colors"
      >
        ⬇ Print / Save as PDF
      </button>
    </div>
  );
}
