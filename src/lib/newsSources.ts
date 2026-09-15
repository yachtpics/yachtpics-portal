/**
 * Where the industry news comes from.
 *
 * One entry per publication: the feed we read, the homepage we credit, and a
 * hint at what that outlet usually covers. The hint is only a hint — the model
 * assigns the real category per item — but it keeps the list readable and gives
 * the daily job something sensible to fall back on.
 *
 * `unverified: true` means the address is the most likely feed for that
 * publication but nobody has watched it return XML yet. The daily job tolerates
 * a source that fails, so a wrong guess costs nothing but a name in
 * `failedSources`; correct the URL here and it joins in the next morning.
 *
 * Forums are deliberately absent. The Hull Truth and its like are conversation,
 * not press, and we summarise press.
 */

/** The six shelves. One per item, chosen by the model. */
export const NEWS_CATEGORIES = [
  "brokerage",
  "new-builds",
  "shows",
  "sportfish",
  "superyacht",
  "industry",
] as const;

export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

/** How each category is written in the portal. Sentence case, no shouting. */
export const NEWS_CATEGORY_LABELS: Record<NewsCategory, string> = {
  brokerage: "Brokerage",
  "new-builds": "New builds",
  shows: "Shows",
  sportfish: "Sportfish",
  superyacht: "Superyacht",
  industry: "Industry",
};

/** Narrows an unknown string to one of the six. Anything else is not a category. */
export function isNewsCategory(value: unknown): value is NewsCategory {
  return typeof value === "string" && (NEWS_CATEGORIES as readonly string[]).indexOf(value) !== -1;
}

export type NewsSource = {
  /** Shown to brokers, verbatim: "BOAT International". */
  name: string;
  /** The RSS or Atom feed. */
  url: string;
  /** The publication's front page — where the source name links. */
  homepage: string;
  /** What this outlet mostly covers. Not binding. */
  hint: NewsCategory;
  /** True until someone has seen this URL return a feed. */
  unverified?: boolean;
};

export const NEWS_SOURCES: NewsSource[] = [
  {
    // No feed exists. Tried /rss, /rss.xml, /feed, /feed/, /atom.xml, /index.xml,
    // /feed.xml, /rss/news, /yachts/news/feed — all 404, and the homepage declares
    // no <link rel="alternate">. It is a Next.js site with nothing to subscribe to.
    name: "BOAT International",
    url: "https://www.boatinternational.com/rss",
    homepage: "https://www.boatinternational.com",
    hint: "superyacht",
    unverified: true,
  },
  {
    // No feed exists. Tried /rss, /rss.xml, /feed, /feed/, /yacht-news/feed,
    // /news/rss, /atom.xml, /index.xml — all 404, and no <link rel="alternate">
    // on the homepage. Also a Next.js site with no feed endpoint.
    name: "SuperYacht Times",
    url: "https://www.superyachttimes.com/rss",
    homepage: "https://www.superyachttimes.com",
    hint: "superyacht",
    unverified: true,
  },
  {
    // Seen returning XML: /rss redirects here.
    name: "Trade Only Today",
    url: "https://tradeonlytoday.com/feed/",
    homepage: "https://tradeonlytoday.com",
    hint: "industry",
  },
  {
    // Seen returning XML. The www address redirects here; this is the address
    // the feed names as its own.
    name: "Soundings Online",
    url: "https://soundingsonline.com/feed/",
    homepage: "https://www.soundingsonline.com",
    hint: "industry",
  },
  {
    // Seen returning XML. The www address redirects here.
    name: "Power & Motoryacht",
    url: "https://powerandmotoryacht.com/feed/",
    homepage: "https://www.powerandmotoryacht.com",
    hint: "new-builds",
  },
  {
    // Seen returning XML, but the feed is slow-moving — it was last rebuilt in
    // December 2025, so expect long quiet stretches rather than daily items.
    name: "Yachts International",
    url: "https://yachtsinternational.com/feed/",
    homepage: "https://www.yachtsinternational.com",
    hint: "superyacht",
  },
  {
    // Seen returning XML.
    name: "Yachting Magazine",
    url: "https://www.yachtingmagazine.com/feed/",
    homepage: "https://www.yachtingmagazine.com",
    hint: "new-builds",
  },
  {
    // Seen returning XML. The section feed, not the whole magazine.
    name: "Robb Report Marine",
    url: "https://robbreport.com/motors/marine/feed/",
    homepage: "https://robbreport.com/motors/marine/",
    hint: "superyacht",
  },
  {
    // Seen returning XML. The site-wide /feed/ works too, but this one is the
    // industry-news channel and nothing else.
    name: "YATCO",
    url: "https://www.yatco.com/news/feed/",
    homepage: "https://www.yatco.com",
    hint: "brokerage",
  },
  {
    // No feed found, and the address in the original guess was wrong too:
    // iyba.yachts does not resolve at all — the association is at iyba.org.
    // On iyba.org tried /feed/, /rss, /rss.xml, /news/feed/, /news-list/feed,
    // /index.xml, /atom.xml — all 404, no <link rel="alternate">. Their news
    // sits at /news-list with nothing to subscribe to.
    name: "IYBA",
    url: "https://iyba.org/feed/",
    homepage: "https://iyba.org",
    hint: "brokerage",
    unverified: true,
  },
  {
    // Seen returning XML. The site-wide /feed/ is switched off and redirects to
    // the homepage; the per-category feed is the one that works.
    name: "Boats Group",
    url: "https://www.boatsgroup.com/category/news/feed/",
    homepage: "https://www.boatsgroup.com",
    hint: "brokerage",
  },
  {
    // Seen returning XML.
    name: "Sport Fishing Magazine",
    url: "https://www.sportfishingmag.com/feed/",
    homepage: "https://www.sportfishingmag.com",
    hint: "sportfish",
  },
  {
    // Seen returning XML.
    name: "Marlin Magazine",
    url: "https://www.marlinmag.com/feed/",
    homepage: "https://www.marlinmag.com",
    hint: "sportfish",
  },
  {
    // Seen returning XML. Carries the American superyacht coverage that BOAT
    // International and SuperYacht Times would have given us if either had a feed.
    name: "Megayacht News",
    url: "https://megayachtnews.com/feed/",
    homepage: "https://megayachtnews.com",
    hint: "superyacht",
  },
  {
    // Seen returning XML. Dealer, manufacturer and trade-association news.
    name: "Boating Industry",
    url: "https://boatingindustry.com/feed/",
    homepage: "https://boatingindustry.com",
    hint: "industry",
  },
  {
    // Seen returning XML. The www address redirects here.
    name: "Southern Boating",
    url: "https://southernboating.com/feed/",
    homepage: "https://www.southernboating.com",
    hint: "industry",
  },
];

/** The name we put on items Charlie enters himself. */
export const NATIVE_SOURCE_NAME = "YachtPics";
export const NATIVE_SOURCE_HOMEPAGE = "https://www.yachtpics.com";
