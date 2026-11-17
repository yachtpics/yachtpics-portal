/**
 * The portal's one door to a language/vision model. Kept deliberately thin —
 * plain fetch against the Anthropic Messages API, no SDK — so it can be swapped
 * or switched off by removing one environment variable.
 *
 *   ANTHROPIC_API_KEY   required; without it every helper reports "not configured"
 *   ANTHROPIC_MODEL     optional; defaults to a fast, inexpensive vision model
 *
 * Two jobs today:
 *   1. Label photographs with plain category names (so a broker's phone
 *      upload lands in the walk-through order without any typing).
 *   2. Draft a listing description from the specs and a few photographs, in
 *      the portal's understated register.
 */

import { NEWS_CATEGORIES, isNewsCategory, type NewsCategory } from "@/lib/newsSources";
import { AI_PHOTO_LABELS, normalizeAiPhotoLabel } from "@/lib/aiPhotoLabels";

const API = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5";
/** Website text drafts (draftSiteDescription). Override with SITE_TEXT_MODEL. */
const SITE_TEXT_DEFAULT_MODEL = "claude-sonnet-4-5";

export function isAiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export type Block =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "url"; url: string } };

async function ask(blocks: Block[], opts: { system: string; maxTokens: number; timeoutMs?: number; model?: string }): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("AI is not configured (ANTHROPIC_API_KEY is missing).");
  // Optional cap on the whole call, so a caller with a time budget (the photo
  // labelling route) can still answer before the platform cuts it off.
  const ctrl = opts.timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : null;
  try {
    return await askOnce(key, blocks, opts, ctrl?.signal);
  } catch (err) {
    if (ctrl?.signal.aborted) throw new Error("AI request took too long and was stopped.");
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function askOnce(key: string, blocks: Block[], opts: { system: string; maxTokens: number; model?: string }, signal?: AbortSignal): Promise<string> {
  const res = await fetch(API, {
    method: "POST",
    signal,
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
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
 * null where the model wasn't sure. The model may only use the short plain
 * vocabulary in src/lib/aiPhotoLabels.ts ("Stateroom", not "Master
 * Stateroom") — a photograph can't show which cabin or bathroom it is. A more
 * specific answer is mapped down to its plain label (normalizeAiPhotoLabel);
 * anything else is discarded rather than invented.
 */
export async function categorizePhotos(images: { url: string }[], opts: { timeoutMs?: number } = {}): Promise<(string | null)[]> {
  if (images.length === 0) return [];
  const system = [
    "You label photographs of yachts and boats for a broker's listing gallery.",
    "For each image, choose exactly one label from the list below. The broker can rename any photo afterwards, so a plain label that is right is far better than a specific one that might be wrong.",
    "Choose the most general label that is certainly true. Never guess which stateroom or head it is, which side of the boat, or which deck level unless it is unmistakable. If two labels fit, choose the more general one.",
    "If you are unsure, answer \"Other\".",
    "Labels:",
    ...AI_PHOTO_LABELS.map((l) => `- ${l.name}: ${l.means}.`),
    "- Other: none of the above, or you are not sure.",
    "Reply with a JSON array only, one entry per image in order: [{\"i\":0,\"label\":\"Salon\"},{\"i\":1,\"label\":\"Other\"}]",
  ].join("\n");

  const blocks: Block[] = [];
  images.forEach((img, i) => {
    blocks.push({ type: "text", text: `Image ${i}:` });
    blocks.push({ type: "image", source: { type: "url", url: img.url } });
  });
  blocks.push({ type: "text", text: `Label all ${images.length} images. JSON array only.` });

  const reply = await ask(blocks, { system, maxTokens: 60 + images.length * 24, timeoutMs: opts.timeoutMs });
  const parsed = extractJson<{ i: number; label: string | null }[]>(reply) ?? [];
  const out: (string | null)[] = images.map(() => null);
  for (const row of parsed) {
    if (typeof row?.i !== "number" || row.i < 0 || row.i >= images.length) continue;
    out[row.i] = normalizeAiPhotoLabel(row.label);
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

/**
 * What the website-text draft is allowed to know about a boat. Deliberately
 * NO description field: the broker's own listing description must never be
 * copied or paraphrased onto yachtpics.com, so it isn't sent at all. `make`
 * is the builder as the website shows it (displayMake: Valhalla → Valhalla
 * Boatworks).
 */
export type SiteDescribable = {
  vessel_name: string | null; vessel_type: string | null; year: number | null; make: string | null; model: string | null;
  length_ft: number | string | null; engines: string | null; staterooms: number | null; location: string | null;
  /** Distinct photo areas in gallery order (the Portal's own labels), and how many photos — grounds the text in the shoot. */
  areas?: string[]; photoCount?: number;
};

/** Website text length the prompt asks for (characters). */
export const SITE_TEXT_MIN = 160;
export const SITE_TEXT_MAX = 280;
/** The first sentence becomes the Google description on its own. */
export const SITE_TEXT_FIRST_SENTENCE_MAX = 150;
/** Post-processing: hard cap, and anything shorter than this is a failure. */
export const SITE_TEXT_HARD_CAP = 500;
export const SITE_TEXT_FLOOR = 80;

/**
 * The system and user text for a website-text draft — no model call, so it
 * can be printed and checked (scripts/site_text_check.ts). Photos follow the
 * facts as image blocks.
 */
/**
 * True when a boat's "name" is only her make / model / length / hull number
 * ("32 Galeon", "34 Jupiter 2026", "Valhalla V46-075") rather than a real name
 * ("Reel Weapon"). Such boats open with "This 32-foot Galeon…", not
 * "32 Galeon is a 32-foot Galeon".
 */
export function isModelOnlyName(name: string | null | undefined, make?: string | null, model?: string | null): boolean {
  const n = (name ?? "").trim();
  if (!n) return true;
  const known: Record<string, true> = {};
  const words = ((make ?? "") + " " + (model ?? "")).toLowerCase().split(/[^a-z0-9]+/);
  for (let i = 0; i < words.length; i++) if (words[i]) known[words[i]] = true;
  const generic: Record<string, true> = { boatworks: true, yachts: true, yacht: true, boats: true, marine: true, the: true, ft: true, foot: true };
  const tokens = n.toLowerCase().split(/[^a-z0-9]+/);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) continue;
    if (/\d/.test(t)) continue;          // lengths, years, hull numbers, "44fa", "v46"
    if (known[t] || generic[t]) continue; // the builder or model again
    return false;                         // a real word: she has a name
  }
  return true;
}

export function buildSiteDescriptionPrompt(listing: SiteDescribable, imageUrls: string[]): { system: string; facts: string; blocks: Block[] } {
  const unnamed = isModelOnlyName(listing.vessel_name, listing.make, listing.model);
  const facts = Object.entries({
    Name: unnamed ? "(none — this boat has no name)" : listing.vessel_name,
    Type: listing.vessel_type, Year: listing.year, Builder: listing.make, Model: listing.model,
    "Length (ft)": listing.length_ft, Engines: listing.engines, Staterooms: listing.staterooms, Location: listing.location,
    "Photographs in the gallery": listing.photoCount && listing.photoCount > 0 ? listing.photoCount : null,
    "Areas photographed (gallery order)": listing.areas && listing.areas.length ? listing.areas.join(", ") : null,
  }).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "").map(([k, v]) => `${k}: ${String(v).trim()}`).join("\n");

  const system = [
    "You write the short introduction for a yacht's page on yachtpics.com, the website of YachtPics, a yacht photography studio. The page is a gallery of YachtPics' photographs of that boat. Your text says what the boat is and what the photographs show. It is a caption for a photo shoot, not a sales listing.",
    `Length and form: exactly 2 sentences, ${SITE_TEXT_MIN}–${SITE_TEXT_MAX} characters in total. Plain prose only: no headings, lists, emojis, hashtags or exclamation marks, and no quotation marks around the text.`,
    `First sentence: say what the boat is, using ONLY the listing facts — her name if she has one, year, builder, model, length, and the location if one is given (as where she was photographed). It must stand on its own, be no longer than ${SITE_TEXT_FIRST_SENTENCE_MAX} characters, and say she was photographed by YachtPics. It is used alone as the Google description. If a fact is missing, leave it out; never fill it in.`,
    "Second sentence: one plain line on what the gallery shows — the main spaces, in the order of the areas listed, with at most two simple visible details chosen from colours (hull, deck, upholstery) and layout (where the helm, seating, galley or berths sit). Keep it plain. Do NOT name materials or finishes (no wood species, teak, stone, marble, leather, stainless), brands, equipment, or numbers of anything.",
    "Strict limits on facts. Everything about what the boat IS comes only from the listing facts: do not state or guess a model name, boat type, engine count or type, number of staterooms, range, speed, year or builder that is not in the facts — even if you think you recognise the boat or can count engines in a photo. No history, refits, upgrades, awards, condition claims, prices, availability or broker details. No word about price, value or cost.",
    "No judgements and no purpose claims. Do not say what the boat is built for, designed for, ideal for or capable of, and do not describe performance, comfort, efficiency, seaworthiness or how she would be used. Do not use evaluative words such as spacious, generous, ample, commanding, excellent, thoughtful, well-appointed, comfortable, luxurious, stunning, impressive, powerful, serious, practical, purposeful, elegant or beautiful. Do not praise the view, the light or the weather. Say what is there; let the photographs do the persuading.",
    "A boat with no name: when the Name fact says there is none, open with 'This' and the facts — for example 'This 32-foot Galeon was photographed by YachtPics in Palm Beach Gardens, Florida.' or 'This 2026 Jupiter 34 center console was photographed by YachtPics in Marco Island, Florida.' Never invent a name, never use the builder or model as if it were her name, and do not repeat the length or year twice.",
    "If you are not sure something is shown, leave it out. A shorter, plainer text is better than a guess.",
    "Voice: calm, exact, understated; third person; present tense. Refer to the boat by name, or as 'she' sparingly. Do not use the word 'walkthrough'. Vary the sentence openings; do not begin a sentence with 'The boat features' or 'Below deck,'.",
    "For tone only (an invented boat — do not reuse its wording): Sea Lark is a 2019 Example 52, photographed by YachtPics in Stuart, Florida. The gallery runs from her navy hull and open cockpit to the flybridge helm, then inside to a light salon with the galley aft and the staterooms forward.",
    "Reply with the text only.",
  ].join("\n");

  const blocks: Block[] = [{ type: "text", text: `Listing facts:\n${facts || "(none provided)"}` }];
  imageUrls.slice(0, 6).forEach((url, i) => {
    blocks.push({ type: "text", text: `Photo ${i + 1}:` });
    blocks.push({ type: "image", source: { type: "url", url } });
  });
  blocks.push({ type: "text", text: "Write the introduction." });
  return { system, facts, blocks };
}

/**
 * Tidy a model reply into website text: one paragraph, whitespace collapsed,
 * wrapping quotes stripped, capped at ~500 characters at a sentence end.
 * Throws when what's left is empty or too short to use (< 80 characters).
 */
export function cleanSiteDescription(raw: string | null | undefined): string {
  let t = (raw ?? "").replace(/\s+/g, " ").trim();
  // Wrapping quotes (straight or curly), possibly twice ("“…”").
  for (let k = 0; k < 2; k++) {
    const m = /^["'“‘«](.*)["'”’»]$/.exec(t);
    if (!m) break;
    t = m[1].trim();
  }
  if (t.length > SITE_TEXT_HARD_CAP) {
    const head = t.slice(0, SITE_TEXT_HARD_CAP);
    const m = head.match(/^[\s\S]*[.!?](?=\s|$)/);
    t = m ? m[0].trim() : "";
  }
  if (t.length < SITE_TEXT_FLOOR) {
    throw new Error(t ? "The AI draft came back too short to use — try again." : "The AI returned no usable text — try again.");
  }
  return t;
}

/**
 * Draft the yachtpics.com boat-page text (listings.site_description) from the
 * listing's facts and up to six photographs. Same client, model and settings
 * as draftDescription. Returns cleaned text; throws on failure.
 */
export async function draftSiteDescription(listing: SiteDescribable, imageUrls: string[]): Promise<string> {
  const { system, blocks } = buildSiteDescriptionPrompt(listing, imageUrls);
  // Public website copy is worth a stronger writer than the labelling model:
  // it follows the "facts only, no judgements" rules far more reliably. If the
  // override is refused (unknown model on this account), fall back quietly.
  const model = process.env.SITE_TEXT_MODEL || SITE_TEXT_DEFAULT_MODEL;
  let reply = "";
  try {
    reply = await ask(blocks, { system, maxTokens: 400, model });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (!/model/i.test(msg)) throw err;
  }
  // Refused model, or a reply with no text in it: use the Portal's everyday model.
  if (!reply.trim()) reply = await ask(blocks, { system, maxTokens: 400 });
  return cleanSiteDescription(reply);
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
