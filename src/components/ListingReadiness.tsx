"use client";

import Link from "next/link";

/**
 * A quiet checklist under the listing title: what's done, what would make the
 * listing land better. Each unmet item is a link to where it gets fixed.
 * Nothing here blocks anything — it's a nudge, in the order that matters.
 */

export type ReadinessInput = {
  listingId: string;
  photoCount: number;
  uncategorized: number;
  hasCover: boolean;
  published: boolean;
  hasVideo: boolean;
  hasDocs: boolean;
  hasTour: boolean;
  specs: { year: number | null; length_ft: number | null; make: string | null; asking_price: number | null; vessel_type: string | null; location: string | null; staterooms: number | null; description: string | null };
};

export function readinessItems(r: ReadinessInput) {
  const specFilled = [r.specs.year, r.specs.length_ft, r.specs.make, r.specs.vessel_type, r.specs.location].filter((v) => v !== null && v !== undefined && v !== "").length;
  const edit = `/dashboard/listings/${r.listingId}/edit`;
  return [
    { key: "photos", done: r.photoCount >= 12, label: r.photoCount >= 12 ? `${r.photoCount} photos` : `${r.photoCount} photo${r.photoCount === 1 ? "" : "s"} — aim for 12+`, href: "#photos" },
    { key: "cover", done: r.hasCover, label: r.hasCover ? "Cover set" : "Pick a cover photo (★)", href: "#photos" },
    { key: "labels", done: r.photoCount > 0 && r.uncategorized === 0, label: r.uncategorized === 0 ? "Photos labelled" : `${r.uncategorized} photo${r.uncategorized === 1 ? "" : "s"} still "Other"`, href: "#photos" },
    { key: "specs", done: specFilled >= 5, label: specFilled >= 5 ? "Specs complete" : `Specs ${specFilled}/5 — year, length, builder, type, location`, href: edit },
    { key: "description", done: !!r.specs.description, label: r.specs.description ? "Description written" : "Add a description", href: edit },
    { key: "published", done: r.published, label: r.published ? "Slideshow live" : "Publish the slideshow", href: "#slideshow" },
    { key: "video", done: r.hasVideo, label: r.hasVideo ? "Video added" : "Add a video (or make the Film)", href: r.hasVideo ? "#videos" : `/dashboard/listings/${r.listingId}/reel` },
    { key: "tour", done: r.hasTour, label: r.hasTour ? "360° tour linked" : "Link a 360° tour", href: edit },
    { key: "docs", done: r.hasDocs, label: r.hasDocs ? "Documents attached" : "Attach a brochure or spec PDF", href: "#documents" },
  ];
}

export default function ListingReadiness(r: ReadinessInput) {
  const items = readinessItems(r);
  const done = items.filter((i) => i.done).length;
  const pct = Math.round((done / items.length) * 100);
  const next = items.find((i) => !i.done);

  return (
    <div className="mb-6 rounded-card border border-hairline bg-white shadow-elev-1 px-5 py-3.5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative h-9 w-9 shrink-0" aria-hidden="true">
            <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(5,11,20,0.08)" strokeWidth="3" />
              <circle cx="18" cy="18" r="15.5" fill="none" stroke={pct === 100 ? "#2f7a3e" : "#c39e4e"} strokeWidth="3" strokeLinecap="round"
                strokeDasharray={`${(pct / 100) * 97.4} 97.4`} />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-ink-700 tabular-nums">{done}/{items.length}</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink-900">
              {pct === 100 ? "Listing is fully set up" : "Listing readiness"}
            </p>
            <p className="text-xs text-ink-500 truncate">
              {pct === 100 ? "Every box ticked — buyers get the full picture." : next ? <>Next: <Link href={next.href} className="text-accent-700 font-medium hover:underline">{next.label}</Link></> : ""}
            </p>
          </div>
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {items.map((i) => (
            <li key={i.key}>
              {i.done ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full bg-success-50 text-success-700 border border-success-200">
                  <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
                  {i.label}
                </span>
              ) : (
                <Link href={i.href} className="inline-flex items-center text-[11px] font-medium px-2 py-1 rounded-full bg-white text-ink-500 border border-hairline-strong hover:border-accent-500 hover:text-ink-900 transition-colors duration-fast">
                  {i.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
