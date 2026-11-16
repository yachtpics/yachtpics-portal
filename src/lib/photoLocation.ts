// Where a photo was taken, read from the location fields the photographer
// embeds (Lightroom / Photo Mechanic write them as XMP and as IPTC IIM).
//
// Pure functions, no imports, so they can be tested on their own
// (scripts/site_text_check.ts). The server side that reads a listing's cover
// photo and calls sharp is in src/lib/siteTextServer.ts.
//
// Only the SHOT location is read: photoshop:City / photoshop:State, the IPTC
// Extension LocationShown / LocationCreated City + ProvinceState, or IIM
// 2:90 City / 2:95 Province-State. The creator's contact address
// (Iptc4xmpCore:CiAdrCity = "North Palm Beach" on every YachtPics photo) is
// deliberately NOT read — it says where the photographer's office is, not
// where the boat is.

const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "puerto rico": "PR", "u.s. virgin islands": "VI", "us virgin islands": "VI",
};

/** "Florida" → "FL"; an existing two-letter US code is upper-cased; anything else is kept as written. */
export function stateShort(state: string): string {
  const s = state.trim().replace(/\s+/g, " ");
  const code = US_STATES[s.toLowerCase()];
  if (code) return code;
  if (/^[a-z]{2}$/i.test(s)) {
    const up = s.toUpperCase();
    for (const k in US_STATES) if (US_STATES[k] === up) return up;
  }
  return s;
}

/** "Jupiter" + "Florida" → "Jupiter, FL". City alone is fine; state alone is not a location. */
export function formatLocation(city: string | null | undefined, state: string | null | undefined): string | null {
  const c = clean(city);
  if (!c) return null;
  const st = clean(state);
  return st ? `${c}, ${stateShort(st)}` : c;
}

function clean(v: string | null | undefined): string {
  const s = (v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  // Placeholder values some presets leave behind.
  if (!s || s === "-" || /^(n\/?a|none|unknown|city|state)$/i.test(s)) return "";
  return s.length > 60 ? "" : s;
}

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** One XMP property, written either as an attribute (prop="v") or an element (<prop>v</prop>). */
function xmpProp(xmp: string, prop: string, scope?: string): string | null {
  const hay = scope ?? xmp;
  const esc = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attr = new RegExp(`[\\s<]${esc}\\s*=\\s*"([^"]*)"`).exec(hay) ?? new RegExp(`[\\s<]${esc}\\s*=\\s*'([^']*)'`).exec(hay);
  if (attr && attr[1].trim()) return decodeXml(attr[1]);
  const el = new RegExp(`<${esc}>([^<]*)</${esc}>`).exec(hay);
  if (el && el[1].trim()) return decodeXml(el[1]);
  return null;
}

/** The first LocationShown / LocationCreated block, if any (where the IPTC Extension keeps City). */
function xmpLocationBlock(xmp: string): string | null {
  const names = ["Iptc4xmpExt:LocationShown", "Iptc4xmpExt:LocationCreated"];
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    const start = xmp.indexOf(`<${n}`);
    if (start < 0) continue;
    const end = xmp.indexOf(`</${n}>`, start);
    return xmp.slice(start, end > start ? end : Math.min(xmp.length, start + 4000));
  }
  return null;
}

/** City + state from an XMP packet. */
export function locationFromXmp(xmp: string | null | undefined): { city: string | null; state: string | null } {
  if (!xmp) return { city: null, state: null };
  let city = xmpProp(xmp, "photoshop:City");
  let state = xmpProp(xmp, "photoshop:State");
  if (!clean(city)) {
    const block = xmpLocationBlock(xmp);
    if (block) {
      city = xmpProp(xmp, "Iptc4xmpExt:City", block);
      state = state ?? xmpProp(xmp, "Iptc4xmpExt:ProvinceState", block);
    }
  }
  return { city: clean(city) || null, state: clean(state) || null };
}

function decodeIimValue(bytes: number[]): string {
  // IIM text is UTF-8 in anything written this century (and on YachtPics
  // files); fall back to Latin-1 if it isn't valid UTF-8.
  const raw = String.fromCharCode.apply(null, bytes);
  try {
    return decodeURIComponent(escape(raw));
  } catch {
    return raw;
  }
}

/**
 * City (2:90) and Province-State (2:95) from raw IPTC IIM — what sharp's
 * metadata().iptc gives (the Photoshop "8BIM" resource block, with the IIM
 * records inside it) or a bare IIM stream. Every record is a 0x1C tag marker,
 * record number, dataset number and a 2-byte big-endian length.
 */
export function locationFromIptc(buf: Uint8Array | null | undefined): { city: string | null; state: string | null } {
  if (!buf || buf.length < 5) return { city: null, state: null };
  let city: string | null = null;
  let state: string | null = null;
  // Start at the IIM stream's first record (2:00 Record Version, length 2)
  // when it can be found, so stray bytes in the 8BIM header can't be misread.
  let start = 0;
  for (let j = 0; j + 5 <= buf.length; j++) {
    if (buf[j] === 0x1c && buf[j + 1] === 0x02 && buf[j + 2] === 0x00 && buf[j + 3] === 0x00 && buf[j + 4] === 0x02) { start = j; break; }
  }
  for (let i = start; i + 5 <= buf.length; i++) {
    if (buf[i] !== 0x1c || buf[i + 1] !== 0x02) continue;
    const ds = buf[i + 2];
    if (buf[i + 3] & 0x80) continue; // extended length — never used for these fields
    const len = (buf[i + 3] << 8) | buf[i + 4];
    if (i + 5 + len > buf.length) continue;
    if ((ds === 90 && city === null) || (ds === 95 && state === null)) {
      const bytes: number[] = [];
      for (let k = 0; k < len; k++) bytes.push(buf[i + 5 + k]);
      const v = clean(decodeIimValue(bytes)) || null;
      if (ds === 90) city = v;
      else state = v;
    }
    i += 4 + len; // skip this record's value (loop adds the last 1)
  }
  return { city, state };
}

/** "City, ST" from a photo's embedded metadata — XMP first, then IPTC IIM. Null if neither names a city. */
export function locationFromMetadata(meta: { xmp?: Uint8Array | string | null; iptc?: Uint8Array | null }): string | null {
  const xmpText = typeof meta.xmp === "string" ? meta.xmp : meta.xmp ? utf8(meta.xmp) : null;
  const x = locationFromXmp(xmpText);
  if (x.city) return formatLocation(x.city, x.state);
  const p = locationFromIptc(meta.iptc ?? null);
  return formatLocation(p.city, p.state);
}

function utf8(b: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(b);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}
