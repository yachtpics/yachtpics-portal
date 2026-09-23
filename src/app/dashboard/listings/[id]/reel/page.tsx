"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { hasAccess } from "@/lib/subscriptionAccess";
import { orderPhotos } from "@/lib/photoOrder";
import { loadBitmap } from "@/lib/canvasText";
import { normalizeHex } from "@/lib/reelStyles";
import { reelPromoActive } from "@/lib/reelPromo";
import ReelMaker, { type ListingData, type ReelPhoto, type ReelSource, type ReelVideo } from "@/components/ReelMaker";

/**
 * Listing Reel
 * ------------
 * The loader. Everything that makes the film — the looks, the lengths, the
 * framing, the end card, the encoder — lives in <ReelMaker>, which the admin
 * Reel Studio uses too. This page's only job is to assemble the listing's half
 * of it: the boat, the broker's card and colours, the photographs in
 * walk-through order, and whether the plan behind the listing is paid up.
 */

type Photo = { id: string; storage_path: string; category: string | null; filename: string | null; display_order: number };
type VideoRow = { id: string; title: string | null; filename: string | null; thumbnail_path: string | null; display_order: number | null };

export default function ListingReelPage() {
  const supabase = createClient();
  const id = useParams().id as string;

  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<ReelSource | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: l } = await supabase.from("listings")
        .select("vessel_name, year, make, model, vessel_type, length_ft, location, asking_price, staterooms, broker_id, hero_photo_id, photo_order_manual")
        .eq("id", id).single();
      if (!l) { setLoading(false); return; }
      const listing = l as ListingData;
      const { data: { user: me } } = await supabase.auth.getUser();
      const isOwner = !!me && me.id === l.broker_id;
      let admin = false;
      if (me) {
        const { data: meProf } = await supabase.from("profiles").select("role").eq("id", me.id).maybeSingle();
        admin = meProf?.role === "admin";
      }

      // During the open house the Reel is unlocked for everyone — subscribed,
      // trialling or lapsed. Every other paid tool keeps its own gate.
      // An admin is never locked either way: the gate is the listing broker's
      // plan, and YachtPics cutting a reel on a lapsed broker's boat is not
      // what it's for (same fix as the Social page, 2026-09-19).
      let locked = false;
      if (reelPromoActive() || admin) {
        locked = false;
      } else {
        try {
          const subRes = await fetch(`/api/subscription/status?brokerId=${l.broker_id}`);
          // A server hiccup is not a lapsed plan. Only a real answer can lock.
          if (subRes.ok) {
            const subData = await subRes.json();
            locked = !hasAccess(subData?.status);
          }
        } catch { /* stay unlocked on a status hiccup */ }
      }

      const [{ data: prof }, { data: det }, { data: ph }, { count }, { data: vids }] = await Promise.all([
        supabase.from("profiles").select("first_name, last_name, phone, display_email").eq("id", l.broker_id).maybeSingle(),
        supabase.from("broker_details").select("brokerage_name, brokerage_website, logo_url, brand_accent, brand_ground").eq("id", l.broker_id).maybeSingle(),
        supabase.from("photos").select("id, storage_path, category, filename, display_order").eq("listing_id", id).eq("is_visible", true).order("display_order"),
        supabase.from("videos").select("id", { count: "exact", head: true }).eq("listing_id", id),
        // The listing's videos, offered as clips in the listing's own order.
        supabase.from("videos").select("id, title, filename, thumbnail_path, display_order").eq("listing_id", id).order("display_order"),
      ]);
      const broker = {
        // No placeholder here: an end card reading "Broker" over a phone number
        // is worse than no line at all. drawEndCard skips an empty name.
        name: [prof?.first_name, prof?.last_name].filter(Boolean).join(" "),
        brokerage: det?.brokerage_name ?? null,
        phone: prof?.phone ?? null,
        email: prof?.display_email ?? null,
        website: det?.brokerage_website ?? null,
        logoUrl: det?.logo_url ?? null,
      };
      const brand = { accent: normalizeHex(det?.brand_accent), ground: normalizeHex(det?.brand_ground) };

      // Same order the slideshow uses: cover first, then the walk-through.
      const ordered = orderPhotos((ph ?? []) as Photo[], { manual: l.photo_order_manual === true, heroId: l.hero_photo_id });
      // Small thumbnails for the picker (one signing call per photo, in parallel).
      const thumbs = await Promise.all(ordered.map(async (p) => {
        const { data } = await supabase.storage.from("listing-photos")
          .createSignedUrl(p.storage_path, 3600, { transform: { width: 240, height: 240, resize: "contain", quality: 70 } });
        return data?.signedUrl ?? null;
      }));
      const photos: ReelPhoto[] = ordered.map((p, i) => ({
        id: p.id,
        previewUrl: thumbs[i] ?? "",
        category: p.category,
        filename: p.filename,
        // Photographs at a sensible size for the frame. Transform first (fast,
        // cheap on the wire); fall back to the original if transforms fail.
        loadBitmap: async (longEdge: number) => {
          const { data: t } = await supabase.storage.from("listing-photos")
            .createSignedUrl(p.storage_path, 3600, { transform: { width: Math.round(longEdge), height: Math.round(longEdge), resize: "contain", quality: 82 } });
          const url = t?.signedUrl ?? null;
          let bmp: ImageBitmap | null = null;
          if (url) { try { bmp = await loadBitmap(url); } catch { bmp = null; } }
          if (!bmp) {
            const { data: o } = await supabase.storage.from("listing-photos").createSignedUrl(p.storage_path, 3600);
            if (!o?.signedUrl) throw new Error("A photo couldn't be loaded.");
            bmp = await loadBitmap(o.signedUrl);
          }
          return bmp;
        },
      }));

      // Video clips. The poster is the video's own thumbnail (a still in the
      // photo bucket); the file itself is on R2 and gets a fresh signed link
      // each time it is opened — for the trimmer and again for the render —
      // from the same route the rest of the portal uses.
      // Open to everyone who can open this reel page (Sept 23, after Charlie's
      // end-to-end test: R2 CORS set, clip rendered, played on his phone).
      const videoRows = (vids ?? []) as VideoRow[];
      const posters = await Promise.all(videoRows.map(async (v) => {
        if (!v.thumbnail_path) return null;
        const { data } = await supabase.storage.from("listing-photos")
          .createSignedUrl(v.thumbnail_path, 3600, { transform: { width: 320, height: 320, resize: "contain", quality: 70 } });
        return data?.signedUrl ?? null;
      }));
      const videos: ReelVideo[] = videoRows.map((v, i) => ({
        id: v.id,
        title: v.title?.trim() || v.filename || "Video",
        posterUrl: posters[i],
        open: async () => {
          const res = await fetch("/api/videos/signed-urls", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ videoId: v.id }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || typeof data?.url !== "string") throw new Error(data?.error ?? "Couldn\u2019t get a link to this video.");
          return { url: data.url as string };
        },
      }));

      setSource({
        listing,
        photos,
        videos,
        broker,
        listingId: id,
        isAdmin: admin,
        isOwner,
        locked,
        brand,
        videoCount: count ?? 0,
      });
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <div className="flex items-center justify-center h-64 text-ink-400 text-sm">Loading…</div>;
  if (!source) return <div className="flex items-center justify-center h-64 text-ink-400 text-sm">Listing not found.</div>;

  return <ReelMaker source={source} />;
}
