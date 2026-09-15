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
 *
 * Three publications are absent for a harder reason — see PUBLICATIONS_WITHOUT_FEEDS
 * at the foot of this file before adding them back.
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
    // Seen returning XML, but the publication has effectively stopped: the newest
    // item in the feed is 19 December 2025 (checked 15 Sep 2026). Kept because the
    // address is sound and costs nothing, but do not count it towards the daily
    // intake — if it is still silent at the end of 2026, retire it.
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
    // Seen returning XML, but it publishes in bursts — newest item 11 May 2026 on
    // the news channel, 27 May 2026 on the site-wide /feed/ (checked 15 Sep 2026).
    // The site-wide feed is the fuller of the two and is what we read now; it
    // carries the same news posts plus the occasional market piece.
    name: "YATCO",
    url: "https://www.yatco.com/feed/",
    homepage: "https://www.yatco.com",
    hint: "brokerage",
  },
  {
    // Seen returning XML from a browser, but 403s from at least one data-centre
    // network (Cloudflare edge rule — even /robots.txt is refused, so it is the
    // caller's address being judged, not the path). Left in: if Vercel's egress
    // is blocked too it will simply appear in `failedSources` every morning and
    // can be retired then. The address itself is correct — the site-wide /feed/
    // is switched off and redirects to the homepage.
    name: "Boats Group",
    url: "https://www.boatsgroup.com/category/news/feed/",
    homepage: "https://www.boatsgroup.com",
    hint: "brokerage",
  },
  {
    // Seen returning XML, daily. Trade press proper — dealers, builders, marinas,
    // finance and the brokerage business. British-based but it covers the American
    // market, and it is the closest working replacement for what IYBA and
    // SuperYacht Times were meant to supply.
    name: "Marine Industry News",
    url: "https://marineindustrynews.co.uk/feed/",
    homepage: "https://marineindustrynews.co.uk",
    hint: "industry",
  },
  {
    // Seen returning XML, but quiet — newest item 8 July 2026 (checked 15 Sep
    // 2026). Kept for its patch rather than its pace: it is the Fort Lauderdale
    // marine-business paper, so when it does publish it is about the yards,
    // brokerages and crews our brokers already know.
    name: "The Triton",
    url: "https://triton.news/feed/",
    homepage: "https://triton.news",
    hint: "industry",
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
  {
    // Seen returning XML, thirty items deep and moving most days. British, and
    // consumer rather than trade, but it is motor-yacht coverage — new models,
    // sea trials, builder news — which is the ground Yachts International used to
    // hold for us.
    name: "Motor Boat & Yachting",
    url: "https://www.mby.com/feed",
    homepage: "https://www.mby.com",
    hint: "new-builds",
  },
];

/**
 * The ones that got away, and why — so nobody spends another morning guessing
 * feed addresses that were never there. Re-checked 15 September 2026.
 *
 * BOAT International — no feed at any address (/rss, /rss.xml, /feed, /feed/,
 *   /atom.xml, /index.xml, /feed.xml, /rss/news, /yachts/news/feed all 404) and
 *   no <link rel="alternate"> on the homepage. Its sitemap carries no dates
 *   either, and the daily job drops undated items by design, so the sitemap is
 *   not a way round it.
 *
 * SuperYacht Times — no feed, and now unreadable by machine at all: Cloudflare
 *   refuses the homepage, the sitemap index and every feed guess outright.
 *
 * IYBA — no feed. iyba.yachts does not resolve; the association is at iyba.org,
 *   where /feed/, /rss, /rss.xml, /news/feed/, /news-list/feed, /index.xml and
 *   /atom.xml all 404 and the sitemap is menu-and-data only, undated. Their news
 *   sits at /news-list with nothing to subscribe to.
 *
 * All three would have to be scraped, which is a different undertaking with a
 * different set of manners. Megayacht News and Robb Report Marine carry the
 * superyacht ground; Marine Industry News and The Triton carry the trade.
 */
export const PUBLICATIONS_WITHOUT_FEEDS = [
  "BOAT International",
  "SuperYacht Times",
  "IYBA",
] as const;

/** The name we put on items Charlie enters himself. */
export const NATIVE_SOURCE_NAME = "YachtPics";
export const NATIVE_SOURCE_HOMEPAGE = "https://www.yachtpics.com";
