import type { PublicBrokerSite } from "@/lib/brokerSiteServer";
import type { ResolvedSiteStyle } from "@/lib/siteStyle";
import { cleanSectionOrder, type SectionKey } from "@/lib/brokerSite";
import SiteShell, { sectionsShown } from "./SiteShell";
import { SiteHome } from "./sections";
import { displayFont } from "./fonts";

/** The home page in the site's chosen look — used by /b/[slug] and its preview. */
export default function HomePage({ s, look, order: orderOverride }: { s: PublicBrokerSite; look: ResolvedSiteStyle; order?: SectionKey[] }) {
  const order = orderOverride ?? cleanSectionOrder(s.site.section_order, look.layout);
  const shown = sectionsShown(s, { yachts: s.yachts.length, sold: s.sold.length });
  const display = displayFont(look.layout);
  const { site } = s;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "RealEstateAgent",
    name: s.name,
    ...(site.headline ? { description: site.headline } : {}),
    ...(s.phone ? { telephone: s.phone } : {}),
    ...(s.email ? { email: s.email } : {}),
    ...(s.portrait ? { image: s.portrait } : s.og ? { image: s.og } : {}),
    url: `https://portal.yachtpics.com/b/${site.slug}`,
    ...(s.brokerageName
      ? { parentOrganization: { "@type": "Organization", name: s.brokerageName, ...(s.brokerageWebsite ? { url: s.brokerageWebsite } : {}) } }
      : {}),
  };
  return (
    <SiteShell s={s} shown={shown} base="" look={look} displayClass={display} order={order}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <SiteHome s={s} layout={look.layout} display={display} shown={shown} order={order} />
    </SiteShell>
  );
}
