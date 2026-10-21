"use client";

import BoatShowCard from "@/components/BoatShowCard";
import { useState, useRef, useEffect } from "react";
import CoBrokerManager from "./CoBrokerManager";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import VideoDetailsEditor from "@/components/VideoDetailsEditor";
import PrepareVideoForSite from "@/components/PrepareVideoForSite";
import { uploadListingVideo } from "@/lib/uploadListingVideo";
import { SITE_MEDIA_OPTIONS, type SiteMedia } from "@/lib/siteMedia";
import DeleteListingButton from "./DeleteListingButton";
import DownloadLinkManager from "./DownloadLinkManager";
import ListingEngagement from "@/components/ListingEngagement";
import SortableVideoList from "@/components/SortableVideoList";
import { arrayMove } from "@dnd-kit/sortable";
// Photo management (grid, upload, replace, delete, order, categories, cover,
// lightbox, saving originals) is shared with the broker listing page.
import {
  ADMIN_PHOTO_CAPABILITIES, type PhotoMessage,
  useListingPhotos, usePhotoActions, useOriginalSave,
  PhotoGrid, PhotoLightbox, PhotoToolbar, DeletePhotosDialogs, SavePanel,
  PhotoFileInputs, UploadProgress, UploadFailedNotice,
} from "@/components/listing-photos";

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
  showcase_opt_out_at?: string | null;
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
  /** Whether it plays in the client slideshow (/s/[slug]). Defaults on. */
  in_slideshow?: boolean | null;
  display_order?: number | null;
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

export default function AdminListingDetail({ listing, photos: initialPhotos, videos: initialVideos = [], globalCustomCategories = [], downloads = [], sentEmails = [], canShare = false, brokerOptions = [], sitePages = [], coBrokers = [], leads = [], fromBroker = false, pocketSetBy = null }: { listing: Listing; photos: Photo[]; videos?: Video[]; globalCustomCategories?: string[]; downloads?: DownloadRecord[]; sentEmails?: SentEmail[]; canShare?: boolean; brokerOptions?: { id: string; name: string }[]; sitePages?: { label: string; filename: string }[]; coBrokers?: { id: string; name: string }[]; leads?: Lead[]; fromBroker?: boolean; pocketSetBy?: string | null }) {
  const supabase = createClient();
  const [status, setStatus] = useState(listing.status);
  const [isShared, setIsShared] = useState(listing.is_shared === true);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [inShowcase, setInShowcase] = useState(listing.in_showcase === true);
  const [showcaseBusy, setShowcaseBusy] = useState(false);
  const [optOut, setOptOut] = useState(listing.showcase_opt_out === true);
  const [optOutBusy, setOptOutBusy] = useState(false);
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
  // Defaults to what's actually on the listing (photos, video or both) until
  // the admin picks something by hand.
  const [notifyMediaType, setNotifyMediaTypeRaw] = useState<"photos" | "video" | "both">(
    initialVideos.length > 0 ? (initialPhotos.length > 0 ? "both" : "video") : "photos"
  );
  const [notifyTypeTouched, setNotifyTypeTouched] = useState(false);
  // Last "ready" email for this listing, from the email log; updated locally
  // after a send so the confirm step works without a reload.
  const [lastReadySentAt, setLastReadySentAt] = useState<string | null>(() => {
    const times = sentEmails
      .filter((e) => ["photos_ready", "video_ready", "media_ready"].includes(e.email_type) && e.status !== "failed")
      .map((e) => e.sent_at)
      .sort();
    return times.length ? times[times.length - 1] : null;
  });
  // Who gets the "ready" email. "assistant" keeps the broker's inbox quiet when
  // only their assistant needs to know the files have landed.
  const [notifyTo, setNotifyTo] = useState<"both" | "broker" | "assistant">("both");
  // The banner under the header. `kind` picks the colour: a failure must never
  // show up in the green success style.
  const [message, setMessageText] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  function setMessage(text: string, kind: "success" | "error" = "success") {
    setMessageText(text);
    setMessageKind(kind);
  }

  // ── Photos — shared with the broker listing page (src/components/listing-photos).
  // Thumbnails, upload, replace, delete, order, categories, cover, show/hide,
  // AI labels, lightbox and saving originals live there; this page supplies
  // the admin capabilities and its banner. Failures stay up until closed;
  // confirmations clear themselves.
  const photoState = useListingPhotos({
    supabase,
    listingId: listing.id,
    caps: ADMIN_PHOTO_CAPABILITIES,
    initialPhotos,
    initialHeroPhotoId: listing.hero_photo_id ?? null,
    initialCustomCategories: globalCustomCategories,
  });
  const { photos, thumbs, heroPhotoId } = photoState;
  const onPhotoMessage = (m: PhotoMessage) => {
    setMessage(m.text, m.kind);
    if (m.kind === "success" && m.ms) {
      const shown = m.text;
      setTimeout(() => setMessageText((cur) => (cur === shown ? "" : cur)), m.ms);
    }
  };
  const photoActions = usePhotoActions({
    supabase,
    listingId: listing.id,
    caps: ADMIN_PHOTO_CAPABILITIES,
    state: photoState,
    onMessage: onPhotoMessage,
    // Files go under the listing's broker, as with every admin upload.
    ownerFolder: () => listing.broker_id,
  });
  const save = useOriginalSave({
    supabase,
    vesselName: listing.vessel_name,
    photos,
    onMessage: onPhotoMessage,
    onFinished: photoActions.clearSelection,
  });
  // Held until confirmed — deleting media is permanent, so nothing irreversible
  // happens on a single click.
  const [pendingVideoDelete, setPendingVideoDelete] = useState<{ id: string; storagePath: string; name: string } | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Video state
  const [videos, setVideos] = useState<Video[]>(initialVideos);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState(0);
  const [deletingVideoIds, setDeletingVideoIds] = useState<Set<string>>(new Set());
  const [videoError, setVideoError] = useState<string | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // Slideshow toggle and reorder go through /api/admin/videos/[id] (service
  // role): the repo's videos RLS has no admin update policy, and an update RLS
  // filters out comes back with no error, so a browser write could silently
  // do nothing.
  async function patchVideo(videoId: string, patch: { in_slideshow?: boolean; display_order?: number }): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/videos/${videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function toggleVideoSlideshow(videoId: string, current: boolean) {
    setVideos(prev => prev.map(v => v.id === videoId ? { ...v, in_slideshow: !current } : v));
    const ok = await patchVideo(videoId, { in_slideshow: !current });
    if (!ok) {
      setVideos(prev => prev.map(v => v.id === videoId ? { ...v, in_slideshow: current } : v));
      setVideoError("Couldn't change that video's slideshow setting — please try again.");
    }
  }

  async function moveVideo(activeId: string, overId: string) {
    const before = videos;
    const oldIndex = before.findIndex(v => v.id === activeId);
    const newIndex = before.findIndex(v => v.id === overId);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(before, oldIndex, newIndex).map((v, idx) => ({ ...v, display_order: idx }));
    setVideos(next);
    setVideoError(null);
    const results = await Promise.all(next.map((v, idx) => patchVideo(v.id, { display_order: idx })));
    if (results.some(ok => !ok)) {
      setVideos(before);
      setVideoError("Couldn't save the new video order — please try again.");
    }
  }


  const broker = listing.profiles;
  const brokerName = broker?.first_name
    ? `${broker.first_name} ${broker.last_name ?? ""}`.trim()
    : broker?.display_email ?? "Unknown";

  // Follow what's on the listing for the "ready" email's media type until the
  // admin chooses one themselves.
  useEffect(() => {
    if (notifyTypeTouched) return;
    setNotifyMediaTypeRaw(videos.length > 0 ? (photos.length > 0 ? "both" : "video") : "photos");
  }, [photos.length, videos.length, notifyTypeTouched]);
  function setNotifyMediaType(v: "photos" | "video" | "both") {
    setNotifyTypeTouched(true);
    setNotifyMediaTypeRaw(v);
  }

  async function notifyBroker() {
    if (lastReadySentAt && !confirm(
      `A ready email already went out for this listing on ${new Date(lastReadySentAt).toLocaleString()}. Send another?`
    )) return;
    setNotifying(true);
    try {
      const wantBroker = notifyTo !== "assistant";
      const wantAssistant = notifyTo !== "broker";

      const post = (url: string, extra: Record<string, unknown>) =>
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingId: listing.id, mediaType: notifyMediaType, ...extra }),
        });

      const [brokerRes, assistantRes, brokerageRes] = await Promise.all([
        // Broker only → the broker route must not push the assistants either.
        wantBroker ? post("/api/email/notify-broker", { pushAssistants: wantAssistant }) : Promise.resolve(null),
        // Assistant only → the assistant route does the push, since the broker route isn't running.
        wantAssistant ? post("/api/email/notify-assistant", { push: !wantBroker }) : Promise.resolve(null),
        // Automatic, no toggle: brokerage admins expect to know when their brokers'
        // media lands, so any send to the broker copies them by email. Skipped on an
        // assistant-only send — that isn't "telling the broker". excludeAssistants
        // stops anyone who is both admin and assistant getting two copies.
        wantBroker
          ? post("/api/email/notify-brokerage-admin", { excludeAssistants: wantAssistant })
          : Promise.resolve(null),
      ]);

      const sentTo: string[] = [];
      const notes: string[] = [];

      if (brokerRes) {
        const brokerData = await brokerRes.json().catch(() => ({}));
        if (!brokerRes.ok) throw new Error(brokerData.error ?? "Failed to notify broker");
        sentTo.push(broker?.display_email ?? brokerName);
      }

      if (assistantRes) {
        const assistantData = await assistantRes.json().catch(() => ({}));
        if (!assistantRes.ok) throw new Error(assistantData.error ?? "Failed to notify assistant");
        const n = Number(assistantData.sent ?? 0);
        const failed = Number(assistantData.failed ?? 0);
        if (n > 0) sentTo.push(`${n} assistant${n !== 1 ? "s" : ""}`);
        if (failed > 0) notes.push(`${failed} assistant email${failed !== 1 ? "s" : ""} failed`);
        else if (n === 0) notes.push(assistantData.message ?? "no assistant linked to this broker");
      }

      if (brokerageRes) {
        const brokerageData = await brokerageRes.json().catch(() => ({}));
        if (!brokerageRes.ok) throw new Error(brokerageData.error ?? "Failed to notify brokerage admin");
        const n = Number(brokerageData.sent ?? 0);
        const failed = Number(brokerageData.failed ?? 0);
        const names: string[] = Array.isArray(brokerageData.names) ? brokerageData.names : [];
        if (n > 0) {
          sentTo.push(names.length ? `brokerage admin (${names.join(", ")})` : `${n} brokerage admin${n !== 1 ? "s" : ""}`);
        }
        if (failed > 0) notes.push(`${failed} brokerage admin email${failed !== 1 ? "s" : ""} failed`);
        // "Broker isn't part of a brokerage" is the normal case for most brokers —
        // reporting it every time would just be noise. Anything else is worth saying.
        else if (n === 0 && brokerageData.message && brokerageData.message !== "Broker isn't part of a brokerage.") {
          notes.push(brokerageData.message);
        }
      }

      if (sentTo.length === 0) {
        // Nothing actually went out — say so rather than report a success.
        setMessage(`Nothing sent — ${notes.join("; ")}.`, "error");
        return;
      }

      setLastReadySentAt(new Date().toISOString());
      setMessage(`Notification sent to ${sentTo.join(" + ")}.${notes.length ? ` (${notes.join("; ")})` : ""}`, notes.some((n) => n.includes("failed")) ? "error" : "success");
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setNotifying(false);
      // No auto-dismiss — user closes manually so they can confirm who was notified
    }
  }

  async function updateStatus() {
    setSaving(true);
    const { error } = await supabase.from("listings").update({ status }).eq("id", listing.id);
    setSaving(false);
    if (error) {
      setMessage(`Couldn't update the status: ${error.message}`, "error");
      return;
    }
    setMessage("Status updated.");
    setTimeout(() => setMessage(""), 3000);
  }

  async function publishSlideshow() {
    setSlideshowBusy(true);
    const slug = slideshowSlug ?? Math.random().toString(36).substring(2, 10);
    const { error } = await supabase.from("listings").update({ slideshow_slug: slug, slideshow_published: true }).eq("id", listing.id);
    if (!error) { setSlideshowSlug(slug); setSlideshowPublished(true); }
    else setMessage(`Couldn't publish the slideshow: ${error.message}`, "error");
    setSlideshowBusy(false);
  }

  async function unpublishSlideshow() {
    setSlideshowBusy(true);
    const { error } = await supabase.from("listings").update({ slideshow_published: false }).eq("id", listing.id);
    if (!error) setSlideshowPublished(false);
    else setMessage(`Couldn't unpublish the slideshow: ${error.message}`, "error");
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
      setMessage("Couldn't update sharing. Please try again.", "error");
      setTimeout(() => setMessage(""), 3000);
    } finally {
      setSharingBusy(false);
    }
  }

  /**
   * Pocket listing, from the admin side.
   *
   * Same endpoint the broker's own switch uses — it already accepted admins,
   * so this was a missing control rather than a missing capability. Marking one
   * also pulls the boat off yachtpics.com if it was already live; that happens
   * inside the route, which is why the message reports it.
   */
  async function toggleOptOut() {
    if (optOutBusy) return;
    const next = !optOut;
    setOptOutBusy(true);
    setOptOut(next); // optimistic
    try {
      const res = await fetch(`/api/listings/${listing.id}/showcase-optout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optOut: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error();
      setMessage(next
        ? (data.removedFromSite
            ? "Marked a pocket listing — and taken off yachtpics.com."
            : "Marked a pocket listing — kept out of Recently Photographed.")
        : "No longer a pocket listing.");
      setTimeout(() => setMessage(""), 4000);
    } catch {
      setOptOut(!next); // revert
      setMessage("Couldn't update the pocket-listing setting. Please try again.", "error");
      setTimeout(() => setMessage(""), 3000);
    } finally {
      setOptOutBusy(false);
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
      setMessage("Couldn't update the showcase. Please try again.", "error");
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
      setMessage("Couldn't set the website page.", "error");
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
      setMessage(e instanceof Error ? e.message : "Couldn't add the brokerage page.", "error");
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
      setMessage(e instanceof Error ? e.message : "Couldn't save that.", "error");
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
      setMessage(e instanceof Error ? e.message : "Couldn't update the website.", "error");
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
            {[listing.year, listing.make, listing.vessel_type, listing.length_ft ? `${listing.length_ft}′` : null, listing.location].filter(Boolean).join(" · ")}
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
          <Link
            href={`/dashboard/listings/${listing.id}/reel`}
            className="mt-2 ml-2 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-ctl border border-hairline-strong bg-white text-ink-600 hover:border-accent-500 hover:text-ink-900 transition-colors duration-fast ease-quiet"
            title="Turn the photos into a reel or film"
          >
            Reel
          </Link>
          <Link
            href={`/dashboard/listings/${listing.id}/social`}
            className="mt-2 ml-2 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-ctl border border-hairline-strong bg-white text-ink-600 hover:border-accent-500 hover:text-ink-900 transition-colors duration-fast ease-quiet"
            title="Build a social post from the photos"
          >
            Social Post
          </Link>
          <a
            href={`/report/listing/${listing.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 ml-2 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-ctl border border-hairline-strong bg-white text-ink-600 hover:border-accent-500 hover:text-ink-900 transition-colors duration-fast ease-quiet"
            title="One-page marketing report for the owner"
          >
            Seller Report ↗
          </a>
          {photoState.aiConfigured && (
            <button
              type="button"
              onClick={() => photoActions.labelWithAi(undefined, photos.every((ph) => ph.category && ph.category !== "Other"))}
              disabled={photoActions.labeling}
              className="mt-2 ml-2 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-ctl border border-hairline-strong bg-white text-ink-600 hover:border-accent-500 hover:text-ink-900 transition-colors duration-fast ease-quiet disabled:opacity-50"
              title={photos.some((ph) => !ph.category || ph.category === "Other") ? "Let the model label the photos still marked Other" : "Re-label every photo not set by hand"}
            >
              {photoActions.labeling ? "Labelling…" : photos.some((ph) => !ph.category || ph.category === "Other") ? "Label photos" : "Re-label photos"}
            </button>
          )}
          {photoActions.labelNote && <span className="ml-2 text-xs text-ink-500">{photoActions.labelNote}</span>}
          {/* Straight through to the broker. Reading a listing and wanting the
              person behind it is constant — their other boats, their contact
              details, whether they are subscribed — and the old route was
              Brokers, find them in the list, click. `from=listing` gives their
              page a way back here. */}
          <p className="text-ink-500 text-xs mt-1">
            Broker:{" "}
            <Link
              href={`/admin/brokers/${listing.broker_id}?from=listing&listing=${listing.id}`}
              className="text-ink-700 hover:text-accent-700 underline decoration-hairline-strong underline-offset-2 transition-colors duration-fast ease-quiet"
              title={`Open ${brokerName}’s page`}
            >
              {brokerName}
            </Link>
          </p>
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
            disabled={siteBusy || (optOut && !onSite) || !sitePage}
            title={
              optOut && onSite
                ? "Pocket listing — take it off the website"
                : optOut
                  ? "Pocket listing — it can’t go up"
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
          {/* Pocket listing. The same switch the broker has — anything a broker
              can do from their side, the admin side can do too. The note names
              WHO set it, because switching it off is housekeeping when it was
              ours and an override when it was theirs, and the switch alone
              cannot tell those apart. */}
          <div className="mt-2">
            <button
              onClick={toggleOptOut}
              disabled={optOutBusy}
              title={optOut
                ? "Let this boat appear in Recently Photographed again"
                : "Keep this boat out of Recently Photographed, and off yachtpics.com"}
              className={`inline-flex items-center gap-2 text-xs font-medium pl-1.5 pr-3 py-1.5 rounded-full border transition-colors duration-fast ease-quiet disabled:opacity-50 ${
                optOut
                  ? "border-warn-200 bg-warn-50 text-warn-700"
                  : "border-hairline-strong bg-white text-ink-500 hover:border-warn-200"
              }`}
            >
              <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors duration-fast ease-quiet ${optOut ? "bg-warn-700" : "bg-ink-300"}`}>
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${optOut ? "translate-x-3.5" : "translate-x-0.5"}`} />
              </span>
              {optOut ? "Pocket listing" : "Make it a pocket listing"}
            </button>
            {optOut && (
              <p className="mt-1.5 text-xs text-warn-700">
                {pocketSetBy ? `Set by ${pocketSetBy}.` : "Set from this page."}{" "}
                Kept out of Recently Photographed even when added, and it can&rsquo;t go up on yachtpics.com.
              </p>
            )}
          </div>
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
          <select
            value={notifyTo}
            onChange={(e) => setNotifyTo(e.target.value as "both" | "broker" | "assistant")}
            disabled={notifying}
            title="Who gets the email"
            className="text-sm text-ink-700 bg-white border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
          >
            <option value="both">Broker &amp; assistant</option>
            <option value="broker">Broker only</option>
            <option value="assistant">Assistant only</option>
          </select>
          <button
            onClick={notifyBroker}
            disabled={notifying}
            className="bg-white hover:border-ink-400 hover:text-ink-900 disabled:opacity-50 text-ink-700 text-sm font-medium px-4 py-2 rounded-ctl border border-hairline-strong transition-colors duration-fast ease-quiet"
          >
            {notifying ? "Sending..." : "📧 Send ready email"}
          </button>
          {lastReadySentAt && (
            <span className="text-xs text-ink-400 self-center" title={new Date(lastReadySentAt).toLocaleString()}>
              Last sent {new Date(lastReadySentAt).toLocaleDateString()}
            </span>
          )}
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
        <div
          role={messageKind === "error" ? "alert" : "status"}
          className={`mb-5 px-4 py-3 rounded-ctl text-sm flex items-start justify-between gap-3 ${
            messageKind === "error"
              ? "bg-danger-50 border border-danger-200 text-danger-700"
              : "bg-success-50 border border-success-200 text-success-700"
          }`}
        >
          <span>{message}</span>
          <button
            onClick={() => setMessage("")}
            className={`shrink-0 leading-none text-base font-bold ${
              messageKind === "error" ? "text-danger-600 hover:text-danger-700" : "text-success-600 hover:text-success-700"
            }`}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* Boat shows — the same card brokers see; admins can mark any listing. */}
      <BoatShowCard listingId={listing.id} onMessage={(text, kind) => setMessage(text, kind)} className="mb-6" />

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
      <ListingEngagement listingId={listing.id} thumbs={thumbs} />

      <DownloadLinkManager listingId={listing.id} />

      {/* Photos section */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h2 className="text-h2 text-ink-900">Photos</h2>
            <p className="text-ink-500 text-sm">{photos.length} photo{photos.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <PhotoToolbar
              variant="admin"
              actions={photoActions}
              photoCount={photos.length}
              customCategories={photoState.customCategories}
              downloadBusy={save.saveLocked}
              onDownloadAll={() => save.savePhotos(photos)}
              onDownloadSelected={() => save.savePhotos(photos.filter((p) => photoActions.selectedIds.has(p.id)))}
            />
            {photos.length > 1 && !photoActions.selectMode && (
              <span className="text-xs text-ink-400">Drag photos to set the order buyers see them in.</span>
            )}
            {photos.length > 1 && !photoActions.selectMode && (
              <button
                onClick={photoActions.sortToStandardOrder}
                disabled={photoActions.sorting}
                title="Rewrite the order to the standard walk-through: profiles, exterior, engine room, then the interior"
                className="text-sm font-medium px-3 py-2 rounded-ctl border border-hairline-strong bg-white text-ink-600 hover:border-accent-500 hover:text-ink-900 disabled:opacity-50 transition-colors duration-fast ease-quiet"
              >
                {photoActions.sorting ? "Sorting…" : "Sort to standard order"}
              </button>
            )}
            <button
              onClick={() => photoActions.fileInputRef.current?.click()}
              className="bg-ink-950 hover:bg-ink-800 text-white text-sm font-medium px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
            >
              + Add Photos
            </button>
            <button
              onClick={() => photoActions.anyFileInputRef.current?.click()}
              className="text-sm text-ink-500 hover:text-ink-900 underline underline-offset-2 transition-colors duration-fast"
              title="Pick from your Files app — Downloads, folders or a zip"
            >
              From files / zip
            </button>
          </div>
          <PhotoFileInputs actions={photoActions} />
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

        <DeletePhotosDialogs variant="admin" actions={photoActions} photoCount={photos.length} />

        <UploadProgress variant="admin" actions={photoActions} />
        <UploadFailedNotice variant="admin" actions={photoActions} />

        {photos.length === 0 ? (
          <div
            onClick={() => photoActions.fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); photoActions.handleFiles(e.dataTransfer.files); }}
            className="border-2 border-dashed border-ink-200 rounded-card p-12 text-center cursor-pointer hover:border-accent-500 transition-colors duration-fast ease-quiet"
          >
            <p className="text-ink-400 text-sm">Drag photos here or click to upload</p>
          </div>
        ) : (
          <PhotoGrid
            variant="admin"
            photos={photos}
            thumbs={thumbs}
            selectedIds={photoActions.selectedIds}
            selectMode={photoActions.selectMode}
            heroPhotoId={heroPhotoId}
            customCategories={photoState.customCategories}
            replacing={photoActions.replacing}
            downloadBusy={save.saveLocked}
            onOpen={setLightboxIndex}
            onToggleSelect={photoActions.toggleSelect}
            onSetHero={photoActions.setHero}
            onDownload={(photo) => save.savePhotos([photo])}
            onToggleVisibility={(photo) => photoActions.toggleVisibility(photo.id, photo.is_visible)}
            onUpdateCategory={(photoId, cat) => { photoActions.updateCategory(photoId, cat); }}
            onDelete={(photo) => photoActions.deletePhoto(photo.id, photo.storage_path)}
            onReplace={photoActions.startReplace}
            onDragEnd={photoActions.handleDragEnd}
          />
        )}
      </div>

      {/* Videos section */}
      <div className="mt-6 bg-white border border-hairline rounded-card shadow-elev-1 p-6">
        <div className="flex items-start justify-between flex-wrap gap-4 mb-5">
          <div>
            <h2 className="text-h2 text-ink-900">Listing Videos</h2>
            <p className="text-ink-500 text-sm mt-0.5">Upload MP4 or MOV video for this listing. Videos appear first in the client slideshow, in the order shown here — drag the grip to reorder.</p>
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
          <SortableVideoList items={videos.filter(v => !deletingVideoIds.has(v.id))} onMove={moveVideo}>
            {(video, handle) => (
              <div className="rounded-card overflow-hidden border border-hairline bg-white">
                {video.url && (
                  <video
                    src={video.url}
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full max-h-[420px] bg-black"
                  />
                )}
                <div className="px-4 py-3 bg-ink-50 flex flex-wrap items-center gap-3">
                  {handle}
                  <div className="flex-1 basis-40 min-w-0">
                    <p className="text-sm font-medium text-ink-800 truncate">
                      🎬 {video.filename ?? "video.mp4"}
                      {video.in_slideshow === false && <span className="ml-2 text-[11px] font-semibold text-ink-500 bg-ink-100 border border-hairline-strong rounded-full px-2 py-0.5">Hidden from slideshow</span>}
                    </p>
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
                    onClick={() => toggleVideoSlideshow(video.id, video.in_slideshow !== false)}
                    title={video.in_slideshow !== false ? "Hide this video from the client slideshow" : "Show this video in the client slideshow"}
                    className="text-xs font-medium text-ink-500 hover:text-accent-700 transition-colors shrink-0"
                  >
                    {video.in_slideshow !== false ? "Hide from slideshow" : "Show in slideshow"}
                  </button>
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
            )}
          </SortableVideoList>
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
      {/* Save / share panel — pinned to the bottom of the screen, above the lightbox. */}
      <SavePanel save={save} />

      {/* Lightbox — shared with the broker page (src/components/listing-photos/Lightbox.tsx). */}
      {lightboxIndex !== null && (
        <PhotoLightbox
          variant="admin"
          photos={photos}
          index={lightboxIndex}
          setIndex={setLightboxIndex}
          thumbs={thumbs}
          onSave={(photo) => save.savePhotos([photo])}
          saveLocked={save.saveLocked}
        />
      )}
    </div>
  );
}
