/**
 * The portal's one door to a language/vision model. Kept deliberately thin —
 * plain fetch against the Anthropic Messages API, no SDK — so it can be swapped
 * or switched off by removing one environment variable.
 *
 *   ANTHROPIC_API_KEY   required; without it every helper reports "not configured"
 *   ANTHROPIC_MODEL     optional; defaults to a fast, inexpensive vision model
 *
 * Two jobs today:
 *   1. Label photographs with the portal's own category names (so a broker's
 *      phone upload lands in the walk-through order without any typing).
 *   2. Draft a listing description from the specs and a few photographs, in
 *      the portal's understated register.
 */

import { NEWS_CATEGORIES, isNewsCategory, type NewsCategory } from "@/lib/newsSources";

const API = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5";

export function isAiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

type Block =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "url"; url: string } };

async function ask(blocks: Block[], opts: { system: string; maxTokens: number }): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("AI is not configured (ANTHROPIC_API_KEY is missing).");
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: [{ role: "user", content: blocks }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message ?? `AI request failed (${res.status})`;
    throw new Error(msg);
  }
  const text = (data?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
  return text.trim();
}

/** Pull the first JSON array/object out of a model reply, tolerating prose around it. */
function extractJson<T>(text: string): T | null {
  const start = text.search(/[\[{]/);
  if (start < 0) return null;
  const end = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
  if (end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)) as T; } catch { return null; }
}

/**
 * Label a batch of photographs. Returns one category per input (in order), or
 * null where the model wasn't sure. Categories MUST come from `categories`;
 * anything else is discarded rather than invented.
 */
export async function categorizePhotos(
  images: { url: string }[],
  categories: readonly string[]
): Promise<(string | null)[]> {
  if (images.length === 0) return [];
  const system = [
    "You label photographs of yachts and boats for a broker's listing gallery.",
    "For each image, choose exactly one label from the allowed list. Use the most specific label that clearly applies;",
    "when unsure between a specific and a general one (e.g. 'Master Stateroom' vs 'Guest Stateroom', or 'Aft Deck' vs 'Cockpit'), prefer the general one.",
    "Exterior shots of the whole boat from the side are 'Profiles'; the boat moving through water is 'Profiles Running'; drone shots are 'Aerial'.",
    "If nothing fits, answer null.",
    "Reply with a JSON array only, one entry per image in order: [{\"i\":0,\"label\":\"Salon\"},{\"i\":1,\"label\":null}]",
    "Allowed labels: " + categories.join(" | "),
  ].join(" ");

  const blocks: Block[] = [];
  images.forEach((img, i) => {
    blocks.push({ type: "text", text: `Image ${i}:` });
    blocks.push({ type: "image", source: { type: "url", url: img.url } });
  });
  blocks.push({ type: "text", text: `Label all ${images.length} images. JSON array only.` });

  const reply = await ask(blocks, { system, maxTokens: 60 + images.length * 24 });
  const parsed = extractJson<{ i: number; label: string | null }[]>(reply) ?? [];
  const allowed = new Set(categories);
  const out: (string | null)[] = images.map(() => null);
  for (const row of parsed) {
    if (typeof row?.i !== "number" || row.i < 0 || row.i >= images.length) continue;
    const label = typeof row.label === "string" ? row.label.trim() : null;
    out[row.i] = label && allowed.has(label) ? label : null;
  }
  return out;
}

export type DescribableListing = {
  vessel_name: string | null; vessel_type: string | null; year: number | null; make: string | null; model: string | null;
  length_ft: number | null; beam_ft: number | null; draft_ft: number | null; staterooms: number | null; heads: number | null;
  engines: string | null; engine_hours: number | null; fuel_type: string | null; cruising_speed_kn: number | null;
  max_speed_kn: number | null; hull_material: string | null; location: string | null; asking_price: number | null;
  description: string | null;
};

/**
 * Draft a listing description. Specs are facts; photographs supply the feel.
 * The register is the portal's — restrained, specific, no exclamation marks,
 * nothing invented. Returns plain text, 2–3 short paragraphs.
 */
export async function draftDescription(listing: DescribableListing, imageUrls: string[]): Promise<string> {
  const facts = Object.entries({
    Name: listing.vessel_name, Type: listing.vessel_type, Year: listing.year, Builder: listing.make, Model: listing.model,
    "Length (ft)": listing.length_ft, "Beam (ft)": listing.beam_ft, "Draft (ft)": listing.draft_ft,
    Staterooms: listing.staterooms, Heads: listing.heads, Engines: listing.engines, "Engine hours": listing.engine_hours,
    Fuel: listing.fuel_type, "Cruising speed (kn)": listing.cruising_speed_kn, "Max speed (kn)": listing.max_speed_kn,
    Hull: listing.hull_material, Location: listing.location,
  }).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `${k}: ${v}`).join("\n");

  const system = [
    "You write listing descriptions for a yacht brokerage. The voice is premium and understated: specific, calm, confident.",
    "Rules: use only the facts provided and what is plainly visible in the photographs. Never invent equipment, history, upgrades, or numbers.",
    "No exclamation marks, no 'stunning', 'must-see', 'won't last', 'turn-key', or sales clichés. No emoji. No headings. No bullet points.",
    "Do not state the price. Do not address the reader as 'you' more than once.",
    "Structure: 2–3 short paragraphs, 90–160 words total. Open with what the boat is and what it's for; then layout and living spaces;",
    "close with machinery/performance and where she lies. Refer to the vessel as 'she' sparingly or by name.",
    "If the broker's existing notes are given, keep any specific facts from them (upgrades, service history) and improve the prose.",
    "Reply with the description text only.",
  ].join(" ");

  const blocks: Block[] = [{ type: "text", text: `Facts:\n${facts || "(none provided)"}` }];
  if (listing.description) blocks.push({ type: "text", text: `Broker's existing notes:\n${listing.description}` });
  imageUrls.slice(0, 6).forEach((url, i) => {
    blocks.push({ type: "text", text: `Photo ${i + 1}:` });
    blocks.push({ type: "image", source: { type: "url", url } });
  });
  blocks.push({ type: "text", text: "Write the description." });

  return ask(blocks, { system, maxTokens: 400 });
}

export type ReelCopy = {
  /** A short line for the opening frame — six words at most, or "". */
  headline: string;
  /** Ready to paste under the post. */
  caption: string;
  hashtags: string[];
};

/**
 * Write the words that go with a reel, from the photographs actually chosen.
 *
 * This is the part brokers stall on: the film renders in a minute, then the
 * post sits in the camera roll for a week because nobody wants to write the
 * caption. So the model sees the same frames the buyer will, in the same order,
 * with the rooms already named by the photographer — and writes about what's
 * in them rather than paraphrasing a spec sheet.
 *
 * The headline is a suggestion the broker edits or ignores; nothing reaches a
 * client without them approving it.
 */
export async function draftReelCopy(
  listing: DescribableListing,
  photos: { url: string; category: string | null }[]
): Promise<ReelCopy> {
  const facts = Object.entries({
    Name: listing.vessel_name, Type: listing.vessel_type, Year: listing.year, Builder: listing.make, Model: listing.model,
    "Length (ft)": listing.length_ft, Staterooms: listing.staterooms, Heads: listing.heads,
    "Cruising speed (kn)": listing.cruising_speed_kn, "Max speed (kn)": listing.max_speed_kn, Location: listing.location,
  }).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `${k}: ${v}`).join("\n");

  const system = [
    "You write social copy for a yacht brokerage that photographs the boats itself. The voice is premium and understated:",
    "specific, calm, confident — the register of Burgess or Edmiston, not a dealership.",
    "You are given the exact photographs, in the order they appear in a short silent reel, each labelled with the space it shows.",
    "Write about what is actually visible in those photographs. Never invent equipment, materials, history, or numbers.",
    "Rules: no exclamation marks. No 'stunning', 'must-see', 'dream', 'turn-key', 'don't miss', 'welcome aboard'. No emoji.",
    "Do not state the price. Do not open with the vessel name — the film already shows it.",
    "headline: three to six words, under 40 characters, no full stop, evoking what the photographs show. It sits over the opening frame in one line. May be \"\" if nothing good fits.",
    "caption: 2–3 sentences, 35–60 words, for Instagram and Facebook. End with a quiet invitation to enquire — never a hard sell.",
    "hashtags: 6–9, lowercase, no punctuation beyond the #, mixing the builder, the type and the cruising ground where known.",
    "Reply with JSON only: {\"headline\":\"...\",\"caption\":\"...\",\"hashtags\":[\"#...\"]}",
  ].join(" ");

  const blocks: Block[] = [{ type: "text", text: `Facts:\n${facts || "(none provided)"}` }];
  // Ten frames is the whole reel — enough to write from without paying for more.
  photos.slice(0, 10).forEach((p, i) => {
    blocks.push({ type: "text", text: `Frame ${i + 1}${p.category ? ` — ${p.category}` : ""}:` });
    blocks.push({ type: "image", source: { type: "url", url: p.url } });
  });
  blocks.push({ type: "text", text: "Write the headline, caption and hashtags. JSON only." });

  const reply = await ask(blocks, { system, maxTokens: 500 });
  const parsed = extractJson<Partial<ReelCopy>>(reply);
  const tidy = (s: unknown) => (typeof s === "string" ? s.trim() : "");
  const tags = Array.isArray(parsed?.hashtags) ? parsed!.hashtags : [];
  // A long headline is cut back on a WORD, never mid-word: the model was asked
  // for under 40 characters, the title wraps if it must, and "Twin Diesels,
  // One Ow" is worse than no headline at all.
  const headline = (() => {
    const h = tidy(parsed?.headline).replace(/[."']+$/, "");
    if (h.length <= 48) return h;
    const cut = h.slice(0, 48);
    const sp = cut.lastIndexOf(" ");
    return (sp > 20 ? cut.slice(0, sp) : cut).replace(/[,;:\-–—]+$/, "");
  })();
  return {
    headline,
    caption: tidy(parsed?.caption),
    hashtags: tags
      .map((t) => tidy(t))
      .filter(Boolean)
      .map((t) => (t.startsWith("#") ? t : `#${t}`))
      .slice(0, 9),
  };
}

/** One piece of trade press, as it came off the wire. */
export type NewsInput = {
  title: string;
  excerpt: string;
  /** The publication's name, so the model knows who is talking. */
  source: string;
};

export type NewsSummary = {
  /** Rewritten headline, sentence case, at most 90 characters. */
  title: string;
  /** Two sentences, at most 260 characters. */
  summary: string;
  category: NewsCategory;
  /** True for advertisements, listings for sale, anything not about yachting — and for anything the model didn't answer on. */
  skip: boolean;
};

/** Cut a string back on a word boundary, never mid-word. */
function capAtWord(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  const kept = space > max * 0.6 ? cut.slice(0, space) : cut;
  return kept.replace(/[\s,;:\-–—]+$/, "");
}

/**
 * Rewrite a batch of trade-press items in the portal's register.
 *
 * Returns one entry per input, aligned by index. Anything the model declines
 * to answer on comes back `skip: true` rather than empty — a blank headline in
 * front of a broker is worse than one story fewer, and the daily job is happy
 * to leave an item out and pick it up tomorrow.
 *
 * Nothing here is published automatically beyond the feed itself: the weekly
 * piece that draws on these still waits for Charlie.
 */
export async function summarizeNews(items: NewsInput[]): Promise<NewsSummary[]> {
  // Skipping by default means a failed call costs nothing but a quiet morning.
  const out: NewsSummary[] = items.map<NewsSummary>(() => ({
    title: "",
    summary: "",
    category: "industry",
    skip: true,
  }));
  if (items.length === 0) return out;

  const system = [
    "You write for a portal used by yacht brokers.",
    "For each item return a headline (90 characters or fewer, sentence case, no source name, no clickbait)",
    "and a two-sentence summary (260 characters or fewer) stating what happened and why a broker would care.",
    "Plain, specific, calm — Burgess, not a dealership. Never invent figures.",
    "No exclamation marks, no emoji, no 'stunning', 'must-see' or 'don't miss'.",
    "Choose one category from: " + NEWS_CATEGORIES.join(", ") + ".",
    "Skip anything that is an advertisement, a listing for sale, or not about yachting; return skip:true for those.",
    "Reply with a JSON array only, one entry per item in order:",
    "[{\"i\":0,\"title\":\"...\",\"summary\":\"...\",\"category\":\"brokerage\",\"skip\":false}]",
  ].join(" ");

  const listed = items
    .map((it, i) => {
      const excerpt = it.excerpt ? it.excerpt.slice(0, 600) : "(no summary given)";
      return `Item ${i}\nSource: ${it.source}\nHeadline: ${it.title}\nText: ${excerpt}`;
    })
    .join("\n\n");

  const blocks: Block[] = [
    { type: "text", text: listed },
    { type: "text", text: `Rewrite all ${items.length} items. JSON array only.` },
  ];

  let reply: string;
  try {
    reply = await ask(blocks, { system, maxTokens: 200 + items.length * 140 });
  } catch {
    return out;
  }

  type NewsRow = { i?: number; title?: string; summary?: string; category?: string; skip?: boolean };
  const parsed = extractJson<(NewsRow | null)[]>(reply);
  if (!Array.isArray(parsed)) return out;

  for (let n = 0; n < parsed.length; n++) {
    const row = parsed[n];
    if (!row) continue;
    // Trust the model's index when it gives one, its ordering when it doesn't.
    const i = typeof row.i === "number" ? row.i : n;
    if (i < 0 || i >= items.length) continue;

    if (row.skip === true) continue;

    const title = capAtWord(typeof row.title === "string" ? row.title : "", 90);
    const rawSummary = typeof row.summary === "string" ? row.summary.trim() : "";
    // A summary cut short still has to read like a sentence.
    const summary =
      rawSummary.length <= 260
        ? rawSummary
        : (() => {
            const cut = capAtWord(rawSummary, 259);
            return /[.!?]$/.test(cut) ? cut : `${cut}.`;
          })();

    if (!title || !summary) continue;

    out[i] = {
      title,
      summary,
      // An invented category is discarded rather than trusted; "industry" is
      // the honest shelf for anything that didn't land on one of the others.
      category: isNewsCategory(row.category) ? row.category : "industry",
      skip: false,
    };
  }

  return out;
}

/** One item from the week's feed, as the weekly piece sees it. */
export type DigestItemInput = {
  title: string;
  summary: string;
  source: string;
  category: string;
};

/** The weekly piece, before anyone has read it. */
export type NewsDigestDraft = {
  /** One line, 60 characters or fewer, no date. */
  title: string;
  /** Two sentences. */
  intro: string;
  /** The piece itself: markdown paragraphs separated by a blank line. */
  body_md: string;
};

/**
 * Draft "Yachting this week" from the week's feed.
 *
 * This is the one thing in the news feature that a person still signs off:
 * the daily list is mechanical, but a piece written in our name and sent to
 * every broker is not. So this returns a draft and nothing else — no row is
 * approved, nothing is sent, and a null here just means Monday's draft isn't
 * ready and Charlie will hear about it when he opens the page.
 */
export async function draftNewsDigest(items: DigestItemInput[]): Promise<NewsDigestDraft | null> {
  if (items.length === 0) return null;

  const system = [
    // The voice, as written in docs/news-spec.md.
    'Write "Yachting this week" for yacht brokers, about 350 words, in the portal\'s voice:',
    "a one-line title (≤ 60 chars, no date), a two-sentence intro, then four to six short paragraphs",
    "each opening with the news and closing with what it means for someone selling boats.",
    "Cite sources inline as plain text in parentheses.",
    "No lists, no headings, no exclamation marks, no emoji.",
    "End with one calm sentence that points to the portal's Reel tool — never a hard sell.",
    // House rules for the shape of the answer, so it renders without surprises.
    "The body is markdown paragraphs separated by a blank line. *emphasis* and **strong** are the only marks:",
    "no headings, no links, no bullets, no numbered lists. Never invent figures, names or dates.",
    'Reply with JSON only: {"title":"...","intro":"...","body_md":"..."}',
  ].join(" ");

  const listed = items
    .map((it, i) => `Item ${i + 1} (${it.category}) — ${it.source}\n${it.title}\n${it.summary}`)
    .join("\n\n");

  const blocks: Block[] = [
    { type: "text", text: `This week's items:\n\n${listed}` },
    { type: "text", text: "Write the piece. JSON only." },
  ];

  let reply: string;
  try {
    reply = await ask(blocks, { system, maxTokens: 1400 });
  } catch {
    return null;
  }

  const parsed = extractJson<Partial<NewsDigestDraft>>(reply);
  if (!parsed) return null;

  const title = capAtWord(typeof parsed.title === "string" ? parsed.title : "", 60);

  const rawIntro = typeof parsed.intro === "string" ? parsed.intro.trim() : "";
  // A two-sentence intro that ran long still has to read like a sentence.
  const intro =
    rawIntro.length <= 320
      ? rawIntro
      : (() => {
          const cut = capAtWord(rawIntro, 319);
          return /[.?]$/.test(cut) ? cut : `${cut}.`;
        })();

  const body_md = (typeof parsed.body_md === "string" ? parsed.body_md : "").replace(/\r\n/g, "\n").trim();

  // Too short to be the piece we asked for: better no draft than a stub with
  // our name on it.
  if (!title || !intro || body_md.length < 200) return null;

  return { title, intro, body_md: body_md.slice(0, 8000) };
}
