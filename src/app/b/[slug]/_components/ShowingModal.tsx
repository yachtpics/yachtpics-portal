"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import LeadForm from "./LeadForm";

/** "Request a showing" dialog with the yacht prefilled. */
export default function ShowingModal({
  slug,
  firstName,
  listingId,
  boatLabel,
  serifClass,
  onClose,
}: {
  slug: string;
  firstName: string;
  listingId: string;
  boatLabel: string;
  serifClass: string;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus the first field once the dialog is on screen.
    const t = window.setTimeout(() => panel.current?.querySelector<HTMLInputElement>("input:not([tabindex='-1'])")?.focus(), 30);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      window.clearTimeout(t);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="showing-title">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink-950/60 backdrop-blur-[2px] cursor-default" />
      <div ref={panel} className="relative w-full sm:max-w-lg max-h-[92vh] overflow-y-auto bg-[var(--site-bg)] rounded-t-surface sm:rounded-surface shadow-elev-3 px-5 sm:px-8 pt-6 pb-8">
        <div className="flex items-start justify-between gap-4 mb-5">
          <h2 id="showing-title" className={`${serifClass} text-[1.75rem] leading-tight text-[var(--site-ink)]`}>Request a showing</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 -mt-1 inline-flex items-center justify-center w-11 h-11 rounded-full text-[var(--site-muted)] hover:text-[var(--site-ink)] hover:bg-[var(--site-surface)] transition-colors duration-fast">
            <X className="w-5 h-5" />
          </button>
        </div>
        <LeadForm slug={slug} kind="showing" listingId={listingId} boatLabel={boatLabel} firstName={firstName} onDone={onClose} submitLabel="Request a showing" />
      </div>
    </div>
  );
}
