"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import JSZip from "jszip";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, rectSortingStrategy, arrayMove, useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PHOTO_CATEGORIES } from "@/lib/photoCategories";
import { guessCategory } from "@/lib/guessCategory";
import { hasAccess, type AccessStatus } from "@/lib/subscriptionAccess";
import ContentRightsModal from "@/components/ContentRightsModal";

interface Photo {
  id: string;
  storage_path: string;
  filename: string | null;
  category: string | null;
  display_order: number;
  is_visible: boolean;
  url: string | null;
}

export default function BrokerListingPage() {
  const supabase = createClient();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [listing, setListing] = useState<{ vessel_name: string | null; location: string | null; status: string; slideshow_slug: string | null; slideshow_published: boolean } | null>(null);
  const [subStatus, setSubStatus] = useState<string | null>(null);
  const [accessStatus, setAccessStatus] = useState<AccessStatus>("trial_active");
  const [showRightsModal, setShowRightsModal] = useState(false);
  const [rightsAccepted, setRightsAccepted] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const [slideshowCopied, setSlideshowCopied] = useState(false);
  const [slideshowWorking, setSlideshowWorking] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkCategorizing, setBulkCategorizing] = useState(false);
  // Upload category prompt — shown when files can't be auto-categorized
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [pendingCategory, setPendingCategory] = useState("Other");
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxTouch, setLightboxTouch] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const tapStart = useRef<{x: number; y: number} | null>(null);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (typeof window !== "undefined") {
      setRightsAccepted(localStorage.getItem("yp_content_rights_v1") === "accepted");
    }
  }, []);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const docInputRef = useRef<HTMLInputElement>(null);

  // Sent history + view tracking
  interface ClientSend { id: string; client_email: string; sent_at: string; included_slideshow: boolean; document_count: number; message: string | null; }
  const [clientSends, setClientSends] = useState<ClientSend[]>([]);
  const [viewTimestamps, setViewTimestamps] = useState<Date[]>([]);

  // Documents
  interface Document { id: string; storage_path: string; filename: string | null; created_at: string; }
  const [documents, setDocuments] = useState<Document[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [deletingDocIds, setDeletingDocIds] = useState<Set<string>>(new Set());
  const [pdfViewer, setPdfViewer] = useState<{ url: string; filename: string | null; storagePath: string } | null>(null);

  // Videos
  interface Video { id: string; storage_path: string; filename: string | null; created_at: string; url: string | null; }
  const [videos, setVideos] = useState<Video[]>([]);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState(0);
  const [deletingVideoIds, setDeletingVideoIds] = useState<Set<string>>(new Set());
  const videoInputRef = useRef<HTMLInputElement>(null);

  // Send to client
  const [sendModal, setSendModal] = useState(false);
  const [sendEmail, setSendEmail] = useState("");
  const [sendMessage, setSendMessage] = useState("");
  const [sendSlideshow, setSendSlideshow] = useState(true);
  const [sendDocIds, setSendDocIds] = useState<Set<string>>(new Set());
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
    if (hasAccess(accessStatus)) requireRights(() => handleFiles(e.dataTransfer.files));
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profileData } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    const isAssistant = profileData?.role === "assistant";

    let listingQuery = supabase.from("listings")
      .select("vessel_name, location, status, slideshow_slug, slideshow_published, broker_id")
      .eq("id", id);
    if (!isAssistant) listingQuery = listingQuery.eq("broker_id", user.id);
    const { data: l } = await listingQuery.single();

    if (!l) { router.push("/dashboard/listings"); return; }
    setListing(l);

    const brokerId = (l as unknown as { broker_id: string }).broker_id;
    // Use the API (service role) so RLS doesn't block assistants from reading
    // the broker's subscription row.
    const subRes = await fetch(`/api/subscription/status?brokerId=${brokerId}`);
    const subData = subRes.ok ? await subRes.json() : null;
    setSubStatus(subData?.status ?? null);
    setAccessStatus((subData?.status as AccessStatus) ?? "no_access");

    const { data: p } = await supabase.from("photos")
      .select("id, storage_path, filename, category, display_order, is_visible")
      .eq("listing_id", id)
      .order("display_order");

    const photos_raw = p ?? [];
    // Use index-based signed URL mapping — Supabase preserves order
    const photosWithUrls: (typeof photos_raw[0] & { url: string | null })[] = [];
    if (photos_raw.length > 0) {
      const paths = photos_raw.map(photo => photo.storage_path);
      const { data: signedData } = await supabase.storage.from("listing-photos").createSignedUrls(paths, 3600);
      for (let i = 0; i < photos_raw.length; i++) {
        photosWithUrls.push({ ...photos_raw[i], url: signedData?.[i]?.signedUrl ?? null });
      }
    }
    const withUrls = photosWithUrls;

    setPhotos(withUrls);

    const { data: docs } = await supabase.from("documents")
      .select("id, storage_path, filename, created_at")
      .eq("listing_id", id)
      .order("created_at");
    setDocuments(docs ?? []);

    const { data: vids } = await supabase.from("videos")
      .select("id, storage_path, filename, created_at")
      .eq("listing_id", id)
      .order("created_at");
    if (vids && vids.length > 0) {
      const vidPaths = vids.map(v => v.storage_path);
      const { data: vidSigned } = await supabase.storage.from("listing-videos").createSignedUrls(vidPaths, 3600);
      const vidUrlMap = new Map((vidSigned ?? []).map(d => [d.path, d.signedUrl]));
      setVideos(vids.map(v => ({ ...v, url: vidUrlMap.get(v.storage_path) ?? null })));
    } else {
      setVideos([]);
    }

    const { data: sends } = await supabase.from("client_sends")
      .select("id, client_email, sent_at, included_slideshow, document_count, message")
      .eq("listing_id", id)
      .order("sent_at", { ascending: false });
    setClientSends(sends ?? []);

    const { data: viewRows } = await supabase.from("slideshow_views")
      .select("viewed_at")
      .eq("listing_id", id)
      .order("viewed_at", { ascending: false });
    setViewTimestamps((viewRows ?? []).map(r => new Date(r.viewed_at)));

    setLoading(false);
  }

  async function handleDocFiles(files: FileList | null) {
    if (!files) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUploadingDoc(true);
    const fileArr = Array.from(files).filter(f => f.type === "application/pdf");
    for (const file of fileArr) {
      const path = `${user.id}/${id}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("listing-documents").upload(path, file, { upsert: false });
      if (!error) {
        const { data: newDoc } = await supabase.from("documents").insert({
          listing_id: id,
          storage_path: path,
          filename: file.name,
          uploaded_by: user.id,
        }).select().single();
        if (newDoc) setDocuments(prev => [...prev, newDoc as Document]);
      }
    }
    setUploadingDoc(false);
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

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    const fileArr = Array.from(files);

    // If any files can't be auto-categorized, prompt before uploading
    const uncategorized = fileArr.filter((f) => guessCategory(f.name) === "Other");
    if (uncategorized.length > 0) {
      setPendingFiles(fileArr);
      setPendingCategory("Other");
      return;
    }

    await doUpload(fileArr, null);
  }

  async function doUpload(fileArr: File[], overrideCategory: string | null) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setUploading(true);
    setUploadProgress(0);
    setPendingFiles(null);

    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i];
      const ext = file.name.split(".").pop();
      const path = `${user.id}/${id}/${Date.now()}-${i}.${ext}`;

      const { error } = await supabase.storage.from("listing-photos").upload(path, file, { upsert: false });

      if (!error) {
        const category = overrideCategory && guessCategory(file.name) === "Other"
          ? overrideCategory
          : guessCategory(file.name);

        const { data: newPhoto } = await supabase.from("photos").insert({
          listing_id: id,
          storage_path: path,
          filename: file.name,
          category,
          display_order: photos.length + i,
          is_visible: true,
          uploaded_by: user.id,
        }).select().single();

        if (newPhoto) {
          const { data: signed } = await supabase.storage.from("listing-photos").createSignedUrl(path, 3600);
          setPhotos((prev) => [...prev, { ...newPhoto, url: signed?.signedUrl ?? null } as Photo]);
        }
      }
      setUploadProgress(Math.round(((i + 1) / fileArr.length) * 100));
    }

    setUploading(false);
    setMessage(`${fileArr.length} photo${fileArr.length !== 1 ? "s" : ""} uploaded.`);
    setTimeout(() => setMessage(""), 3000);
  }


  function toggleSelect(photoId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(photoId) ? next.delete(photoId) : next.add(photoId);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(photos.filter(p => p.is_visible).map(p => p.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setSelectMode(false);
    setBulkCategory("");
  }

  async function applyBulkCategory() {
    if (!bulkCategory || selectedIds.size === 0) return;
    setBulkCategorizing(true);
    const ids = Array.from(selectedIds);
    await Promise.all(ids.map((photoId) => updateCategory(photoId, bulkCategory)));
    setBulkCategorizing(false);
    setBulkCategory("");
    clearSelection();
  }

  async function deletePhoto(photoId: string, storagePath: string) {
    setDeletingIds((prev) => new Set(Array.from(prev).concat(photoId)));
    const res = await fetch("/api/photos/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoId, storagePath }),
    });
    if (res.ok) {
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(photoId); return next; });
    } else {
      const data = await res.json().catch(() => ({}));
      setMessage("Delete failed: " + (data.error ?? res.statusText));
      setTimeout(() => setMessage(""), 4000);
    }
    setDeletingIds((prev) => { const next = new Set(prev); next.delete(photoId); return next; });
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    const toDelete = photos.filter((p) => selectedIds.has(p.id));
    await Promise.all(
      toDelete.map((p) =>
        fetch("/api/photos/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photoId: p.id, storagePath: p.storage_path }),
        })
      )
    );
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
    await supabase.from("photos").delete().eq("listing_id", id);
    setPhotos([]);
    setSelectedIds(new Set());
    setSelectMode(false);
    setDeleting(false);
    setMessage("All photos deleted.");
    setTimeout(() => setMessage(""), 3000);
  }

  async function downloadPhotos(targets: Photo[]) {
    if (targets.length === 0) return;
    setDownloading(true);
    setDownloadProgress(0);

    const folderName = listing?.vessel_name ?? "photos";

    // Single photo — direct download, no ZIP needed
    if (targets.length === 1 && targets[0].url) {
      const response = await fetch(targets[0].url);
      const blob = await response.blob();
      const ext = targets[0].filename?.split(".").pop() ?? "jpg";
      const filename = `${targets[0].category ?? "photo"}.${ext}`;
      triggerDownload(blob, filename);
      setDownloading(false);
      setDownloadProgress(0);
      clearSelection();
      return;
    }

    // Multiple photos — ZIP
    const zip = new JSZip();
    for (let i = 0; i < targets.length; i++) {
      const photo = targets[i];
      if (!photo.url) continue;
      try {
        const response = await fetch(photo.url);
        const blob = await response.blob();
        const ext = photo.filename?.split(".").pop() ?? "jpg";
        const filename = `${String(i + 1).padStart(2, "0")}-${photo.category ?? "photo"}.${ext}`;
        zip.file(filename, blob);
      } catch { /* skip */ }
      setDownloadProgress(Math.round(((i + 1) / targets.length) * 100));
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const zipName = `${folderName}-photos.zip`;

    if ("showSaveFilePicker" in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: zipName,
          types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(zipBlob);
        await writable.close();
        setDownloading(false);
        setDownloadProgress(0);
        clearSelection();
        return;
      } catch { /* cancelled — fall through */ }
    }

    triggerDownload(zipBlob, zipName);
    setDownloading(false);
    setDownloadProgress(0);
    clearSelection();
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function toggleVisibility(photoId: string, current: boolean) {
    await supabase.from("photos").update({ is_visible: !current }).eq("id", photoId);
    setPhotos((prev) => prev.map((p) => p.id === photoId ? { ...p, is_visible: !current } : p));
  }

  async function updateCategory(photoId: string, category: string) {
    await supabase.from("photos").update({ category }).eq("id", photoId);
    setPhotos((prev) => prev.map((p) => p.id === photoId ? { ...p, category } : p));
  }

  async function handleVideoFiles(files: FileList | null) {
    if (!files) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUploadingVideo(true);
    setVideoUploadProgress(0);
    const fileArr = Array.from(files).filter(f => f.type === "video/mp4" || f.name.endsWith(".mp4"));
    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i];
      const path = `${user.id}/${id}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("listing-videos").upload(path, file, { upsert: false });
      if (!error) {
        const { data: newVideo } = await supabase.from("videos").insert({
          listing_id: id,
          storage_path: path,
          filename: file.name,
          uploaded_by: user.id,
          display_order: videos.length + i,
        }).select().single();
        if (newVideo) {
          const { data: signed } = await supabase.storage.from("listing-videos").createSignedUrl(path, 3600);
          setVideos(prev => [...prev, { ...newVideo, url: signed?.signedUrl ?? null }]);
        }
      }
      setVideoUploadProgress(Math.round(((i + 1) / fileArr.length) * 100));
    }
    setUploadingVideo(false);
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

  async function downloadVideo(storagePath: string, filename: string | null) {
    const { data } = await supabase.storage.from("listing-videos").createSignedUrl(storagePath, 60);
    if (!data?.signedUrl) return;
    const a = window.document.createElement("a");
    a.href = data.signedUrl;
    a.download = filename ?? "video.mp4";
    a.click();
  }

  async function sendToClient() {
    if (!sendEmail) return;
    setSending(true);
    try {
      const res = await fetch("/api/email/send-to-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: id,
          clientEmail: sendEmail,
          message: sendMessage,
          includeSlideshow: sendSlideshow,
          documentIds: Array.from(sendDocIds),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`Failed to send: ${data.error ?? res.statusText}`);
        setSending(false);
        return;
      }
      setSendSuccess(true);
      setTimeout(() => {
        setSendModal(false);
        setSendSuccess(false);
        setSendEmail("");
        setSendMessage("");
        setSendSlideshow(true);
        setSendDocIds(new Set());
      }, 2000);
    } catch (err) {
      alert(`Error: ${String(err)}`);
    } finally {
      setSending(false);
    }
  }

  async function publishSlideshow() {
    setSlideshowWorking(true);
    const slug = listing?.slideshow_slug ?? Math.random().toString(36).substring(2, 10);
    await supabase.from("listings").update({ slideshow_slug: slug, slideshow_published: true }).eq("id", id);
    setListing((prev) => prev ? { ...prev, slideshow_slug: slug, slideshow_published: true } : prev);
    setSlideshowWorking(false);
  }

  async function unpublishSlideshow() {
    setSlideshowWorking(true);
    await supabase.from("listings").update({ slideshow_published: false }).eq("id", id);
    setListing((prev) => prev ? { ...prev, slideshow_published: false } : prev);
    setSlideshowWorking(false);
  }

  function copyLink() {
    if (!listing?.slideshow_slug) return;
    const url = `${window.location.origin}/s/${listing.slideshow_slug}`;
    navigator.clipboard.writeText(url);
    setSlideshowCopied(true);
    setTimeout(() => setSlideshowCopied(false), 2000);
  }

  const visiblePhotos = photos.filter(p => p.is_visible);
  const selectedPhotos = photos.filter(p => selectedIds.has(p.id));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = photos.findIndex(p => p.id === active.id);
    const newIndex = photos.findIndex(p => p.id === over.id);
    const newPhotos = arrayMove(photos, oldIndex, newIndex);
    setPhotos(newPhotos);
    await Promise.all(
      newPhotos.map((photo, idx) =>
        supabase.from("photos").update({ display_order: idx }).eq("id", photo.id)
      )
    );
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading...</div>;
  if (!listing) return null;

  return (
    <div
      className="px-6 py-8 max-w-5xl mx-auto relative"
      onDragEnter={handlePageDragEnter}
      onDragLeave={handlePageDragLeave}
      onDragOver={handlePageDragOver}
      onDrop={handlePageDrop}
    >
      {/* Lightbox — portal to document.body, all layout via inline styles to avoid Tailwind purging */}
      {mounted && lightboxIndex !== null && createPortal(
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.97)", display: "flex", flexDirection: "column" }}
          onTouchStart={(e) => setLightboxTouch(e.touches[0].clientX)}
          onTouchEnd={(e) => {
            if (lightboxTouch === null) return;
            const diff = lightboxTouch - e.changedTouches[0].clientX;
            if (Math.abs(diff) > 50) {
              if (diff > 0) setLightboxIndex(i => i !== null ? Math.min(photos.length - 1, i + 1) : null);
              else setLightboxIndex(i => i !== null ? Math.max(0, i - 1) : null);
            }
            setLightboxTouch(null);
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", flexShrink: 0 }}>
            <span style={{ color: "#9ca3af", fontSize: 14 }}>
              {photos[lightboxIndex]?.category ? `${photos[lightboxIndex].category} · ` : ""}{lightboxIndex + 1} / {photos.length}
            </span>
            <button
              onClick={() => setLightboxIndex(null)}
              style={{ color: "#9ca3af", fontSize: 28, lineHeight: 1, width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer" }}
            >
              ×
            </button>
          </div>

          {/* Photo area — fills remaining height */}
          <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", padding: "0 48px" }}>
            {photos[lightboxIndex]?.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photos[lightboxIndex].url!}
                alt={photos[lightboxIndex].filename ?? ""}
                style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain", display: "block" }}
              />
            )}
            {lightboxIndex > 0 && (
              <button onClick={() => setLightboxIndex(i => i !== null ? i - 1 : null)}
                style={{ position: "absolute", left: 8, background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: 40, height: 40, color: "#fff", fontSize: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                ‹
              </button>
            )}
            {lightboxIndex < photos.length - 1 && (
              <button onClick={() => setLightboxIndex(i => i !== null ? i + 1 : null)}
                style={{ position: "absolute", right: 8, background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: 40, height: 40, color: "#fff", fontSize: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                ›
              </button>
            )}
          </div>

          {/* Thumbnail strip */}
          <div style={{ display: "flex", gap: 8, padding: "12px 16px", overflowX: "auto", flexShrink: 0 }}>
            {photos.map((p, i) => (
              <button key={p.id} onClick={() => setLightboxIndex(i)}
                style={{ flexShrink: 0, borderRadius: 4, overflow: "hidden", border: "none", cursor: "pointer", opacity: i === lightboxIndex ? 1 : 0.4, outline: i === lightboxIndex ? "2px solid #d4a843" : "none" }}>
                {p.url && <img src={p.url} alt="" style={{ width: 56, height: 36, objectFit: "cover", display: "block" }} />}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}

      {/* Full-page drop overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-50 bg-amber-50/90 border-2 border-dashed border-[#d4a843] rounded-xl flex items-center justify-center pointer-events-none">
          <p className="text-[#c49a35] text-lg font-semibold">Drop photos to upload</p>
        </div>
      )}
      {/* Header */}
      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href="/dashboard/listings" className="text-gray-400 hover:text-gray-600 text-sm transition-colors">← My Listings</Link>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl font-bold text-gray-900">{listing.vessel_name ?? "Untitled vessel"}</h1>
            <Link href={`/dashboard/listings/${id}/edit`} className="text-xs text-gray-400 hover:text-[#c49a35] border border-gray-200 hover:border-[#d4a843] px-2.5 py-1 rounded-md transition-colors">
              Edit
            </Link>
          </div>
          <p className="text-gray-500 text-sm mt-0.5">{listing.location ?? ""}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {!selectMode && (
            <button
              onClick={() => { setSendSlideshow(!!listing.slideshow_published); setSendDocIds(new Set()); setSendModal(true); }}
              className="bg-[#050b14] hover:bg-[#0a1628] text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
            >
              ✉ Send to Client
            </button>
          )}
          {photos.length > 0 && !selectMode && (
            <>
              <button
                onClick={() => { setSelectMode(true); }}
                className="bg-white border border-gray-200 hover:border-[#d4a843] text-gray-700 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
              >
                Select
              </button>
              <button
                onClick={() => downloadPhotos(visiblePhotos)}
                disabled={downloading}
                className="bg-white border border-gray-200 hover:border-[#d4a843] text-gray-700 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {downloading ? `Zipping... ${downloadProgress}%` : `⬇ Download All (${visiblePhotos.length})`}
              </button>
              <button
                onClick={() => setConfirmDeleteAll(true)}
                className="bg-white border border-gray-200 hover:border-red-300 text-red-500 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
              >
                Delete All
              </button>
            </>
          )}

          {selectMode && (
            <>
              <button onClick={selectAll} className="text-sm text-[#c49a35] hover:text-[#b08c2a] font-medium transition-colors px-2">
                Select all
              </button>
              <button onClick={clearSelection} className="text-sm text-gray-400 hover:text-gray-600 transition-colors px-2">
                Cancel
              </button>
              {selectedIds.size > 0 && (
                <>
                  {/* Bulk category assign */}
                  <div className="flex items-center gap-2">
                    <select
                      value={bulkCategory}
                      onChange={(e) => setBulkCategory(e.target.value)}
                      className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#d4a843] bg-white"
                    >
                      <option value="">Assign category…</option>
                      {PHOTO_CATEGORIES.filter(c => c !== "Other").map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                      <option value="Other">Other</option>
                    </select>
                    {bulkCategory && (
                      <button
                        onClick={applyBulkCategory}
                        disabled={bulkCategorizing}
                        className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-3 py-2 rounded-lg transition-colors whitespace-nowrap"
                      >
                        {bulkCategorizing ? "Applying…" : `Apply to ${selectedIds.size}`}
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => downloadPhotos(selectedPhotos)}
                    disabled={downloading}
                    className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
                  >
                    {downloading ? `Zipping... ${downloadProgress}%` : `⬇ Download ${selectedIds.size}`}
                  </button>
                  <button
                    onClick={deleteSelected}
                    disabled={deleting}
                    className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
                  >
                    {deleting ? "Deleting..." : `🗑 Delete ${selectedIds.size}`}
                  </button>
                </>
              )}
            </>
          )}

          {hasAccess(accessStatus) ? (
            <button onClick={() => requireRights(() => fileInputRef.current?.click())}
              className="bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors">
              + Add Photos
            </button>
          ) : (
            <Link href="/dashboard/billing"
              className="bg-gray-100 text-gray-400 text-sm font-semibold px-4 py-2.5 rounded-lg cursor-not-allowed border border-gray-200"
              title="Subscribe to upload photos">
              + Add Photos
            </Link>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      </div>

      {message && (
        <div className="mb-5 px-4 py-3 rounded-lg text-sm bg-green-50 border border-green-200 text-green-700">{message}</div>
      )}

      {uploading && (
        <div className="mb-5">
          <div className="flex justify-between text-xs text-gray-500 mb-1"><span>Uploading...</span><span>{uploadProgress}%</span></div>
          <div className="bg-gray-100 rounded-full h-2">
            <div className="bg-[#d4a843] h-2 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
          </div>
        </div>
      )}

      {/* Category prompt — shown when photos can't be auto-categorized from filename */}
      {pendingFiles && (
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
          <p className="text-sm font-semibold text-amber-800 mb-1">
            {pendingFiles.filter(f => guessCategory(f.name) === "Other").length} of {pendingFiles.length} photo{pendingFiles.length !== 1 ? "s" : ""} couldn&apos;t be auto-categorized
          </p>
          <p className="text-xs text-amber-700 mb-3">
            Pick a category to apply to those photos, or skip and assign them manually after uploading.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={pendingCategory}
              onChange={(e) => setPendingCategory(e.target.value)}
              className="text-sm border border-amber-200 bg-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#d4a843]"
            >
              {PHOTO_CATEGORIES.filter(c => c !== "Other").map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
              <option value="Other">Other (assign later)</option>
            </select>
            <button
              onClick={() => doUpload(pendingFiles, pendingCategory === "Other" ? null : pendingCategory)}
              className="bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              Upload {pendingFiles.length} photo{pendingFiles.length !== 1 ? "s" : ""}
            </button>
            <button
              onClick={() => setPendingFiles(null)}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {photos.length === 0 ? (
        <div
          onClick={() => hasAccess(accessStatus) && requireRights(() => fileInputRef.current?.click())}
          className={`border-2 border-dashed rounded-xl p-16 text-center transition-colors ${hasAccess(accessStatus) ? "border-gray-200 cursor-pointer hover:border-[#d4a843]" : "border-gray-100 cursor-default"}`}
        >
          {hasAccess(accessStatus) ? (
            <>
              <p className="text-gray-400 text-sm">No photos yet — drag here or click to upload</p>
              <p className="text-gray-300 text-xs mt-1">YachtPics professional photos will also appear here after your shoot</p>
            </>
          ) : (
            <>
              <p className="text-gray-400 text-sm">Your trial has ended</p>
              <Link href="/dashboard/billing" className="text-[#d4a843] text-xs font-medium hover:underline mt-1 inline-block">Subscribe to upload photos &#8594;</Link>
            </>
          )}
        </div>
      ) : (
        <div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={photos.map(p => p.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {photos.filter(p => !deletingIds.has(p.id)).map((photo) => {
            const isSelected = selectedIds.has(photo.id);
            return (
              <SortablePhotoCard
                key={photo.id}
                photo={photo}
                index={photos.indexOf(photo)}
                isSelected={isSelected}
                selectMode={selectMode}
                downloading={downloading}
                tapStart={tapStart}
                onTap={() => selectMode ? toggleSelect(photo.id) : setLightboxIndex(photos.indexOf(photo))}
                onDownload={() => downloadPhotos([photo])}
                onToggleVisibility={() => toggleVisibility(photo.id, photo.is_visible)}
                onUpdateCategory={(cat) => updateCategory(photo.id, cat)}
                onDelete={() => deletePhoto(photo.id, photo.storage_path)}
              />
            );
          })}
          </div>
          </SortableContext>
          </DndContext>

          {/* Drop zone strip */}
          <div
            onClick={() => requireRights(() => fileInputRef.current?.click())}
            className="mt-3 border-2 border-dashed border-gray-200 rounded-xl py-4 text-center cursor-pointer hover:border-[#d4a843] transition-colors"
          >
            <p className="text-gray-400 text-xs">Drag photos anywhere on this page, or click here to add more</p>
          </div>
        </div>
      )}

      {/* Send to Client modal */}
      {sendModal && mounted && createPortal(
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 shrink-0">
              <div>
                <h2 className="text-base font-bold text-gray-900">Send to Client</h2>
                <p className="text-xs text-gray-400 mt-0.5">{listing.vessel_name ?? "This listing"}</p>
              </div>
              <button onClick={() => setSendModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none transition-colors">✕</button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
              {/* Client email */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Client Email <span className="text-red-400">*</span></label>
                <input
                  type="email"
                  value={sendEmail}
                  onChange={(e) => setSendEmail(e.target.value)}
                  placeholder="client@example.com"
                  className="w-full bg-white border border-gray-200 text-gray-900 placeholder-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4a843] transition-colors"
                />
              </div>

              {/* Personal message */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Personal Message <span className="text-gray-400 font-normal">(optional)</span></label>
                <textarea
                  value={sendMessage}
                  onChange={(e) => setSendMessage(e.target.value)}
                  placeholder="Add a personal note to your client…"
                  rows={3}
                  className="w-full bg-white border border-gray-200 text-gray-900 placeholder-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#d4a843] transition-colors resize-none"
                />
              </div>

              {/* What to include */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">Include in Email</label>
                <div className="space-y-2">
                  {/* Slideshow */}
                  <label className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                    !listing.slideshow_published ? "opacity-40 cursor-not-allowed" : sendSlideshow ? "border-[#d4a843] bg-[#d4a843]/5" : "border-gray-200 hover:border-gray-300"
                  }`}>
                    <input
                      type="checkbox"
                      checked={sendSlideshow}
                      disabled={!listing.slideshow_published}
                      onChange={(e) => setSendSlideshow(e.target.checked)}
                      className="accent-[#d4a843] w-4 h-4 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800">Photo Slideshow</p>
                      <p className="text-xs text-gray-400">{listing.slideshow_published ? "Published · clients can view online" : "Not published yet"}</p>
                    </div>
                  </label>

                  {/* Documents */}
                  {documents.length === 0 ? (
                    <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 opacity-40">
                      <input type="checkbox" disabled className="w-4 h-4 shrink-0" />
                      <p className="text-sm text-gray-500">No documents uploaded yet</p>
                    </div>
                  ) : (
                    documents.map(doc => (
                      <label key={doc.id} className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                        sendDocIds.has(doc.id) ? "border-[#d4a843] bg-[#d4a843]/5" : "border-gray-200 hover:border-gray-300"
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
                          className="accent-[#d4a843] w-4 h-4 shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">📄 {doc.filename ?? "document.pdf"}</p>
                          <p className="text-xs text-gray-400">PDF document</p>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 shrink-0">
              {sendSuccess ? (
                <div className="flex items-center justify-center gap-2 py-2.5 text-green-600 font-semibold text-sm">
                  <span>✓</span> Email sent successfully
                </div>
              ) : (
                <button
                  onClick={sendToClient}
                  disabled={sending || !sendEmail || (!sendSlideshow && sendDocIds.size === 0)}
                  className="w-full bg-[#050b14] hover:bg-[#0a1628] disabled:opacity-50 text-white text-sm font-semibold py-3 rounded-lg transition-colors"
                >
                  {sending ? "Sending…" : "Send Email"}
                </button>
              )}
              {!sendSlideshow && sendDocIds.size === 0 && !sendSuccess && (
                <p className="text-xs text-center text-gray-400 mt-2">Select at least one item to include</p>
              )}
            </div>
          </div>
        </div>,
        window.document.body
      )}

      {/* PDF Viewer modal */}
      {pdfViewer && mounted && createPortal(
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col">
          <div className="flex items-center justify-between bg-[#050b14] px-4 py-3 shrink-0">
            <p className="text-white text-sm font-medium truncate max-w-xs">{pdfViewer.filename ?? "Document"}</p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => downloadDocument(pdfViewer.storagePath, pdfViewer.filename)}
                className="text-[#d4a843] hover:text-[#c49a35] text-sm font-medium transition-colors"
              >
                Download
              </button>
              <button
                onClick={() => setPdfViewer(null)}
                className="text-gray-400 hover:text-white text-sm font-medium transition-colors ml-2"
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

      {/* Delete All confirmation dialog */}
      {confirmDeleteAll && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Delete all photos?</h3>
            <p className="text-gray-500 text-sm mb-6">
              This will permanently delete all {photos.length} photo{photos.length !== 1 ? "s" : ""}. This can&apos;t be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDeleteAll(false)}
                className="flex-1 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={deleteAll}
                disabled={deleting}
                className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
              >
                {deleting ? "Deleting..." : "Delete All"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Video section */}
      <div className="mt-8 bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-start justify-between flex-wrap gap-4 mb-5">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Listing Videos</h2>
            <p className="text-gray-500 text-sm mt-0.5">Upload MP4 video for this listing. Videos appear first in the client slideshow.</p>
          </div>
          <button
            onClick={() => hasAccess(accessStatus) && requireRights(() => videoInputRef.current?.click())}
            disabled={uploadingVideo || !hasAccess(accessStatus)}
            className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            {uploadingVideo ? `Uploading… ${videoUploadProgress}%` : "＋ Upload MP4"}
          </button>
          <input ref={videoInputRef} type="file" accept="video/mp4,.mp4" multiple className="hidden" onChange={(e) => handleVideoFiles(e.target.files)} />
        </div>

        {uploadingVideo && (
          <div className="mb-4">
            <div className="bg-gray-100 rounded-full h-2">
              <div className="bg-[#d4a843] h-2 rounded-full transition-all" style={{ width: `${videoUploadProgress}%` }} />
            </div>
            <p className="text-xs text-gray-400 mt-1">Uploading large files may take a moment…</p>
          </div>
        )}

        {videos.length === 0 ? (
          <div
            onClick={() => hasAccess(accessStatus) && requireRights(() => videoInputRef.current?.click())}
            className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${hasAccess(accessStatus) ? "border-gray-200 cursor-pointer hover:border-[#d4a843]" : "border-gray-100 cursor-default"}`}
          >
            {!hasAccess(accessStatus)
              ? <p className="text-gray-400 text-sm"><Link href="/dashboard/billing" className="text-[#d4a843] font-medium hover:underline">Subscribe</Link> to upload videos</p>
              : <p className="text-gray-400 text-sm">No videos yet — click to upload an MP4</p>
            }
          </div>
        ) : (
          <div className="space-y-4">
            {videos.filter(v => !deletingVideoIds.has(v.id)).map((video) => (
              <div key={video.id} className="rounded-xl overflow-hidden border border-gray-200">
                {video.url && (
                  <video
                    src={video.url}
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full max-h-[420px] bg-black"
                  />
                )}
                <div className="flex items-center gap-3 px-4 py-3 bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">🎬 {video.filename ?? "video.mp4"}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(video.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                  <button
                    onClick={() => downloadVideo(video.storage_path, video.filename)}
                    className="text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors shrink-0"
                  >
                    Download
                  </button>
                  <button
                    onClick={() => deleteVideo(video.id, video.storage_path)}
                    className="text-xs font-medium text-red-400 hover:text-red-600 transition-colors shrink-0"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Slideshow section */}
      <div className="mt-8 bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Client Slideshow</h2>
            <p className="text-gray-500 text-sm mt-0.5">
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
                  className="text-sm text-[#c49a35] hover:text-[#b08c2a] font-medium transition-colors"
                >
                  Preview ↗
                </a>
                <button
                  onClick={unpublishSlideshow}
                  disabled={slideshowWorking}
                  className="bg-white border border-gray-200 hover:border-red-300 text-gray-500 hover:text-red-500 text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  Unpublish
                </button>
              </>
            ) : hasAccess(accessStatus) ? (
              <button
                onClick={publishSlideshow}
                disabled={slideshowWorking || photos.filter(p => p.is_visible).length === 0}
                className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                {slideshowWorking ? "Creating..." : "Create Slideshow"}
              </button>
            ) : (
              <Link
                href="/dashboard/billing"
                className="bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                {accessStatus === "trial_expired" ? "Subscribe to Unlock" : "Upgrade to Unlock"}
              </Link>
            )}
          </div>
        </div>

        {listing.slideshow_published && listing.slideshow_slug && (
          <>
            {/* Link display */}
            <div className="mt-4 bg-gray-50 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
              <p className="text-sm text-gray-500 truncate">
                {typeof window !== "undefined" ? window.location.origin : ""}/s/{listing.slideshow_slug}
              </p>
              <span className="shrink-0 text-xs font-medium bg-green-50 text-green-700 px-2 py-0.5 rounded-full">
                Live
              </span>
            </div>

            {/* Share buttons */}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => { setSendSlideshow(!!listing.slideshow_published); setSendDocIds(new Set()); setSendModal(true); }}
                className="flex items-center gap-2 bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
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
                  className="flex items-center gap-2 bg-[#050b14] hover:bg-[#0a1628] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  Share
                </button>
              )}
              <a
                href={`sms:?body=${encodeURIComponent(`${listing.vessel_name ?? "Yacht listing"} — view photos here: ${typeof window !== "undefined" ? window.location.origin : ""}/s/${listing.slideshow_slug}`)}`}
                className="flex items-center gap-2 bg-white border border-gray-200 hover:border-[#d4a843] text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Text
              </a>
              <a
                href={`mailto:?subject=${encodeURIComponent(`${listing.vessel_name ?? "Yacht"} — Photo Gallery`)}&body=${encodeURIComponent(`Please find the photo gallery for ${listing.vessel_name ?? "this vessel"} at the link below:\n\n${typeof window !== "undefined" ? window.location.origin : ""}/s/${listing.slideshow_slug}`)}`}
                className="flex items-center gap-2 bg-white border border-gray-200 hover:border-[#d4a843] text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Email
              </a>
              <button
                onClick={copyLink}
                className="flex items-center gap-2 bg-white border border-gray-200 hover:border-[#d4a843] text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {slideshowCopied ? "✓ Copied!" : "Copy Link"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Documents section */}
      <div className="mt-8 bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-start justify-between flex-wrap gap-4 mb-5">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Listing Documents</h2>
            <p className="text-gray-500 text-sm mt-0.5">Upload PDF brochures or spec sheets for this listing.</p>
          </div>
          <button
            onClick={() => hasAccess(accessStatus) && requireRights(() => docInputRef.current?.click())}
            disabled={uploadingDoc || !hasAccess(accessStatus)}
            className="bg-[#d4a843] hover:bg-[#c49a35] disabled:opacity-50 text-[#050b14] text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            {uploadingDoc ? "Uploading…" : "＋ Upload PDF"}
          </button>
          <input ref={docInputRef} type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => handleDocFiles(e.target.files)} />
        </div>

        {documents.length === 0 ? (
          <div
            onClick={() => hasAccess(accessStatus) && requireRights(() => docInputRef.current?.click())}
            className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${hasAccess(accessStatus) ? "border-gray-200 cursor-pointer hover:border-[#d4a843]" : "border-gray-100 cursor-default"}`}
          >
            {!hasAccess(accessStatus)
              ? <p className="text-gray-400 text-sm"><Link href="/dashboard/billing" className="text-[#d4a843] font-medium hover:underline">Subscribe</Link> to upload documents</p>
              : <p className="text-gray-400 text-sm">No documents yet — click to upload a PDF</p>
            }
          </div>
        ) : (
          <div className="space-y-2">
            {documents.filter(d => !deletingDocIds.has(d.id)).map((doc) => (
              <div key={doc.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-4 py-3">
                <span className="text-red-500 text-lg shrink-0">📄</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{doc.filename ?? "document.pdf"}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(doc.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </div>
                <button
                  onClick={() => openPdfViewer(doc.storage_path, doc.filename)}
                  className="text-xs font-medium text-[#c49a35] hover:text-[#b08c2a] transition-colors shrink-0"
                >
                  View
                </button>
                <button
                  onClick={async () => {
                    const { data } = await supabase.storage.from("listing-documents").createSignedUrl(doc.storage_path, 3600);
                    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
                  }}
                  className="text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors shrink-0"
                >
                  Open ↗
                </button>
                <button
                  onClick={() => downloadDocument(doc.storage_path, doc.filename)}
                  className="text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors shrink-0"
                >
                  Download
                </button>
                <button
                  onClick={() => deleteDocument(doc.id, doc.storage_path)}
                  className="text-xs font-medium text-red-400 hover:text-red-600 transition-colors shrink-0"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sent History section */}
      <div className="mt-8 bg-white border border-gray-200 rounded-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Sent History</h2>
            <p className="text-gray-500 text-xs mt-0.5">Tracks emails sent via the &ldquo;Send to Client&rdquo; button above — not the Email link below.</p>
          </div>
          <div className="flex items-center gap-3">
            {viewTimestamps.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-full">
                <svg className="w-3.5 h-3.5 text-[#d4a843]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            <p className="text-gray-400 text-sm">No emails sent yet.</p>
            <p className="text-gray-300 text-xs mt-1">Use the &ldquo;Send to Client&rdquo; button in the Client Slideshow section to send a tracked email.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {clientSends.map((send) => {
              const sentAt = new Date(send.sent_at);
              const viewsSince = viewTimestamps.filter(t => t >= sentAt);
              const lastViewed = viewsSince.length > 0 ? viewsSince[0] : null;
              return (
                <li key={send.id} className="px-6 py-4 flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{send.client_email}</p>
                    {send.message && (
                      <p className="text-xs text-gray-400 mt-0.5 line-clamp-1 italic">&ldquo;{send.message}&rdquo;</p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {send.included_slideshow && (
                        <span className="text-[10px] font-medium bg-[#d4a843]/10 text-[#b08c2a] px-2 py-0.5 rounded-full">Slideshow</span>
                      )}
                      {send.document_count > 0 && (
                        <span className="text-[10px] font-medium bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                          {send.document_count} doc{send.document_count !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    {send.included_slideshow && (
                      <div className="mt-2">
                        {lastViewed ? (
                          <span className="flex items-center gap-1.5 text-[11px] text-emerald-600 font-medium">
                            <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            Opened {viewsSince.length} {viewsSince.length === 1 ? "time" : "times"} · Last {relativeTime(lastViewed)}
                          </span>
                        ) : (
                          <span className="text-[11px] text-gray-400">Not yet opened</span>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 shrink-0 mt-0.5">
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

// ─── Sortable photo card ───────────────────────────────────────────────────────
function SortablePhotoCard({
  photo, index, isSelected, selectMode, downloading, tapStart,
  onTap, onDownload, onToggleVisibility, onUpdateCategory, onDelete,
}: {
  photo: { id: string; url: string | null; filename: string | null; category: string | null; is_visible: boolean };
  index: number;
  isSelected: boolean;
  selectMode: boolean;
  downloading: boolean;
  tapStart: React.MutableRefObject<{ x: number; y: number } | null>;
  onTap: () => void;
  onDownload: () => void;
  onToggleVisibility: () => void;
  onUpdateCategory: (cat: string) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: photo.id });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isVertical, setIsVertical] = useState(false);
  const inStandardList = (PHOTO_CATEGORIES as readonly string[]).includes(photo.category ?? "");
  const [showCustomInput, setShowCustomInput] = useState(!inStandardList);
  const [customValue, setCustomValue] = useState(!inStandardList ? (photo.category ?? "") : "");

  function commitCustom() {
    const trimmed = customValue.trim();
    if (trimmed) {
      onUpdateCategory(trimmed);
    } else {
      setShowCustomInput(false);
      setCustomValue("");
      onUpdateCategory("Other");
    }
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative rounded-lg overflow-hidden border-2 transition-colors touch-manipulation ${
        isSelected ? "border-[#d4a843] shadow-md" :
        photo.is_visible ? "border-transparent" : "border-gray-200 opacity-60"
      }`}
    >
      {/* Drag handle — top-right grip */}
      {!selectMode && (
        <div
          {...attributes}
          {...listeners}
          className="absolute top-1.5 right-1.5 z-10 bg-black/40 hover:bg-black/60 rounded p-1 cursor-grab active:cursor-grabbing touch-manipulation"
          title="Drag to reorder"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="white">
            <circle cx="4" cy="3" r="1.2"/><circle cx="8" cy="3" r="1.2"/>
            <circle cx="4" cy="6" r="1.2"/><circle cx="8" cy="6" r="1.2"/>
            <circle cx="4" cy="9" r="1.2"/><circle cx="8" cy="9" r="1.2"/>
          </svg>
        </div>
      )}

      {/* Photo */}
      <div
        onClick={onTap}
        onTouchStart={(e) => { tapStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
        onTouchEnd={(e) => {
          if (!tapStart.current) return;
          const dx = Math.abs(e.changedTouches[0].clientX - tapStart.current.x);
          const dy = Math.abs(e.changedTouches[0].clientY - tapStart.current.y);
          tapStart.current = null;
          if (dx < 8 && dy < 8) { e.preventDefault(); onTap(); }
        }}
        className="cursor-pointer"
      >
        {photo.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.url}
            alt={photo.filename ?? ""}
            onLoad={(e) => {
              const img = e.target as HTMLImageElement;
              setIsVertical(img.naturalHeight > img.naturalWidth);
            }}
            className={`w-full object-cover pointer-events-none ${isVertical ? "aspect-[3/4]" : "aspect-[4/3]"}`}
          />
        ) : (
          <div className="w-full aspect-[4/3] bg-amber-50 border-b border-amber-200 flex flex-col items-center justify-center gap-2 pointer-events-none">
            <span className="text-2xl">⚠️</span>
            <div className="text-center px-3">
              <p className="text-amber-700 text-xs font-semibold">File missing</p>
              <p className="text-amber-600 text-[10px] mt-0.5">Delete and re-upload</p>
            </div>
          </div>
        )}
      </div>

      {/* Checkbox in select mode */}
      {selectMode && (
        <div
          onClick={onTap}
          className={`absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors cursor-pointer ${
            isSelected ? "bg-[#d4a843] border-[#d4a843]" : "bg-white/80 border-gray-300"
          }`}
        >
          {isSelected && <span className="text-[#050b14] text-xs font-bold">✓</span>}
        </div>
      )}

      {/* Caption row */}
      <div className="p-2 bg-white">
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 shrink-0">{String(index + 1).padStart(2, "0")} ·</span>
          {!showCustomInput ? (
            <select
              value={photo.category ?? "Other"}
              onChange={(e) => {
                e.stopPropagation();
                if (e.target.value === "__custom__") {
                  setShowCustomInput(true);
                  setCustomValue("");
                } else {
                  onUpdateCategory(e.target.value);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className="text-xs font-medium text-gray-700 bg-transparent border-none outline-none cursor-pointer hover:text-[#c49a35] transition-colors flex-1 min-w-0 truncate"
            >
              <option value="__custom__">+ Custom...</option>
              {PHOTO_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <input
                type="text"
                value={customValue}
                onChange={(e) => { e.stopPropagation(); setCustomValue(e.target.value); }}
                onBlur={commitCustom}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitCustom(); } }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                placeholder="Type & press Enter..."
                autoFocus
                className="text-xs text-gray-700 bg-transparent border-b border-gray-200 outline-none flex-1 min-w-0 focus:border-[#d4a843]"
              />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowCustomInput(false); setCustomValue(""); onUpdateCategory("Other"); }}
                className="text-gray-400 hover:text-gray-600 text-xs shrink-0 px-1"
                title="Back to list"
              >✕</button>
            </div>
          )}
          {!photo.is_visible && <span className="text-gray-400 text-xs shrink-0">· hidden</span>}
        </div>
        {photo.filename && (
          <p className="text-xs text-gray-400 truncate mt-0.5" title={photo.filename}>{photo.filename}</p>
        )}
        {/* Action buttons */}
        {!selectMode && (
          <div
            className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100"
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            {photo.url && (
              <button onClick={(e) => { e.stopPropagation(); onDownload(); }}
                className="flex-1 text-center text-xs font-medium text-gray-600 py-1.5 rounded bg-gray-50 hover:bg-gray-100 transition-colors">
                ⬇ Download
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); onToggleVisibility(); }}
              className="flex-1 text-center text-xs font-medium text-gray-600 py-1.5 rounded bg-gray-50 hover:bg-gray-100 transition-colors">
              {photo.is_visible ? "Hide" : "Show"}
            </button>
            {confirmDelete ? (
              <>
                <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
                  className="flex-1 text-center text-xs font-medium text-gray-500 py-1.5 rounded bg-gray-50 hover:bg-gray-100 transition-colors">
                  Cancel
                </button>
                <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="flex-1 text-center text-xs font-bold text-white py-1.5 rounded bg-red-500 hover:bg-red-600 transition-colors">
                  Confirm
                </button>
              </>
            ) : (
              <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
                className="flex-1 text-center text-xs font-medium text-red-500 py-1.5 rounded bg-red-50 hover:bg-red-100 transition-colors">
                Delete
                            </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
