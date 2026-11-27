/**
 * Offline checks for "Upload to YouTube" (Nov 27, 2026): the pure pieces only.
 *   - metadata builders (src/lib/youtube/metadata.ts): missing fields, the
 *     100-character trim, never a location / price / description / contact;
 *   - the chunk planner (src/lib/youtube/resumable.ts): ranges cover the file
 *     exactly, every chunk but the last is a multiple of 256 KiB, resuming
 *     from a "Range: bytes=0-N" answer;
 *   - the OAuth state / CSRF helper (src/lib/youtube/oauthState.ts);
 *   - the Google error classifier.
 * No network, no database, no Google.
 *
 *   npx tsx scripts/youtube_upload_check.ts
 */
import { RESUMABLE_GRANULE, YOUTUBE_CHUNK_BYTES, YOUTUBE_TICK_BUDGET_MS, YOUTUBE_TITLE_MAX } from "../src/lib/youtube/config";
import { YACHTPICS_CREDIT, boatLine, offeredByLine, sanitizeDescription, sanitizeTitle, youtubeDescription, youtubeTitle } from "../src/lib/youtube/metadata";
import {
  classifyGoogleError, contentRange, nextChunk, planChunks, resumeOffsetFromRange, statusQueryRange, totalFromContentRange, videoContentType,
} from "../src/lib/youtube/resumable";
import { YOUTUBE_STATE_TTL_MS, makeState, newNonce, verifyState } from "../src/lib/youtube/oauthState";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else {
    failed++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const eq = (name: string, got: unknown, want: unknown) => check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ── metadata ────────────────────────────────────────────────────────────────
const everglade = { vessel_name: "Everglade", year: 2021, make: "Everglades", model: "365CC", length_ft: null };
eq("title: example from the brief", youtubeTitle(everglade), '2021 Everglades 365CC — "Everglade"');
eq("title: with length", youtubeTitle({ ...everglade, length_ft: 36 }), `2021 Everglades 365CC 36' — "Everglade"`);
eq("title: fractional length", boatLine({ year: 2019, make: "Viking", model: "68 C", length_ft: 68.5 }), "2019 Viking 68 C 68.5'");
eq("title: only a name", youtubeTitle({ vessel_name: "Sea Ray" }), '"Sea Ray"');
eq("title: no name", youtubeTitle({ year: 2020, make: "Boston Whaler", model: "330 Outrage" }), "2020 Boston Whaler 330 Outrage");
eq("title: nothing at all", youtubeTitle({}), "Listing video");
eq("title: make not doubled", boatLine({ make: "Everglades", model: "Everglades 365CC" }), "Everglades 365CC");
eq("title: string year ignored if bogus", boatLine({ year: "abc", make: "Hatteras" }), "Hatteras");
eq("title: angle brackets stripped", youtubeTitle({ vessel_name: "<Wave>" }), '"Wave"');
eq("title: whitespace collapsed", youtubeTitle({ vessel_name: "  Big   Blue " }), '"Big Blue"');

const longModel = "Sportfish Convertible Enclosed Bridge With Extended Cockpit And Every Option You Could Possibly Want";
const longT = youtubeTitle({ vessel_name: "Reel Therapy", year: 2018, make: "Bertram", model: longModel, length_ft: 61 });
check("title: trimmed to 100", longT.length <= YOUTUBE_TITLE_MAX, `${longT.length}: ${longT}`);
check("title: long boat line keeps the vessel name", longT.endsWith('— "Reel Therapy"'), longT);
const longName = youtubeTitle({ vessel_name: "X".repeat(140) });
check("title: very long name trimmed", longName.length <= YOUTUBE_TITLE_MAX, String(longName.length));

const broker = { first_name: "Kelly", last_name: "Sprigg", brokerage_name: "SYC Yachts" };
const desc = youtubeDescription(everglade, broker);
eq("description: full", desc, `2021 Everglades 365CC — "Everglade"\nOffered by Kelly Sprigg, SYC Yachts\n\n${YACHTPICS_CREDIT}`);
eq("description: broker without brokerage", offeredByLine({ first_name: "Wes", last_name: null }), "Offered by Wes");
eq("description: brokerage only", offeredByLine({ brokerage_name: "HMY Yachts" }), "Offered by HMY Yachts");
eq("description: no broker", youtubeDescription(everglade, null), `2021 Everglades 365CC — "Everglade"\n\n${YACHTPICS_CREDIT}`);
eq("description: nothing known", youtubeDescription({}, null), YACHTPICS_CREDIT);
// The builders never see location / price / description / contact, but a
// listing object carrying them must not leak them through.
const leaky = { ...everglade, location: "Palm Beach, FL", asking_price: 1250000, description: "Call 561-555-0100", email: "x@y.com" } as unknown as typeof everglade;
const leakyText = youtubeTitle(leaky) + "\n" + youtubeDescription(leaky, { ...broker, phone: "561-555-0100", display_email: "k@syc.com" } as unknown as typeof broker);
["Palm Beach", "1250000", "1,250,000", "$", "561", "@", "Call"].forEach((bad) => check(`no "${bad}" in the prefill`, leakyText.indexOf(bad) < 0, leakyText));
eq("sanitizeTitle: trims and caps", sanitizeTitle(`  ${"a".repeat(150)} `).length, 100);
eq("sanitizeTitle: non-string", sanitizeTitle(42), "");
eq("sanitizeDescription: strips <>", sanitizeDescription("a <b> c"), "a b c");
eq("sanitizeDescription: caps 5000", sanitizeDescription("x".repeat(6000)).length, 5000);

// ── chunk planner ───────────────────────────────────────────────────────────
check("chunk size is a multiple of 256 KiB", YOUTUBE_CHUNK_BYTES % RESUMABLE_GRANULE === 0);
eq("chunk size is 16 MiB", YOUTUBE_CHUNK_BYTES, 16 * 1024 * 1024);
check("tick budget well under 60 s", YOUTUBE_TICK_BUDGET_MS <= 40_000);

function coverCheck(label: string, total: number, offset = 0) {
  const chunks = planChunks(total, YOUTUBE_CHUNK_BYTES, offset);
  let at = offset;
  let ok = true;
  chunks.forEach((c, i) => {
    if (c.start !== at) ok = false;
    if (c.size !== c.end - c.start + 1) ok = false;
    const isLast = i === chunks.length - 1;
    if (c.last !== isLast) ok = false;
    if (!isLast && c.size % RESUMABLE_GRANULE !== 0) ok = false;
    if (!isLast && c.size !== YOUTUBE_CHUNK_BYTES) ok = false;
    at = c.end + 1;
  });
  check(`${label}: chunks cover the file exactly`, ok && at === total, `ended at ${at} of ${total}, ${chunks.length} chunks`);
  return chunks;
}
const MB = 1024 * 1024;
coverCheck("500 MB", 500 * MB);
coverCheck("exact multiple (64 MiB)", 64 * MB);
coverCheck("one byte", 1);
coverCheck("just under one chunk", YOUTUBE_CHUNK_BYTES - 1);
coverCheck("one chunk + 1 byte", YOUTUBE_CHUNK_BYTES + 1);
coverCheck("odd size 1.37 GB", 1_470_123_457);
coverCheck("resume mid-file at an odd byte", 300 * MB + 17, 123_456_789);
eq("500 MB = 32 chunks", planChunks(500 * MB, YOUTUBE_CHUNK_BYTES).length, 32);
eq("done file → no chunk", nextChunk(100, 100, YOUTUBE_CHUNK_BYTES), null);
eq("empty file → no chunk", nextChunk(0, 0, YOUTUBE_CHUNK_BYTES), null);
let threw = false;
try { nextChunk(0, 100, 1000); } catch { threw = true; }
check("non-256 KiB chunk size refused", threw);

eq("Range none → 0", resumeOffsetFromRange(null), 0);
eq("Range bytes=0-0 → 1", resumeOffsetFromRange("bytes=0-0"), 1);
eq("Range bytes=0-16777215 → 16777216", resumeOffsetFromRange("bytes=0-16777215"), 16 * MB);
eq("Range garbage → 0", resumeOffsetFromRange("nonsense"), 0);
eq("Range not from 0 → 0", resumeOffsetFromRange("bytes=5-10"), 0);
const resumed = nextChunk(resumeOffsetFromRange("bytes=0-16777215"), 40 * MB, YOUTUBE_CHUNK_BYTES);
eq("resume → next chunk starts at 16 MiB", resumed?.start, 16 * MB);
eq("resume → Content-Range", resumed ? contentRange(resumed, 40 * MB) : "", `bytes ${16 * MB}-${32 * MB - 1}/${40 * MB}`);
const tail = nextChunk(32 * MB, 40 * MB, YOUTUBE_CHUNK_BYTES);
eq("tail chunk is the last", tail?.last, true);
eq("tail chunk size", tail?.size, 8 * MB);
eq("status query range", statusQueryRange(12345), "bytes */12345");
eq("total from Content-Range", totalFromContentRange("bytes 0-0/52428800"), 52428800);
eq("total from missing Content-Range", totalFromContentRange(null), null);
eq("content type from header", videoContentType("a.mov", "video/mp4; codecs=avc1"), "video/mp4");
eq("content type .mov", videoContentType("Walk.MOV", "application/octet-stream"), "video/quicktime");
eq("content type default", videoContentType(null, null), "video/mp4");

// ── OAuth state / CSRF ──────────────────────────────────────────────────────
const secret = "test-client-secret";
const nonce = newNonce();
const t0 = 1_800_000_000_000;
const state = makeState({ n: nonce, u: "admin-1", r: "https://portal.yachtpics.com/api/admin/youtube/callback", t: t0 }, secret);
const good = verifyState(state, nonce, "admin-1", secret, t0 + 1000);
check("state: good", good.ok);
check("state: carries the redirect URI", good.ok && good.payload.r === "https://portal.yachtpics.com/api/admin/youtube/callback");
const why = (r: ReturnType<typeof verifyState>) => (r.ok ? "ok" : r.why);
eq("state: wrong cookie", why(verifyState(state, newNonce(), "admin-1", secret, t0 + 1000)), "cookie");
eq("state: no cookie", why(verifyState(state, undefined, "admin-1", secret, t0 + 1000)), "cookie");
eq("state: other admin", why(verifyState(state, nonce, "admin-2", secret, t0 + 1000)), "user");
eq("state: expired", why(verifyState(state, nonce, "admin-1", secret, t0 + YOUTUBE_STATE_TTL_MS + 1)), "expired");
eq("state: other secret", why(verifyState(state, nonce, "admin-1", "another-secret", t0 + 1000)), "signature");
const [payload, sig] = state.split(".");
const forged = Buffer.from(JSON.stringify({ n: nonce, u: "admin-2", r: "https://evil.example/cb", t: t0 })).toString("base64url");
eq("state: tampered payload", why(verifyState(`${forged}.${sig}`, nonce, "admin-2", secret, t0 + 1000)), "signature");
eq("state: missing", why(verifyState(null, nonce, "admin-1", secret, t0)), "missing");
eq("state: no signature", why(verifyState(payload, nonce, "admin-1", secret, t0)), "missing");
check("state: nonces differ", newNonce() !== newNonce());

// ── error classifier ────────────────────────────────────────────────────────
const gErr = (reason: string) => ({ error: { code: 403, errors: [{ reason }], message: "x" } });
eq("401 → refresh", classifyGoogleError(401, null, true).action, "refresh");
eq("403 quotaExceeded → fail", classifyGoogleError(403, gErr("quotaExceeded"), false).action, "fail");
check("403 quotaExceeded → plain words", /allowance/.test(classifyGoogleError(403, gErr("quotaExceeded"), false).message));
eq("403 uploadLimitExceeded → fail", classifyGoogleError(403, gErr("uploadLimitExceeded"), true).action, "fail");
check("403 youtubeSignupRequired → plain words", /channel/.test(classifyGoogleError(403, gErr("youtubeSignupRequired"), false).message));
eq("403 rateLimitExceeded → retry", classifyGoogleError(403, gErr("rateLimitExceeded"), true).action, "retry");
eq("403 unknown → fail", classifyGoogleError(403, gErr("somethingNew"), true).action, "fail");
eq("404 on session → restart", classifyGoogleError(404, null, true).action, "restart");
eq("410 on session → restart", classifyGoogleError(410, null, true).action, "restart");
eq("404 elsewhere → fail", classifyGoogleError(404, null, false).action, "fail");
eq("500 → retry", classifyGoogleError(500, null, true).action, "retry");
eq("503 → retry", classifyGoogleError(503, null, true).action, "retry");
eq("429 → retry", classifyGoogleError(429, null, true).action, "retry");
eq("network (0) → retry", classifyGoogleError(0, null, true).action, "retry");
eq("400 invalidTitle → fail", classifyGoogleError(400, { error: { errors: [{ reason: "invalidTitle" }] } }, false).action, "fail");
check("400 invalidTitle → says title", /title/.test(classifyGoogleError(400, { error: { errors: [{ reason: "invalidTitle" }] } }, false).message));
eq("reason from string error", classifyGoogleError(400, { error: "invalid_grant" }, false).reason, "invalid_grant");

// No exclamation marks in anything a person reads.
const texts = [desc, longT, classifyGoogleError(403, gErr("quotaExceeded"), false).message, classifyGoogleError(403, gErr("youtubeSignupRequired"), false).message];
check("no exclamation marks", texts.every((t) => t.indexOf("!") < 0));

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
