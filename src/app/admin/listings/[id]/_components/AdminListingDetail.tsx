"use client";

import { useState, useRef, useEffect } from "react";
import CoBrokerManager from "./CoBrokerManager";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { PHOTO_CATEGORIES } from "@/lib/photoCategories";
import { guessCategory } from "@/lib/guessCategory";
import { orderPhotos } from "@/lib/photoOrder";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import VideoDetailsEditor from "@/components/VideoDetailsEditor";
import PrepareVideoForSite from "@/components/PrepareVideoForSite";
import { uploadListingVideo } from "@/lib/uploadListingVideo";
import { SITE_MEDIA_OPTIONS, type SiteMedia } from "@/lib/siteMedia";
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
  site_media?: string | null;
  site_page?: string | null;
  showcase_opt_out?: boolean | null;
  slideshow_slug?: string | null;
  slideshow_published?: boolean | null;
  hero_photo_id?: string | null;
  photo_order_manual?: boolean | null;
  profiles: { first_name: string | null; last_name: string | null; display_email: string | null } | null;
}

interface Video {
  id: string;
  storage_path: string;
  filename: string | null;
  created_at: string;
  url: string | null;
  title?: string | null;
  description?: string | null;
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
  // Resized thumbnails keyed by photo id, signed once in the background. The
  // grid shows the full-size original until they land, so nothing blocks.
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/thumbs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingId: listing.id, width: 400 }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.urls) setThumbs(d.urls); })
      .catch(() => { /* thumbnails are an optimisation, never a blocker */ });
  }, [listing.id]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [status, setStatus] = useState(listing.status);
  const [isShared, setIsShared] = useState(listing.is_shared === true);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [inShowcase, setInShowcase] = useState(listing.in_showcase === true);
  const [showcaseBusy, setShowcaseBusy] = useState(false);
  const [onSite, setOnSite] = useState(listing.publish_to_site === true);
  const [siteBusy, setSiteBusy] = useState(false);
  // What this boat shows on yachtpics.com. Separate from whether it's on the
  // site at all, and separate from the videos' in_slideshow flag (which governs
  // the client slideshow, not the public website).
  const [siteMedia, setSiteMedia] = useState<SiteMedia>(
    (listing.site_media as SiteMedia) ?? "photos"
  );
  const [siteMediaBusy, setSiteMediaBusy] = useState(false);
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
  // Held until confirmed — deleting media is permanent, so nothing irreversible
  // happens on a single click.
  const [pendingVideoDelete, setPendingVideoDelete] = useState<{ id: string; storagePath: string; name: string } | null>(null);
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkCategorizing, setBulkCategorizing] = useState(false);
  const [heroPhotoId, setHeroPhotoId] = useState<string | null>(listing.hero_photo_id ?? null);
  const [sorting, setSorting] = useState(false);
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
    // Stamp WHICH admin uploaded these. It used to be null, which made every
    // admin upload anonymous — "who uploaded this?" had no answer beyond
    // "YachtPics". The by-YachtPics checks look the role up by id, so a
    // stamped admin still counts as ours.
    const { data: { user } } = await supabase.auth.getUser();

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
          uploaded_by: user?.id ?? null,
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

  // Set the category on every selected photo at once — so 20 shots of the same
  // area are one pick, not twenty.
  async function applyBulkCategory() {
    if (!bulkCategory || selectedIds.size === 0) return;
    setBulkCategorizing(true);
    const ids = Array.from(selectedIds);
    await Promise.all(ids.map((photoId) => updateCategory(photoId, bulkCategory)));
    setBulkCategorizing(false);
    setSelectedIds(new Set());
    const label = bulkCategory;
    setBulkCategory("");
    setMessage(`Set ${ids.length} photo${ids.length !== 1 ? "s" : ""} to “${label}”.`);
    setTimeout(() => setMessage(""), 3000);
  }

  // Star / cover photo — the featured image used on the showcase card, listings
  // card, flyer, and social posts. Clicking the current one clears it.
  async function setHero(photoId: string) {
    const next = heroPhotoId === photoId ? null : photoId;
    const prev = heroPhotoId;
    setHeroPhotoId(next); // optimistic
    const { error } = await supabase.from("listings").update({ hero_photo_id: next }).eq("id", listing.id);
    if (error) {
      setHeroPhotoId(prev);
      setMessage("Couldn't update the cover photo.");
      setTimeout(() => setMessage(""), 3000);
      return;
    }
    setMessage(next ? "Cover photo set." : "Cover photo cleared.");
    setTimeout(() => setMessage(""), 2500);
  }

  // Rewrite display_order into the canonical walk-the-boat order (profiles →
  // exterior → engine room → interior → staterooms). Marks the listing
  // hand-sorted so that order sticks everywhere.
  async function sortToStandardOrder() {
    if (sorting || photos.length === 0) return;
    if (!confirm("Re-sort all photos into the standard order? Your current order will be replaced.")) return;
    setSorting(true);
    const sorted = orderPhotos(photos, { manual: false, heroId: heroPhotoId ?? null });
    await Promise.all(sorted.map((p, i) => supabase.from("photos").update({ display_order: i }).eq("id", p.id)));
    setPhotos(sorted.map((p, i) => ({ ...p, display_order: i })));
    await supabase.from("listings").update({ photo_order_manual: true }).eq("id", listing.id);
    setSorting(false);
    setMessage("Sorted to standard order.");
    setTimeout(() => setMessage(""), 2500);
  }

  // All photo deletions go through the delete API rather than raw storage
  // calls: the server verifies access, deletes the recorded path, and writes
  // the deletion log — the record that answers "what happened to the photos
  // on this boat?" long after they're gone.
  async function deletePhotosViaApi(photoIds: string[]) {
    await fetch("/api/photos/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoIds }),
    });
  }

  async function deletePhoto(photoId: string, _storagePath: string) {
    await deletePhotosViaApi([photoId]);
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    setSelectedIds((prev) => { const next = new Set(prev); next.delete(photoId); return next; });
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    const toDelete = photos.filter((p) => selectedIds.has(p.id));
    await deletePhotosViaApi(toDelete.map((p) => p.id));
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
    await deletePhotosViaApi(photos.map((p) => p.id));
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

  /**
   * Choose what this boat puts on the website: photos, video, or both.
   *
   * Saved immediately, but the live page only changes on the next publish —
   * said plainly in the UI, because a setting that looks applied but isn't is
   * exactly how a boat ends up on the site showing the wrong thing.
   */
  async function chooseSiteMedia(next: SiteMedia) {
    if (next === siteMedia || siteMediaBusy) return;
    const prev = siteMedia;
    setSiteMedia(next); // optimistic
    setSiteMediaBusy(true);
    try {
      const res = await fetch(`/api/admin/listings/${listing.id}/site-media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteMedia: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setMessage(
        onSite
          ? `Saved — re-publish to update the live page.`
          : `Saved.`
      );
      setTimeout(() => setMessage(""), 5000);
    } catch (e) {
      setSiteMedia(prev); // revert
      setMessage(e instanceof Error ? e.message : "Couldn't save that.");
      setTimeout(() => setMessage(""), 5000);
    } finally {
      setSiteMediaBusy(false);
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
      if (!next) {
        setMessage(
          data.warning
            ? `Removed from the website — ${data.warning}`
            : "Removed from the website — the boat page is deleted and its video is off the media host. Photos and video stay in the portal."
        );
      }
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
    // Shared with the create forms and the broker's Manage page — uploads go
    // straight to the private Cloudflare bucket, which is what stops Supabase
    // storage growing. The helper returns a playback link, since the browser
    // can't sign for that bucket itself.
    const failed: string[] = [];
    for (let i = 0; i < fileArr.length; i++) {
      const result = await uploadListingVideo({
        supabase,
        file: fileArr[i],
        listingId: listing.id,
        uploadedBy: user.id,
        displayOrder: videos.length + i,
        onProgress: (pct) => {
          const base = (i / fileArr.length) * 100;
          setVideoUploadProgress(Math.round(base + (pct / fileArr.length)));
        },
      });
      if (result.ok) {
        setVideos(prev => [...prev, { ...(result.video as unknown as Video), url: result.playbackUrl }]);
      } else {
        console.error("Video upload failed:", result.error);
        // Name the actual reason. A generic "check your connection" once hid a
        // real fault for days — the truth is always more useful.
        failed.push(`${fileArr[i].name} — ${result.error}`);
      }
      setVideoUploadProgress(Math.round(((i + 1) / fileArr.length) * 100));
    }
    setUploadingVideo(false);
    if (videoInputRef.current) videoInputRef.current.value = "";
    if (failed.length > 0) {
      setVideoError(`${failed.length > 1 ? `${failed.length} videos didn't upload. ` : ""}${failed.join(" · ")}`);
    } else if (rejected > 0) {
      setVideoError(`${rejected} file${rejected > 1 ? "s were" : " was"} skipped — only MP4 and MOV videos are supported.`);
    }
  }

  async function deleteVideo(videoId: string, storagePath: string) {
    setDeletingVideoIds(prev => new Set(Array.from(prev).concat(videoId)));
    setVideoError(null);
    try {
      const res = await fetch("/api/videos/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, storagePath }),
      });
      // Only drop it from the list once the server confirms. Removing it
      // regardless is what made a refused delete look like it had worked —
      // the video vanished, then reappeared on the next load.
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? `Delete failed (${res.status})`);
      }
      // The video is gone from the portal either way. This only fires when the
      // published website page couldn't be rewritten — worth saying, because
      // until it is, the page still shows a player for a video that no longer
      // exists.
      if (data.siteWarning) {
        setVideoError(String(data.siteWarning) + " Re-publish the boat to fix it.");
      }
      setVideos(prev => prev.filter(v => v.id !== videoId));
    } catch (e) {
      setVideoError(`Couldn't delete that video — ${e instanceof Error ? e.message : "please try again"}.`);
    } finally {
      setDeletingVideoIds(prev => { const next = new Set(prev); next.delete(videoId); return next; });
    }
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
          {/* A bordered control rather than a text link. As a link tucked on the
              end of the specs line it was genuinely hard to find — it took three
              looks to spot, which is the interface being wrong rather than the
              person. These details were read-only until now, so a typo at upload
              could only be fixed by deleting the listing and re-uploading every
              photo. */}
          <Link
            href={`/admin/listings/${listing.id}/edit`}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-ctl border border-hairline-strong bg-white text-ink-600 hover:border-accent-500 hover:text-ink-900 transition-colors duration-fast ease-quiet"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
            Edit vessel details
          </Link>
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
            // The pocket-listing veto blocks putting a boat UP, never taking
            // one DOWN. Disabling both directions locked the switch on boats
            // that were published before the broker marked them private —
            // exactly when it needs to work.
            disabled={siteBusy || (listing.showcase_opt_out === true && !onSite) || !sitePage}
            title={
              listing.showcase_opt_out && onSite
                ? "Pocket listing — take it off the website"
                : listing.showcase_opt_out
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

          {/* What goes on the page. Only shown once a brokerage page is chosen,
              since it's meaningless before that. Video options are disabled with
              a reason when the boat has none, rather than silently doing
              nothing. */}
          {sitePage && (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-ink-400">Show on the page:</span>
              <div className="inline-flex rounded-ctl border border-hairline-strong overflow-hidden">
                {SITE_MEDIA_OPTIONS.map((opt) => {
                  const needsVideo = opt.value !== "photos";
                  const blocked = needsVideo && videos.length === 0;
                  const active = siteMedia === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => chooseSiteMedia(opt.value)}
                      disabled={siteMediaBusy || blocked}
                      title={blocked ? "This boat has no video uploaded" : opt.title}
                      className={`text-xs font-medium px-3 py-1.5 transition-colors duration-fast ease-quiet disabled:opacity-40 disabled:cursor-not-allowed ${
                        active
                          ? "bg-accent-500 text-ink-950"
                          : "bg-white text-ink-600 hover:bg-ink-50"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {onSite && (
                <span className="text-xs text-ink-400">
                  Re-publish to apply.
                </span>
              )}
            </div>
          )}

          {/* Video has to reach the media host BEFORE publishing — a 1.2GB file
              can't be copied inside the publish request. This does it in parts,
              with real progress. */}
          {sitePage && siteMedia !== "photos" && videos.length > 0 && (
            <PrepareVideoForSite videos={videos.map((v) => ({ id: v.id, filename: v.filename }))} />
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
                  <>
                    {/* Bulk category — set the area on every selected photo at once */}
                    <div className="flex items-center gap-2">
                      <select
                        value={bulkCategory}
                        onChange={(e) => setBulkCategory(e.target.value)}
                        className="text-sm border border-hairline-strong rounded-ctl px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent-500"
                      >
                        <option value="">Assign category…</option>
                        {PHOTO_CATEGORIES.filter((c) => c !== "Other").map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                        {customCategories.map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                        <option value="Other">Other</option>
                      </select>
                      {bulkCategory && (
                        <button
                          onClick={applyBulkCategory}
                          disabled={bulkCategorizing}
                          className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold px-3 py-1.5 rounded-ctl transition-colors duration-fast ease-quiet whitespace-nowrap"
                        >
                          {bulkCategorizing ? "Applying…" : `Apply to ${selectedIds.size}`}
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => setConfirmDeleteSelected(true)}
                      disabled={deleting}
                      className="bg-danger-600 hover:bg-danger-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-1.5 rounded-ctl transition-colors duration-fast ease-quiet"
                    >
                      {deleting ? "Deleting..." : `🗑 Delete ${selectedIds.size}`}
                    </button>
                  </>
                )}
              </>
            )}
            {photos.length > 1 && !selectMode && (
              <button
                onClick={sortToStandardOrder}
                disabled={sorting}
                title="Rewrite the order to the standard walk-through: profiles, exterior, engine room, then the interior"
                className="text-sm font-medium px-3 py-2 rounded-ctl border border-hairline-strong bg-white text-ink-600 hover:border-accent-500 hover:text-ink-900 disabled:opacity-50 transition-colors duration-fast ease-quiet"
              >
                {sorting ? "Sorting…" : "Sort to standard order"}
              </button>
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

        {/* Deleting media is permanent — the file leaves storage entirely, so
            these name what's going rather than asking a bare "Are you sure?". */}
        <ConfirmDeleteDialog
          open={pendingVideoDelete !== null}
          title="Delete this video?"
          body={
            <>
              <span className="font-medium text-ink-700 break-all">{pendingVideoDelete?.name}</span> will be
              permanently removed from this listing. This can&apos;t be undone, and any video download link
              already sent will no longer include it.
            </>
          }
          confirmLabel="Delete video"
          busy={pendingVideoDelete ? deletingVideoIds.has(pendingVideoDelete.id) : false}
          onCancel={() => setPendingVideoDelete(null)}
          onConfirm={() => {
            if (!pendingVideoDelete) return;
            const target = pendingVideoDelete;
            setPendingVideoDelete(null);
            deleteVideo(target.id, target.storagePath);
          }}
        />

        <ConfirmDeleteDialog
          open={confirmDeleteSelected}
          title={`Delete ${selectedIds.size} photo${selectedIds.size !== 1 ? "s" : ""}?`}
          body="These photos will be permanently removed from this listing. This can't be undone."
          confirmLabel={`Delete ${selectedIds.size}`}
          busy={deleting}
          onCancel={() => setConfirmDeleteSelected(false)}
          onConfirm={() => { setConfirmDeleteSelected(false); deleteSelected(); }}
        />

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
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 items-start">
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
                    {/* Only ever the resized url — never the original. Falling back
                        to photo.url would make the browser pull every full-size
                        file (~2 MB each) on first paint. */}
                    {photo.url ? (
                      <OrientedThumbnail url={thumbs[photo.id] ?? null} filename={photo.filename} />
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
                    {/* Cover-photo star — sets the featured image (showcase card,
                        listings card, flyer, social). Filled = current cover. */}
                    {!selectMode && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setHero(photo.id); }}
                        title={heroPhotoId === photo.id ? "Cover photo — click to clear" : "Set as cover photo"}
                        aria-label={heroPhotoId === photo.id ? "Clear cover photo" : "Set as cover photo"}
                        className={`absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center text-sm shadow-elev-1 transition-colors duration-fast ease-quiet ${
                          heroPhotoId === photo.id
                            ? "bg-accent-500 text-ink-950"
                            : "bg-white/85 text-ink-500 hover:text-ink-900"
                        }`}
                      >
                        {heroPhotoId === photo.id ? "★" : "☆"}
                      </button>
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
                    {/* What this video IS — becomes the heading above it on the
                        published boat page. */}
                    <div className="mt-1.5">
                      <VideoDetailsEditor
                        videoId={video.id}
                        title={video.title ?? null}
                        description={video.description ?? null}
                        onSaved={(next) =>
                          setVideos((prev) => prev.map((v) => (v.id === video.id ? { ...v, ...next } : v)))
                        }
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => setPendingVideoDelete({
                      id: video.id,
                      storagePath: video.storage_path,
                      name: video.filename ?? "this video",
                    })}
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
                {/* Filmstrip renders at 56px — the resized version is plenty. */}
                {(thumbs[p.id] ?? p.url) && (
                  <img src={thumbs[p.id] ?? p.url!} alt="" loading="lazy" decoding="async" style={{ width: 56, height: 36, objectFit: "cover", display: "block" }} />
                )}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function OrientedThumbnail({ url, filename }: { url: string | null; filename: string | null }) {
  const [isVertical, setIsVertical] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  // onLoad alone misses images that are already cached/complete before React
  // attaches the handler — which left every card defaulting to landscape (4:3)
  // and cropping verticals. Measure on mount too so orientation is always right.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setIsVertical(img.naturalHeight > img.naturalWidth);
    }
  }, [url]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={url ?? undefined}
      alt={filename ?? ""}
      loading="lazy"
      decoding="async"
      onLoad={(e) => {
        const img = e.currentTarget;
        setIsVertical(img.naturalHeight > img.naturalWidth);
      }}
      className={`w-full object-cover ${isVertical ? "aspect-[3/4]" : "aspect-[4/3]"}`}
    />
  );
}
