"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/client";

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
  active:   "bg-green-50 text-green-700",
  sold:     "bg-blue-50 text-blue-700",
  archived: "bg-gray-100 text-gray-500",
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

export default function ListingRow({ listing, showBroker }: { listing: Listing; showBroker?: boolean }) {
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

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 sm:px-6 py-4 flex items-center justify-between hover:border-[#d4a843] transition-colors">
      {/* Left — link to the listing */}
      <Link href={`/dashboard/listings/${listing.id}`} className="flex-1 min-w-0 pr-4">
        <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          {listing.vessel_name ?? "Untitled vessel"}
          {listing.is_shared && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[#d4a843]/15 text-[#a07820] uppercase tracking-wide">
              Shared
            </span>
          )}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">
          {[
            listing.year,
            listing.vessel_type,
            listing.length_ft ? `${listing.length_ft}′` : null,
            listing.location,
          ].filter(Boolean).join(" · ")}
        </p>
        {showBroker && listing.broker_name && (
          <p className="text-xs text-[#c49a35] mt-1">{listing.broker_name}</p>
        )}
      </Link>

      {/* Right — quick actions + date + status */}
      <div className="flex items-center gap-2 shrink-0">

        {/* Share slideshow (only when published) */}
        {listing.slideshow_published && listing.slideshow_slug && (
          <button
            onClick={handleShare}
            title="Share the client slideshow link"
            className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
              shareCopied
                ? "border-green-200 bg-green-50 text-green-700"
                : "border-gray-200 bg-white text-gray-500 hover:border-[#d4a843] hover:text-gray-700"
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
            className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors
              ${downloadDone
                ? "border-green-200 bg-green-50 text-green-700"
                : noPhotos
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-gray-200 bg-white text-gray-500 hover:border-[#d4a843] hover:text-gray-700"
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

        {/* Send to Client */}
        <div className="relative" ref={sendRef}>
          <button
            onClick={(e) => { e.preventDefault(); setSendOpen((o) => !o); setSendDone(false); setSendError(""); }}
            title="Send listing to a client"
            className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors
              ${sendOpen
                ? "border-[#d4a843] bg-[#fdf8ed] text-[#a07820]"
                : "border-gray-200 bg-white text-gray-500 hover:border-[#d4a843] hover:text-gray-700"
              }`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
              <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
            </svg>
            <span className="hidden sm:inline">Send</span>
          </button>

          {sendOpen && (
            <div className="absolute right-0 top-full mt-1.5 z-30 bg-white border border-gray-200 rounded-xl shadow-lg p-4 w-72">
              {sendDone ? (
                <div className="flex items-center gap-2 text-green-700 text-sm font-medium py-1">
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                  Sent!
                </div>
              ) : (
                <form onSubmit={handleSend}>
                  <p className="text-xs font-semibold text-gray-700 mb-3">
                    Send to client
                    {listing.slideshow_published && (
                      <span className="ml-1.5 text-[#a07820] font-normal">· includes slideshow</span>
                    )}
                  </p>
                  <input
                    type="email"
                    placeholder="client@email.com"
                    value={sendEmail}
                    onChange={(e) => setSendEmail(e.target.value)}
                    required
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#d4a843] mb-2"
                  />
                  <textarea
                    placeholder="Add a note (optional)"
                    value={sendMessage}
                    onChange={(e) => setSendMessage(e.target.value)}
                    rows={2}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#d4a843] mb-2 resize-none"
                  />
                  {sendError && (
                    <p className="text-xs text-red-600 mb-2">{sendError}</p>
                  )}
                  <button
                    type="submit"
                    disabled={sending || !sendEmail.trim()}
                    className="w-full bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold py-2 rounded-lg transition-colors"
                  >
                    {sending ? "Sending…" : "Send"}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>

        <p className="text-xs text-gray-400 hidden md:block">Updated {updated}</p>

        {/* Status badge */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={(e) => { e.preventDefault(); setStatusOpen((o) => !o); }}
            disabled={saving}
            className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors cursor-pointer hover:opacity-80 disabled:opacity-50 ${statusStyle[status] ?? "bg-gray-100 text-gray-500"}`}
          >
            {saving ? "Saving…" : status}
          </button>

          {statusOpen && (
            <div className="absolute right-0 top-full mt-1.5 z-20 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[110px]">
              {STATUS_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={(e) => { e.preventDefault(); changeStatus(s); }}
                  className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-gray-50 transition-colors ${s === status ? "text-[#c49a35]" : "text-gray-700"}`}
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
