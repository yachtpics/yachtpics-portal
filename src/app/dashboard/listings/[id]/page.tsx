"use client";

import { slideshowPublishUpdate } from "@/lib/slideshowPublish";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { BILLING_PATH, PLAN_GATE_LINE, PLAN_GATE_LINK } from "@/lib/planValue";
import dynamic from "next/dynamic";
import { arrayMove } from "@dnd-kit/sortable";
import { hasAccess, type AccessStatus } from "@/lib/subscriptionAccess";
import ContentRightsModal from "@/components/ContentRightsModal";
import DownloadLicenseModal from "@/components/DownloadLicenseModal";
import ListingSkeleton from "./_components/ListingSkeleton";
import VideoDetailsEditor from "@/components/VideoDetailsEditor";
import { uploadListingVideo } from "@/lib/uploadListingVideo";
import { reelPromoActive } from "@/lib/reelPromo";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import ListingEngagement from "@/components/ListingEngagement";
import ListingReadiness from "@/components/ListingReadiness";
import BoatShowCard from "@/components/BoatShowCard";
import ReelServiceListingCard from "@/components/ReelServiceListingCard";
import SortableVideoList from "@/components/SortableVideoList";
// Photo management (grid, upload, replace, delete, order, categories, cover,
// lightbox, downloads) is shared with the admin listing page.
import {
  BROKER_PHOTO_CAPABILITIES, type PhotoMessage,
  useListingPhotos, usePhotoActions, useSizedDownloads,
  PhotoGrid, PhotoLightbox, PhotoToolbar, DeletePhotosDialogs, DownloadSizeSelect,
  PhotoFileInputs, UploadProgress, UploadFailedNotice, UncategorizedPrompt,
} from "@/components/listing-photos";

// The QR card sits well down the page and only shows once a slideshow is
// published, so its encoder library (qrcode) is loaded on demand rather than
// shipped with the page's first bundle.
const ListingQRCode = dynamic(() => import("@/components/ListingQRCode"), { ssr: false });

export default function BrokerListingPage() {
  const supabase = createClient();
  const params = useParams();
  const id = params.id as string;

  const [listing, setListing] = useState<{ vessel_name: string | null; location: string | null; status: string; slideshow_slug: string | null; slideshow_published: boolean; is_shared: boolean; showcase_opt_out: boolean; year: number | null; length_ft: number | null; make: string | null; asking_price: number | null; vessel_type: string | null; staterooms: number | null; description: string | null; tour_url: string | null } | null>(null);
  const [optOutBusy, setOptOutBusy] = useState(false);
  const [heroFit, setHeroFit] = useState<"fit" | "fill">("fit");
  const [isBrokerageAdmin, setIsBrokerageAdmin] = useState(false);
  const [isShared, setIsShared] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [subStatus, setSubStatus] = useState<string | null>(null);
  const [accessStatus, setAccessStatus] = useState<AccessStatus>("trial_active");
  const [showRightsModal, setShowRightsModal] = useState(false);
  const [rightsAccepted, setRightsAccepted] = useState(false);
  const [showDownloadLicense, setShowDownloadLicense] = useState(false);
  const [downloadLicenseAccepted, setDownloadLicenseAccepted] = useState(false);
  const pendingDownloadRef = useRef<(() => void) | null>(null);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const [slideshowCopied, setSlideshowCopied] = useState(false);
  const [sendError, setSendError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [slideshowWorking, setSlideshowWorking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  // Colour of the banner above. Most messages are confirmations (green);
  // flash(..., "error") shows a failure in red.
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  function flash(text: string, tone: "success" | "error" = "success", ms = 4000) {
    setMessageTone(tone);
    setMessage(text);
    if (ms > 0) setTimeout(() => setMessage((cur) => (cur === text ? "" : cur)), ms);
  }

  // ── Photos — shared with the admin listing page (src/components/listing-photos).
  // Loading, thumbnails, upload, replace, delete, order, categories, cover,
  // show/hide and AI labels live there; this page supplies the broker's
  // capabilities, its banner, and the rights / licence gates.
  const photoState = useListingPhotos({ supabase, listingId: id, caps: BROKER_PHOTO_CAPABILITIES });
  const { photos, setPhotos, thumbs, heroPhotoId, setHeroPhotoId } = photoState;
  const onPhotoMessage = (m: PhotoMessage) => flash(m.text, m.kind, m.ms ?? 4000);
  const photoActions = usePhotoActions({
    supabase,
    listingId: id,
    caps: BROKER_PHOTO_CAPABILITIES,
    state: photoState,
    onMessage: onPhotoMessage,
    // Files go under the signed-in uploader's folder, as they always have here.
    ownerFolder: (userId) => userId,
  });
  const downloads = useSizedDownloads({
    listingId: id,
    vesselName: listing?.vessel_name ?? null,
    onMessage: onPhotoMessage,
    onFinished: photoActions.clearSelection,
  });
  const dragCounter = useRef(0);
  // Deleting media here is permanent — the file leaves storage — so nothing
  // irreversible happens on a single click.
  const [pendingVideoDelete, setPendingVideoDelete] = useState<{ id: string; storagePath: string; name: string } | null>(null);
  const [pendingDocDelete, setPendingDocDelete] = useState<{ id: string; storagePath: string; name: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (typeof window !== "undefined") {
      setRightsAccepted(localStorage.getItem("yp_content_rights_v1") === "accepted");
      setDownloadLicenseAccepted(localStorage.getItem("yp_download_license_v1") === "accepted");
    }
  }, []);


  function requireRights(action: () => void) {
    if (rightsAccepted) { action(); return; }
    pendingActionRef.current = action;
    setShowRightsModal(true);
  }
  function handleRightsAccept() {
    localStorage.setItem("yp_content_rights_v1", "accepted");
    setRightsAccepted(true);
    setShowRightsModal(false);
    pendingActionRef.current?.();
    pendingActionRef.current = null;
  }
  function handleRightsCancel() {
    setShowRightsModal(false);
    pendingActionRef.current = null;
  }

  function requireDownloadLicense(action: () => void) {
    if (downloadLicenseAccepted) { action(); return; }
    pendingDownloadRef.current = action;
    setShowDownloadLicense(true);
  }
  function handleDownloadLicenseAccept() {
    localStorage.setItem("yp_download_license_v1", "accepted");
    setDownloadLicenseAccepted(true);
    setShowDownloadLicense(false);
    pendingDownloadRef.current?.();
    pendingDownloadRef.current = null;
  }
  function handleDownloadLicenseCancel() {
    setShowDownloadLicense(false);
    pendingDownloadRef.current = null;
  }
  const docInputRef = useRef<HTMLInputElement>(null);

  // Sent history + view tracking
  interface ClientSend { id: string; client_email: string; client_name: string | null; sent_at: string; included_slideshow: boolean; document_count: number; message: string | null; open_count: number | null; last_opened_at: string | null; }
  // Sends before this date went out without a tracked link, so their opens can
  // only be inferred from anonymous views. Everything after is exact.
  const TRACKED_SINCE = new Date("2026-09-07T00:00:00Z");
  const [clientSends, setClientSends] = useState<ClientSend[]>([]);
  const [viewTimestamps, setViewTimestamps] = useState<Date[]>([]);

  interface Lead { id: string; name: string | null; email: string | null; phone: string | null; message: string | null; status: string; source: string | null; created_at: string; }
  const [leads, setLeads] = useState<Lead[]>([]);

  async function markLead(leadId: string, status: string) {
    setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, status } : l));
    await supabase.from("listing_leads").update({ status }).eq("id", leadId);
  }

  // Documents
  interface Document { id: string; storage_path: string; filename: string | null; created_at: string; }
  const [documents, setDocuments] = useState<Document[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [videoDeleteError, setVideoDeleteError] = useState<string | null>(null);
  const [videoUploadError, setVideoUploadError] = useState<string | null>(null);
  const [videoOrderError, setVideoOrderError] = useState<string | null>(null);
  // Who owns this listing — video files are stored under their folder rather
  // than the uploader's, so an assistant's uploads stay with the broker's media.
  const [listingBrokerId, setListingBrokerId] = useState<string | null>(null);
  const [deletingDocIds, setDeletingDocIds] = useState<Set<string>>(new Set());
  const [pdfViewer, setPdfViewer] = useState<{ url: string; filename: string | null; storagePath: string } | null>(null);

  // Videos
  interface Video { id: string; storage_path: string; storage_host?: string | null; filename: string | null; created_at: string; url: string | null; in_slideshow: boolean; display_order?: number | null; title?: string | null; description?: string | null; thumbnail_path?: string | null; posterUrl?: string | null; }
  const [videos, setVideos] = useState<Video[]>([]);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState(0);
  const [deletingVideoIds, setDeletingVideoIds] = useState<Set<string>>(new Set());
  const videoInputRef = useRef<HTMLInputElement>(null);

  // Send to client
  const [sendModal, setSendModal] = useState(false);
  const [sendEmail, setSendEmail] = useState("");
  const [sendName, setSendName] = useState("");
  const [sendMessage, setSendMessage] = useState("");
  const [sendSlideshow, setSendSlideshow] = useState(true);
  const [sendDocIds, setSendDocIds] = useState<Set<string>>(new Set());
  const [sendVideoIds, setSendVideoIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);

  // Page-level drag detection — reliable across all child elements
  function handlePageDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current++;
    if (dragCounter.current === 1) setDragOver(true);
  }
  function handlePageDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragOver(false);
  }
  function handlePageDragOver(e: React.DragEvent) {
    e.preventDefault();
  }
  function handlePageDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    if (hasAccess(accessStatus)) requireRights(() => photoActions.handleFiles(e.dataTransfer.files));
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // "?section=slideshow" (the Slideshow ready email's button, carried through
  // the sign-in redirect as part of ?next=) or "#slideshow": once the page
  // has loaded, bring the Client Slideshow section into view. A plain anchor
  // can't do it — the section renders after the data arrives.
  const scrolledToSectionRef = useRef(false);
  useEffect(() => {
    if (loading || scrolledToSectionRef.current) return;
    const wants = new URLSearchParams(window.location.search).get("section") === "slideshow" || window.location.hash === "#slideshow";
    if (!wants) return;
    scrolledToSectionRef.current = true;
    window.setTimeout(() => document.getElementById("slideshow")?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
  }, [loading]);

  /**
   * Everything this page needs, in two waves instead of a queue.
   *
   * This used to be a dozen `await`s stacked end to end — profile, then
   * listing, then subscription, then photos, then sign them, then documents,
   * then videos, then sign those, then sends, then views, then leads — and
   * `setLoading(false)` only fired after the last one. Each is a separate
   * network round trip, so the spinner sat there for the SUM of all of them
   * even though the photos had been ready since round trip four.
   *
   * None of the table reads depend on each other, so they go out together.
   * Only three things genuinely need something first — signing photo urls
   * needs the photo rows, signing video urls needs the video rows, and the
   * subscription lookup needs the listing's broker_id — so those form a
   * second wave that also runs in parallel.
   */
  async function loadData() {
    // getSession() reads the already-stored token locally. getUser() sends it
    // to Supabase's auth server to be re-validated, which measured at ~460ms
    // on a live load — and because it ran first, every query on the page sat
    // waiting behind it. Nothing is loosened by this: row-level security still
    // validates the token on the server for every single query below, so the
    // browser's copy is only being used to know which id to ask about.
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return;

    // Wave 1 — every independent read at once.
    // Row-level security governs access: own boats, boats of brokers you assist
    // or manage, and any listing individually shared into your brokerage.
    const [
      { data: profileData },
      { data: l },
      { data: p },
      { data: docs },
      { data: vids },
      { data: sends },
      { data: viewRows },
      { data: leadRows },
    ] = await Promise.all([
      supabase.from("profiles").select("role, is_brokerage_admin").eq("id", user.id).single(),
      supabase.from("listings")
        .select("vessel_name, location, status, slideshow_slug, slideshow_published, broker_id, is_shared, showcase_opt_out, hero_photo_id, hero_fit, year, length_ft, make, asking_price, vessel_type, staterooms, description, tour_url")
        .eq("id", id)
        .single(),
      supabase.from("photos")
        .select("id, storage_path, filename, category, display_order, is_visible, derivatives_at")
        .eq("listing_id", id)
        .order("display_order"),
      supabase.from("documents")
        .select("id, storage_path, filename, created_at")
        .eq("listing_id", id)
        .order("created_at"),
      supabase.from("videos")
        .select("id, storage_path, storage_host, filename, created_at, in_slideshow, display_order, title, description, thumbnail_path")
        .eq("listing_id", id)
        .order("display_order", { ascending: true, nullsFirst: false })
        .order("created_at"),
      supabase.from("client_sends")
        .select("id, client_email, client_name, sent_at, included_slideshow, document_count, message, open_count, last_opened_at")
        .eq("listing_id", id)
        .order("sent_at", { ascending: false }),
      supabase.from("slideshow_views")
        .select("viewed_at")
        .eq("listing_id", id)
        .order("viewed_at", { ascending: false }),
      supabase.from("listing_leads")
        .select("id, name, email, phone, message, status, source, created_at")
        .eq("listing_id", id)
        .order("created_at", { ascending: false }),
    ]);

    // Not found, removed, or not shared with this person: say so rather than
    // silently bouncing back to the list.
    if (!l) { setLoadFailed(true); setLoading(false); return; }

    setIsBrokerageAdmin(profileData?.is_brokerage_admin === true);
    // Admins (YachtPics) own the photos: never ask them to accept the broker download license.
    if (profileData?.role === "admin") setDownloadLicenseAccepted(true);
    setListing(l);
    setIsShared((l as unknown as { is_shared: boolean }).is_shared === true);
    setHeroPhotoId((l as unknown as { hero_photo_id: string | null }).hero_photo_id ?? null);
    setHeroFit((l as unknown as { hero_fit: string | null }).hero_fit === "fill" ? "fill" : "fit");
    setDocuments(docs ?? []);
    setClientSends(sends ?? []);
    setViewTimestamps((viewRows ?? []).map(r => new Date(r.viewed_at)));
    setLeads((leadRows ?? []) as Lead[]);

    const photos_raw = p ?? [];
    const brokerId = (l as unknown as { broker_id: string }).broker_id;
    setListingBrokerId(brokerId);

    // Wave 2 — the reads that needed a result from wave 1.
    // The subscription lookup goes through the API (service role) so RLS
    // doesn't block assistants from reading the broker's subscription row.
    // Full-size photo originals are NOT signed here any more: the grid uses
    // /api/thumbs, and the lightbox / downloads sign originals on demand.
    const posterPaths = (vids ?? []).map((v) => v.thumbnail_path).filter((p): p is string => !!p);
    const [subData, vidSigned, posterSigned] = await Promise.all([
      fetch(`/api/subscription/status?brokerId=${brokerId}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      // Videos are signed by the server, not here: some now live on the
      // private Cloudflare bucket, whose credentials the browser doesn't have.
      // The API answers from whichever store holds each file.
      vids?.length
        ? fetch("/api/videos/signed-urls", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ listingId: id }),
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => (d?.urls ?? null) as Record<string, string> | null)
            .catch(() => null)
        : Promise.resolve(null),
      // Video still frames (saved at upload) live in the photo bucket.
      posterPaths.length
        ? supabase.storage.from("listing-photos")
            .createSignedUrls(posterPaths, 3600)
            .then((r) => r.data)
        : Promise.resolve(null),
    ]);

    setSubStatus(subData?.status ?? null);
    setAccessStatus((subData?.status as AccessStatus) ?? "no_access");

    setPhotos(photos_raw);

    if (vids?.length) {
      const posterByPath = new Map<string, string>();
      (posterSigned ?? []).forEach((d) => { if (d.path && d.signedUrl && !d.error) posterByPath.set(d.path, d.signedUrl); });
      setVideos(vids.map(v => ({
        ...v,
        url: vidSigned?.[v.id] ?? null,
        posterUrl: v.thumbnail_path ? posterByPath.get(v.thumbnail_path) ?? null : null,
      })));
    } else {
      setVideos([]);
    }

    setLoading(false);
  }

  async function handleDocFiles(files: FileList | null) {
    if (!files) return;
    setDocError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setDocError("Your session has expired. Please refresh the page and sign in again."); return; }
    const selected = Array.from(files);
    const fileArr = selected.filter(f => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (fileArr.length === 0) { setDocError("Only PDF documents are supported."); return; }
    const rejected = selected.length - fileArr.length;
    setUploadingDoc(true);
    let failures = 0;
    for (const file of fileArr) {
      const path = `${user.id}/${id}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("listing-documents").upload(path, file, { upsert: false });
      if (uploadError) { failures++; continue; }
      const { data: newDoc, error: insertError } = await supabase.from("documents").insert({
        listing_id: id,
        storage_path: path,
        filename: file.name,
        uploaded_by: user.id,
      }).select().single();
      if (insertError || !newDoc) {
        // File reached storage but the record was rejected — surface it instead of failing silently.
        console.error("Document record insert failed:", insertError);
        failures++;
      } else {
        setDocuments(prev => [...prev, newDoc as Document]);
      }
    }
    setUploadingDoc(false);
    if (docInputRef.current) docInputRef.current.value = "";
    if (failures > 0) {
      setDocError(`${failures} document${failures > 1 ? "s" : ""} failed to upload. Please try again.`);
    } else if (rejected > 0) {
      setDocError(`${rejected} file${rejected > 1 ? "s were" : " was"} skipped — only PDF documents are supported.`);
    }
  }

  async function deleteDocument(docId: string, storagePath: string) {
    setDeletingDocIds(prev => new Set(Array.from(prev).concat(docId)));
    await fetch("/api/documents/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId: docId, storagePath }),
    });
    setDocuments(prev => prev.filter(d => d.id !== docId));
    setDeletingDocIds(prev => { const next = new Set(prev); next.delete(docId); return next; });
  }

  async function downloadDocument(storagePath: string, filename: string | null) {
    const { data } = await supabase.storage.from("listing-documents").createSignedUrl(storagePath, 60);
    if (!data?.signedUrl) return;
    const a = window.document.createElement("a");
    a.href = data.signedUrl;
    a.download = filename ?? "document.pdf";
    a.click();
  }

  async function openPdfViewer(storagePath: string, filename: string | null) {
    const { data } = await supabase.storage.from("listing-documents").createSignedUrl(storagePath, 3600);
    if (!data?.signedUrl) return;
    setPdfViewer({ url: data.signedUrl, filename, storagePath });
  }

  // How the cover photo sits on the flyer: "fit" shows the whole photo,
  // "fill" crops it to fill the band edge-to-edge.
  async function updateHeroFit(mode: "fit" | "fill") {
    if (mode === heroFit) return;
    const prev = heroFit;
    setHeroFit(mode); // optimistic
    const { error } = await supabase.from("listings").update({ hero_fit: mode }).eq("id", id);
    if (error) { setHeroFit(prev); }
  }

  async function handleVideoFiles(files: FileList | null) {
    if (!files) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUploadingVideo(true);
    setVideoUploadProgress(0);
    setVideoUploadError(null);
    const fileArr = Array.from(files).filter(f =>
      f.type === "video/mp4" || f.type === "video/quicktime" ||
      f.name.toLowerCase().endsWith(".mp4") || f.name.toLowerCase().endsWith(".mov")
    );
    if (fileArr.length === 0) { setUploadingVideo(false); return; }

    // Shared with both create forms (see uploadListingVideo), so a video added
    // here behaves identically to one added when the listing was made — same
    // storage layout, same progress reporting, and it captures a still frame
    // for use as the listing's cover when there are no photos.
    const failures: string[] = [];
    for (let i = 0; i < fileArr.length; i++) {
      const result = await uploadListingVideo({
        supabase,
        file: fileArr[i],
        listingId: id,
        uploadedBy: user.id,
        displayOrder: videos.length + i,
        onProgress: (pct) => {
          const base = (i / fileArr.length) * 100;
          setVideoUploadProgress(Math.round(base + (pct / fileArr.length)));
        },
      });

      if (result.ok) {
        // Playback link comes with the upload ticket — the browser can't sign
        // links for the private Cloudflare bucket itself.
        setVideos(prev => [...prev, { ...result.video, storage_host: "r2", url: result.playbackUrl }]);
      } else {
        // Previously a failed upload still drove the bar to 100% and simply
        // left the video missing, with nothing said.
        failures.push(`${fileArr[i].name} — ${result.error}`);
      }
      setVideoUploadProgress(Math.round(((i + 1) / fileArr.length) * 100));
    }
    setUploadingVideo(false);
    if (failures.length > 0) {
      setVideoUploadError(
        failures.length === 1
          ? `Couldn't upload ${failures[0]}`
          : `${failures.length} videos didn't upload:\n${failures.join("\n")}`
      );
    }
  }

  async function deleteVideo(videoId: string, storagePath: string) {
    setDeletingVideoIds(prev => new Set(Array.from(prev).concat(videoId)));
    setVideoDeleteError(null);
    try {
      const res = await fetch("/api/videos/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, storagePath }),
      });
      // Only drop it from the list once the server confirms — otherwise a
      // refused delete looks like it worked and the video returns on reload.
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? `Delete failed (${res.status})`);
      }
      // The video is gone from the portal either way. This only fires when the
      // published website page couldn't be rewritten — worth saying, because
      // until it is, the page still shows a player for a video that no longer
      // exists.
      if (data.siteWarning) {
        setVideoDeleteError(String(data.siteWarning) + " Re-publish the boat to fix it.");
      }
      setVideos(prev => prev.filter(v => v.id !== videoId));
    } catch (e) {
      setVideoDeleteError(`Couldn't delete that video — ${e instanceof Error ? e.message : "please try again"}.`);
    } finally {
      setDeletingVideoIds(prev => { const next = new Set(prev); next.delete(videoId); return next; });
    }
  }

  async function toggleVideoSlideshow(videoId: string, current: boolean) {
    setVideos(prev => prev.map(v => v.id === videoId ? { ...v, in_slideshow: !current } : v));
    await supabase.from("videos").update({ in_slideshow: !current }).eq("id", videoId);
  }

  // Drag-to-reorder. Writes display_order = position for every video, the
  // same way the photo grid saves its order; every reader sorts on it.
  async function moveVideo(activeId: string, overId: string) {
    const before = videos;
    const oldIndex = before.findIndex(v => v.id === activeId);
    const newIndex = before.findIndex(v => v.id === overId);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(before, oldIndex, newIndex).map((v, idx) => ({ ...v, display_order: idx }));
    setVideos(next);
    setVideoOrderError(null);
    // .select() so an update that RLS silently filters out (no error, zero
    // rows) is caught rather than looking saved.
    const results = await Promise.all(
      next.map((v, idx) => supabase.from("videos").update({ display_order: idx }).eq("id", v.id).select("id"))
    );
    if (results.some(r => r.error || !r.data || r.data.length === 0)) {
      setVideos(before);
      setVideoOrderError("Couldn't save the new video order — please try again.");
    }
  }

  async function downloadVideo(videoId: string, filename: string | null) {
    // Signed by the server so it works wherever the file lives, with the
    // download disposition baked into the link — the a.download attribute is
    // ignored for cross-origin URLs, so the header is what actually makes the
    // browser save rather than play.
    setVideoDeleteError(null);
    const res = await fetch("/api/videos/signed-urls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId, asDownload: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) {
      // Failing silently here left a broker staring at a button that "did
      // nothing" — and guessing at reasons. Name the actual failure.
      setVideoDeleteError(
        `Couldn't start that download — ${data.error ?? `the server answered ${res.status}`}. Downloading your videos is always free; this is a technical problem, not a billing one.`
      );
      return;
    }
    const a = window.document.createElement("a");
    a.href = data.url;
    a.download = filename ?? "video.mp4";
    a.click();
  }

  async function sendToClient() {
    if (!sendEmail) return;
    setSending(true);
    setSendError("");
    try {
      const res = await fetch("/api/email/send-to-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: id,
          clientEmail: sendEmail,
          clientName: sendName,
          message: sendMessage,
          includeSlideshow: sendSlideshow,
          documentIds: Array.from(sendDocIds),
          videoIds: Array.from(sendVideoIds),
        }),
      });
      const data = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) {
        console.error("Send to client failed:", res.status, data.error);
        setSendError(
          res.status === 403 && data.error
            ? data.error // the plan-ended message is written for brokers
            : res.status === 401
              ? "Your session has ended. Please sign in again, then resend."
              : "The email couldn't be sent just now. Check the address and try again."
        );
        setSending(false);
        return;
      }
      setSendSuccess(true);
      setTimeout(() => {
        setSendModal(false);
        setSendSuccess(false);
        setSendEmail("");
        setSendName("");
        setSendMessage("");
        setSendSlideshow(true);
        setSendDocIds(new Set());
        setSendVideoIds(new Set());
      }, 2000);
    } catch (err) {
      console.error("Send to client request failed:", err);
      setSendError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  async function publishSlideshow() {
    setSlideshowWorking(true);
    // Same change as everywhere else Create Slideshow exists (src/lib/slideshowPublish.ts).
    const update = slideshowPublishUpdate(listing?.slideshow_slug);
    const slug = update.slideshow_slug;
    await supabase.from("listings").update(update).eq("id", id);
    setListing((prev) => prev ? { ...prev, slideshow_slug: slug, slideshow_published: true } : prev);
    setSlideshowWorking(false);
  }

  async function unpublishSlideshow() {
    setSlideshowWorking(true);
    await supabase.from("listings").update({ slideshow_published: false }).eq("id", id);
    setListing((prev) => prev ? { ...prev, slideshow_published: false } : prev);
    setSlideshowWorking(false);
  }

  // Broker veto over the Recently Photographed showcase (pocket listings).
  async function toggleShowcaseOptOut() {
    if (!listing || optOutBusy) return;
    const next = !listing.showcase_opt_out;
    setOptOutBusy(true);
    setListing((prev) => prev ? { ...prev, showcase_opt_out: next } : prev); // optimistic
    try {
      const res = await fetch(`/api/listings/${id}/showcase-optout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optOut: next }),
      });
      if (!res.ok) throw new Error();
      setMessage(next
        ? "Marked as a pocket listing — kept out of Recently Photographed."
        : "This boat can now appear in Recently Photographed.");
      setTimeout(() => setMessage(""), 3000);
    } catch {
      setListing((prev) => prev ? { ...prev, showcase_opt_out: !next } : prev); // revert
      setMessage("Couldn't update that. Please try again.");
      setTimeout(() => setMessage(""), 3000);
    } finally {
      setOptOutBusy(false);
    }
  }

  async function toggleShare() {
    if (sharingBusy) return;
    const next = !isShared;
    setSharingBusy(true);
    setIsShared(next); // optimistic
    setListing((prev) => prev ? { ...prev, is_shared: next } : prev);
    try {
      const res = await fetch(`/api/listings/${id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shared: next }),
      });
      if (!res.ok) throw new Error();
      setMessage(next ? "Shared with the brokerage." : "Removed from brokerage sharing.");
      setTimeout(() => setMessage(""), 3000);
    } catch {
      setIsShared(!next); // revert
      setListing((prev) => prev ? { ...prev, is_shared: !next } : prev);
      setMessage("Couldn't update sharing. Please try again.");
      setTimeout(() => setMessage(""), 3000);
    } finally {
      setSharingBusy(false);
    }
  }

  async function copyLink() {
    if (!listing?.slideshow_slug) return;
    const url = `${window.location.origin}/s/${listing.slideshow_slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setSlideshowCopied(true);
      setTimeout(() => setSlideshowCopied(false), 2000);
    } catch {
      setMessage(`Couldn't copy automatically. The link is ${url}`);
      setTimeout(() => setMessage(""), 6000);
    }
  }

  const visiblePhotos = photos.filter(p => p.is_visible);
  const selectedPhotos = photos.filter(p => photoActions.selectedIds.has(p.id));

  // Send to Client is a paid feature and needs something to deliver
  // (a published slideshow, a document, or a video).
  const canSendToClient = !!listing && hasAccess(accessStatus) && (listing.slideshow_published || documents.length > 0 || videos.length > 0);

  // This — not loading.tsx — is what people actually see after clicking a boat.
  // It used to be the word "Loading..." in a small box, which is easy to read as
  // nothing having happened.
  if (loading) return <ListingSkeleton />;
  if (!listing) {
    if (!loadFailed) return null;
    return (
      <div className="px-4 sm:px-6 py-16 max-w-md mx-auto text-center">
        <h1 className="text-h2 text-ink-900">This listing isn&apos;t available</h1>
        <p className="text-sm text-ink-500 mt-2">It may have been removed, or it hasn&apos;t been shared with your account.</p>
        <Link href="/dashboard/listings" className="mt-6 inline-block text-sm font-medium text-accent-700 hover:text-accent-600 transition-colors duration-fast">
          &larr; Back to My Listings
        </Link>
      </div>
    );
  }

  return (
    <div
      className="px-4 sm:px-6 py-8 max-w-6xl mx-auto relative"
      onDragEnter={handlePageDragEnter}
      onDragLeave={handlePageDragLeave}
      onDragOver={handlePageDragOver}
      onDrop={handlePageDrop}
    >
      {/* Lightbox — shared with the admin page (src/components/listing-photos/Lightbox.tsx).
          A print on paper (ink-50); shows the stored 2000px copy, signed on demand. */}
      {lightboxIndex !== null && (
        <PhotoLightbox
          variant="broker"
          photos={photos}
          index={lightboxIndex}
          setIndex={setLightboxIndex}
          displayCopies={photoState.originals}
          signDisplayCopies={photoState.signDisplayCopies}
        />
      )}

      {/* Full-page drop overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-50 bg-ink-950/85 border border-accent-500/60 rounded-card flex items-center justify-center pointer-events-none backdrop-blur-[2px]">
          <p className="text-accent-300 text-lg font-semibold tracking-wide">Drop photos to upload</p>
        </div>
      )}
      {/* Header */}
      <div className="mb-8 pb-6 border-b border-hairline flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href="/dashboard/listings" className="label-caps text-ink-400 hover:text-ink-600 transition-colors duration-fast">← My Listings</Link>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <h1 className="text-display text-ink-900">{listing.vessel_name ?? "Untitled vessel"}</h1>
            <Link href={`/dashboard/listings/${id}/edit`} className="text-xs font-medium text-ink-500 hover:text-ink-900 border border-hairline-strong hover:border-ink-400 px-2.5 py-1 rounded-ctl transition-colors duration-fast">
              Edit
            </Link>
            <a href={`/print/listing/${id}`} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-ink-500 hover:text-ink-900 border border-hairline-strong hover:border-ink-400 px-2.5 py-1 rounded-ctl transition-colors duration-fast">
              Spec Sheet
            </a>
            <Link href={`/dashboard/listings/${id}/social`} className="text-xs font-medium text-ink-500 hover:text-ink-900 border border-hairline-strong hover:border-ink-400 px-2.5 py-1 rounded-ctl transition-colors duration-fast">
              Social Post
            </Link>
            {/* Flagged while the open house runs — a tool nobody knows about
                gets used by nobody, and this is the fortnight it has to land. */}
            <Link
              href={`/dashboard/listings/${id}/reel`}
              className={`text-xs font-medium px-2.5 py-1 rounded-ctl transition-colors duration-fast border ${
                reelPromoActive()
                  ? "text-ink-900 bg-accent-50 border-accent-300 hover:border-accent-500"
                  : "text-ink-500 hover:text-ink-900 border-hairline-strong hover:border-ink-400"
              }`}
            >
              Reel
              {reelPromoActive() && <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-accent-700">Free</span>}
            </Link>
          </div>
          <p className="text-ink-500 text-sm mt-1">{[listing.year, listing.make, listing.vessel_type, listing.length_ft ? `${listing.length_ft}′` : null, listing.location].filter(Boolean).join(" · ")}</p>
          {isBrokerageAdmin && (
            <button
              onClick={toggleShare}
              disabled={sharingBusy}
              title={isShared ? "This boat is visible to every broker in your brokerage" : "Share this boat with every broker in your brokerage"}
              className={`mt-2 inline-flex items-center gap-2 text-xs font-medium pl-1.5 pr-3 py-1.5 rounded-full border transition-colors disabled:opacity-50 ${
                isShared
                  ? "border-accent-500 bg-accent-500/10 text-accent-700"
                  : "border-hairline-strong bg-white text-ink-500 hover:border-accent-500"
              }`}
            >
              <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${isShared ? "bg-accent-500" : "bg-ink-300"}`}>
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${isShared ? "translate-x-3.5" : "translate-x-0.5"}`} />
              </span>
              {isShared ? "Shared with brokerage" : "Share with brokerage"}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {!photoActions.selectMode && (
            <button
              onClick={() => { setSendSlideshow(!!listing.slideshow_published); setSendDocIds(new Set()); setSendVideoIds(new Set()); setSendModal(true); }}
              disabled={!canSendToClient}
              title={canSendToClient ? "Email this listing to a client" : (!hasAccess(accessStatus) ? `Send this listing to a client from the Portal. ${PLAN_GATE_LINE}` : "Publish your slideshow first to send it to a client")}
              className="bg-ink-950 hover:bg-ink-800 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-ink-950 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
            >
              Send to Client
            </button>
          )}
          <PhotoToolbar
            variant="broker"
            actions={photoActions}
            photoCount={photos.length}
            customCategories={photoState.customCategories}
            downloadAllCount={visiblePhotos.length}
            downloadBusy={downloads.downloading}
            busyLabel={downloads.downloadLabel ?? `Downloading... ${downloads.downloadProgress}%`}
            onDownloadAll={() => requireDownloadLicense(() => downloads.downloadPhotos(visiblePhotos))}
            onDownloadSelected={() => requireDownloadLicense(() => downloads.downloadPhotos(selectedPhotos))}
            sizeSelect={<DownloadSizeSelect value={downloads.downloadSize} onChange={downloads.setDownloadSize} disabled={downloads.downloading} />}
          />

          {hasAccess(accessStatus) ? (
            <span className="inline-flex items-center gap-3">
              <button onClick={() => requireRights(() => photoActions.fileInputRef.current?.click())}
                className="bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors">
                + Add Photos
              </button>
              <button onClick={() => requireRights(() => photoActions.anyFileInputRef.current?.click())}
                className="text-sm text-ink-500 hover:text-ink-900 underline underline-offset-2 transition-colors"
                title="Pick from your Files app — Downloads, folders or a zip">
                From files / zip
              </button>
            </span>
          ) : (
            <Link href="/dashboard/billing"
              className="bg-ink-100 text-ink-400 text-sm font-semibold px-4 py-2.5 rounded-lg cursor-not-allowed border border-hairline-strong"
              title={`Upload your own photos for boats we didn't shoot. ${PLAN_GATE_LINE}`}>
              + Add Photos
            </Link>
          )}
        </div>
        <PhotoFileInputs actions={photoActions} />
      </div>

      {/* Readiness — what's done, what would make the listing land better */}
      <ListingReadiness
        listingId={id}
        photoCount={photos.filter((p) => p.is_visible).length}
        uncategorized={photos.filter((p) => p.is_visible && (!p.category || p.category === "Other")).length}
        hasCover={!!heroPhotoId}
        published={!!listing.slideshow_published}
        hasVideo={videos.length > 0}
        hasDocs={documents.length > 0}
        hasTour={!!listing.tour_url}
        specs={{ year: listing.year, length_ft: listing.length_ft, make: listing.make, asking_price: listing.asking_price, vessel_type: listing.vessel_type, location: listing.location, staterooms: listing.staterooms, description: listing.description }}
      />

      {hasAccess(accessStatus) && !listing.slideshow_published && (
        <div className="mb-5 px-4 py-3 rounded-lg text-sm bg-warn-50 border border-warn-200 text-warn-800">
          <span className="font-semibold">Publish your slideshow to send this listing to a client.</span>{" "}
          Scroll to the <span className="font-medium">Client Slideshow</span> section below and click Create Slideshow — then the Send to Client button turns on.
        </div>
      )}

      {message && (
        <div
          role={messageTone === "error" ? "alert" : "status"}
          className={`mb-5 px-4 py-3 rounded-lg text-sm ${
            messageTone === "error"
              ? "bg-danger-50 border border-danger-200 text-danger-700"
              : "bg-success-50 border border-success-200 text-success-700"
          }`}
        >
          {message}
        </div>
      )}

      {/* Boat shows — only while a show is coming up (FLIBS 2026). Mark the boat,
          add her dock / slip, download the dock card. Messages use the banner above. */}
      <BoatShowCard listingId={id} onMessage={(text, kind) => flash(text, kind, kind === "error" ? 8000 : 4000)} />

      {/* Reel Service (Oct 24) — add it for this boat ($179/mo, Stripe), see
          this month's count, cancel, or fix a failed payment. */}
      <ReelServiceListingCard listingId={id} onMessage={(text, kind) => flash(text, kind, kind === "error" ? 8000 : 6000)} />

      {/* Pocket-listing veto — keep this boat out of the Recently Photographed showcase */}
      <label className="mb-5 flex items-start gap-3 px-4 py-3 rounded-lg bg-white border border-hairline cursor-pointer">
        <input
          type="checkbox"
          checked={listing.showcase_opt_out}
          disabled={optOutBusy}
          onChange={toggleShowcaseOptOut}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-hairline-strong text-accent-600 focus:ring-accent-500 disabled:opacity-50"
        />
        <span className="text-sm text-ink-700">
          <span className="font-medium text-ink-900">Keep this a pocket listing</span>
          <span className="block text-xs text-ink-500 mt-0.5">
            Hide this boat from the portal-wide <span className="font-medium">Recently Photographed</span> showcase and keep it off yachtpics.com, even if YachtPics features it. Nothing else about your listing changes.
          </span>
        </span>
      </label>

      <UploadProgress variant="broker" actions={photoActions} />
      <UploadFailedNotice variant="broker" actions={photoActions} />

      {/* Category prompt — shown when photos can't be auto-categorized from filename */}
      <UncategorizedPrompt actions={photoActions} />

      <div id="photos" className="scroll-mt-24" />
      {photos.length === 0 ? (
        <div
          onClick={() => hasAccess(accessStatus) && requireRights(() => photoActions.fileInputRef.current?.click())}
          className={`border-2 border-dashed rounded-xl p-16 text-center transition-colors ${hasAccess(accessStatus) ? "border-hairline-strong cursor-pointer hover:border-accent-500" : "border-hairline cursor-default"}`}
        >
          {hasAccess(accessStatus) ? (
            <>
              <p className="text-ink-400 text-sm">No photos yet — drag here or click to upload</p>
              <p className="text-ink-300 text-xs mt-1">JPG, PNG · Any source — your own or YachtPics delivered</p>
            </>
          ) : (
            <>
              <p className="text-ink-400 text-sm">Upload your own photos for boats we didn&rsquo;t shoot.</p>
              <p className="text-ink-400 text-xs mt-1">{PLAN_GATE_LINE}{" "}<Link href={BILLING_PATH} className="text-accent-700 font-medium hover:underline">{PLAN_GATE_LINK} &#8594;</Link></p>
            </>
          )}
        </div>
      ) : (
        <div>
          {!photoActions.selectMode && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-ink-400 flex-1 min-w-[220px]">
                Tap the <span className="text-accent-700">★</span> on a photo to make it the cover — that&apos;s the image used on the spec sheet and social posts. If none is set, the first photo is used.
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-ink-400">Flyer cover:</span>
                <div className="inline-flex rounded-lg border border-hairline-strong overflow-hidden">
                  {(["fit", "fill"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => updateHeroFit(m)}
                      title={m === "fit" ? "Show the whole photo (no cropping)" : "Fill the space edge-to-edge (may crop)"}
                      className={`text-xs font-medium px-3 py-1.5 transition-colors ${
                        heroFit === m ? "bg-ink-950 text-white" : "bg-white text-ink-500 hover:text-ink-700"
                      }`}
                    >
                      {m === "fit" ? "Fit (show all)" : "Fill (crop)"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {photos.length > 1 && (
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <p className="text-xs text-ink-400">Drag photos to set the order buyers see them in.</p>
              <div className="flex items-center gap-2 flex-wrap">
                {photoActions.labelNote && <span className="text-xs text-ink-500">{photoActions.labelNote}</span>}
                {photoState.aiConfigured && (
                  <button
                    onClick={() => photoActions.labelWithAi(undefined, photos.every((p) => p.category && p.category !== "Other"))}
                    disabled={photoActions.labeling}
                    title={photos.some((p) => !p.category || p.category === "Other") ? "Let the model label the photos still marked Other" : "Re-label every photo you haven't set by hand"}
                    className="text-xs font-medium px-3 py-1.5 rounded-ctl border border-hairline-strong bg-white text-ink-600 hover:border-accent-500 hover:text-ink-900 transition-colors duration-fast ease-quiet disabled:opacity-50"
                  >
                    {photoActions.labeling ? "Labelling…" : photos.some((p) => !p.category || p.category === "Other") ? "Label photos" : "Re-label photos"}
                  </button>
                )}
                <button
                  onClick={photoActions.sortToStandardOrder}
                  disabled={photoActions.sorting}
                  title="Rewrite the order to the standard walk-through: outside, up top, cockpit, engine room, then the interior"
                  className="text-xs font-medium px-3 py-1.5 rounded-ctl border border-hairline-strong bg-white text-ink-600 hover:border-accent-500 hover:text-ink-900 transition-colors duration-fast ease-quiet disabled:opacity-50"
                >
                  {photoActions.sorting ? "Sorting…" : "Sort to standard order"}
                </button>
              </div>
            </div>
          )}
          <PhotoGrid
            variant="broker"
            photos={photos}
            thumbs={thumbs}
            originals={photoState.originals}
            missingIds={photoState.missingIds}
            selectedIds={photoActions.selectedIds}
            selectMode={photoActions.selectMode}
            heroPhotoId={heroPhotoId}
            customCategories={photoState.customCategories}
            deletingIds={photoActions.deletingIds}
            replacing={photoActions.replacing}
            replaceFailed={photoActions.replaceFailed}
            downloadBusy={downloads.downloading}
            downloadTitle={downloads.downloadTitle}
            canReplace={hasAccess(accessStatus)}
            onOpen={setLightboxIndex}
            onToggleSelect={photoActions.toggleSelect}
            onSetHero={photoActions.setHero}
            onDownload={(photo) => requireDownloadLicense(() => downloads.downloadPhotos([photo]))}
            onToggleVisibility={(photo) => photoActions.toggleVisibility(photo.id, photo.is_visible)}
            onUpdateCategory={(photoId, cat) => { photoActions.updateCategory(photoId, cat); }}
            onSaveCategory={photoState.saveCustomCategory}
            onDelete={(photo) => photoActions.deletePhoto(photo.id, photo.storage_path)}
            onReplace={(photoId) => requireRights(() => photoActions.startReplace(photoId))}
            onDragEnd={photoActions.handleDragEnd}
          />

          {/* Drop zone strip */}
          <div
            onClick={() => requireRights(() => photoActions.fileInputRef.current?.click())}
            className="mt-3 border-2 border-dashed border-hairline-strong rounded-xl py-4 text-center cursor-pointer hover:border-accent-500 transition-colors"
          >
            <p className="text-ink-400 text-xs">Drag photos anywhere on this page, or click here to add more</p>
          </div>
        </div>
      )}

      {/* Send to Client modal */}
      {sendModal && mounted && createPortal(
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-hairline shrink-0">
              <div>
                <h2 className="text-base font-bold text-ink-900">Send to Client</h2>
                <p className="text-xs text-ink-400 mt-0.5">{listing.vessel_name ?? "This listing"}</p>
              </div>
              <button onClick={() => { setSendModal(false); setSendError(""); }} className="text-ink-400 hover:text-ink-600 text-xl leading-none transition-colors">✕</button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
              {/* Client name — so opens show up as "Mark opened it", not "someone" */}
              <div>
                <label className="block text-xs font-semibold text-ink-600 mb-1.5">Client Name <span className="text-ink-400 font-normal">(optional)</span></label>
                <input
                  type="text"
                  value={sendName}
                  onChange={(e) => setSendName(e.target.value)}
                  placeholder="Mark Johnson"
                  autoComplete="off"
                  className="w-full bg-white border border-hairline-strong text-ink-900 placeholder-ink-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent-500 transition-colors"
                />
                <p className="text-[11px] text-ink-400 mt-1">You&rsquo;ll be told by name when they open it.</p>
              </div>

              {/* Client email */}
              <div>
                <label className="block text-xs font-semibold text-ink-600 mb-1.5">Client Email <span className="text-danger-500">*</span></label>
                <input
                  type="email"
                  value={sendEmail}
                  onChange={(e) => setSendEmail(e.target.value)}
                  placeholder="client@example.com"
                  className="w-full bg-white border border-hairline-strong text-ink-900 placeholder-ink-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent-500 transition-colors"
                />
              </div>

              {/* Personal message */}
              <div>
                <label className="block text-xs font-semibold text-ink-600 mb-1.5">Personal Message <span className="text-ink-400 font-normal">(optional)</span></label>
                <textarea
                  value={sendMessage}
                  onChange={(e) => setSendMessage(e.target.value)}
                  placeholder="Add a personal note to your client…"
                  rows={3}
                  className="w-full bg-white border border-hairline-strong text-ink-900 placeholder-ink-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent-500 transition-colors resize-none"
                />
              </div>

              {/* What to include */}
              <div>
                <label className="block text-xs font-semibold text-ink-600 mb-2">Include in Email</label>
                <div className="space-y-2">
                  {/* Slideshow */}
                  <label className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                    !listing.slideshow_published ? "opacity-40 cursor-not-allowed" : sendSlideshow ? "border-accent-500 bg-accent-500/5" : "border-hairline-strong hover:border-ink-300"
                  }`}>
                    <input
                      type="checkbox"
                      checked={sendSlideshow}
                      disabled={!listing.slideshow_published}
                      onChange={(e) => setSendSlideshow(e.target.checked)}
                      className="accent-accent-600 w-4 h-4 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink-800">Photo Slideshow</p>
                      <p className="text-xs text-ink-400">{listing.slideshow_published ? "Published · clients can view online" : "Not published yet"}</p>
                    </div>
                  </label>

                  {/* Documents */}
                  {documents.length === 0 ? (
                    <div className="flex items-center gap-3 p-3 rounded-lg border border-hairline-strong opacity-40">
                      <input type="checkbox" disabled className="w-4 h-4 shrink-0" />
                      <p className="text-sm text-ink-500">No documents uploaded yet</p>
                    </div>
                  ) : (
                    documents.map(doc => (
                      <label key={doc.id} className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                        sendDocIds.has(doc.id) ? "border-accent-500 bg-accent-500/5" : "border-hairline-strong hover:border-ink-300"
                      }`}>
                        <input
                          type="checkbox"
                          checked={sendDocIds.has(doc.id)}
                          onChange={(e) => {
                            setSendDocIds(prev => {
                              const next = new Set(Array.from(prev));
                              e.target.checked ? next.add(doc.id) : next.delete(doc.id);
                              return next;
                            });
                          }}
                          className="accent-accent-600 w-4 h-4 shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink-800 truncate">{doc.filename ?? "document.pdf"}</p>
                          <p className="text-xs text-ink-400">PDF document</p>
                        </div>
                      </label>
                    ))
                  )}

                  {/* Videos — sent as their own links, separate from the slideshow */}
                  {videos.map(video => (
                    <label key={video.id} className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                      sendVideoIds.has(video.id) ? "border-accent-500 bg-accent-500/5" : "border-hairline-strong hover:border-ink-300"
                    }`}>
                      <input
                        type="checkbox"
                        checked={sendVideoIds.has(video.id)}
                        onChange={(e) => {
                          setSendVideoIds(prev => {
                            const next = new Set(Array.from(prev));
                            e.target.checked ? next.add(video.id) : next.delete(video.id);
                            return next;
                          });
                        }}
                        className="accent-accent-600 w-4 h-4 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink-800 truncate">{video.filename ?? "video.mp4"}</p>
                        <p className="text-xs text-ink-400">Video · sent as a direct link{!video.in_slideshow ? " · hidden from slideshow" : ""}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-hairline shrink-0">
              {sendSuccess ? (
                <div className="flex items-center justify-center gap-2 py-2.5 text-success-600 font-semibold text-sm">
                  <span>✓</span> Email sent successfully
                </div>
              ) : (
                <button
                  onClick={sendToClient}
                  disabled={sending || !sendEmail || (!sendSlideshow && sendDocIds.size === 0 && sendVideoIds.size === 0)}
                  className="w-full bg-ink-950 hover:bg-ink-800 disabled:opacity-50 text-white text-sm font-semibold py-3 rounded-lg transition-colors"
                >
                  {sending ? "Sending…" : "Send Email"}
                </button>
              )}
              {sendError && !sendSuccess && (
                <p role="alert" className="mt-3 text-sm text-danger-600 bg-danger-50 border border-danger-200 rounded-ctl px-4 py-3">{sendError}</p>
              )}
              {!sendSlideshow && sendDocIds.size === 0 && sendVideoIds.size === 0 && !sendSuccess && (
                <p className="text-xs text-center text-ink-400 mt-2">Select at least one item to include</p>
              )}
            </div>
          </div>
        </div>,
        window.document.body
      )}

      {/* PDF Viewer modal */}
      {pdfViewer && mounted && createPortal(
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col">
          <div className="flex items-center justify-between bg-ink-950 px-4 py-3 shrink-0">
            <p className="text-white text-sm font-medium truncate max-w-xs">{pdfViewer.filename ?? "Document"}</p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => downloadDocument(pdfViewer.storagePath, pdfViewer.filename)}
                className="text-accent-700 hover:text-accent-700 text-sm font-medium transition-colors"
              >
                Download
              </button>
              <button
                onClick={() => setPdfViewer(null)}
                className="text-ink-400 hover:text-white text-sm font-medium transition-colors ml-2"
              >
                ✕ Close
              </button>
            </div>
          </div>
          <iframe
            src={pdfViewer.url}
            className="flex-1 w-full border-0"
            title={pdfViewer.filename ?? "Document"}
          />
        </div>,
        window.document.body
      )}

      {/* Deleting media is permanent — the file leaves storage entirely. Each
          of these names what's going and says so, rather than a bare
          "Are you sure?" that people learn to click straight through. */}
      <ConfirmDeleteDialog
        open={pendingVideoDelete !== null}
        title="Delete this video?"
        body={
          <>
            <span className="font-medium text-ink-700 break-all">{pendingVideoDelete?.name}</span> will be
            permanently removed from this listing. This can&apos;t be undone, and anyone you&apos;ve already
            sent a video link to will no longer be able to download it.
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
        open={pendingDocDelete !== null}
        title="Delete this document?"
        body={
          <>
            <span className="font-medium text-ink-700 break-all">{pendingDocDelete?.name}</span> will be
            permanently removed from this listing. This can&apos;t be undone.
          </>
        }
        confirmLabel="Delete document"
        onCancel={() => setPendingDocDelete(null)}
        onConfirm={() => {
          if (!pendingDocDelete) return;
          const target = pendingDocDelete;
          setPendingDocDelete(null);
          deleteDocument(target.id, target.storagePath);
        }}
      />

      <DeletePhotosDialogs variant="broker" actions={photoActions} photoCount={photos.length} />

      {/* Video section */}
      <div id="videos" className="mt-8 bg-white border border-hairline rounded-card shadow-elev-1 p-6 scroll-mt-24">
        <div className="flex items-start justify-between flex-wrap gap-4 mb-5">
          <div>
            <h2 className="label-caps text-ink-600">Listing Videos</h2>
            <p className="text-ink-500 text-sm mt-0.5">Upload MP4 video for this listing. Videos appear first in the client slideshow, in the order shown here — drag the grip to reorder.</p>
          </div>
          <button
            onClick={() => hasAccess(accessStatus) && requireRights(() => videoInputRef.current?.click())}
            disabled={uploadingVideo || !hasAccess(accessStatus)}
            className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            {uploadingVideo ? `Uploading… ${videoUploadProgress}%` : "Upload MP4"}
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

        {videoDeleteError && (
          <div className="mb-4 bg-danger-50 border border-danger-200 text-danger-700 text-sm px-4 py-3 rounded-ctl flex items-start justify-between gap-3">
            <span>{videoDeleteError}</span>
            <button onClick={() => setVideoDeleteError(null)} className="shrink-0 font-bold text-danger-600 hover:text-danger-700" aria-label="Dismiss">×</button>
          </div>
        )}

        {videoUploadError && (
          <div className="mb-4 bg-danger-50 border border-danger-200 text-danger-700 text-sm px-4 py-3 rounded-ctl flex items-start justify-between gap-3">
            <span className="whitespace-pre-line">{videoUploadError}</span>
            <button onClick={() => setVideoUploadError(null)} className="shrink-0 font-bold text-danger-600 hover:text-danger-700" aria-label="Dismiss">×</button>
          </div>
        )}

        {videoOrderError && (
          <div className="mb-4 bg-danger-50 border border-danger-200 text-danger-700 text-sm px-4 py-3 rounded-ctl flex items-start justify-between gap-3">
            <span>{videoOrderError}</span>
            <button onClick={() => setVideoOrderError(null)} className="shrink-0 font-bold text-danger-600 hover:text-danger-700" aria-label="Dismiss">×</button>
          </div>
        )}

        {videos.length === 0 ? (
          <div
            onClick={() => hasAccess(accessStatus) && requireRights(() => videoInputRef.current?.click())}
            className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${hasAccess(accessStatus) ? "border-hairline-strong cursor-pointer hover:border-accent-500" : "border-hairline cursor-default"}`}
          >
            {!hasAccess(accessStatus)
              ? <p className="text-ink-400 text-sm">
                  No videos on this listing yet. Downloading delivered videos is always free —{" "}
                  <Link href="/dashboard/billing" className="text-accent-700 font-medium hover:underline">subscribing</Link>{" "}
                  is only needed to upload your own.
                </p>
              : <p className="text-ink-400 text-sm">No videos yet — click to upload an MP4</p>
            }
          </div>
        ) : (
          <SortableVideoList items={videos.filter(v => !deletingVideoIds.has(v.id))} onMove={moveVideo}>
            {(video, handle) => (
              <div className="rounded-xl overflow-hidden border border-hairline-strong bg-white">
                {video.url && (
                  <video
                    src={video.url}
                    poster={video.posterUrl ?? undefined}
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full max-h-[420px] bg-black"
                  />
                )}
                <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-ink-50">
                  {handle}
                  <div className="flex-1 basis-40 min-w-0">
                    <p className="text-sm font-medium text-ink-800 truncate">
                      {video.filename ?? "video.mp4"}
                      {!video.in_slideshow && <span className="ml-2 text-[11px] font-semibold text-ink-500 bg-ink-100 border border-hairline-strong rounded-full px-2 py-0.5">Hidden from slideshow</span>}
                    </p>
                    <p className="text-xs text-ink-400 mt-0.5">
                      {new Date(video.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                    {/* What this video IS. Shown as the heading above it on the
                        website — "Aerial Drone Footage" beats a filename. */}
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
                    onClick={() => toggleVideoSlideshow(video.id, video.in_slideshow)}
                    title={video.in_slideshow ? "Hide this video from the client slideshow" : "Show this video in the client slideshow"}
                    className="text-xs font-medium text-ink-500 hover:text-accent-700 transition-colors shrink-0"
                  >
                    {video.in_slideshow ? "Hide from slideshow" : "Show in slideshow"}
                  </button>
                  <button
                    onClick={() => downloadVideo(video.id, video.filename)}
                    className="text-xs font-medium text-ink-400 hover:text-ink-600 transition-colors shrink-0"
                  >
                    Download
                  </button>
                  <button
                    onClick={() => setPendingVideoDelete({
                      id: video.id,
                      storagePath: video.storage_path,
                      name: video.filename ?? "this video",
                    })}
                    className="text-xs font-medium text-danger-500 hover:text-danger-600 transition-colors shrink-0"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </SortableVideoList>
        )}
      </div>

      {/* Slideshow section */}
      <div id="slideshow" className="mt-8 bg-white border border-hairline rounded-card shadow-elev-1 p-6 scroll-mt-24">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h2 className="label-caps text-ink-600">Client Slideshow</h2>
            <p className="text-ink-500 text-sm mt-0.5">
              Share a branded, full-screen photo presentation with your client.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {listing.slideshow_published && listing.slideshow_slug ? (
              <>
                <a
                  href={`/s/${listing.slideshow_slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-accent-700 hover:text-accent-600 font-medium transition-colors"
                >
                  Preview ↗
                </a>
                <button
                  onClick={unpublishSlideshow}
                  disabled={slideshowWorking}
                  className="bg-white border border-hairline-strong hover:border-danger-300 text-ink-500 hover:text-danger-600 text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  Unpublish
                </button>
              </>
            ) : (
              // Publishing + previewing stays open even after the trial — brokers
              // can build and view their slideshow; sharing it is what's gated.
              <button
                onClick={publishSlideshow}
                disabled={slideshowWorking || photos.filter(p => p.is_visible).length === 0}
                className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                {slideshowWorking ? "Creating..." : "Create Slideshow"}
              </button>
            )}
          </div>
        </div>

        {listing.slideshow_published && listing.slideshow_slug && hasAccess(accessStatus) && (
          <>
            {/* Link display */}
            <div className="mt-4 bg-ink-50 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
              <p className="text-sm text-ink-500 truncate">
                {typeof window !== "undefined" ? window.location.origin : ""}/s/{listing.slideshow_slug}
              </p>
              <span className="shrink-0 text-xs font-medium bg-success-50 text-success-700 px-2 py-0.5 rounded-full">
                Live
              </span>
            </div>

            {/* Share buttons */}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => { setSendSlideshow(!!listing.slideshow_published); setSendDocIds(new Set()); setSendVideoIds(new Set()); setSendModal(true); }}
                disabled={!hasAccess(accessStatus)}
                title={hasAccess(accessStatus) ? "Email this listing to a client" : `Send this listing to a client from the Portal. ${PLAN_GATE_LINE}`}
                className="flex items-center gap-2 bg-accent-500 hover:bg-accent-400 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-accent-500 text-ink-950 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Send to Client
              </button>
              {"share" in navigator && (
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/s/${listing.slideshow_slug}`;
                    navigator.share({
                      title: listing.vessel_name ?? "Yacht Listing",
                      text: `Check out this listing: ${listing.vessel_name ?? ""}`,
                      url,
                    }).catch(() => {});
                  }}
                  className="flex items-center gap-2 bg-ink-950 hover:bg-ink-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  Share
                </button>
              )}
              <a
                href={`sms:?body=${encodeURIComponent(`${listing.vessel_name ?? "Yacht listing"} — view photos here: ${typeof window !== "undefined" ? window.location.origin : ""}/s/${listing.slideshow_slug}`)}`}
                className="flex items-center gap-2 bg-white border border-hairline-strong hover:border-accent-500 text-ink-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Text
              </a>
              <a
                href={`mailto:?subject=${encodeURIComponent(`${listing.vessel_name ?? "Yacht"} — Photo Gallery`)}&body=${encodeURIComponent(`Please find the photo gallery for ${listing.vessel_name ?? "this vessel"} at the link below:\n\n${typeof window !== "undefined" ? window.location.origin : ""}/s/${listing.slideshow_slug}`)}`}
                className="flex items-center gap-2 bg-white border border-hairline-strong hover:border-accent-500 text-ink-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Email
              </a>
              <button
                onClick={copyLink}
                className="flex items-center gap-2 bg-white border border-hairline-strong hover:border-accent-500 text-ink-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {slideshowCopied ? "✓ Copied" : "Copy Link"}
              </button>
            </div>
          </>
        )}

        {listing.slideshow_published && !hasAccess(accessStatus) && (
          <div className="mt-4 px-4 py-3 rounded-lg text-sm bg-danger-50 border border-danger-200 text-danger-700">
            <span className="font-semibold">Your plan has ended.</span>{" "}
            You can still <span className="font-medium">Preview</span> your slideshow, but sending, sharing links and the QR code are off, and the link won&rsquo;t open for clients until a plan is back. Buyer slideshows are branded to you, with video, and sent from the Portal. {PLAN_GATE_LINE}{" "}
            <Link href={BILLING_PATH} className="font-semibold underline">{PLAN_GATE_LINK} →</Link>{" "}
            <span className="text-danger-600">Downloading your delivered photos always stays free.</span>
          </div>
        )}
      </div>

      {/* QR code — only when the slideshow is live and the plan is active */}
      {listing.slideshow_published && listing.slideshow_slug && hasAccess(accessStatus) && (
        <div className="mt-8">
          <ListingQRCode url={`https://portal.yachtpics.com/s/${listing.slideshow_slug}?src=qr`} vesselName={listing.vessel_name} />
        </div>
      )}

      {/* Documents section */}
      <div id="documents" className="mt-8 bg-white border border-hairline rounded-card shadow-elev-1 p-6 scroll-mt-24">
        <div className="flex items-start justify-between flex-wrap gap-4 mb-5">
          <div>
            <h2 className="label-caps text-ink-600">Listing Documents</h2>
            <p className="text-ink-500 text-sm mt-0.5">Upload PDF brochures or spec sheets for this listing.</p>
          </div>
          <button
            onClick={() => hasAccess(accessStatus) && requireRights(() => docInputRef.current?.click())}
            disabled={uploadingDoc || !hasAccess(accessStatus)}
            className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            {uploadingDoc ? "Uploading…" : "Upload PDF"}
          </button>
          <input ref={docInputRef} type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => handleDocFiles(e.target.files)} />
        </div>

        {docError && (
          <div className="mb-4 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {docError}
          </div>
        )}

        {documents.length === 0 ? (
          <div
            onClick={() => hasAccess(accessStatus) && requireRights(() => docInputRef.current?.click())}
            className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${hasAccess(accessStatus) ? "border-hairline-strong cursor-pointer hover:border-accent-500" : "border-hairline cursor-default"}`}
          >
            {!hasAccess(accessStatus)
              ? <p className="text-ink-400 text-sm">Add brochures and spec PDFs to the listing. {PLAN_GATE_LINE} <Link href={BILLING_PATH} className="text-accent-700 font-medium hover:underline">{PLAN_GATE_LINK}</Link></p>
              : <p className="text-ink-400 text-sm">No documents yet — click to upload a PDF</p>
            }
          </div>
        ) : (
          <div className="space-y-2">
            {documents.filter(d => !deletingDocIds.has(d.id)).map((doc) => (
              <div key={doc.id} className="flex items-center gap-3 bg-ink-50 rounded-lg px-4 py-3">
                <svg className="w-4 h-4 text-ink-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12H9m6.75 3H9m1.5-9H9M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-800 truncate">{doc.filename ?? "document.pdf"}</p>
                  <p className="text-xs text-ink-400 mt-0.5">
                    {new Date(doc.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </div>
                <button
                  onClick={() => openPdfViewer(doc.storage_path, doc.filename)}
                  className="text-xs font-medium text-accent-700 hover:text-accent-600 transition-colors shrink-0"
                >
                  View
                </button>
                <button
                  onClick={async () => {
                    const { data } = await supabase.storage.from("listing-documents").createSignedUrl(doc.storage_path, 3600);
                    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
                  }}
                  className="text-xs font-medium text-ink-400 hover:text-ink-600 transition-colors shrink-0"
                >
                  Open ↗
                </button>
                <button
                  onClick={() => downloadDocument(doc.storage_path, doc.filename)}
                  className="text-xs font-medium text-ink-400 hover:text-ink-600 transition-colors shrink-0"
                >
                  Download
                </button>
                <button
                  onClick={() => setPendingDocDelete({
                    id: doc.id,
                    storagePath: doc.storage_path,
                    name: doc.filename ?? "this document",
                  })}
                  className="text-xs font-medium text-danger-500 hover:text-danger-600 transition-colors shrink-0"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Inquiries section */}
      <div className="mt-8 bg-white border border-hairline rounded-card shadow-elev-1">
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
          <div>
            <h2 className="label-caps text-ink-600">Inquiries ({leads.length})</h2>
            <p className="text-xs text-ink-400 mt-0.5">Buyers who reached out from this boat&apos;s slideshow.</p>
          </div>
          {leads.some((l) => l.status === "new") && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-warn-50 text-warn-700 border border-warn-200">
              {leads.filter((l) => l.status === "new").length} new
            </span>
          )}
        </div>
        {leads.length === 0 ? (
          <div className="px-6 py-8 text-center text-ink-400 text-sm">No inquiries yet. When a buyer hits &ldquo;Request Info&rdquo; on your slideshow, they&apos;ll appear here.</div>
        ) : (
          <ul className="divide-y divide-hairline">
            {leads.map((l) => (
              <li key={l.id} className="px-6 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900 flex items-center gap-2">
                      {l.name ?? "Buyer"}
                      {l.status === "new" && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-warn-50 text-warn-700 uppercase tracking-wide">New</span>}
                    </p>
                    <div className="text-xs text-ink-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                      {l.email && <a href={`mailto:${l.email}`} className="hover:text-accent-700">{l.email}</a>}
                      {l.phone && <a href={`tel:${l.phone}`} className="hover:text-accent-700">{l.phone}</a>}
                      <span className="text-ink-400">{new Date(l.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                      {l.source && !["slideshow", "link"].includes(l.source) && (
                        <span className="text-accent-700 font-medium uppercase">via {l.source}</span>
                      )}
                    </div>
                    {l.message && <p className="text-sm text-ink-600 mt-1.5 leading-relaxed">{l.message}</p>}
                  </div>
                  <button
                    onClick={() => markLead(l.id, l.status === "new" ? "contacted" : "new")}
                    className={`shrink-0 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${l.status === "new" ? "border-hairline-strong text-ink-600 hover:border-accent-500" : "border-success-200 bg-success-50 text-success-700"}`}
                  >
                    {l.status === "new" ? "Mark contacted" : "✓ Contacted"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Engagement — who's looking, how long, at what */}
      <ListingEngagement listingId={id} thumbs={thumbs} />

      {/* Sent History section */}
      <div className="mt-8 bg-white border border-hairline rounded-card shadow-elev-1">
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
          <div>
            <h2 className="label-caps text-ink-600">Sent History</h2>
            <p className="text-ink-500 text-xs mt-0.5">Tracks emails sent via the &ldquo;Send to Client&rdquo; button above — not the Email link below.</p>
          </div>
          <div className="flex items-center gap-3">
            {viewTimestamps.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-ink-500 bg-ink-50 border border-hairline-strong px-3 py-1.5 rounded-full">
                <svg className="w-3.5 h-3.5 text-accent-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                {viewTimestamps.length} total {viewTimestamps.length === 1 ? "view" : "views"}
              </span>
            )}
          </div>
        </div>
        {clientSends.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-ink-400 text-sm">No emails sent yet.</p>
            <p className="text-ink-300 text-xs mt-1">Use the &ldquo;Send to Client&rdquo; button in the Client Slideshow section to send a tracked email.</p>
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {clientSends.map((send) => {
              const sentAt = new Date(send.sent_at);
              const viewsSince = viewTimestamps.filter(t => t >= sentAt);
              const lastViewed = viewsSince.length > 0 ? viewsSince[0] : null;
              return (
                <li key={send.id} className="px-6 py-4 flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-900 truncate">
                      {send.client_name ? <>{send.client_name} <span className="text-ink-400 font-normal">· {send.client_email}</span></> : send.client_email}
                    </p>
                    {send.message && (
                      <p className="text-xs text-ink-400 mt-0.5 line-clamp-1 italic">&ldquo;{send.message}&rdquo;</p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {send.included_slideshow && (
                        <span className="text-[10px] font-medium bg-accent-500/10 text-accent-700 px-2 py-0.5 rounded-full">Slideshow</span>
                      )}
                      {send.document_count > 0 && (
                        <span className="text-[10px] font-medium bg-ink-100 text-ink-500 px-2 py-0.5 rounded-full">
                          {send.document_count} doc{send.document_count !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    {send.included_slideshow && (
                      <div className="mt-2">
                        {(send.open_count ?? 0) > 0 ? (
                          <span className="flex items-center gap-1.5 text-[11px] text-success-600 font-medium">
                            <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            {send.client_name ? send.client_name.split(" ")[0] : "They"} opened it {send.open_count} {send.open_count === 1 ? "time" : "times"}{send.last_opened_at ? ` · Last ${relativeTime(new Date(send.last_opened_at))}` : ""}
                          </span>
                        ) : sentAt >= TRACKED_SINCE ? (
                          <span className="text-[11px] text-ink-400">Not yet opened</span>
                        ) : lastViewed ? (
                          <span className="flex items-center gap-1.5 text-[11px] text-success-600 font-medium">
                            <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            Gallery viewed {viewsSince.length} {viewsSince.length === 1 ? "time" : "times"} since · Last {relativeTime(lastViewed)}
                          </span>
                        ) : (
                          <span className="text-[11px] text-ink-400">Not yet opened</span>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-ink-400 shrink-0 mt-0.5">
                    {sentAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {showRightsModal && (
        <ContentRightsModal
          onAccept={handleRightsAccept}
          onCancel={handleRightsCancel}
        />
      )}
      {showDownloadLicense && (
        <DownloadLicenseModal
          onAccept={handleDownloadLicenseAccept}
          onCancel={handleDownloadLicenseCancel}
        />
      )}
    </div>
  );
}

// ─── Relative time helper ─────────────────────────────────────────────────────
function relativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
