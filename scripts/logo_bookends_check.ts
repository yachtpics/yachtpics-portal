/**
 * Offline checks for logo bookends (Nov 25, 2026): the pure pieces only.
 *   - addBookends (src/lib/reelStack.ts): unit order, starts / total / flashes
 *     shifted by the opening frame, both joins a plain dissolve, the look's own
 *     units and transitions untouched (same objects, same holds).
 *   - bookendLogoRect (src/lib/logoBookends.ts): a stacked 992×537 mark and a
 *     wide 2974×398 mark in 1080×1920, 1080×1080, 1080×1350 and 1920×1080 —
 *     inside the frame, centred, the expected width.
 *   - bookendLogoHardToSee: white on navy reads, navy on navy warns, white on
 *     white warns, an opaque box never warns.
 * No network, no database.
 *
 *   npx tsx scripts/logo_bookends_check.ts
 */
import { addBookends, planSingles, planStack } from "../src/lib/reelStack";
import { bookendLogoHardToSee, bookendLogoRect, BOOKEND_CLOSE_SEC, BOOKEND_OPEN_SEC, BOOKEND_WIDE_ASPECT } from "../src/lib/logoBookends";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else { failed++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

// ── addBookends ──────────────────────────────────────────────────────────────
function checkTimeline(label: string, base: ReturnType<typeof planSingles>, fade: number) {
  const beforeUnits = base.units.slice();
  const beforeHolds = base.units.map((u) => u.hold);
  const beforeTrans = base.transitions.slice();
  const beforeStarts = base.starts.slice();
  const beforeTotal = base.total;
  const beforeFlashes = base.flashes.slice();
  const close = BOOKEND_CLOSE_SEC + fade;
  const tl = addBookends(base, { open: BOOKEND_OPEN_SEC, close, fade });
  const n = base.units.length;

  check(`${label}: two more units`, tl.units.length === n + 2);
  check(`${label}: opens on the opening bookend`, tl.units[0].kind === "bookend" && (tl.units[0] as { side: string }).side === "open");
  check(`${label}: ends on the closing bookend`, tl.units[n + 1].kind === "bookend" && (tl.units[n + 1] as { side: string }).side === "close");
  check(`${label}: end card is second to last`, tl.units[n].kind === "end");
  check(`${label}: look's units are the same objects, in order`, base.units.every((u, i) => tl.units[i + 1] === u));
  check(`${label}: look's holds untouched`, base.units.every((u, i) => u.hold === beforeHolds[i]));
  check(`${label}: input timeline not mutated`, base.units.length === beforeUnits.length && base.total === beforeTotal
    && base.starts.every((x, i) => x === beforeStarts[i]) && base.transitions.every((t, i) => t === beforeTrans[i])
    && base.flashes.every((f, i) => f === beforeFlashes[i]));
  check(`${label}: open hold`, near(tl.units[0].hold, BOOKEND_OPEN_SEC));
  check(`${label}: close hold = solid + fade`, near(tl.units[n + 1].hold, BOOKEND_CLOSE_SEC + fade));
  check(`${label}: total`, near(tl.total, beforeTotal + BOOKEND_OPEN_SEC + close), `${tl.total} vs ${beforeTotal + BOOKEND_OPEN_SEC + close}`);
  check(`${label}: starts[0] = 0`, tl.starts[0] === 0);
  check(`${label}: starts shifted by the open`, beforeStarts.every((x, i) => near(tl.starts[i + 1], x + BOOKEND_OPEN_SEC)));
  check(`${label}: close starts when the end card ends`, near(tl.starts[n + 1], beforeTotal + BOOKEND_OPEN_SEC));
  // Recomputed from holds, the starts agree.
  let t = 0;
  let consistent = true;
  tl.units.forEach((u, k) => { if (!near(tl.starts[k], t)) consistent = false; t += u.hold; });
  check(`${label}: starts consistent with holds`, consistent && near(t, tl.total));
  check(`${label}: one transition per join`, tl.transitions.length === tl.units.length - 1);
  check(`${label}: joins into and out of the bookends are a plain dissolve`,
    tl.transitions[0].type === "dissolve" && near(tl.transitions[0].dur, fade)
    && tl.transitions[tl.transitions.length - 1].type === "dissolve" && near(tl.transitions[tl.transitions.length - 1].dur, fade));
  check(`${label}: look's transitions are the same, in order`, base.transitions.every((tr, i) => tl.transitions[i + 1] === tr));
  check(`${label}: flashes shifted`, tl.flashes.length === beforeFlashes.length && beforeFlashes.every((f, i) => near(tl.flashes[i], f + BOOKEND_OPEN_SEC)));
  // Every flash still sits on a cut (a unit start).
  check(`${label}: flashes land on unit starts`, tl.flashes.every((f) => tl.starts.some((s) => near(s, f))));
}

const quiet = planSingles(12, { titleHold: 4.2, hold: 2.2, endHold: 3, dissolve: 0.55, burst: false, vocab: null, seed: 12 * 131 + 9 * 17 });
checkTimeline("reel, quiet singles", quiet, 0.55);
const energy = planSingles(14, { titleHold: 4.2, hold: 1.6, endHold: 3, dissolve: 0.55, burst: true, vocab: "energy", seed: 14 * 131 + 6 * 17 });
check("energy plan has flashes to shift", energy.flashes.length > 0, `${energy.flashes.length}`);
checkTimeline("reel, energy (burst + flash cuts)", energy, 0.55);
const film = planSingles(20, { titleHold: 5, hold: 2.6, endHold: 3, dissolve: 0.6, burst: false, vocab: null, seed: 20 * 131 + 9 * 17 });
checkTimeline("film, quiet singles", film, 0.6);
const stack = planStack(10, { heroHold: 4.2, beat: 1.7, endHold: 3, seed: 10 * 131 + 5 * 17 });
checkTimeline("reel, stack", stack, 0.55);
const empty = planSingles(0, { titleHold: 4.2, hold: 2, endHold: 3, dissolve: 0.55, burst: false, vocab: null, seed: 1 });
checkTimeline("end card only", empty, 0.55);

const addedReel = BOOKEND_OPEN_SEC + BOOKEND_CLOSE_SEC + 0.55;
const addedFilm = BOOKEND_OPEN_SEC + BOOKEND_CLOSE_SEC + 0.6;
check("reel adds 3.55 s", near(addedReel, 3.55));
check("film adds 3.6 s", near(addedFilm, 3.6));

// ── bookendLogoRect ──────────────────────────────────────────────────────────
const frames: [number, number][] = [[1080, 1920], [1080, 1080], [1080, 1350], [1920, 1080]];
// NOTE: 992×537 (SYC's stacked mark) is 1.85:1. BOOKEND_WIDE_ASPECT is 2.5 so
// it is sized as a STACKED mark, as approved; the wide mark is 7.47:1.
const marks: { name: string; w: number; h: number }[] = [
  { name: "stacked 992×537", w: 992, h: 537 },
  { name: "wide 2974×398", w: 2974, h: 398 },
];
const rows: string[] = [];
for (const m of marks) {
  for (const [W, H] of frames) {
    const r = bookendLogoRect(W, H, m.w, m.h);
    const label = `${m.name} in ${W}×${H}`;
    const short = Math.min(W, H);
    check(`${label}: inside the frame`, r.x >= -1e-6 && r.y >= -1e-6 && r.x + r.w <= W + 1e-6 && r.y + r.h <= H + 1e-6);
    check(`${label}: centred`, near(r.x + r.w / 2, W / 2, 1e-6) && near(r.y + r.h / 2, H / 2, 1e-6));
    check(`${label}: aspect kept`, near(r.w / r.h, m.w / m.h, 1e-6));
    let expectW: number;
    if (m.w / m.h >= BOOKEND_WIDE_ASPECT) {
      const maxW = 0.76 * Math.min(W, 1.25 * H);
      const maxH = 0.58 * short;
      expectW = Math.min(maxW, maxH * (m.w / m.h));
    } else {
      const box = 0.58 * short;
      expectW = Math.min(box, box * (m.w / m.h));
    }
    check(`${label}: width ${expectW.toFixed(1)}`, near(r.w, expectW, 1e-6), `${r.w}`);
    rows.push(`  ${label.padEnd(30)} → ${r.w.toFixed(1)} × ${r.h.toFixed(1)} at (${r.x.toFixed(1)}, ${r.y.toFixed(1)})`);
  }
}
// Spot values worked by hand.
console.log(`992×537 is ${(992 / 537).toFixed(3)}:1 → ${992 / 537 >= BOOKEND_WIDE_ASPECT ? "horizontal" : "stacked"} under the ${BOOKEND_WIDE_ASPECT} rule`);
check("992×537 in 1080×1920 is sized as stacked: 626.4 wide (58% of 1080)", near(bookendLogoRect(1080, 1920, 992, 537).w, 626.4, 1e-6));
check("a true stacked 1:1 mark in 1080×1920 is 626.4 wide (58% of 1080)", near(bookendLogoRect(1080, 1920, 600, 600).w, 626.4, 1e-6));
check("a 1.5:1 mark in 1080×1920 is 626.4 wide (58% box)", near(bookendLogoRect(1080, 1920, 900, 600).w, 626.4, 1e-6));
check("wide in 1080×1920 is 820.8 wide (76% of 1080)", near(bookendLogoRect(1080, 1920, 2974, 398).w, 820.8, 1e-6));
check("wide in 1920×1080 is 1026 wide (76% of 1.25 × 1080)", near(bookendLogoRect(1920, 1080, 2974, 398).w, 1026, 1e-6));
check("a 1.5:1 mark in 1920×1080 is 626.4 wide (58% box)", near(bookendLogoRect(1920, 1080, 900, 600).w, 626.4, 1e-6));
check("zero-size logo is harmless", bookendLogoRect(1080, 1920, 0, 0).w === 0);

// ── bookendLogoHardToSee ─────────────────────────────────────────────────────
function mark(w: number, h: number, rgb: [number, number, number], cover = 0.3): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const on = x < w * cover || cover >= 1;
      d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = on ? 255 : 0;
    }
  }
  return d;
}
check("white mark on navy reads", !bookendLogoHardToSee(mark(60, 30, [255, 255, 255]), 60, 30, "#040847"));
check("navy mark on navy warns", bookendLogoHardToSee(mark(60, 30, [8, 12, 80]), 60, 30, "#040847"));
check("white mark on white warns", bookendLogoHardToSee(mark(60, 30, [255, 255, 255]), 60, 30, "#ffffff"));
check("navy mark on white reads", !bookendLogoHardToSee(mark(60, 30, [8, 12, 80]), 60, 30, "#ffffff"));
check("opaque box never warns", !bookendLogoHardToSee(mark(60, 30, [8, 12, 80], 1), 60, 30, "#040847"));
check("empty image never warns", !bookendLogoHardToSee(new Uint8ClampedArray(60 * 30 * 4), 60, 30, "#040847"));

console.log(rows.join("\n"));
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
