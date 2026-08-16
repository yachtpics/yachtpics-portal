"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// JSZip is only needed when someone actually downloads photos, but importing it
// at the top meant every broker downloaded the whole zip library just to LOOK at
// their listings. Loaded on demand instead, inside handleDownload.

type Listing = {
  id: string;
  vessel_name: string | null;
  vessel_type: string | null;
  year: number | null;
  length_ft: number | null;
  location: string | null;
  status: string;
  updated_at: string;
  broker_name?: string | null;
  is_shared?: boolean | null;
  slideshow_slug?: string | null;
  slideshow_published?: boolean | null;
};

const STATUS_OPTIONS = ["active", "archived", "sold"] as const;

const statusStyle: Record<string, string> = {
  active:   "bg-success-50 text-success-700",
  sold:     "bg-info-50 text-info-700",
  archived: "bg-ink-100 text-ink-500",
};

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ListingRow({ listing, showBroker, isCoBroker, locked, heroUrl = null, heroFit = "fit" }: { listing: Listing; showBroker?: boolean; isCoBroker?: boolean; locked?: boolean; heroUrl?: string | null; heroFit?: "fit" | "fill" }) {
  // Status dropdown state
  const [status, setStatus] = useState(listing.status);
  const [statusOpen, setStatusOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Download state
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadDone, setDownloadDone] = useState(false);
  const [noPhotos, setNoPhotos] = useState(false);

  // Share state
  const [shareCopied, setShareCopied] = useState(false);

  // Hero photo — the listing's cover print on a paper ground. Resolved and
  // signed server-side in one batched pass (see listing_hero_photos), so the
  // list paints in a single shot instead of 2-3 round trips per row.
  const [heroLoaded, setHeroLoaded] = useState(false);

  // Opening state. A hover highlight tells you the row is clickable; it does
  // not tell you your click landed — which is why a slow open reads as a
  // missed click and gets clicked again. Driving the navigation through a
  // transition lets the row say "Opening…" from the instant it's pressed until
  // the next page is ready, however long that takes.
  const router = useRouter();
  const [isOpening, startOpening] = useTransition();
  const href = `/dashboard/listings/${listing.id}`;

  function handleOpen(e: React.MouseEvent<HTMLAnchorElement>) {
    // Leave the browser's own behaviour alone for open-in-new-tab / new-window.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    startOpening(() => router.push(href));
  }

  async function handleShare() {
    if (!listing.slideshow_slug) return;
    const url = `${window.location.origin}/s/${listing.slideshow_slug}`;
    const title = listing.vessel_name ?? "Yacht listing";
    const nav: Navigator | undefined = typeof navigator !== "undefined" ? navigator : undefined;
    if (nav && typeof nav.share === "function") {
      // Native share sheet (mobile): text, email, AirDrop, etc.
      try { await nav.share({ title, text: `View the photos for ${title}`, url }); } catch { /* cancelled */ }
      return;
    }
    // Desktop fallback: copy the link
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  }

  // Send state
  const [sendOpen, setSendOpen] = useState(false);
  const [sendEmail, setSendEmail] = useState("");
  const [sendMessage, setSendMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendDone, setSendDone] = useState(false);
  const [sendError, setSendError] = useState("");
  const sendRef = useRef<HTMLDivElement>(null);

  const updated = new Date(listing.updated_at).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });

  // Close status dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setStatusOpen(false);
      }
    }
    if (statusOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [statusOpen]);

  // Close send popover on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (sendRef.current && !sendRef.current.contains(e.target as Node)) {
        setSendOpen(false);
      }
    }
    if (sendOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [sendOpen]);

  async function changeStatus(newStatus: string) {
    if (newStatus === status) { setStatusOpen(false); return; }
    setSaving(true);
    setStatusOpen(false);
    setStatus(newStatus);
    try {
      await fetch(`/api/listings/${listing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch {
      setStatus(status);
    } finally {
      setSaving(false);
    }
  }

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    setDownloadProgress(0);
    setDownloadDone(false);
    setNoPhotos(false);

    try {
      const supabase = createClient();

      const { data: photos } = await supabase
        .from("photos")
        .select("storage_path, filename, category")
        .eq("listing_id", listing.id)
        .eq("is_visible", true)
        .order("display_order");

      if (!photos || photos.length === 0) {
        setNoPhotos(true);
        setTimeout(() => setNoPhotos(false), 3000);
        setDownloading(false);
        return;
      }

      const paths = photos.map((p) => p.storage_path);
      const { data: signedData } = await supabase.storage
        .from("listing-photos")
        .createSignedUrls(paths, 3600);

      if (!signedData) { setDownloading(false); return; }

      const photosWithUrls = photos.map((p, i) => ({
        ...p,
        url: signedData[i]?.signedUrl ?? null,
      }));

      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const BATCH = 8;
      let fetched = 0;

      for (let b = 0; b < photosWithUrls.length; b += BATCH) {
        const batch = photosWithUrls.slice(b, b + BATCH);
        await Promise.all(
          batch.map(async (photo, bi) => {
            const globalIndex = b + bi;
            if (!photo.url) return;
            try {
              const response = await fetch(photo.url);
              const blob = await response.blob();
              const ext = photo.filename?.split(".").pop() ?? "jpg";
              const fname = `${String(globalIndex + 1).padStart(2, "0")}-${photo.category ?? "photo"}.${ext}`;
              zip.file(fname, blob);
            } catch { /* skip failed photo */ }
            fetched++;
            setDownloadProgress(Math.round((fetched / photosWithUrls.length) * 85));
          })
        );
      }

      setDownloadProgress(88);
      const zipBlob = await zip.generateAsync(
        { type: "blob", compression: "STORE" },
        (meta) => setDownloadProgress(88 + Math.round(meta.percent * 0.12))
      );

      const zipName = `${listing.vessel_name ?? "photos"}-photos.zip`;

      if ("showSaveFilePicker" in window) {
        try {
          const handle = await (window as unknown as { showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
            suggestedName: zipName,
            types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(zipBlob);
          await writable.close();
        } catch (err: unknown) {
          if ((err as { name?: string })?.name !== "AbortError") triggerBlobDownload(zipBlob, zipName);
        }
      } else {
        triggerBlobDownload(zipBlob, zipName);
      }

      // Log download (fire-and-forget)
      fetch(`/api/listings/${listing.id}/log-download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoCount: photos.length }),
      }).catch(() => {});

      setDownloadDone(true);
      setTimeout(() => setDownloadDone(false), 3000);
    } catch {
      // silently fail
    } finally {
      setDownloading(false);
      setDownloadProgress(0);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!sendEmail.trim()) return;
    setSending(true);
    setSendError("");

    try {
      const res = await fetch("/api/email/send-to-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: listing.id,
          clientEmail: sendEmail.trim(),
          message: sendMessage.trim(),
          includeSlideshow: !!listing.slideshow_published,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setSendError(data.error ?? "Failed to send.");
        return;
      }

      setSendDone(true);
      setSendEmail("");
      setSendMessage("");
      setTimeout(() => {
        setSendDone(false);
        setSendOpen(false);
      }, 2000);
    } catch {
      setSendError("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  }

  const quickAction =
    "flex items-center gap-1 text-xs font-medium px-2.5 py-2.5 sm:py-1.5 rounded-ctl border transition-colors duration-fast ease-quiet " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500";

  return (
    <div className="bg-white border border-hairline rounded-card shadow-elev-1 hover:shadow-elev-2 pr-3 sm:pr-4 flex items-stretch justify-between overflow-hidden transition-shadow duration-base ease-quiet">
      {/* Left — the photograph first, then the vessel */}
      <Link
        href={href}
        onClick={handleOpen}
        aria-busy={isOpening}
        className={`relative flex flex-1 min-w-0 items-stretch gap-3 sm:gap-4 pr-2 group transition-opacity duration-fast ease-quiet ${
          isOpening ? "opacity-55" : ""
        }`}
      >
        {/* Accent rule down the edge — the row's own "yes, I heard you". */}
        {isOpening && <span aria-hidden className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent-500" />}
        {/* "fit" floats the whole print on the paper with its shadow; "fill" stays a
            flush edge-to-edge crop. Same hero_fit convention as the flyer. */}
        <div className="relative w-24 sm:w-32 shrink-0 self-stretch min-h-[4.5rem] bg-ink-50 border-r border-hairline overflow-hidden flex items-center justify-center p-1">
          {heroUrl && (
            // Signed URL — raw <img> on purpose (never next/image).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={heroUrl}
              alt={listing.vessel_name ?? "Listing photo"}
              loading="lazy"
              decoding="async"
              onLoad={() => setHeroLoaded(true)}
              ref={(el) => { if (el && el.complete && el.naturalWidth > 0) setHeroLoaded(true); }}
              className={`transition-opacity duration-base ease-quiet ${
                heroFit === "fit"
                  ? "max-h-full max-w-full object-contain rounded-[2px] shadow-print"
                  : "absolute inset-0 h-full w-full object-cover"
              } ${heroLoaded ? "opacity-100" : "opacity-0"}`}
            />
          )}
        </div>
        <div className="min-w-0 py-3.5 self-center">
          <p className="text-sm font-semibold text-ink-900 flex items-center gap-2 group-hover:text-ink-950">
            <span className="truncate">{listing.vessel_name ?? "Untitled vessel"}</span>
            {listing.is_shared && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent-500/10 text-accent-700 uppercase tracking-caps shrink-0">
                Shared
              </span>
            )}
            {isCoBroker && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-info-50 text-info-700 uppercase tracking-caps shrink-0">
                Co-broker
              </span>
            )}
          </p>
          {isOpening ? (
            <p className="text-xs text-accent-700 mt-0.5 flex items-center gap-1.5 font-medium">
              <svg className="w-3 h-3 animate-spin shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Opening…
            </p>
          ) : (
            <p className="text-xs text-ink-400 mt-0.5 truncate">
              {[
                listing.year,
                listing.vessel_type,
                listing.length_ft ? `${listing.length_ft}′` : null,
                listing.location,
              ].filter(Boolean).join(" · ")}
            </p>
          )}
          {showBroker && listing.broker_name && (
            <p className="text-xs text-accent-700 mt-1 truncate">{listing.broker_name}</p>
          )}
        </div>
      </Link>

      {/* Right — quick actions + date + status */}
      <div className="flex items-center gap-2 shrink-0 py-3.5">

        {/* Share slideshow (only when published + active plan) */}
        {listing.slideshow_published && listing.slideshow_slug && !locked && (
          <button
            onClick={handleShare}
            title="Share the client slideshow link"
            className={`${quickAction} ${
              shareCopied
                ? "border-success-200 bg-success-50 text-success-700"
                : "border-hairline-strong bg-white text-ink-500 hover:border-accent-500 hover:text-ink-700"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            <span className="hidden sm:inline">{shareCopied ? "Copied" : "Share"}</span>
          </button>
        )}

        {/* Download Photos */}
        <div className="relative">
          <button
            onClick={handleDownload}
            disabled={downloading}
            title="Download all photos as ZIP"
            className={`${quickAction}
              ${downloadDone
                ? "border-success-200 bg-success-50 text-success-700"
                : noPhotos
                  ? "border-warn-200 bg-warn-50 text-warn-700"
                  : "border-hairline-strong bg-white text-ink-500 hover:border-accent-500 hover:text-ink-700"
              }
              disabled:opacity-60 disabled:cursor-not-allowed`}
          >
            {downloading ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="hidden sm:inline">{downloadProgress}%</span>
              </>
            ) : downloadDone ? (
              <>
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                <span className="hidden sm:inline">Done</span>
              </>
            ) : noPhotos ? (
              <>
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                <span className="hidden sm:inline">No photos</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                <span className="hidden sm:inline">Photos</span>
              </>
            )}
          </button>
        </div>

        {/* Send to Client — active plans only */}
        {!locked && (
        <div className="relative" ref={sendRef}>
          <button
            onClick={(e) => { e.preventDefault(); setSendOpen((o) => !o); setSendDone(false); setSendError(""); }}
            title="Send listing to a client"
            className={`${quickAction}
              ${sendOpen
                ? "border-accent-500 bg-accent-50 text-accent-700"
                : "border-hairline-strong bg-white text-ink-500 hover:border-accent-500 hover:text-ink-700"
              }`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
              <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
            </svg>
            <span className="hidden sm:inline">Send</span>
          </button>

          {sendOpen && (
            <div className="absolute right-0 top-full mt-1.5 z-30 bg-white border border-hairline rounded-card shadow-elev-3 p-4 w-72">
              {sendDone ? (
                <div className="flex items-center gap-2 text-success-700 text-sm font-medium py-1">
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                  Sent!
                </div>
              ) : (
                <form onSubmit={handleSend}>
                  <p className="text-xs font-semibold text-ink-700 mb-3">
                    Send to client
                    {listing.slideshow_published && (
                      <span className="ml-1.5 text-accent-700 font-normal">· includes slideshow</span>
                    )}
                  </p>
                  <input
                    type="email"
                    placeholder="client@email.com"
                    value={sendEmail}
                    onChange={(e) => setSendEmail(e.target.value)}
                    required
                    className="w-full border border-hairline-strong rounded-ctl px-3 py-2 text-sm text-ink-900 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-500 mb-2"
                  />
                  <textarea
                    placeholder="Add a note (optional)"
                    value={sendMessage}
                    onChange={(e) => setSendMessage(e.target.value)}
                    rows={2}
                    className="w-full border border-hairline-strong rounded-ctl px-3 py-2 text-sm text-ink-900 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-500 mb-2 resize-none"
                  />
                  {sendError && (
                    <p className="text-xs text-danger-600 mb-2">{sendError}</p>
                  )}
                  <button
                    type="submit"
                    disabled={sending || !sendEmail.trim()}
                    className="w-full bg-accent-500 hover:bg-accent-400 disabled:opacity-40 text-ink-950 text-sm font-semibold py-2 rounded-ctl transition-colors duration-fast ease-quiet"
                  >
                    {sending ? "Sending…" : "Send"}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
        )}

        <p className="text-xs text-ink-400 hidden md:block">Updated {updated}</p>

        {/* Status badge */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={(e) => { e.preventDefault(); setStatusOpen((o) => !o); }}
            disabled={saving}
            className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors duration-fast cursor-pointer hover:opacity-80 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${statusStyle[status] ?? "bg-ink-100 text-ink-500"}`}
          >
            {saving ? "Saving…" : status}
          </button>

          {statusOpen && (
            <div className="absolute right-0 top-full mt-1.5 z-20 bg-white border border-hairline rounded-card shadow-elev-3 py-1 min-w-[110px]">
              {STATUS_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={(e) => { e.preventDefault(); changeStatus(s); }}
                  className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-ink-50 transition-colors duration-fast ${s === status ? "text-accent-700" : "text-ink-700"}`}
                >
                  {s === status ? `✓ ${s}` : s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
