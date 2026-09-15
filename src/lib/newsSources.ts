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
    name: "BOAT International",
    url: "https://www.boatinternational.com/rss",
    homepage: "https://www.boatinternational.com",
    hint: "superyacht",
    unverified: true,
  },
  {
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
    name: "Soundings Online",
    url: "https://www.soundingsonline.com/feed/",
    homepage: "https://www.soundingsonline.com",
    hint: "industry",
    unverified: true,
  },
  {
    name: "Power & Motoryacht",
    url: "https://www.powerandmotoryacht.com/feed/",
    homepage: "https://www.powerandmotoryacht.com",
    hint: "new-builds",
    unverified: true,
  },
  {
    name: "Yachts International",
    url: "https://www.yachtsinternational.com/feed/",
    homepage: "https://www.yachtsinternational.com",
    hint: "superyacht",
    unverified: true,
  },
  {
    // Seen returning XML.
    name: "Yachting Magazine",
    url: "https://www.yachtingmagazine.com/feed/",
    homepage: "https://www.yachtingmagazine.com",
    hint: "new-builds",
  },
  {
    name: "Robb Report Marine",
    url: "https://robbreport.com/motors/marine/feed/",
    homepage: "https://robbreport.com/motors/marine/",
    hint: "superyacht",
    unverified: true,
  },
  {
    name: "YATCO",
    url: "https://www.yatco.com/feed/",
    homepage: "https://www.yatco.com",
    hint: "brokerage",
    unverified: true,
  },
  {
    name: "IYBA",
    url: "https://iyba.yachts/feed/",
    homepage: "https://iyba.yachts",
    hint: "brokerage",
    unverified: true,
  },
  {
    name: "Boats Group",
    url: "https://www.boatsgroup.com/feed/",
    homepage: "https://www.boatsgroup.com",
    hint: "brokerage",
    unverified: true,
  },
  {
    name: "Sport Fishing Magazine",
    url: "https://www.sportfishingmag.com/feed/",
    homepage: "https://www.sportfishingmag.com",
    hint: "sportfish",
    unverified: true,
  },
  {
    name: "Marlin Magazine",
    url: "https://www.marlinmag.com/feed/",
    homepage: "https://www.marlinmag.com",
    hint: "sportfish",
    unverified: true,
  },
];

/** The name we put on items Charlie enters himself. */
export const NATIVE_SOURCE_NAME = "YachtPics";
export const NATIVE_SOURCE_HOMEPAGE = "https://www.yachtpics.com";
