// sitemap.xml for yachtpics.com — the pure XML half (renderSitemap in
// sitePublish.ts gathers the rows). No imports, so it can be checked offline.

/** Google reads at most 1,000 <image:image> entries per page. */
export const SITEMAP_MAX_IMAGES_PER_PAGE = 1000;

export type SitemapRow = {
  loc: string;
  lastmod: string;
  priority: string;
  /** Public photo URLs shown on that page (image sitemap). */
  images?: string[];
};

function xmlEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * One <url> per line, in the order given. Boat pages also list their photos
 * as <image:image> entries (capped at 1,000 per page).
 */
export function sitemapXml(rows: SitemapRow[]): string {
  const body = rows
    .map((u) => {
      const imgs = (u.images ?? [])
        .slice(0, SITEMAP_MAX_IMAGES_PER_PAGE)
        .map((src) => `<image:image><image:loc>${xmlEsc(src)}</image:loc></image:image>`)
        .join("");
      return `  <url><loc>${xmlEsc(u.loc)}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority}</priority>${imgs}</url>`;
    })
    .join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${body}\n</urlset>\n`
  );
}
