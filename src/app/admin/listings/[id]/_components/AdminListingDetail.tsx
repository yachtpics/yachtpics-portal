"use client";

import { useState, useRef, useEffect } from "react";
import CoBrokerManager from "./CoBrokerManager";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { PHOTO_CATEGORIES } from "@/lib/photoCategories";
import { guessCategory } from "@/lib/guessCategory";
import DeleteListingButton from "./DeleteListingButton";
import DownloadLinkManager from "./DownloadLinkManager";

interface Photo {
  id: string;
  storage_path: string;
  filename: string | null;
  category: string | null;
  display_order: number;
  is_visible: boolean;
  url: string | null;
}

interface Listing {
  id: string;
  vessel_name: string | null;
  vessel_type: string | null;
  year: number | null;
  length_ft: number | null;
  make: string | null;
  model: string | null;
  asking_price: number | null;
  location: string | null;
  description: string | null;
  status: string;
  broker_id: string;
  is_shared?: boolean | null;
  in_showcase?: boolean | null;
  publish_to_site?: boolean | null;
  site_page?: string | null;
  showcase_opt_out?: boolean | null;
  slideshow_slug?: string | null;
  slideshow_published?: boolean | null;
  profiles: { first_name: string | null; last_name: string | null; display_email: string | null } | null;
}

interface Video {
  id: string;
  storage_path: string;
  filename: string | null;
  created_at: string;
  url: string | null;
}

interface DownloadRecord {
  id: string;
  photo_count: number;
  downloaded_at: string;
  downloader_name: string;
  downloader_email: string | null;
  source?: "portal" | "link";
}

interface SentEmail {
  id: string;
  sent_at: string;
  email_type: string;
  recipient_email: string;
  recipient_role: string | null;
  status: string;
}

const EMAIL_TYPE_LABELS: Record<string, string> = {
  broker_invite: "Broker invite",
  assistant_invite: "Assistant invite",
  assistant_added: "Assistant added",
  resend_invite: "Resent login",
  photos_ready: "Photos ready",
  video_ready: "Video ready",
  media_ready: "Photos & video ready",
  welcome: "Welcome",
  download_link: "Download link",
  client_send: "Sent to client",
};

type Lead = { id: string; name: string | null; email: string | null; phone: string | null; message: string | null; status: string; created_at: string };

export default function AdminListingDetail({ listing, photos: initialPhotos, videos: initialVideos = [], globalCustomCategories = [], downloads = [], sentEmails = [], canShare = false, brokerOptions = [], sitePages = [], coBrokers = [], leads = [], fromBroker = false }: { listing: Listing; photos: Photo[]; videos?: Video[]; globalCustomCategories?: string[]; downloads?: DownloadRecord[]; sentEmails?: SentEmail[]; canShare?: boolean; brokerOptions?: { id: string; name: string }[]; sitePages?: { label: string; filename: string }[]; coBrokers?: { id: string; name: string }[]; leads?: Lead[]; fromBroker?: boolean }) {
  const supabase = createClient();
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [status, setStatus] = useState(listing.status);
  const [isShared, setIsShared] = useState(listing.is_shared === true);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [inShowcase, setInShowcase] = useState(listing.in_showcase === true);
  const [showcaseBusy, setShowcaseBusy] = useState(false);
  const [onSite, setOnSite] = useState(listing.publish_to_site === true);
  const [siteBusy, setSiteBusy] = useState(false);
  const [sitePage, setSitePage] = useState(listing.site_page ?? "");
  const [pages, setPages] = useState(sitePages);
  const [slideshowPublished, setSlideshowPublished] = useState(listing.slideshow_published === true);
  const [slideshowSlug, setSlideshowSlug] = useState<string | null>(listing.slideshow_slug ?? null);
  const [slideshowBusy, setSlideshowBusy] = useState(false);
  const [slideshowCopied, setSlideshowCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [notifyMediaType, setNotifyMediaType] = useState<"photos" | "video" | "both">("photos");
  const [message, setMessage] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [customEdit, setCustomEdit] = useState<{ photoId: string; value: string } | null>(null);
  // Custom categories — seeded from every listing in the DB at page load,
  // then extended locally when a new one is saved during this session
  const [customCategories, setCustomCategories] = useState<string[]>(globalCustomCategories);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Video state
  const [videos, setVideos] = useState<Video[]>(initialVideos);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState(0);
  const [deletingVideoIds, setDeletingVideoIds] = useState<Set<string>>(new Set());
  const [videoError, setVideoError] = useState<string | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (lightboxIndex === null) return;
      if (e.key === "ArrowLeft") setLightboxIndex(i => i !== null ? Math.max(0, i - 1) : null);
      if (e.key === "ArrowRight") setLightboxIndex(i => i !== null ? Math.min(photos.length - 1, i + 1) : null);
      if (e.key === "Escape") setLightboxIndex(null);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [lightboxIndex, photos.length]);

  const broker = listing.profiles;
  const brokerName = broker?.first_name
    ? `${broker.first_name} ${broker.last_name ?? ""}`.trim()
    : broker?.display_email ?? "Unknown";

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    setUploading(true);
    setUploadProgress(0);
    const fileArr = Array.from(files);

    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i];
      const ext = file.name.split(".").pop();
      const path = `${listing.broker_id}/${listing.id}/${Date.now()}-${i}.${ext}`;

      const { error } = await supabase.storage
        .from("listing-photos")
        .upload(path, file, { upsert: false });

      if (!error) {
        const category = guessCategory(file.name);
        const { data: newPhoto } = await supabase.from("photos").insert({
          listing_id: listing.id,
          storage_path: path,
          filename: file.name,
          category,
          display_order: photos.length + i,
          is_visible: true,
        }).select().single();

        if (newPhoto) {
          const { data: signed } = await supabase.storage
            .from("listing-photos")
            .createSignedUrl(path, 3600);
          setPhotos((prev) => [...prev, { ...newPhoto, url: signed?.signedUrl ?? null } as Photo]);
        }
      }
      setUploadProgress(Math.round(((i + 1) / fileArr.length) * 100));
    }
    setUploading(false);
    setMessage(`${fileArr.length} photo${fileArr.length !== 1 ? "s" : ""} uploaded.`);
    setTimeout(() => setMessage(""), 3000);
  }


  async function toggleVisibility(photoId: string, current: boolean) {
    await supabase.from("photos").update({ is_visible: !current }).eq("id", photoId);
    setPhotos((prev) => prev.map((p) => p.id === photoId ? { ...p, is_visible: !current } : p));
  }

  async function updateCategory(photoId: string, category: string) {
    const res = await fetch("/api/admin/photos/update-category", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoId, category }),
    });
    if (!res.ok) {
      const data = await res.json();
      setMessage("Failed to save category: " + (data.error ?? "Unknown error"));
      setTimeout(() => setMessage(""), 4000);
      return;
    }
    setPhotos((prev) => prev.map((p) => p.id === photoId ? { ...p, category } : p));
    // If it's a non-standard category, add it to the custom list so other photos can pick it
    if (!(PHOTO_CATEGORIES as readonly string[]).includes(category)) {
      setCustomCategories((prev) => prev.includes(category) ? prev : [...prev, category]);
    }
  }

  async function deletePhoto(photoId: string, storagePath: string) {
    await supabase.storage.from("listing-photos").remove([storagePath]);
    await supabase.from("photos").delete().eq("id", photoId);
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    setSelectedIds((prev) => { const next = new Set(prev); next.delete(photoId); return next; });
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    const toDelete = photos.filter((p) => selectedIds.has(p.id));
    await Promise.all(toDelete.map((p) => supabase.storage.from("listing-photos").remove([p.storage_path])));
    await Promise.all(toDelete.map((p) => supabase.from("photos").delete().eq("id", p.id)));
    setPhotos((prev) => prev.filter((p) => !selectedIds.has(p.id)));
    setSelectedIds(new Set());
    setSelectMode(false);
    setDeleting(false);
    setMessage(`${toDelete.length} photo${toDelete.length !== 1 ? "s" : ""} deleted.`);
    setTimeout(() => setMessage(""), 3000);
  }

  async function deleteAll() {
    setDeleting(true);
    setConfirmDeleteAll(false);
    await Promise.all(photos.map((p) => supabase.storage.from("listing-photos").remove([p.storage_path])));
    await supabase.from("photos").delete().eq("listing_id", listing.id);
    setPhotos([]);
    setSelectedIds(new Set());
    setSelectMode(false);
    setDeleting(false);
    setMessage("All photos deleted.");
    setTimeout(() => setMessage(""), 3000);
  }

  async function notifyBroker() {
    setNotifying(true);
    try {
      const [brokerRes, assistantRes] = await Promise.all([
        fetch("/api/email/notify-broker", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingId: listing.id, mediaType: notifyMediaType }),
        }),
        fetch("/api/email/notify-assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingId: listing.id, mediaType: notifyMediaType }),
        }),
      ]);

      const brokerData = await brokerRes.json();
      if (!brokerRes.ok) throw new Error(brokerData.error ?? "Failed to notify broker");

      const assistantData = await assistantRes.json();
      const assistantMsg = assistantData.sent > 0
        ? ` + ${assistantData.sent} assistant${assistantData.sent !== 1 ? "s" : ""}`
        : "";

      setMessage(`Notification sent to ${broker?.display_email ?? brokerName}${assistantMsg}.`);
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setNotifying(false);
      // No auto-dismiss — user closes manually so they can confirm who was notified
    }
  }

  async function updateStatus() {
    setSaving(true);
    await supabase.from("listings").update({ status }).eq("id", listing.id);
    setSaving(false);
    setMessage("Status updated.");
    setTimeout(() => setMessage(""), 3000);
  }

  async function publishSlideshow() {
    setSlideshowBusy(true);
    const slug = slideshowSlug ?? Math.random().toString(36).substring(2, 10);
    const { error } = await supabase.from("listings").update({ slideshow_slug: slug, slideshow_published: true }).eq("id", listing.id);
    if (!error) { setSlideshowSlug(slug); setSlideshowPublished(true); }
    setSlideshowBusy(false);
  }

  async function unpublishSlideshow() {
    setSlideshowBusy(true);
    const { error } = await supabase.from("listings").update({ slideshow_published: false }).eq("id", listing.id);
    if (!error) setSlideshowPublished(false);
    setSlideshowBusy(false);
  }

  function copySlideshowLink() {
    if (!slideshowSlug) return;
    navigator.clipboard.writeText(`${window.location.origin}/s/${slideshowSlug}`);
    setSlideshowCopied(true);
    setTimeout(() => setSlideshowCopied(false), 2000);
  }

  async function toggleShare() {
    if (sharingBusy) return;
    const next = !isShared;
    setSharingBusy(true);
    setIsShared(next); // optimistic
    try {
      const res = await fetch(`/api/listings/${listing.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shared: next }),
      });
      if (!res.ok) throw new Error();
      setMessage(next ? "Shared with the brokerage." : "Removed from brokerage sharing.");
      setTimeout(() => setMessage(""), 3000);
    } catch {
      setIsShared(!next); // revert
      setMessage("Couldn't update sharing. Please try again.");
      setTimeout(() => setMessage(""), 3000);
    } finally {
      setSharingBusy(false);
    }
  }

  async function toggleShowcase() {
    if (showcaseBusy) return;
    const next = !inShowcase;
    setShowcaseBusy(true);
    setInShowcase(next); // optimistic
    try {
      const res = await fetch(`/api/admin/listings/${listing.id}/showcase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ show: next }),
      });
      if (!res.ok) throw new Error();
      setMessage(next ? "Added to Recently Photographed." : "Removed from Recently Photographed.");
      setTimeout(() => setMessage(""), 3000);
    } catch {
      setInShowcase(!next); // revert
      setMessage("Couldn't update the showcase. Please try again.");
      setTimeout(() => setMessage(""), 3000);
    } finally {
      setShowcaseBusy(false);
    }
  }

  // Which yachtpics.com brokerage page this boat belongs on. Optional — most
  // listings never go to the website. Chosen per listing rather than inherited
  // from the brokerage, because most brokers have no brokerage record.
  async function chooseSitePage(next: string) {
    const prev = sitePage;
    setSitePage(next); // optimistic
    try {
      const res = await fetch(`/api/admin/listings/${listing.id}/site-page`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sitePage: next || null }),
      });
      if (!res.ok) throw new Error();
      setMessage(next ? "Website page set." : "Website page cleared.");
      setTimeout(() => setMessage(""), 2500);
    } catch {
      setSitePage(prev); // revert
      setMessage("Couldn't set the website page.");
      setTimeout(() => setMessage(""), 3000);
    }
  }

  // Add a brand-new brokerage to the website taxonomy — for a brokerage that's
  // never been on the site. It joins the picker and, once a boat is published,
  // the Boats index. NOT for re-adding one of the existing pages.
  async function addSitePage() {
    const label = window.prompt("New brokerage name (as it should appear on yachtpics.com):")?.trim();
    if (!label) return;
    try {
      const res = await fetch(`/api/admin/site-pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setPages((prev) => [...prev, { label: data.label, filename: data.filename }].sort((a, b) => a.label.localeCompare(b.label)));
      await chooseSitePage(data.filename);
      setMessage(`Added "${data.label}" and set it for this boat.`);
      setTimeout(() => setMessage(""), 4000);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Couldn't add the brokerage page.");
      setTimeout(() => setMessage(""), 5000);
    }
  }

  // Publish to yachtpics.com. Separate pipeline from Recently Photographed —
  // this one puts the boat on the public brokerage page with a portal slideshow.
  async function togglePublishSite() {
    if (siteBusy) return;
    const next = !onSite;
    setSiteBusy(true);
    try {
      const res = await fetch(`/api/admin/listings/${listing.id}/publish-site`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publish: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setOnSite(next);
      if (!next) setMessage("Removed from the website.");
      else if (data.previewOnly) setMessage(`Generated ${data.label} — ${data.reason}`);
      else setMessage(`Published to yachtpics.com — ${data.uploaded?.length ?? 0} page(s) uploaded.`);
      setTimeout(() => setMessage(""), 6000);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Couldn't update the website.");
      setTimeout(() => setMessage(""), 6000);
    } finally {
      setSiteBusy(false);
    }
  }

  async function handleVideoFiles(files: FileList | null) {
    if (!files) return;
    setVideoError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: { session } } = await supabase.auth.getSession();
    if (!user || !session) {
      setVideoError("Your session has expired. Please refresh the page and sign in again.");
      return;
    }

    const selected = Array.from(files);
    const fileArr = selected.filter(f =>
      f.type === "video/mp4" || f.type === "video/quicktime" ||
      f.name.toLowerCase().endsWith(".mp4") || f.name.toLowerCase().endsWith(".mov")
    );
    if (fileArr.length === 0) {
      setVideoError("Unsupported file type. Please upload an MP4 or MOV video.");
      return;
    }
    const rejected = selected.length - fileArr.length;

    setUploadingVideo(true);
    setVideoUploadProgress(0);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    let failures = 0;
    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i];
      const path = `${listing.broker_id}/${listing.id}/${Date.now()}-${file.name}`;
      // Use XHR so we get real byte-level upload progress (fetch has no progress API)
      const ok = await new Promise<boolean>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const base = (i / fileArr.length) * 100;
            const slice = (e.loaded / e.total) * (100 / fileArr.length);
            setVideoUploadProgress(Math.round(base + slice));
          }
        };
        xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
        xhr.onerror = () => resolve(false);
        xhr.open("POST", `${supabaseUrl}/storage/v1/object/listing-videos/${path}`);
        xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
        xhr.setRequestHeader("cache-control", "max-age=3600");
        xhr.setRequestHeader("content-type", file.type || "video/mp4");
        xhr.send(file);
      });
      if (ok) {
        const { data: newVideo, error: insertError } = await supabase.from("videos").insert({
          listing_id: listing.id,
          storage_path: path,
          filename: file.name,
          uploaded_by: user.id,
          display_order: videos.length + i,
        }).select().single();
        if (insertError || !newVideo) {
          // File reached storage but the database record was rejected (e.g. permissions).
          // Count it as a failure so the user sees an error instead of a silent vanish.
          console.error("Video record insert failed:", insertError);
          failures++;
        } else {
          const { data: signed } = await supabase.storage.from("listing-videos").createSignedUrl(path, 3600);
          setVideos(prev => [...prev, { ...newVideo as Video, url: signed?.signedUrl ?? null }]);
        }
      } else {
        failures++;
      }
      setVideoUploadProgress(Math.round(((i + 1) / fileArr.length) * 100));
    }
    setUploadingVideo(false);
    if (videoInputRef.current) videoInputRef.current.value = "";
    if (failures > 0) {
      setVideoError(`${failures} video${failures > 1 ? "s" : ""} failed to upload. Please check your connection and try again.`);
    } else if (rejected > 0) {
      setVideoError(`${rejected} file${rejected > 1 ? "s were" : " was"} skipped — only MP4 and MOV videos are supported.`);
    }
  }

  async function deleteVideo(videoId: string, storagePath: string) {
    setDeletingVideoIds(prev => new Set(Array.from(prev).concat(videoId)));
    await fetch("/api/videos/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId, storagePath }),
    });
    setVideos(prev => prev.filter(v => v.id !== videoId));
    setDeletingVideoIds(prev => { const next = new Set(prev); next.delete(videoId); return next; });
  }

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <Link
            href={fromBroker ? `/admin/brokers/${listing.broker_id}` : "/admin/listings"}
            className="text-ink-400 hover:text-ink-600 text-sm transition-colors duration-fast ease-quiet"
          >
            {fromBroker ? `← Back to ${brokerName}` : "← All listings"}
          </Link>
          <h1 className="text-display text-ink-900 mt-1">
            {listing.vessel_name ?? "Untitled vessel"}
          </h1>
          <p className="text-ink-500 text-sm mt-0.5">
            {[listing.year, listing.vessel_type, listing.length_ft ? `${listing.length_ft}′` : null, listing.location].filter(Boolean).join(" · ")}
          </p>
          <p className="text-ink-500 text-xs mt-1">Broker: {brokerName}</p>
          {canShare && (
            <button
              onClick={toggleShare}
              disabled={sharingBusy}
              title={isShared ? "Visible to every broker in this brokerage" : "Share this boat with every broker in this brokerage"}
              className={`mt-2 inline-flex items-center gap-2 text-xs font-medium pl-1.5 pr-3 py-1.5 rounded-full border transition-colors duration-fast ease-quiet disabled:opacity-50 ${
                isShared
                  ? "border-accent-500 bg-accent-50 text-accent-700"
                  : "border-hairline-strong bg-white text-ink-500 hover:border-accent-500"
              }`}
            >
              <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors duration-fast ease-quiet ${isShared ? "bg-accent-500" : "bg-ink-300"}`}>
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${isShared ? "translate-x-3.5" : "translate-x-0.5"}`} />
              </span>
              {isShared ? "Shared with brokerage" : "Share with brokerage"}
            </button>
          )}
          <button
            onClick={toggleShowcase}
            disabled={showcaseBusy}
            title={inShowcase ? "Showing in Recently Photographed for all brokers" : "Feature this boat in Recently Photographed"}
            className={`mt-2 ml-0 sm:ml-2 inline-flex items-center gap-2 text-xs font-medium pl-1.5 pr-3 py-1.5 rounded-full border transition-colors duration-fast ease-quiet disabled:opacity-50 ${
              inShowcase
                ? "border-accent-500 bg-accent-50 text-accent-700"
                : "border-hairline-strong bg-white text-ink-500 hover:border-accent-500"
            }`}
          >
            <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors duration-fast ease-quiet ${inShowcase ? "bg-accent-500" : "bg-ink-300"}`}>
              <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${inShowcase ? "translate-x-3.5" : "translate-x-0.5"}`} />
            </span>
            {inShowcase ? "In Recently Photographed" : "Add to Recently Photographed"}
          </button>
          <button
            onClick={togglePublishSite}
            disabled={siteBusy || listing.showcase_opt_out === true || !sitePage}
            title={
              listing.showcase_opt_out
                ? "Pocket listing — the broker vetoed this"
                : !sitePage
                  ? "Pick a website page first"
                  : onSite
                    ? "Live on yachtpics.com"
                    : "Publish this boat to yachtpics.com with a portal slideshow"
            }
            className={`mt-2 ml-0 sm:ml-2 inline-flex items-center gap-2 text-xs font-medium pl-1.5 pr-3 py-1.5 rounded-full border transition-colors duration-fast ease-quiet disabled:opacity-50 ${
              onSite
                ? "border-accent-500 bg-accent-50 text-accent-700"
                : "border-hairline-strong bg-white text-ink-500 hover:border-accent-500"
            }`}
          >
            <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors duration-fast ease-quiet ${onSite ? "bg-accent-500" : "bg-ink-300"}`}>
              <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${onSite ? "translate-x-3.5" : "translate-x-0.5"}`} />
            </span>
            {siteBusy ? "Publishing…" : onSite ? "On yachtpics.com" : "Publish to website"}
          </button>
          {pages.length > 0 && (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <label htmlFor="sitePage" className="text-xs text-ink-400">Website page:</label>
              <select
                id="sitePage"
                value={sitePage}
                onChange={(e) => chooseSitePage(e.target.value)}
                disabled={onSite}
                title={onSite ? "Unpublish before moving this boat to a different page" : "Which brokerage page this boat appears on"}
                className="text-xs border border-hairline-strong rounded-ctl px-2 py-1.5 bg-white text-ink-700 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 disabled:opacity-50 max-w-[16rem]"
              >
                <option value="">— not on the website —</option>
                {pages.map((p) => (
                  <option key={p.filename} value={p.filename}>{p.label}</option>
                ))}
              </select>
              {!onSite && (
                <button
                  onClick={addSitePage}
                  className="text-xs font-medium text-accent-700 hover:text-accent-600 transition-colors duration-fast"
                >
                  + New brokerage
                </button>
              )}
              {!sitePage && (
                <span className="text-xs text-ink-400">Pick one to enable publishing.</span>
              )}
            </div>
          )}
          {listing.showcase_opt_out && (
            <p className="mt-1.5 text-xs text-warn-700">
              Broker kept this a pocket listing — it won&rsquo;t appear in Recently Photographed even when added.
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="text-sm text-ink-700 bg-white border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="sold">Sold</option>
          </select>
          <select
            value={notifyMediaType}
            onChange={(e) => setNotifyMediaType(e.target.value as "photos" | "video" | "both")}
            disabled={notifying}
            title="What to tell the broker is ready"
            className="text-sm text-ink-700 bg-white border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
          >
            <option value="photos">Photos</option>
            <option value="video">Video</option>
            <option value="both">Photos &amp; Video</option>
          </select>
          <button
            onClick={notifyBroker}
            disabled={notifying}
            className="bg-white hover:border-ink-400 hover:text-ink-900 disabled:opacity-50 text-ink-700 text-sm font-medium px-4 py-2 rounded-ctl border border-hairline-strong transition-colors duration-fast ease-quiet"
          >
            {notifying ? "Sending..." : "📧 Notify Broker"}
          </button>
          <button
            onClick={updateStatus}
            disabled={saving}
            className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {message && (
        <div className="mb-5 px-4 py-3 rounded-ctl text-sm bg-success-50 border border-success-200 text-success-700 flex items-start justify-between gap-3">
          <span>{message}</span>
          <button
            onClick={() => setMessage("")}
            className="shrink-0 text-success-600 hover:text-success-700 leading-none text-base font-bold"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <CoBrokerManager listingId={listing.id} brokers={brokerOptions} initialCoBrokers={coBrokers} />

      {/* Client Slideshow — publish so the broker can share / send to client */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 mb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-h2 text-ink-900">Client Slideshow</h2>
            <p className="text-xs text-ink-500 mt-0.5">
              {slideshowPublished
                ? "Published — the broker can share the link, send it to a client, or use the QR code."
                : "Not published. Publish it so this listing can be shared with clients."}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {slideshowPublished ? (
              <>
                <button onClick={copySlideshowLink} className="text-sm text-ink-600 border border-hairline-strong hover:border-ink-400 px-3 py-2 rounded-ctl transition-colors duration-fast ease-quiet">
                  {slideshowCopied ? "Copied ✓" : "Copy link"}
                </button>
                <a href={`/s/${slideshowSlug}`} target="_blank" rel="noopener noreferrer" className="text-sm text-ink-600 border border-hairline-strong hover:border-ink-400 px-3 py-2 rounded-ctl transition-colors duration-fast ease-quiet">
                  Open
                </a>
                <button onClick={unpublishSlideshow} disabled={slideshowBusy} className="text-sm text-ink-500 border border-hairline-strong hover:border-danger-300 hover:text-danger-600 px-3 py-2 rounded-ctl transition-colors duration-fast ease-quiet disabled:opacity-50">
                  {slideshowBusy ? "…" : "Unpublish"}
                </button>
              </>
            ) : (
              <button onClick={publishSlideshow} disabled={slideshowBusy} className="bg-ink-950 hover:bg-ink-800 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet">
                {slideshowBusy ? "Publishing…" : "Publish slideshow"}
              </button>
            )}
          </div>
        </div>
        {slideshowPublished && slideshowSlug && (
          <p className="text-xs text-ink-400 mt-3 break-all">{typeof window !== "undefined" ? window.location.origin : ""}/s/{slideshowSlug}</p>
        )}
      </div>

      {/* Inquiries (leads from the public slideshow) */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 mb-6">
        <p className="label-caps mb-1">Inquiries ({leads.length})</p>
        <p className="text-xs text-ink-500 mb-4">Buyers who reached out from this boat&rsquo;s slideshow.</p>
        {leads.length === 0 ? (
          <p className="text-sm text-ink-400">No inquiries yet.</p>
        ) : (
          <div className="divide-y divide-hairline">
            {leads.map((l) => (
              <div key={l.id} className="py-3">
                <p className="text-sm font-medium text-ink-900 flex items-center gap-2">
                  {l.name ?? "Buyer"}
                  {l.status === "new" && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-warn-50 text-warn-700 border border-warn-200 uppercase tracking-wide">New</span>}
                </p>
                <div className="text-xs text-ink-500 mt-0.5 flex flex-wrap gap-x-3">
                  {l.email && <a href={`mailto:${l.email}`} className="hover:text-accent-700">{l.email}</a>}
                  {l.phone && <a href={`tel:${l.phone}`} className="hover:text-accent-700">{l.phone}</a>}
                  <span className="text-ink-400 tabular-nums">{new Date(l.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}</span>
                </div>
                {l.message && <p className="text-sm text-ink-600 mt-1">{l.message}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Download Activity */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 mb-6">
        <h2 className="label-caps mb-1">Download Activity</h2>
        {downloads.length === 0 ? (
          <p className="text-sm text-ink-400">No downloads yet.</p>
        ) : (
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="text-left border-b border-hairline">
                <th className="pb-2 pr-4 label-caps">Downloaded by</th>
                <th className="pb-2 pr-4 label-caps">Photos</th>
                <th className="pb-2 label-caps">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {downloads.map((d) => (
                <tr key={d.id}>
                  <td className="py-2 pr-4 text-ink-800">
                    {d.source === "link" && (
                      <span className="mr-1.5 align-middle text-[10px] font-semibold uppercase bg-accent-50 text-accent-700 border border-accent-200 rounded px-1.5 py-0.5">
                        Public link
                      </span>
                    )}
                    {d.downloader_name}
                    {d.downloader_email && (
                      <span className="ml-1 text-ink-400 text-xs">({d.downloader_email})</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-ink-600 tabular-nums">{d.photo_count}</td>
                  <td className="py-2 text-ink-500 text-xs whitespace-nowrap tabular-nums">
                    {new Date(d.downloaded_at).toLocaleString("en-US", {
                      month: "short", day: "numeric", year: "numeric",
                      hour: "numeric", minute: "2-digit",
                      timeZone: "America/New_York", timeZoneName: "short",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Emails sent for this listing */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 mb-6">
        <h2 className="label-caps mb-1">Emails sent for this listing</h2>
        {sentEmails.length === 0 ? (
          <p className="text-sm text-ink-400">No emails sent yet for this listing.</p>
        ) : (
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="text-left border-b border-hairline">
                <th className="pb-2 pr-4 label-caps">Type</th>
                <th className="pb-2 pr-4 label-caps">Recipient</th>
                <th className="pb-2 pr-4 label-caps">When</th>
                <th className="pb-2 label-caps">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {sentEmails.map((e) => (
                <tr key={e.id}>
                  <td className="py-2 pr-4">
                    <span className="text-[11px] font-medium bg-ink-100 text-ink-600 rounded px-2 py-0.5 whitespace-nowrap">
                      {EMAIL_TYPE_LABELS[e.email_type] ?? e.email_type}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-ink-800">
                    {e.recipient_email}
                    {e.recipient_role && <span className="ml-1 text-ink-400 text-xs capitalize">({e.recipient_role})</span>}
                  </td>
                  <td className="py-2 pr-4 text-ink-500 text-xs whitespace-nowrap tabular-nums">
                    {new Date(e.sent_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" })}
                  </td>
                  <td className="py-2">
                    {e.status === "failed" ? (
                      <span className="text-[11px] font-semibold text-danger-700 bg-danger-50 border border-danger-200 rounded px-2 py-0.5">Failed</span>
                    ) : (
                      <span className="text-[11px] font-semibold text-success-700 bg-success-50 border border-success-200 rounded px-2 py-0.5">Sent</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Public download links (admin only) */}
      <DownloadLinkManager listingId={listing.id} />

      {/* Photos section */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h2 className="text-h2 text-ink-900">Photos</h2>
            <p className="text-ink-500 text-sm">{photos.length} photo{photos.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {photos.length > 0 && !selectMode && (
              <>
                <button
                  onClick={() => setSelectMode(true)}
                  className="text-sm text-ink-500 hover:text-ink-700 border border-hairline-strong px-3 py-1.5 rounded-ctl transition-colors duration-fast ease-quiet"
                >
                  Select
                </button>
                <button
                  onClick={() => setConfirmDeleteAll(true)}
                  className="text-sm text-danger-600 hover:text-danger-700 border border-hairline-strong hover:border-danger-300 px-3 py-1.5 rounded-ctl transition-colors duration-fast ease-quiet"
                >
                  Delete All
                </button>
              </>
            )}
            {selectMode && (
              <>
                <button
                  onClick={() => setSelectedIds(new Set(photos.map((p) => p.id)))}
                  className="text-sm text-accent-700 font-medium transition-colors duration-fast ease-quiet px-2"
                >
                  Select all
                </button>
                <button
                  onClick={() => { setSelectedIds(new Set()); setSelectMode(false); }}
                  className="text-sm text-ink-400 hover:text-ink-600 transition-colors duration-fast ease-quiet px-2"
                >
                  Cancel
                </button>
                {selectedIds.size > 0 && (
                  <button
                    onClick={deleteSelected}
                    disabled={deleting}
                    className="bg-danger-600 hover:bg-danger-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-1.5 rounded-ctl transition-colors duration-fast ease-quiet"
                  >
                    {deleting ? "Deleting..." : `🗑 Delete ${selectedIds.size}`}
                  </button>
                )}
              </>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-ink-950 hover:bg-ink-800 text-white text-sm font-medium px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
            >
              + Add Photos
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
        </div>

        {/* Delete All confirmation */}
        {confirmDeleteAll && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-surface p-6 max-w-sm w-full shadow-elev-3">
              <h3 className="text-lg font-bold text-ink-900 mb-2">Delete all photos?</h3>
              <p className="text-ink-500 text-sm mb-6">
                This will permanently delete all {photos.length} photo{photos.length !== 1 ? "s" : ""} for this listing. This can&apos;t be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDeleteAll(false)}
                  className="flex-1 bg-white border border-hairline-strong hover:bg-ink-50 text-ink-700 text-sm font-medium py-2.5 rounded-ctl transition-colors duration-fast ease-quiet"
                >
                  Cancel
                </button>
                <button
                  onClick={deleteAll}
                  disabled={deleting}
                  className="flex-1 bg-danger-600 hover:bg-danger-500 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-ctl transition-colors duration-fast ease-quiet"
                >
                  {deleting ? "Deleting..." : "Delete All"}
                </button>
              </div>
            </div>
          </div>
        )}

        {uploading && (
          <div className="mb-4">
            <div className="flex justify-between text-xs text-ink-500 mb-1">
              <span>Uploading...</span><span className="tabular-nums">{uploadProgress}%</span>
            </div>
            <div className="bg-ink-100 rounded-full h-2">
              <div className="bg-accent-500 h-2 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
            </div>
          </div>
        )}

        {photos.length === 0 ? (
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
            className="border-2 border-dashed border-ink-200 rounded-card p-12 text-center cursor-pointer hover:border-accent-500 transition-colors duration-fast ease-quiet"
          >
            <p className="text-ink-400 text-sm">Drag photos here or click to upload</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {photos.map((photo, idx) => {
              const isSelected = selectedIds.has(photo.id);
              return (
                <div
                  key={photo.id}
                  className={`rounded-lg overflow-hidden border-2 bg-white transition-colors duration-fast ease-quiet ${
                    isSelected ? "border-accent-500 shadow-elev-2" :
                    photo.is_visible ? "border-transparent" : "border-ink-200 opacity-60"
                  }`}
                >
                  {/* Thumbnail — click to enlarge or select */}
                  <div
                    className="relative cursor-pointer"
                    onClick={() => selectMode
                      ? setSelectedIds((prev) => { const next = new Set(prev); next.has(photo.id) ? next.delete(photo.id) : next.add(photo.id); return next; })
                      : setLightboxIndex(idx)
                    }
                  >
                    {photo.url ? (
                      <OrientedThumbnail url={photo.url} filename={photo.filename} />
                    ) : (
                      <div className="w-full aspect-[4/3] bg-ink-100 flex items-center justify-center text-ink-400 text-xs">No preview</div>
                    )}
                    {selectMode && (
                      <div className={`absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center ${
                        isSelected ? "bg-accent-500 border-accent-500" : "bg-white/80 border-ink-300"
                      }`}>
                        {isSelected && <span className="text-ink-950 text-xs font-bold">✓</span>}
                      </div>
                    )}
                  </div>

                  {/* Category + actions below thumbnail */}
                  <div className="p-2 bg-white">
                    {customEdit?.photoId === photo.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          autoFocus
                          value={customEdit.value}
                          onChange={(e) => setCustomEdit({ photoId: photo.id, value: e.target.value })}
                          onBlur={() => {
                            const v = customEdit.value.trim();
                            updateCategory(photo.id, v || "Other");
                            setCustomEdit(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              const v = customEdit.value.trim();
                              updateCategory(photo.id, v || "Other");
                              setCustomEdit(null);
                            }
                            if (e.key === "Escape") setCustomEdit(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          placeholder="Type & press Enter..."
                          className="text-xs text-ink-700 bg-transparent border-b border-hairline-strong outline-none flex-1 min-w-0 focus:border-accent-500"
                        />
                        <button type="button" onClick={(e) => { e.stopPropagation(); setCustomEdit(null); }}
                          className="text-ink-400 hover:text-ink-600 text-xs px-1">✕</button>
                      </div>
                    ) : (
                      <select
                        value={
                          (PHOTO_CATEGORIES as readonly string[]).includes(photo.category ?? "") ||
                          customCategories.includes(photo.category ?? "")
                            ? (photo.category ?? "Other")
                            : "__custom__"
                        }
                        onChange={(e) => {
                          e.stopPropagation();
                          if (e.target.value === "__new__") {
                            setCustomEdit({ photoId: photo.id, value: "" });
                          } else {
                            updateCategory(photo.id, e.target.value);
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-ink-600 bg-transparent border-none outline-none cursor-pointer hover:text-accent-700 transition-colors duration-fast ease-quiet max-w-full"
                      >
                        <option value="__new__">+ New custom...</option>
                        {[...PHOTO_CATEGORIES, ...customCategories]
                          .sort((a, b) => a.localeCompare(b))
                          .map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    )}
                    {!photo.is_visible && <span className="text-[10px] text-ink-400 ml-1">· hidden</span>}
                    {!selectMode && (
                      <div className="flex gap-1.5 mt-2">
                        <button
                          onClick={() => toggleVisibility(photo.id, photo.is_visible)}
                          className="flex-1 text-[10px] font-medium text-ink-500 hover:text-ink-800 border border-hairline-strong hover:border-ink-400 rounded py-1 transition-colors duration-fast ease-quiet"
                        >
                          {photo.is_visible ? "Hide" : "Show"}
                        </button>
                        {confirmDeleteId === photo.id ? (
                          <>
                            <button onClick={() => setConfirmDeleteId(null)}
                              className="flex-1 text-[10px] font-medium text-ink-500 border border-hairline-strong rounded py-1 transition-colors duration-fast ease-quiet">
                              Cancel
                            </button>
                            <button onClick={() => { setConfirmDeleteId(null); deletePhoto(photo.id, photo.storage_path); }}
                              className="flex-1 text-[10px] font-bold text-white bg-danger-600 hover:bg-danger-500 rounded py-1 transition-colors duration-fast ease-quiet">
                              Confirm
                            </button>
                          </>
                        ) : (
                          <button onClick={() => setConfirmDeleteId(photo.id)}
                            className="flex-1 text-[10px] font-medium text-danger-600 hover:text-danger-700 border border-danger-200 hover:border-danger-300 rounded py-1 transition-colors duration-fast ease-quiet">
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Videos section */}
      <div className="mt-6 bg-white border border-hairline rounded-card shadow-elev-1 p-6">
        <div className="flex items-start justify-between flex-wrap gap-4 mb-5">
          <div>
            <h2 className="text-h2 text-ink-900">Listing Videos</h2>
            <p className="text-ink-500 text-sm mt-0.5">Upload MP4 or MOV video for this listing. Videos appear first in the client slideshow.</p>
          </div>
          <button
            onClick={() => videoInputRef.current?.click()}
            disabled={uploadingVideo}
            className="bg-ink-950 hover:bg-ink-800 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
          >
            {uploadingVideo ? `Uploading… ${videoUploadProgress}%` : "＋ Upload Video"}
          </button>
          <input ref={videoInputRef} type="file" accept="video/mp4,video/quicktime,.mp4,.mov" multiple className="hidden" onChange={(e) => handleVideoFiles(e.target.files)} />
        </div>

        {uploadingVideo && (
          <div className="mb-4">
            <div className="bg-ink-100 rounded-full h-2">
              <div className="bg-accent-500 h-2 rounded-full transition-all" style={{ width: `${videoUploadProgress}%` }} />
            </div>
            <p className="text-xs text-ink-400 mt-1">Uploading large files may take a moment…</p>
          </div>
        )}

        {videoError && (
          <div className="mb-4 rounded-ctl border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {videoError}
          </div>
        )}

        {videos.length === 0 ? (
          <div
            onClick={() => videoInputRef.current?.click()}
            className="border-2 border-dashed border-ink-200 rounded-card p-10 text-center cursor-pointer hover:border-accent-500 transition-colors duration-fast ease-quiet"
          >
            <p className="text-ink-400 text-sm">No videos yet — click to upload an MP4</p>
          </div>
        ) : (
          <div className="space-y-4">
            {videos.filter(v => !deletingVideoIds.has(v.id)).map((video) => (
              <div key={video.id} className="rounded-card overflow-hidden border border-hairline">
                {video.url && (
                  <video
                    src={video.url}
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full max-h-[420px] bg-black"
                  />
                )}
                <div className="px-4 py-3 bg-ink-50 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink-800 truncate">🎬 {video.filename ?? "video.mp4"}</p>
                    <p className="text-xs text-ink-400 mt-0.5 tabular-nums">
                      {new Date(video.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })}
                    </p>
                  </div>
                  <button
                    onClick={() => deleteVideo(video.id, video.storage_path)}
                    className="text-xs font-medium text-danger-600 hover:text-danger-700 transition-colors duration-fast ease-quiet shrink-0"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Danger zone */}
      <div className="mt-6 border border-danger-200 rounded-card px-6 py-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-ink-700">Delete this listing</p>
          <p className="text-xs text-ink-500 mt-0.5">Permanently removes the listing and all its photos. This cannot be undone.</p>
        </div>
        <DeleteListingButton listingId={listing.id} vesselName={listing.vessel_name} brokerId={listing.broker_id} />
      </div>
      {/* Lightbox */}
      {mounted && lightboxIndex !== null && createPortal(
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.97)", display: "flex", flexDirection: "column" }}
          onClick={() => setLightboxIndex(null)}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", flexShrink: 0 }}>
            <span style={{ color: "#9ca3af", fontSize: 14 }}>
              {photos[lightboxIndex]?.category ? `${photos[lightboxIndex].category} · ` : ""}{lightboxIndex + 1} / {photos.length}
            </span>
            <button onClick={() => setLightboxIndex(null)}
              style={{ color: "#fff", background: "none", border: "none", fontSize: 28, cursor: "pointer", lineHeight: 1 }}>×</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", padding: "0 48px" }}
            onClick={(e) => e.stopPropagation()}>
            {photos[lightboxIndex]?.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photos[lightboxIndex].url!} alt={photos[lightboxIndex].filename ?? ""}
                style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain", display: "block" }} />
            )}
            {lightboxIndex > 0 && (
              <button onClick={() => setLightboxIndex(i => i !== null ? i - 1 : null)}
                style={{ position: "absolute", left: 8, background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: 40, height: 40, color: "#fff", fontSize: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
            )}
            {lightboxIndex < photos.length - 1 && (
              <button onClick={() => setLightboxIndex(i => i !== null ? i + 1 : null)}
                style={{ position: "absolute", right: 8, background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: 40, height: 40, color: "#fff", fontSize: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "12px 16px", flexShrink: 0 }}>
            {photos.map((p, i) => (
              <button key={p.id} onClick={(e) => { e.stopPropagation(); setLightboxIndex(i); }}
                style={{ flexShrink: 0, borderRadius: 4, overflow: "hidden", border: "none", cursor: "pointer", opacity: i === lightboxIndex ? 1 : 0.4, outline: i === lightboxIndex ? "2px solid var(--accent)" : "none" }}>
                {p.url && <img src={p.url} alt="" style={{ width: 56, height: 36, objectFit: "cover", display: "block" }} />}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function OrientedThumbnail({ url, filename }: { url: string; filename: string | null }) {
  const [isVertical, setIsVertical] = useState(false);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={filename ?? ""}
      onLoad={(e) => {
        const img = e.target as HTMLImageElement;
        setIsVertical(img.naturalHeight > img.naturalWidth);
      }}
      className={`w-full object-cover ${isVertical ? "aspect-[3/4]" : "aspect-[4/3]"}`}
    />
  );
}
