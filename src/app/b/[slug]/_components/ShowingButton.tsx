"use client";

import { useState } from "react";
import ShowingModal from "./ShowingModal";

/** The boat page's prominent "Request a showing" button (lead kind 'showing'). */
export default function ShowingButton({
  slug,
  firstName,
  listingId,
  boatLabel,
  serifClass,
}: {
  slug: string;
  firstName: string;
  listingId: string;
  boatLabel: string;
  serifClass: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[48px] px-7 bg-[var(--site-accent)] text-[var(--site-on-accent)] text-[0.9375rem] font-semibold tracking-wide hover:opacity-90 transition-opacity duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--site-ink)] focus-visible:ring-offset-[var(--site-bg)]"
      >
        Request a showing
      </button>
      {open && (
        <ShowingModal slug={slug} firstName={firstName} listingId={listingId} boatLabel={boatLabel} serifClass={serifClass} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
