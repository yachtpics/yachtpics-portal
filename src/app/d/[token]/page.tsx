import { createClient } from "@supabase/supabase-js";
import DownloadPageClient from "./_components/DownloadPageClient";
import { signVideoUrl } from "@/lib/videoUrls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function InvalidState({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-950 px-6 py-16">
      <div className="max-w-md w-full text-center">
        <p className="text-white text-xl font-light uppercase tracking-caps-wide [text-indent:0.24em] leading-none">
          YachtPics
        </p>
        <span aria-hidden className="mx-auto mt-4 block h-px w-24 bg-white/25" />
        <p className="mt-4 text-[0.6875rem] font-medium uppercase tracking-caps-wide [text-indent:0.24em] text-accent-300/90">
          Portal
        </p>
        <div className="bg-white/[0.03] border border-hairline-inverse rounded-surface p-8 mt-8">
          <h1 className="text-h1 text-white mb-2">{title}</h1>
          <p className="text-sm text-ink-400 leading-relaxed">{body}</p>
        </div>
      </div>
    </div>
  );
}

export default async function PublicDownloadPage({ params }: { params: { token: string } }) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: link } = await supabase
    .from("download_links")
    .select("id, listing_id, revoked, expires_at, scope")
    .eq("token", params.token)
    .single();

  if (!link) {
    return (
      <InvalidState
        title="Link not found"
        body="This download link isn't valid. Please check with the person who sent it to you for an updated link."
      />
    );
  }
  if (link.revoked) {
    return (
      <InvalidState
        title="Link no longer active"
        body="This download link has been turned off. Please contact YachtPics or your broker for access."
      />
    );
  }
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return (
      <InvalidState
        title="Link expired"
        body="This download link has expired. Please request a new link from the person who sent it to you."
      />
    );
  }

  const { data: listing } = await supabase
    .from("listings")
    .select("vessel_name, year, make, model")
    .eq("id", link.listing_id)
    .single();

  // A link can be scoped to photos only, videos only, or both — so a broker who
  // just needs the walkthrough isn't handed 200 photos, and vice versa.
  const scope = (link as { scope?: string }).scope ?? "both";
  const wantsPhotos = scope === "photos" || scope === "both";
  const wantsVideos = scope === "videos" || scope === "both";

  const { data: photos } = wantsPhotos
    ? await supabase
        .from("photos")
        .select("id, storage_path, filename, category, display_order")
        .eq("listing_id", link.listing_id)
        .order("display_order")
    : { data: [] };

  const paths = (photos ?? []).map((p) => p.storage_path);
  const { data: signed } =
    paths.length > 0
      ? await supabase.storage.from("listing-photos").createSignedUrls(paths, 60 * 60 * 6)
      : { data: [] };
  const urlMap = new Map((signed ?? []).map((d) => [d.path, d.signedUrl]));

  const photosWithUrls = (photos ?? []).map((p) => ({
    id: p.id,
    url: urlMap.get(p.storage_path) ?? null,
    filename: p.filename,
    category: p.category,
  }));

  // Videos live in their own bucket. We sign two URLs each: a plain one for the
  // inline preview, and a download-forced one (Supabase's `download` param sets
  // Content-Disposition: attachment) so a click saves the file instead of
  // opening it — and without pulling a huge video into browser memory.
  const { data: videos } = wantsVideos
    ? await supabase
        .from("videos")
        .select("id, storage_path, storage_host, filename, created_at")
        .eq("listing_id", link.listing_id)
        .order("created_at")
    : { data: [] };

  // Two links per video: preview, and download-forced. They must be signed
  // separately — appending &download= to a signed URL only worked on Supabase;
  // an R2 signature covers the whole query string, so a tacked-on parameter
  // invalidates the link. signVideoUrl bakes the disposition in for either host.
  const videosWithUrls = await Promise.all(
    (videos ?? []).map(async (v, i) => {
      const dlName = v.filename && /\.\w+$/.test(v.filename) ? v.filename : `${v.filename ?? "video"}.mp4`;
      const [previewUrl, downloadUrl] = await Promise.all([
        signVideoUrl(supabase, v, { expiresIn: 60 * 60 * 6 }),
        signVideoUrl(supabase, { ...v, filename: dlName }, { expiresIn: 60 * 60 * 6, asDownload: true }),
      ]);
      return { id: v.id, previewUrl, downloadUrl, label: v.filename ?? `Video ${i + 1}` };
    })
  );

  const vesselName = listing?.vessel_name ?? "Vessel";

  return (
    <DownloadPageClient
      token={params.token}
      vesselName={vesselName}
      photos={photosWithUrls}
      videos={videosWithUrls}
    />
  );
}
