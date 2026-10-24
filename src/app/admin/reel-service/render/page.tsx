import { requireAdminPage } from "@/lib/requireAdminPage";
import RenderStation from "./RenderStation";

export const dynamic = "force-dynamic";

/**
 * Reel Service render station — admin only.
 *
 * One tab left open (the office ThinkPad) that renders every planned reel of
 * this month and last, one at a time, with the same in-browser renderer the
 * board's Make buttons use. Opened from the board (?auto=1 starts it).
 */
export default async function ReelServiceRenderPage({ searchParams }: { searchParams: { auto?: string } }) {
  await requireAdminPage();
  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <p className="text-xs text-ink-500">
        <a href="/admin/reel-service" className="hover:underline">Reel Service</a> &rsaquo; Render station
      </p>
      <h1 className="text-display text-ink-900 mt-1">Render station</h1>
      <RenderStation auto={searchParams?.auto === "1"} />
    </div>
  );
}
