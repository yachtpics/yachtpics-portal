import type { Metadata } from "next";
import { getPublicBrokerSite, type PublicBrokerSite } from "@/lib/brokerSiteServer";
import { resolveSiteStyle } from "@/lib/siteStyle";
import HomePage from "./_components/HomePage";
import Unavailable from "./_components/Unavailable";

/**
 * /b/[slug] — a broker's personal website (Oct 26). Public (the middleware
 * doesn't match /b), rebuilt at most hourly and on every save in the editor
 * (revalidatePath in /api/website). Everything comes from the broker's own
 * Portal data via src/lib/brokerSiteServer.ts; empty fields hide their
 * element — nothing placeholder is ever rendered.
 *
 * Not shown ("This page isn't available", noindex) when the slug is unknown,
 * the site is unpublished, or the broker isn't entitled: Portal access AND
 * (Elite, the $50 website line on their plan, or an admin comp) — websiteEntitlement in
 * src/lib/websiteAddon.ts.
 *
 * Look (layout + palette + accent) from the site row — src/lib/siteStyle.ts;
 * the three layouts share sections (_components/sections.tsx). Unsaved looks
 * are previewed at /b/[slug]/preview (dynamic, owner/team/admin only), so
 * this page stays statically cached.
 */
export const revalidate = 3600;

function description(s: PublicBrokerSite): string {
  return (
    s.site.headline ||
    s.site.specialty ||
    [`${s.name}, yacht broker`, s.brokerageName ? `with ${s.brokerageName}` : null].filter(Boolean).join(" ")
  );
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const s = await getPublicBrokerSite(params.slug).catch(() => null);
  if (!s) return { title: "This page isn't available", robots: { index: false, follow: false } };
  const title = `${s.name} — Yacht Broker`;
  const desc = description(s);
  return {
    title,
    description: desc,
    openGraph: {
      title,
      description: desc,
      type: "profile",
      ...(s.og ? { images: [{ url: s.og, width: 1200, height: 630, alt: s.name }] } : {}),
    },
    twitter: {
      card: s.og ? "summary_large_image" : "summary",
      title,
      description: desc,
      ...(s.og ? { images: [s.og] } : {}),
    },
  };
}

export default async function BrokerSitePage({ params }: { params: { slug: string } }) {
  const s = await getPublicBrokerSite(params.slug).catch(() => null);
  if (!s) return <Unavailable />;
  const look = resolveSiteStyle(s.site);
  return <HomePage s={s} look={look} />;
}
