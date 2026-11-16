// Alt text and description helpers for the yachtpics.com boat pages.
//
// Pure functions, no imports: siteTemplates.ts uses them, and they can be
// tested on their own (see docs/where-we-are.md, "yachtpics.com boat pages").
//
// Alt text reads "64′ Viking Reel Weapon — Cockpit": the boat, then what the
// photo shows. "What it shows" is the photo's category as the Portal shows
// it; for a photo still marked Other (or with none) we try a cleaned-up file
// name, and if that's noise, "yacht photo".

/** Section break inside alt text: an em dash with a space either side. */
const DASH = " — ";
/** Prime (′, U+2032) after the length, as on the page's spec line. */
const PRIME = "′";

/** Fallback when neither the category nor the file name says anything. */
export const GENERIC_PHOTO_WORDS = "yacht photo";

// Camera / export leftovers that never describe the photo.
const JUNK_WORDS = new Set([
  "img", "image", "images", "dsc", "dscn", "dscf", "dji", "gopr", "gopro", "gp", "pxl", "mvimg",
  "vid", "photo", "photos", "pic", "pics", "pano", "hdr", "raw", "edit", "edited", "final",
  "copy", "web", "hires", "hi", "res", "lo", "lowres", "highres", "lr", "ps", "export", "exported",
  "untitled", "yachtpics", "yp", "jpeg", "jpg", "png", "webp", "tif", "tiff", "heic", "dng",
  "full", "small", "large", "med", "medium", "crop", "cropped", "resized", "sharpened",
  "retouched", "version", "ver", "ft", "feet", "foot", "loa", "yacht", "yachts", "boat", "boats",
  "of", "the", "and",
]);

// Short forms photographers use for parts of a boat.
const ABBREV: Record<string, string> = {
  stbd: "starboard",
  stb: "starboard",
  fwd: "forward",
  mstr: "master",
  fb: "flybridge",
  er: "engine room",
  vip: "VIP",
};

// "profilest" = "profile st" = profile, starboard side. Only split a run-on
// word when the front is a known part of a boat and the back is a side.
const AREA_WORDS = [
  "profiles", "profile", "running", "aerial", "bow", "stern", "transom", "cockpit",
  "helm", "tower", "flybridge", "bridge", "foredeck", "deck", "engine", "salon", "galley",
];
const SIDE_SUFFIX: Record<string, string> = { st: "starboard", stbd: "starboard", stb: "starboard", pt: "port", port: "port" };

function splitRunOn(token: string): string[] {
  for (let a = 0; a < AREA_WORDS.length; a++) {
    const w = AREA_WORDS[a];
    if (token.length > w.length && token.indexOf(w) === 0) {
      const rest = token.slice(w.length);
      if (SIDE_SUFFIX[rest]) return [w, SIDE_SUFFIX[rest]];
    }
  }
  return [token];
}

function words(s: string | null | undefined): string[] {
  return (s ?? "")
    .toLowerCase()
    .replace(/['’"]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function titleCase(w: string): string {
  if (w === "VIP") return w;
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/**
 * A photo's file name turned into words, or null when what's left is noise.
 *
 *   "38_tiara_intubait_profilest_35.jpg" → "Profile Starboard"
 *   "64-Viking-Reel-Weapon-Master-Stateroom-03.jpg" → "Master Stateroom"
 *   "DSC_0412.JPG" → null
 *
 * Drops the extension, numbers (length, sequence), camera junk (IMG, DSC,
 * DJI…), the make and the vessel-name words, then title-cases the rest.
 */
export function cleanPhotoFilename(
  filename: string | null | undefined,
  boat: { make?: string | null; displayMake?: string | null; vesselName?: string | null } = {}
): string | null {
  if (!filename) return null;
  let base = filename.split(/[\\/]/).pop() ?? "";
  base = base.replace(/\.[a-z0-9]{2,5}$/i, "");
  // "Copy of …", "… copy", "… (2)"
  base = base.replace(/^copy of\s+/i, "");
  // camelCase / PascalCase → separate words ("MasterStateroom" → "Master Stateroom")
  base = base.replace(/([a-z])([A-Z])/g, "$1 $2");

  const drop = new Set<string>();
  words(boat.make).forEach((w) => drop.add(w));
  words(boat.displayMake).forEach((w) => drop.add(w));
  const nameWords = words(boat.vesselName);
  nameWords.forEach((w) => drop.add(w));
  if (nameWords.length > 1) drop.add(nameWords.join(""));

  const out: string[] = [];
  let tokens = words(base);
  // YachtPics names files "<length>_<make>_<name>_<area>_<n>". When the file
  // starts with a number and the vessel name turns up, everything up to the
  // name is that prefix — drop it even if the listing has no make on record.
  if (tokens.length && /^\d/.test(tokens[0]) && nameWords.length) {
    const joined = nameWords.join("");
    let end = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] === joined) { end = i; break; }
      if (tokens.slice(i, i + nameWords.length).join(" ") === nameWords.join(" ")) { end = i + nameWords.length - 1; break; }
    }
    if (end >= 0) tokens = tokens.slice(end + 1);
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/\d/.test(t)) continue; // 38, 35, 0412, dsc0412, 38ft, v2
    if (JUNK_WORDS.has(t) || drop.has(t)) continue;
    const parts = ABBREV[t] ? ABBREV[t].split(" ") : splitRunOn(t);
    for (let k = 0; k < parts.length; k++) out.push(parts[k]);
  }
  // Same word twice in a row ("salon salon") reads as a mistake.
  const deduped = out.filter((w, i) => i === 0 || w.toLowerCase() !== out[i - 1].toLowerCase());
  const letters = deduped.join("").replace(/[^a-z]/gi, "");
  if (letters.length < 3) return null;
  return deduped.slice(0, 6).map(titleCase).join(" ");
}

/**
 * The boat part of the alt text: "64′ Viking Reel Weapon". Missing pieces are
 * left out cleanly. A hull-number "name" that already carries the make and a
 * number ("25 Sportsman Open 252 28276") is used as-is, as boatLabel does.
 */
export function altBoatName(opts: {
  lengthFt?: string | null;
  make?: string | null;
  displayMake?: string | null;
  vesselName?: string | null;
}): string {
  const len = (opts.lengthFt ?? "").toString().trim();
  const make = (opts.displayMake ?? opts.make ?? "").trim();
  let name = (opts.vesselName ?? "").trim();
  // The page falls back to the label ("64 Viking") when a boat has no name.
  if (name && name === [len, (opts.make ?? "").trim()].filter(Boolean).join(" ")) name = "";
  const rawMake = (opts.make ?? "").trim().toLowerCase();
  if (name && rawMake && name.toLowerCase().indexOf(rawMake) >= 0 && /\d/.test(name)) return name;
  return [len ? `${len}${PRIME}` : "", make, name].filter(Boolean).join(" ");
}

/** What the photo shows: its category, else a cleaned file name, else "yacht photo". */
export function photoSubject(
  photo: { category?: string | null; filename?: string | null } | null | undefined,
  boat: { make?: string | null; displayMake?: string | null; vesselName?: string | null }
): string {
  const cat = (photo?.category ?? "").trim();
  if (cat && cat.toLowerCase() !== "other") return cat;
  return cleanPhotoFilename(photo?.filename, boat) ?? GENERIC_PHOTO_WORDS;
}

/** Full alt text: "64′ Viking Reel Weapon — Cockpit". */
export function photoAlt(
  boat: { lengthFt?: string | null; make?: string | null; displayMake?: string | null; vesselName?: string | null },
  photo: { category?: string | null; filename?: string | null } | null | undefined
): string {
  const head = altBoatName(boat);
  const what = photoSubject(photo, boat);
  return head ? `${head}${DASH}${what}` : what.charAt(0).toUpperCase() + what.slice(1);
}

// ─── Descriptions ───────────────────────────────────────────────────────────

/** Google shows about this many characters of a meta description. */
export const META_DESCRIPTION_MAX = 155;

/** One line, whitespace collapsed. */
export function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Cut to at most `max` characters at a word boundary, adding "…" only when
 * something was cut.
 */
export function cutAtWord(s: string, max: number = META_DESCRIPTION_MAX): { text: string; cut: boolean } {
  const t = oneLine(s);
  if (t.length <= max) return { text: t, cut: false };
  // Prefer ending on a whole sentence when one finishes late enough to still
  // fill most of Google's snippet — "…kept under cover." reads better than
  // "…kept under cover. Upgrades…".
  const windowText = t.slice(0, max);
  const m = windowText.match(/^[\s\S]*[.!?](?=\s|$)/);
  if (m && m[0].length >= 60) return { text: m[0], cut: true };
  let head = t.slice(0, max - 1); // leave room for the ellipsis
  // Only back up to a space if the cut landed mid-word.
  if (t.charAt(max - 1) !== " ") {
    const sp = head.lastIndexOf(" ");
    if (sp > max * 0.5) head = head.slice(0, sp);
  }
  head = head.replace(/[\s,;:\-–—]+$/, "");
  return { text: `${head}…`, cut: true };
}

/** Does the text already name this place (the whole thing, or the town before the comma)? */
export function mentionsLocation(text: string, location: string): boolean {
  const t = text.toLowerCase();
  const loc = location.trim().toLowerCase().replace(/\.+$/, "");
  if (!loc) return true;
  if (t.indexOf(loc) >= 0) return true;
  const town = loc.split(",")[0].trim();
  return town.length >= 3 && t.indexOf(town) >= 0;
}

/**
 * Meta description from the broker's/owner's own description: one line, cut
 * at a word to 155. Their words are never changed; the location is added as
 * " Lying Palm Beach, FL." only when the text doesn't mention it, wasn't cut,
 * ends a sentence, and it all still fits.
 */
export function customMetaDescription(description: string, location?: string | null): string {
  const { text, cut } = cutAtWord(description);
  const loc = (location ?? "").trim().replace(/\.+$/, "");
  if (!cut && loc && /[.!?]$/.test(text) && !mentionsLocation(text, loc)) {
    const withLoc = `${text} Lying ${loc}.`;
    if (withLoc.length <= META_DESCRIPTION_MAX) return withLoc;
  }
  return text;
}

/** Paragraphs of a typed description: split on blank lines, trimmed, empties dropped. */
export function descriptionParagraphs(description: string): string[] {
  return description
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
