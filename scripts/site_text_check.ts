/**
 * Offline checks for the yachtpics.com website text (Nov 16, 2026). No AI
 * call, no database, no network.
 *
 *   npx tsx scripts/site_text_check.ts [photo.jpg ...]
 *
 * 1. Prints the website-text prompt (system + user text) for a sample listing.
 * 2. Runs the reply post-processing (cleanSiteDescription) on a table of cases.
 * 3. Runs the photo-location parser on a table of XMP / IPTC samples, and on
 *    any JPEGs given on the command line (read with sharp, like the server).
 */
import { buildSiteDescriptionPrompt, cleanSiteDescription } from "../src/lib/ai";
import { formatLocation, locationFromIptc, locationFromMetadata, locationFromXmp } from "../src/lib/photoLocation";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`}`);
}

// ─── 1. prompt ───────────────────────────────────────────────────────────────
const sample = {
  vessel_name: "Midnight Moon", vessel_type: "Motor Yacht", year: 2018, make: "Horizon", model: "FD85",
  length_ft: 85, engines: "Twin MTU 16V 2000 M86", staterooms: 5, location: "Jupiter, FL",
};
const p = buildSiteDescriptionPrompt(sample, ["https://example.invalid/1.jpg", "https://example.invalid/2.jpg"]);
console.log("=== SYSTEM ===\n" + p.system + "\n");
console.log("=== USER (text blocks; images shown as [image]) ===");
p.blocks.forEach((b) => console.log(b.type === "text" ? b.text : "[image]"));
console.log("");
check("prompt never carries a broker description", /Broker|notes/i.test(p.blocks.map((b) => (b.type === "text" ? b.text : "")).join("\n")), false);

// ─── 2. post-processing ──────────────────────────────────────────────────────
const good =
  "This 2018 Horizon FD85, Midnight Moon, was photographed in Jupiter, FL. The shoot moves from a broad flybridge with a shaded helm to an aft deck set for dining. Inside, a light, open salon leads to a full-beam master and four guest staterooms finished in pale oak.";
check("clean: passes good text through", cleanSiteDescription(good), good);
check("clean: collapses whitespace", cleanSiteDescription("  " + good.replace(/ /g, "  \n ") + " "), good);
check("clean: strips wrapping quotes", cleanSiteDescription(`"${good}"`), good);
check("clean: strips curly quotes", cleanSiteDescription(`“${good}”`), good);
const long = good + " " + good; // ~520 chars
const cut = cleanSiteDescription(long);
check("clean: caps at a sentence end ≤ 500", cut.length <= 500 && /[.!?]$/.test(cut), true);
const throws = (s: string) => {
  try { cleanSiteDescription(s); return false; } catch { return true; }
};
check("clean: empty → failure", throws(""), true);
check("clean: too short → failure", throws("A 2018 Horizon FD85."), true);
check("clean: 500+ with no sentence end → failure", throws("word ".repeat(120)), true);

// ─── 3. location parser ──────────────────────────────────────────────────────
// Real XMP fragment from a YachtPics website copy (85 Horizon "Midnight Moon"):
// note the creator contact city (North Palm Beach) must NOT be used.
const realXmp = `<rdf:Description rdf:about="" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"
   photoshop:DateCreated="2026-06-10T13:36:38"
   photoshop:City="Jupiter"
   photoshop:State="Florida"
   photoshop:Country="United States"
   Iptc4xmpCore:CountryCode="US">
   <Iptc4xmpCore:CreatorContactInfo
    Iptc4xmpCore:CiAdrRegion="Florida"
    Iptc4xmpCore:CiAdrCtry="USA"
    Iptc4xmpCore:CiAdrCity="North Palm Beach"/>
</rdf:Description>`;
check("xmp attr: Jupiter, Florida → Jupiter, FL", locationFromMetadata({ xmp: realXmp }), "Jupiter, FL");
check("xmp element form", locationFromMetadata({ xmp: "<photoshop:City>Stuart</photoshop:City><photoshop:State>FL</photoshop:State>" }), "Stuart, FL");
check(
  "xmp LocationShown (IPTC Ext)",
  locationFromMetadata({
    xmp: `<Iptc4xmpExt:LocationShown><rdf:Bag><rdf:li Iptc4xmpExt:City="Annapolis" Iptc4xmpExt:ProvinceState="Maryland"/></rdf:Bag></Iptc4xmpExt:LocationShown>`,
  }),
  "Annapolis, MD"
);
check("xmp: only creator address → null", locationFromXmp(`<x Iptc4xmpCore:CiAdrCity="North Palm Beach" Iptc4xmpCore:CiAdrRegion="Florida"/>`), { city: null, state: null });
check("xmp entities decoded", locationFromMetadata({ xmp: `<rdf:Description photoshop:City="Fort Lauderdale &amp; Co" photoshop:State="Florida"/>` }), "Fort Lauderdale & Co, FL");
check("non-US state kept as written", formatLocation("Nassau", "New Providence"), "Nassau, New Providence");
check("city only", formatLocation("Monaco", null), "Monaco");
check("state only → null", formatLocation("", "Florida"), null);

// IPTC IIM as sharp returns it: "Photoshop 3.0\0" + 8BIM 0x0404 resource with IIM records.
function iim(records: [number, string][]): Uint8Array {
  const parts: number[] = [];
  const push = (ds: number, bytes: number[]) => { parts.push(0x1c, 0x02, ds, (bytes.length >> 8) & 0xff, bytes.length & 0xff, ...bytes); };
  push(0, [0x00, 0x04]);
  records.forEach(([ds, v]) => push(ds, Array.from(Buffer.from(v, "utf8"))));
  const head = Array.from(Buffer.from("Photoshop 3.0\u00008BIM\u0004\u0004\u0000\u0000", "latin1"));
  const len = parts.length;
  return Uint8Array.from([...head, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff, ...parts]);
}
check("iptc: 2:90 Jupiter, 2:95 Florida → Jupiter, FL", locationFromMetadata({ iptc: iim([[25, "horizon"], [90, "Jupiter"], [95, "Florida"], [101, "United States"]]) }), "Jupiter, FL");
check("iptc: UTF-8 city", locationFromIptc(iim([[90, "Coral Gables – Old Cutler"], [95, "FL"]])), { city: "Coral Gables – Old Cutler", state: "FL" });
check("iptc: none → null", locationFromMetadata({ iptc: iim([[25, "boat"]]) }), null);
check("xmp wins over iptc", locationFromMetadata({ xmp: realXmp, iptc: iim([[90, "Stuart"], [95, "Florida"]]) }), "Jupiter, FL");
check("nothing → null", locationFromMetadata({}), null);

async function files() {
  const paths = process.argv.slice(2);
  if (!paths.length) return;
  const sharp = (await import("sharp")).default;
  for (const f of paths) {
    const m = await sharp(f).metadata();
    console.log(`file  ${f}: xmp → ${JSON.stringify(locationFromXmp(m.xmp ? m.xmp.toString("utf8") : null))} · iptc → ${JSON.stringify(locationFromIptc(m.iptc ?? null))} · result ${JSON.stringify(locationFromMetadata({ xmp: m.xmp ?? null, iptc: m.iptc ?? null }))}`);
  }
}

files().then(() => {
  console.log(failures ? `\n${failures} FAILED` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
});
