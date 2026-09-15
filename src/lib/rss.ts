/**
 * A very small, very forgiving feed reader — RSS 2.0, RSS 1.0 and Atom.
 *
 * No dependency: the portal has no XML parser installed and adding one for
 * thirteen trade-press feeds would be a poor trade. Feeds in the wild are not
 * well-formed anyway — unescaped ampersands, CDATA wrapped around HTML, HTML
 * escaped twice, a `<link>` that is an attribute in one dialect and an element
 * in the other — so this is written to bend rather than throw. Anything it
 * cannot make sense of is dropped, never guessed at.
 *
 * It returns only what the daily job needs: a headline, a link, a date and
 * enough prose to summarise from.
 */

export type FeedItem = {
  title: string;
  url: string;
  /** ISO 8601, or null when the feed gave no usable date. */
  publishedAt: string | null;
  excerpt: string;
};

/** Enough entities to cover trade-press headlines; anything else is left alone. */
const NAMED_ENTITIES: Record<string, string | undefined> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  ndash: "–", mdash: "—", hellip: "…", middot: "·",
  deg: "°", pound: "£", euro: "€", yen: "¥",
  copy: "©", reg: "®", trade: "™", eacute: "é",
  egrave: "è", agrave: "à", ccedil: "ç", ouml: "ö",
  uuml: "ü", auml: "ä", oslash: "ø", aring: "å",
  laquo: "«", raquo: "»", bull: "•", prime: "′",
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]{1,9});/g, (whole, body: string) => {
    if (body.charAt(0) === "#") {
      const hex = body.charAt(1) === "x" || body.charAt(1) === "X";
      const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const hit = NAMED_ENTITIES[body.toLowerCase()];
    return hit === undefined ? whole : hit;
  });
}

/**
 * Removes markup but not arithmetic. The tag pattern insists on a letter after
 * the `<`, so a headline reading "boats under < 80ft" survives intact while
 * `<p>`, `</div>` and `<img …>` do not.
 */
function stripTags(input: string): string {
  return input
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?[a-zA-Z][^<>]*>/g, " ");
}

/**
 * Feed text to plain text: unwrap CDATA, drop markup, decode, then do it once
 * more because a good many feeds escape their HTML twice.
 */
function clean(raw: string): string {
  if (!raw) return "";
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = s.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ");
  s = stripTags(s);
  s = decodeEntities(s);
  if (/<\/?[a-zA-Z][^<>]*>/.test(s)) s = stripTags(s);
  s = decodeEntities(s);
  return s.replace(/\s+/g, " ").trim();
}

/** Every `<tag>…</tag>` body in the document, outermost-first, capped. */
function blocks(xml: string, tag: string, cap: number): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null = re.exec(xml);
  while (m !== null) {
    out.push(m[1] || "");
    if (out.length >= cap) break;
    m = re.exec(xml);
  }
  return out;
}

/** The body of the first of `names` that has one. Names may be namespaced. */
function firstTag(block: string, names: string[]): string {
  for (let i = 0; i < names.length; i++) {
    const re = new RegExp(`<${names[i]}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${names[i]}\\s*>`, "i");
    const m = re.exec(block);
    if (m && m[1] && m[1].trim()) return m[1];
  }
  return "";
}

function attrValue(attrs: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attrs);
  if (!m) return "";
  // Only one of the two quote styles can have matched; the other is undefined
  // at run time even though the type says otherwise.
  const raw: string = m[1] ?? m[2] ?? "";
  return decodeEntities(raw).trim();
}

function isHttp(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * The article's own address. RSS puts it in the element body, Atom in an
 * attribute, and WordPress feeds add `<link>` elements for comments and
 * self-references that must not win.
 */
function itemLink(block: string): string {
  const rss = /<link(?:\s[^>]*)?>([\s\S]*?)<\/link\s*>/i.exec(block);
  if (rss) {
    const text = clean(rss[1] || "");
    if (isHttp(text)) return text;
  }

  const re = /<link\b([^>]*?)\/?>/gi;
  let fallback = "";
  let m: RegExpExecArray | null = re.exec(block);
  while (m !== null) {
    const attrs = m[1] || "";
    const href = attrValue(attrs, "href");
    if (isHttp(href)) {
      const rel = (attrValue(attrs, "rel") || "alternate").toLowerCase();
      if (rel === "alternate") return href;
      if (!fallback && rel !== "self" && rel !== "edit" && rel !== "replies") fallback = href;
    }
    m = re.exec(block);
  }
  if (fallback) return fallback;

  // Last resort — a guid that happens to be a permalink.
  const guid = clean(firstTag(block, ["guid", "id"]));
  return isHttp(guid) ? guid : "";
}

function toIso(raw: string): string | null {
  const s = clean(raw);
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const year = d.getUTCFullYear();
  // A feed whose clock is decades out is broken, not prescient.
  if (year < 2000 || year > 2100) return null;
  return d.toISOString();
}

/**
 * Parse a feed document. Returns an empty array for anything unrecognisable —
 * a 404 page, an HTML holding page, a truncated download — rather than
 * throwing, because one bad source must not stop the other twelve.
 */
export function parseFeed(xml: string): FeedItem[] {
  if (!xml) return [];
  // Leading whitespace and the byte-order mark some feeds still ship (JS
  // counts U+FEFF as whitespace, so one pattern covers both).
  const body = xml.replace(/^\s+/, "");

  let raw = blocks(body, "item", 200);
  if (raw.length === 0) raw = blocks(body, "entry", 200);
  if (raw.length === 0) return [];

  const out: FeedItem[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const block = raw[i];
    const url = itemLink(block);
    const title = clean(firstTag(block, ["title"]));
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    out.push({
      title,
      url,
      publishedAt: toIso(firstTag(block, ["pubDate", "published", "updated", "dc:date", "date"])),
      excerpt: clean(firstTag(block, ["description", "summary", "content:encoded", "content", "subtitle"])),
    });
  }
  return out;
}
