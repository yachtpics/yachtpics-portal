"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import DockCardButton from "@/components/DockCardButton";
import { BILLING_PATH } from "@/lib/planValue";

/**
 * "Ready for this boat" (Nov 3) — the strip under the listing title on the
 * broker listing page. Five compact tiles, one row on desktop, stacked on
 * phones: what's ready for this boat and what a plan adds.
 *
 * Charlie's rules: promote the two included reels hard (the only primary
 * button here is Make a reel); show plan features plainly as "with a plan";
 * the buyer slideshow LINK stays a plan feature (owner Preview is free); the
 * dock card is treated as a plan feature here (the Client Slideshow section
 * below is unchanged). The YachtPics share link (/yp) is never shown here.
 *
 * Reel counts come from GET /api/reels/claim — the same allowance the Reel
 * page and the claim route use (src/lib/reelAllowance.ts), nothing recounted.
 */

export type ReelAllowance = {
  unlimited: boolean;
  /** Included reels used (always 0 when unlimited). */
  used: number;
  /** Included reels left; null when unlimited. */
  remaining: number | null;
  /** Reels made — the claims when metered; reels taken when unlimited. */
  made: number;
};

/** The listing's reel allowance, read once. null while loading or if it can't be read. */
export function useReelAllowance(listingId: string): ReelAllowance | null {
  const [a, setA] = useState<ReelAllowance | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/reels/claim?listingId=${encodeURIComponent(listingId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d || typeof d.unlimited !== "boolean") return;
        setA({
          unlimited: d.unlimited,
          used: typeof d.used === "number" ? d.used : 0,
          remaining: typeof d.remaining === "number" ? d.remaining : null,
          made: typeof d.made === "number" ? d.made : (typeof d.used === "number" ? d.used : 0),
        });
      })
      .catch(() => {});
    return () => { live = false; };
  }, [listingId]);
  return a;
}

/** Whether the post-download nudge has anything to offer. */
export function reelNudgeApplies(a: ReelAllowance | null): boolean {
  if (!a) return false;
  if (a.unlimited) return a.made === 0;
  return (a.remaining ?? 0) > 0;
}

const BTN_PRIMARY = "inline-flex items-center bg-accent-500 hover:bg-accent-400 text-ink-950 text-xs font-semibold px-3 py-1.5 rounded-ctl transition-colors duration-fast ease-quiet";
const BTN_SECONDARY = "inline-flex items-center bg-white border border-hairline-strong hover:border-ink-400 text-ink-700 hover:text-ink-900 text-xs font-semibold px-2.5 py-1.5 rounded-ctl transition-colors duration-fast ease-quiet";
const LINK = "text-xs font-medium text-accent-700 hover:text-accent-600 transition-colors duration-fast";

function Mark({ done }: { done: boolean }) {
  return done ? (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success-50 text-success-700 border border-success-200" aria-label="Done">
      <svg className="w-2.5 h-2.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
    </span>
  ) : (
    <span className="inline-block h-4 w-4 shrink-0 rounded-full border border-hairline-strong bg-white" aria-label="Not yet" />
  );
}

function Tile({ title, done, status, children }: { title: string; done: boolean; status: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="bg-white px-4 py-3.5 flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center gap-2">
        <Mark done={done} />
        <span className="label-caps text-ink-500 truncate">{title}</span>
      </div>
      <p className="text-sm text-ink-900 leading-snug">{status}</p>
      <div className="mt-auto pt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">{children}</div>
    </li>
  );
}

export default function ListingReadyStrip(props: {
  listingId: string;
  /** The listing owner's plan (hasAccess of the effective status). */
  hasPlan: boolean;
  slideshowPublished: boolean;
  slideshowSlug: string | null;
  youtubeUrl: string | null;
  hasVideo: boolean;
  allowance: ReelAllowance | null;
  slideshowCopied: boolean;
  onSend: () => void;
  onCopySlideshowLink: () => void;
  onMessage: (text: string, tone: "success" | "error") => void;
}) {
  const { listingId, hasPlan, slideshowPublished, slideshowSlug, youtubeUrl, hasVideo, allowance: a } = props;
  const [copied, setCopied] = useState<"yt" | "line" | null>(null);
  const reelHref = `/dashboard/listings/${listingId}/reel`;
  const live = slideshowPublished && !!slideshowSlug;

  async function copy(text: string, which: "yt" | "line") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      window.setTimeout(() => setCopied((c) => (c === which ? null : c)), 2000);
    } catch {
      props.onMessage(`Couldn't copy automatically. Here it is: ${text}`, "error");
    }
  }

  // ── Reels
  let reelStatus: string;
  let reelsMore = false;
  if (!a) reelStatus = "2 included";
  else if (a.unlimited) reelStatus = "Unlimited with your plan";
  else if (a.used <= 0) reelStatus = "2 included · 0 made";
  else if ((a.remaining ?? 0) > 0) reelStatus = `${a.used} of 2 made`;
  else { reelStatus = "2 of 2 made"; reelsMore = true; }
  const reelDone = !!a && a.made > 0;

  // ── Description line: the credit plus the YouTube link (never the slideshow link)
  const credit = hasVideo || youtubeUrl ? "Photos and video by YachtPics" : "Photos by YachtPics";
  const descriptionLine = youtubeUrl ? `${credit}\n${youtubeUrl}` : credit;

  return (
    <section aria-label="Ready for this boat" className="mb-6 rounded-card border border-hairline bg-white shadow-elev-1 overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-4 py-2.5 border-b border-hairline">
        <h2 className="label-caps text-ink-600">Ready for this boat</h2>
        <p className="hidden sm:block text-xs text-ink-500">Two reels are included with every boat.</p>
      </div>
      <ul className="grid grid-cols-1 lg:grid-cols-5 gap-px bg-hairline">
        <Tile title="Reels" done={reelDone} status={reelStatus}>
          <Link href={reelHref} className={BTN_PRIMARY}>Make a reel</Link>
          {reelsMore && <Link href={BILLING_PATH} className={LINK}>More with a plan</Link>}
        </Tile>

        <Tile
          title="Buyer slideshow"
          done={hasPlan && live}
          status={hasPlan ? (live ? "Live — ready to send" : "Not published yet") : live ? "Preview ready" : "Not created yet"}
        >
          {hasPlan && live && (
            <>
              <button type="button" onClick={props.onSend} className={BTN_SECONDARY}>Send</button>
              <button type="button" onClick={props.onCopySlideshowLink} className={BTN_SECONDARY}>{props.slideshowCopied ? "✓ Copied" : "Copy link"}</button>
            </>
          )}
          {hasPlan && !live && <a href="#slideshow" className={BTN_SECONDARY}>Create slideshow</a>}
          {!hasPlan && (
            <>
              {live
                ? <a href={`/s/${slideshowSlug}`} target="_blank" rel="noopener noreferrer" className={BTN_SECONDARY}>Preview ↗</a>
                : <a href="#slideshow" className={BTN_SECONDARY}>Preview</a>}
              <Link href={BILLING_PATH} className={LINK}>Send with a plan</Link>
            </>
          )}
        </Tile>

        <Tile title="Seller Report" done={hasPlan} status={hasPlan ? "Ready for the owner" : "Preview, watermarked"}>
          <a href={`/report/listing/${listingId}`} target="_blank" rel="noopener noreferrer" className={BTN_SECONDARY}>See her report ↗</a>
        </Tile>

        <Tile
          title="Dock card"
          done={hasPlan && live}
          status={hasPlan ? (live ? "Ready to print" : "Publish her slideshow first") : "Her card, with a QR code"}
        >
          {hasPlan && live && <DockCardButton listingId={listingId} compact />}
          {hasPlan && !live && <a href="#slideshow" className={BTN_SECONDARY}>Publish</a>}
          {!hasPlan && <Link href={BILLING_PATH} className={LINK}>With a plan</Link>}
        </Tile>

        <Tile title="For your listing" done={!!youtubeUrl} status={youtubeUrl ? "YouTube link ready" : "No YouTube link yet"}>
          {youtubeUrl
            ? <button type="button" onClick={() => copy(youtubeUrl, "yt")} className={BTN_SECONDARY}>{copied === "yt" ? "✓ Copied" : "Copy link"}</button>
            : <Link href={`/dashboard/listings/${listingId}/edit`} className={BTN_SECONDARY}>Add link</Link>}
          <button type="button" onClick={() => copy(descriptionLine, "line")} className={LINK} title={descriptionLine}>
            {copied === "line" ? "✓ Copied" : "Copy description line"}
          </button>
        </Tile>
      </ul>
    </section>
  );
}

/**
 * After a successful Download All / folder save: the moment the broker has her
 * photos in hand. Dismissed for the browser session. Not shown when both
 * included reels are used, or on a plan when a reel has already been made.
 */
export function ReelAfterDownloadCard({ listingId, onDismiss }: { listingId: string; onDismiss: () => void }) {
  return (
    <div role="status" className="mb-5 flex items-center justify-between gap-3 flex-wrap rounded-card border border-hairline bg-white shadow-elev-1 px-4 py-3">
      <p className="text-sm text-ink-900">Her reels are ready to make — two are included.</p>
      <div className="flex items-center gap-3">
        <Link href={`/dashboard/listings/${listingId}/reel`} className={BTN_PRIMARY}>Make a reel</Link>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="text-ink-400 hover:text-ink-700 transition-colors duration-fast p-1">
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M4.3 4.3a1 1 0 011.4 0L10 8.6l4.3-4.3a1 1 0 111.4 1.4L11.4 10l4.3 4.3a1 1 0 01-1.4 1.4L10 11.4l-4.3 4.3a1 1 0 01-1.4-1.4L8.6 10 4.3 5.7a1 1 0 010-1.4z" clipRule="evenodd" /></svg>
        </button>
      </div>
    </div>
  );
}
