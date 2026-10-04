"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { loadListingReelSource } from "@/lib/listingReelSource";
import ReelMaker, { type ReelSource } from "@/components/ReelMaker";

/**
 * Listing Reel
 * ------------
 * The loader. Everything that makes the film — the looks, the lengths, the
 * framing, the end card, the encoder — lives in <ReelMaker>, which the admin
 * Reel Studio uses too. This page's only job is to assemble the listing's half
 * of it: the boat, the broker's card and colours, and the photographs in
 * walk-through order. (The included-reel allowance is ReelMaker's and the
 * server's business — see /api/reels/claim.)
 */


export default function ListingReelPage() {
  const supabase = createClient();
  const id = useParams().id as string;

  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<ReelSource | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const src = await loadListingReelSource(supabase, id);
      setSource(src);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <div className="flex items-center justify-center h-64 text-ink-400 text-sm">Loading…</div>;
  if (!source) return <div className="flex items-center justify-center h-64 text-ink-400 text-sm">Listing not found.</div>;

  return <ReelMaker source={source} />;
}
