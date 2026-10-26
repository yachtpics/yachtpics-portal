import type { Metadata } from "next";
import { getPreviewBrokerSite, getPublicBrokerSite, getSiteBySlug, resolveActingBroker } from "@/lib/brokerSiteServer";
import { PALETTE_KEYS, cleanHex, isLayout, resolveSiteStyle } from "@/lib/siteStyle";
import { cleanSectionOrder } from "@/lib/brokerSite";
import HomePage from "../_components/HomePage";
import Unavailable from "../_components/Unavailable";

/**
 * /b/[slug]/preview?layout=…&palette=…&accent=…&order=… — the site with UNSAVED look
 * choices, opened by the editor's Preview button (Oct 26).
 *
 * Always rendered per request (never cached). The overrides — and showing a
 * site that isn't published / live yet — are honoured only for a signed-in
 * owner, their assistant (or brokerage admin) or a Portal admin
 * (resolveActingBroker for the site's broker). Anyone else gets exactly the
 * public page, ignoring the parameters.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

export default async function SitePreviewPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { layout?: string; palette?: string; accent?: string; order?: string };
}) {
  const site = await getSiteBySlug(params.slug);
  const who = site ? await resolveActingBroker(site.broker_id).catch(() => null) : null;
  const allowed = !!site && !!who && who.ok && who.brokerId === site.broker_id;

  if (!allowed) {
    const s = await getPublicBrokerSite(params.slug).catch(() => null);
    if (!s) return <Unavailable />;
    return <HomePage s={s} look={resolveSiteStyle(s.site)} />;
  }

  const s = await getPreviewBrokerSite(params.slug).catch(() => null);
  if (!s) return <Unavailable />;
  const accentParam = searchParams.accent;
  const look = resolveSiteStyle({
    layout: isLayout(searchParams.layout) ? searchParams.layout : s.site.layout,
    palette: searchParams.palette && PALETTE_KEYS.includes(searchParams.palette) ? searchParams.palette : s.site.palette,
    accent: accentParam === "" || accentParam === "none" ? null : cleanHex(accentParam) ?? s.site.accent,
    ground: s.site.ground,
  });
  return (
    <>
      <div className="bg-black text-white text-xs text-center py-2 px-4">
        Preview — only you can see this. {s.site.published ? "" : "Your site isn’t published yet. "}Close this tab to go back to the editor.
      </div>
      <HomePage s={s} look={look} order={cleanSectionOrder(searchParams.order ?? s.site.section_order, look.layout)} />
    </>
  );
}
