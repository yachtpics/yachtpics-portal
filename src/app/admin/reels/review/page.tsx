import Link from "next/link";
import { requireAdminPage } from "@/lib/requireAdminPage";
import ReviewReelBuilder from "./ReviewReelBuilder";

export const dynamic = "force-dynamic";

/**
 * In Review reels — admin only (Oct 31). One profile photo per boat YachtPics
 * photographed in a period, between an opening card and the YachtPics end
 * card. Rendered in this browser; saved settings let it be made again.
 */
export default async function ReviewReelsPage() {
  await requireAdminPage();
  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <p className="text-xs text-ink-400 mb-1">
          <Link href="/admin/reels" className="hover:underline">Reels</Link>
          {" · "}
          <Link href="/admin/reel-studio" className="hover:underline">Reel Studio</Link>
        </p>
        <h1 className="text-display text-ink-900">In Review</h1>
        <p className="text-ink-500 mt-1 text-sm">
          A reel of every boat we photographed in a month, a quarter or a year &mdash; one profile photo each, an opening card and the YachtPics end card. No names or brokers on the photos. Rendered in this browser.
        </p>
      </div>
      <ReviewReelBuilder />
    </div>
  );
}
