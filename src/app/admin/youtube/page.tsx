import { requireAdminPage } from "@/lib/requireAdminPage";
import YouTubeChannels from "./_components/YouTubeChannels";

export const dynamic = "force-dynamic";

export default async function YouTubePage({ searchParams }: { searchParams: { connected?: string; error?: string } }) {
  await requireAdminPage();
  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-display text-ink-900">YouTube</h1>
        <p className="text-ink-500 mt-1 text-sm">
          Connect a YouTube channel once, then upload a listing video from the listing&apos;s page. Uploads carry on with
          your browser closed.
        </p>
      </div>
      <YouTubeChannels connected={searchParams?.connected === "1"} errorCode={searchParams?.error ?? null} />
    </div>
  );
}
