/**
 * Original music for reels — composed in the browser, owned by YachtPics.
 *
 * A small deterministic composer built on the Web Audio API. Nothing is
 * sampled or licensed: every sound is synthesized here (oscillators, filtered
 * noise, a generated reverb), so a track made by this file belongs to
 * YachtPics and a broker can post it anywhere without a copyright claim.
 *
 * composeReelMusic({ durationSec, cutTimesSec, mood, seed, endCardStartSec })
 * renders a stereo 48 kHz AudioBuffer exactly `durationSec` long in an
 * OfflineAudioContext (a 45 s reel takes a second or two). Same inputs and
 * seed → the same music, sample for sample; "Try another" changes the seed.
 *
 * How it is put together:
 *   • Key, mode and chord progression come from the seed (Imaj7–vi7–IVmaj7–
 *     V9sus and a few relatives; Cinematic sometimes takes a minor key).
 *   • Tempo comes from the mood's range, and is FITTED to the reel: every
 *     tempo in the range and every beat phase is scored by how close the
 *     reel's cuts fall to a beat, and the best grid wins — so cuts land on
 *     the music. (Stack looks pass 120 BPM, the grid reelStack already uses.)
 *   • Layers: a warm pad (detuned saw + triangle through a slowly opening
 *     low-pass, rootless 7th/9th voicings in a comfortable middle register),
 *     a soft FM-light keys arpeggio with a stereo ping-pong delay, a sub bass
 *     on the roots (with a gentle octave so phone speakers carry it), and for
 *     Elegant / Upbeat (and a soft pulse in Cinematic) a quiet rhythm — round
 *     kick, filtered-noise shaker, a soft snap on 2 and 4 for Upbeat.
 *   • Arrangement: a 1–2 bar pad swell, the bass and sparse keys after it, a
 *     build at the bar nearest the cut closest to a quarter of the way in,
 *     a soft bell on cuts that land on a beat, a filtered riser into the end
 *     card, then IV–V(sus) → tonic exactly on the end card and a 2–3 s fade
 *     that ends exactly at durationSec.
 *   • Master: high-pass, a gentle DynamicsCompressor, then a level pass after
 *     rendering (RMS toward roughly -14 LUFS, soft-limited to peaks ≤ -1 dBFS).
 */
import type { StyleKey } from "@/lib/reelStyles";

export type MusicMood = "calm" | "cinematic" | "elegant" | "upbeat" | "groove" | "lift" | "throttle";
export type MusicChoice = "off" | "auto" | MusicMood;

export const MUSIC_MOODS: MusicMood[] = ["calm", "cinematic", "elegant", "upbeat", "groove", "lift", "throttle"];
export const MUSIC_CHOICES: MusicChoice[] = ["off", "auto", "calm", "cinematic", "elegant", "upbeat", "groove", "lift", "throttle"];
export const MUSIC_LABEL: Record<MusicChoice, string> = {
  off: "Off",
  auto: "Auto",
  calm: "Calm",
  cinematic: "Cinematic",
  elegant: "Elegant",
  upbeat: "Upbeat",
  groove: "Groove",
  lift: "Lift",
  throttle: "Throttle",
};

/** One line on what each mood sounds like (shown under the picker). */
export const MUSIC_BLURB: Record<MusicMood, string> = {
  calm: "Soft, warm and spacious",
  cinematic: "Slow, wide and dramatic",
  elegant: "Light and refined, with a gentle beat",
  upbeat: "Bright, with a steady beat",
  groove: "Modern hip-hop beat with deep bass",
  lift: "Bright, building, uplifting",
  throttle: "Fast, punchy, high-energy",
};

/**
 * Each look's own mood — what "Auto" means. Groove, Lift (Oct 6) and Throttle
 * (Oct 7) are never a look's default: they're picked on purpose.
 */
const LOOK_MOOD: Record<StyleKey, MusicMood> = {
  walkthrough: "calm",
  classic: "calm",
  cinematic: "cinematic",
  marquee_still: "cinematic",
  editorial: "elegant",
  marquee: "elegant",
  gallery: "elegant",
  energy: "upbeat",
  stack: "upbeat",
  stack_underway: "upbeat",
  underway: "upbeat",
};

export function moodForLook(look: StyleKey): MusicMood {
  return LOOK_MOOD[look] ?? "elegant";
}

/** The mood a choice plays for a look; null for Off. */
export function resolveMood(choice: MusicChoice, look: StyleKey): MusicMood | null {
  if (choice === "off") return null;
  if (choice === "auto") return moodForLook(look);
  return choice;
}

export function isMusicChoice(v: unknown): v is MusicChoice {
  return typeof v === "string" && MUSIC_CHOICES.indexOf(v as MusicChoice) >= 0;
}

/** A stable 32-bit seed from any string (FNV-1a). */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The next "Try another" seed after `seed`. */
export function nextMusicSeed(seed: number): number {
  return (Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) + 0x2545f491) >>> 0;
}

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
function offlineCtor(): OfflineCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  return w.OfflineAudioContext ?? w.webkitOfflineAudioContext ?? null;
}

/** Whether this browser can compose at all (Web Audio offline rendering). */
export function musicCanCompose(): boolean {
  return offlineCtor() !== null;
}

export type ComposeOptions = {
  durationSec: number;
  /** Every cut / join in the reel, seconds from the start (any order). */
  cutTimesSec: number[];
  mood: MusicMood;
  seed: number;
  /** When the end card arrives; the music resolves to the tonic exactly here. */
  endCardStartSec?: number | null;
  /** Force a tempo (Stack looks: 120, the grid reelStack is timed to). */
  bpm?: number | null;
};

export const MUSIC_SAMPLE_RATE = 48000;

// ── Small helpers ─────────────────────────────────────────────────────────

function mulberry32(a: number): () => number {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mod = (a: number, n: number) => ((a % n) + n) % n;

type MoodParams = {
  tempo: [number, number];
  /** Bars per chord. */
  harmonic: 1 | 2;
  /** Keys note spacing, in beats (A section / build). */
  keysStep: [number, number];
  keysDecay: number;
  keysLevel: number;
  padCut: number;
  padLevel: number;
  reverbSec: number;
  reverbWet: number;
  delayWet: number;
  rhythm: "none" | "pulse" | "soft" | "full" | "groove" | "lift" | "throttle";
  minorChance: number;
  riser: number;
};

const MOOD: Record<MusicMood, MoodParams> = {
  calm:      { tempo: [76, 84],  harmonic: 2, keysStep: [1, 0.5],   keysDecay: 1.9, keysLevel: 0.18, padCut: 1300, padLevel: 0.05,  reverbSec: 3.0, reverbWet: 0.42, delayWet: 0.22, rhythm: "none",  minorChance: 0,    riser: 0.045 },
  cinematic: { tempo: [76, 82],  harmonic: 2, keysStep: [2, 1],     keysDecay: 2.6, keysLevel: 0.19, padCut: 1100, padLevel: 0.058, reverbSec: 3.8, reverbWet: 0.5,  delayWet: 0.2,  rhythm: "pulse", minorChance: 0.4,  riser: 0.07 },
  elegant:   { tempo: [88, 96],  harmonic: 1, keysStep: [1, 0.5],   keysDecay: 1.5, keysLevel: 0.18, padCut: 1700, padLevel: 0.045, reverbSec: 2.6, reverbWet: 0.36, delayWet: 0.2,  rhythm: "soft",  minorChance: 0,    riser: 0.055 },
  upbeat:    { tempo: [98, 104], harmonic: 1, keysStep: [0.5, 0.5], keysDecay: 1.1, keysLevel: 0.16, padCut: 2000, padLevel: 0.04,  reverbSec: 1.9, reverbWet: 0.28, delayWet: 0.18, rhythm: "full",  minorChance: 0,    riser: 0.065 },
  // Groove: modern melodic hip-hop, minor only — 808 sub, busy hats, a chopped lead (see composeGrooveLayers).
  groove:    { tempo: [106, 110], harmonic: 2, keysStep: [1, 0.5],  keysDecay: 1.2, keysLevel: 0.16, padCut: 750,  padLevel: 0.03,  reverbSec: 2.2, reverbWet: 0.3,  delayWet: 0.22, rhythm: "groove", minorChance: 1,  riser: 0.05 },
  // Lift: bright 4-on-the-floor, major only — filtered pluck intro, riser, drop on a cut (see composeLiftLayers).
  lift:      { tempo: [134, 138], harmonic: 2, keysStep: [0.5, 0.5], keysDecay: 0.4, keysLevel: 0.15, padCut: 1200, padLevel: 0.032, reverbSec: 2.4, reverbWet: 0.32, delayWet: 0.2, rhythm: "lift", minorChance: 0, riser: 0.045 },
  // Throttle: fast and relentless for go-fasts — minor or mixolydian (see composeThrottleLayers).
  throttle:  { tempo: [148, 154], harmonic: 1, keysStep: [0.5, 0.5], keysDecay: 0.3, keysLevel: 0.12, padCut: 1500, padLevel: 0.018, reverbSec: 1.6, reverbWet: 0.22, delayWet: 0.12, rhythm: "throttle", minorChance: 0.5, riser: 0.05 },
};

type Chord = { root: number; pad: number[]; arp: number[] };
const MAJ: Record<string, Chord> = {
  I:    { root: 0, pad: [4, 7, 11, 14], arp: [0, 4, 7, 11, 14] },
  ii:   { root: 2, pad: [3, 7, 10, 14], arp: [0, 3, 7, 10] },
  iii:  { root: 4, pad: [3, 7, 10],     arp: [0, 3, 7, 10] },
  IV:   { root: 5, pad: [4, 7, 11, 14], arp: [0, 4, 7, 11, 14] },
  Vsus: { root: 7, pad: [5, 7, 10, 14], arp: [0, 5, 7, 10] },
  vi:   { root: 9, pad: [3, 7, 10, 14], arp: [0, 3, 7, 10] },
};
const MIN: Record<string, Chord> = {
  i:      { root: 0,  pad: [3, 7, 10, 14], arp: [0, 3, 7, 10, 14] },
  III:    { root: 3,  pad: [4, 7, 11, 14], arp: [0, 4, 7, 11] },
  iv:     { root: 5,  pad: [3, 7, 10, 14], arp: [0, 3, 7, 10] },
  VI:     { root: 8,  pad: [4, 7, 11, 14], arp: [0, 4, 7, 11, 14] },
  VIIsus: { root: 10, pad: [5, 7, 10, 14], arp: [0, 5, 7, 10] },
};
const MAJ_PROGS = [
  ["I", "vi", "IV", "Vsus"],
  ["I", "IV", "vi", "Vsus"],
  ["vi", "IV", "I", "Vsus"],
  ["I", "iii", "IV", "Vsus"],
  ["IV", "I", "Vsus", "vi"],
  ["I", "Vsus", "vi", "IV"],
];
const MIN_PROGS = [
  ["i", "VI", "III", "VIIsus"],
  ["i", "iv", "VI", "VIIsus"],
  ["VI", "VIIsus", "i", "III"],
];
const KEYS_PATTERNS = [
  [0, 1, 2, 3, 2, 1, 2, 3],
  [0, 2, 1, 3, 2, 4, 3, 1],
  [0, 1, 2, 1, 3, 2, 1, 2],
  [0, 2, 3, 1, 2, 3, 4, 2],
];
const TONICS = [0, 2, 3, 5, 7, 9, 10]; // C D Eb F G A Bb

/**
 * Fit a beat grid to the cuts: the tempo (in the mood's range, or the one
 * given) and beat phase whose beats sit closest to the reel's cuts, then the
 * downbeat that puts the most cuts on bar lines.
 */
function fitGrid(cuts: number[], p: MoodParams, fixedBpm: number | null, rand: () => number): { bpm: number; phase: number } {
  const tempos: number[] = [];
  if (fixedBpm) tempos.push(fixedBpm);
  else for (let b = p.tempo[0]; b <= p.tempo[1]; b++) tempos.push(b);
  const mid = (p.tempo[0] + p.tempo[1]) / 2;
  let best = { bpm: fixedBpm ?? Math.round(mid), phase: 0, score: Infinity };
  for (let ti = 0; ti < tempos.length; ti++) {
    const bpm = tempos[ti];
    const beat = 60 / bpm;
    const phases = [0].concat(cuts.map((c) => mod(c, beat)));
    for (let pi = 0; pi < phases.length; pi++) {
      const ph = phases[pi];
      let sc = 0;
      for (let ci = 0; ci < cuts.length; ci++) {
        const d = Math.abs(mod(cuts[ci] - ph + beat / 2, beat) - beat / 2);
        sc += Math.min(d, 0.12) / 0.12; // a cut more than 120 ms off counts the same however far
      }
      sc = sc / Math.max(1, cuts.length);
      if (!fixedBpm) sc += 0.03 * Math.abs(bpm - mid) / Math.max(1, p.tempo[1] - p.tempo[0]);
      sc += rand() * 0.004;
      if (sc < best.score) best = { bpm, phase: ph, score: sc };
    }
  }
  // Which of the four beats is the downbeat: the one with most cuts on it.
  const beat = 60 / best.bpm;
  let bestK = 0, bestHits = -1;
  for (let k = 0; k < 4; k++) {
    const ph = best.phase + k * beat;
    let hits = 0;
    for (let ci = 0; ci < cuts.length; ci++) {
      const d = Math.abs(mod(cuts[ci] - ph + 2 * beat, 4 * beat) - 2 * beat);
      if (d < 0.09) hits++;
    }
    if (hits > bestHits) { bestHits = hits; bestK = k; }
  }
  return { bpm: best.bpm, phase: mod(best.phase + bestK * beat, 4 * beat) };
}

function makePan(ctx: BaseAudioContext, v: number): AudioNode {
  const c = ctx as BaseAudioContext & { createStereoPanner?: () => StereoPannerNode };
  if (typeof c.createStereoPanner === "function") {
    const p = c.createStereoPanner();
    p.pan.value = v;
    return p;
  }
  return ctx.createGain();
}

function makeImpulse(ctx: BaseAudioContext, sec: number, rand: () => number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sec * sr);
  const pre = Math.floor(0.012 * sr);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let y = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / (len - pre);
      const x = (rand() * 2 - 1) * Math.exp(-6.9 * t);
      // The tail darkens as it decays, like a real room.
      const a = 0.62 - 0.5 * t;
      y += a * (x - y);
      d[i] = y;
    }
  }
  return buf;
}

// ── The composer ──────────────────────────────────────────────────────────

export async function composeReelMusic(opts: ComposeOptions): Promise<AudioBuffer> {
  const Ctor = offlineCtor();
  if (!Ctor) throw new Error("This browser can’t make music (no Web Audio).");
  const SR = MUSIC_SAMPLE_RATE;
  const dur = Math.max(2, opts.durationSec);
  const length = Math.max(1, Math.round(dur * SR));
  const p = MOOD[opts.mood];
  const groove = opts.mood === "groove";
  const lift = opts.mood === "lift";
  const throttle = opts.mood === "throttle";
  const rand = mulberry32((opts.seed >>> 0) ^ seedFromString(opts.mood));
  const jitter = (amt: number) => (rand() - 0.5) * 2 * amt;

  const cuts = Array.from(new Set(opts.cutTimesSec.filter((c) => isFinite(c) && c > 0.3 && c < dur - 0.3).map((c) => Math.round(c * 1000) / 1000))).sort((a, b) => a - b);

  // Key, mode, progression.
  const tonicPc = TONICS[Math.floor(rand() * TONICS.length)];
  const minor = rand() < p.minorChance;
  const table = minor ? MIN : MAJ;
  const prog = (minor ? MIN_PROGS : MAJ_PROGS)[Math.floor(rand() * (minor ? MIN_PROGS.length : MAJ_PROGS.length))].map((k) => table[k]);
  const tonic = minor ? MIN.i : MAJ.I;
  const dominant = minor ? MIN.VIIsus : MAJ.Vsus;
  const predominant = minor ? MIN.VI : MAJ.IV;
  const keysPattern = KEYS_PATTERNS[Math.floor(rand() * KEYS_PATTERNS.length)];

  // The grid.
  const grid = fitGrid(cuts, p, opts.bpm ?? null, rand);
  // Lift: the drop lands ON a cut — the one nearest 45% (preferring 40–50%) —
  // and the grid is turned so that cut is a downbeat.
  let liftDrop: number | null = null;
  if (lift) {
    const target = dur * 0.45;
    let bestD = Infinity;
    cuts.forEach((ct) => {
      const inBand = ct >= dur * 0.4 && ct <= dur * 0.5;
      const d = Math.abs(ct - target) + (inBand ? 0 : 1000);
      if (ct >= dur * 0.3 && ct <= dur * 0.6 && d < bestD) { bestD = d; liftDrop = ct; }
    });
    if (liftDrop === null) liftDrop = target;
    grid.phase = mod(liftDrop, 4 * 60 / grid.bpm);
  }
  const beat = 60 / grid.bpm;
  const bar = beat * 4;
  const firstBar = grid.phase - Math.ceil(grid.phase / bar) * bar; // ≤ 0
  const nearestBeat = (t: number) => grid.phase + Math.round((t - grid.phase) / beat) * beat;
  const nearestBar = (t: number) => grid.phase + Math.round((t - grid.phase) / bar) * bar;

  // Sections.
  let E = opts.endCardStartSec ?? NaN;
  if (!isFinite(E) || E <= 1 || E > dur - 0.8) E = Math.max(dur * 0.85, dur - 3);
  // Land the end card on its beat when the beat is within a hair of it.
  if (Math.abs(nearestBeat(E) - E) < 0.04) E = nearestBeat(E);
  // Throttle ends on a big hit and a short tail, not a long fade.
  const fadeSec = throttle ? Math.min(0.35, Math.max(0.1, dur - E)) : clamp(dur - E, 2, 3);
  const fadeStart = Math.max(0.1, dur - fadeSec);
  let introEnd = firstBar + (bar >= 2.6 ? 1 : 2) * bar;
  while (introEnd < 1.6) introEnd += bar;
  introEnd = Math.min(introEnd, E * 0.5);
  // Throttle: at most a one-bar pickup, then straight in on the first bar line.
  if (throttle) introEnd = Math.min(firstBar + bar, E * 0.5);
  const quarter = dur * 0.25;
  let anchor = quarter;
  let anchorD = dur * 0.12;
  cuts.forEach((c) => { const d = Math.abs(c - quarter); if (d < anchorD) { anchorD = d; anchor = c; } });
  let buildStart = nearestBar(anchor);
  if (buildStart < introEnd) buildStart = introEnd;
  if (buildStart > E - bar) buildStart = Math.max(introEnd, E - bar);
  if (lift && liftDrop !== null) buildStart = clamp(liftDrop, introEnd, Math.max(introEnd, E - bar));
  if (throttle) buildStart = introEnd;

  // Chord segments up to the end card: bar lines, grouped by harmonic rhythm.
  const barLines: number[] = [];
  for (let t = firstBar; t < E - 1e-3; t += bar) barLines.push(t);
  if (barLines.length > 1 && E - barLines[barLines.length - 1] < 0.4 * bar) barLines.pop();
  // A pickup of under ~half a bar before the first bar line joins the first
  // chord, so the opening swell isn't cut short by a chord change.
  if (barLines.length > 2 && barLines[1] < 0.6 * bar) barLines.splice(1, 1);
  const segStarts: number[] = [];
  let chordOffset = 0;
  if (lift) {
    // Lift: a chord change exactly at the drop…
    let di = 0;
    barLines.forEach((bl, i) => { if (Math.abs(bl - buildStart) < Math.abs(barLines[di] - buildStart)) di = i; });
    for (let i = 0; i < barLines.length; i++) if (i === 0 || mod(i - di, 2) === 0) segStarts.push(barLines[i]);
    const dSeg = segStarts.indexOf(barLines[di]);
    // …on the home chord: the drop resolves to I wherever it sits in the progression.
    chordOffset = mod(Math.max(0, prog.indexOf(tonic)) - Math.max(0, dSeg), prog.length);
  } else {
    for (let i = 0; i < barLines.length; i += p.harmonic) segStarts.push(barLines[i]);
  }
  const segs: Seg[] = segStarts.map((s, i) => ({ start: s, end: i + 1 < segStarts.length ? segStarts[i + 1] : E, chord: prog[(i + chordOffset) % prog.length] }));
  // The cadence: …IV (or VI) → V sus (or VII sus) → tonic on the end card.
  if (segs.length >= 3) { segs[segs.length - 1].chord = dominant; segs[segs.length - 2].chord = predominant; }
  else if (segs.length === 2) segs[1].chord = dominant;
  if (segs.length > 0 && segs[0].chord === dominant) segs[0].chord = tonic;
  segs.push({ start: E, end: dur, chord: tonic });
  // Throttle has its own harmony (minor or mixolydian, bVII → I into the end card).
  if (throttle) assignThrottleChords(segs, minor, rand);
  const chordAt = (t: number): Chord => {
    for (let i = segs.length - 1; i >= 0; i--) if (t >= segs[i].start - 1e-4) return segs[i].chord;
    return segs[0].chord;
  };

  let ctx: OfflineAudioContext | null = new Ctor(2, length, SR);
  try {
    const c = ctx;
    // ── Buses ──
    const master = c.createGain();
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 28; hp.Q.value = 0.7;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 10; comp.ratio.value = 3; comp.attack.value = 0.02; comp.release.value = 0.25;
    if (throttle) { comp.threshold.value = -20; comp.ratio.value = 4; comp.attack.value = 0.006; comp.release.value = 0.12; }
    if (lift) { comp.threshold.value = -19; comp.ratio.value = 3.5; comp.attack.value = 0.012; comp.release.value = 0.2; }
    if (groove) { comp.threshold.value = -20; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.18; }
    const fade = c.createGain();
    master.connect(hp); hp.connect(comp); comp.connect(fade); fade.connect(c.destination);
    fade.gain.setValueAtTime(0, 0);
    fade.gain.linearRampToValueAtTime(1, 0.04);
    const curve = new Float32Array(64);
    for (let i = 0; i < 64; i++) curve[i] = Math.cos((i / 63) * Math.PI / 2);
    fade.gain.setValueCurveAtTime(curve, fadeStart, Math.max(0.05, dur - fadeStart - 0.002));

    const reverb = c.createConvolver();
    reverb.buffer = makeImpulse(c, p.reverbSec, rand);
    const reverbRet = c.createGain(); reverbRet.gain.value = p.reverbWet * 2.5; // the convolver normalizes its impulse, which runs quiet
    reverb.connect(reverbRet); reverbRet.connect(master);

    // Stereo ping-pong delay for the keys.
    const delayIn = c.createGain(); delayIn.gain.value = 1;
    const dTime = Math.min(1.2, beat * 0.75);
    const dl = c.createDelay(2); dl.delayTime.value = dTime;
    const dr = c.createDelay(2); dr.delayTime.value = dTime;
    const fbL = c.createGain(); fbL.gain.value = 0.32;
    const fbR = c.createGain(); fbR.gain.value = 0.32;
    const dlp = c.createBiquadFilter(); dlp.type = "lowpass"; dlp.frequency.value = 2600;
    const panL = makePan(c, -0.65), panR = makePan(c, 0.65);
    const delayRet = c.createGain(); delayRet.gain.value = p.delayWet;
    delayIn.connect(dlp); dlp.connect(dl);
    dl.connect(panL); dl.connect(fbL); fbL.connect(dr);
    dr.connect(panR); dr.connect(fbR); fbR.connect(dl);
    panL.connect(delayRet); panR.connect(delayRet);
    delayRet.connect(master); delayRet.connect(reverb);

    // ── Pad ──
    const padBus = c.createGain();
    const padLp = c.createBiquadFilter(); padLp.type = "lowpass"; padLp.Q.value = 0.6;
    padBus.connect(padLp);
    const padOut = c.createGain(); padOut.gain.value = 1;
    padLp.connect(padOut); padOut.connect(master);
    const padSend = c.createGain(); padSend.gain.value = 0.6; padLp.connect(padSend); padSend.connect(reverb);
    padBus.gain.setValueAtTime(0.25, 0);
    padBus.gain.linearRampToValueAtTime(1, Math.max(0.5, introEnd));
    padBus.gain.setValueAtTime(1, buildStart);
    padBus.gain.linearRampToValueAtTime(1.12, buildStart + bar);
    const cut0 = p.padCut;
    padLp.frequency.setValueAtTime(320, 0);
    padLp.frequency.exponentialRampToValueAtTime(cut0, Math.max(0.6, introEnd));
    padLp.frequency.setValueAtTime(cut0, buildStart);
    padLp.frequency.exponentialRampToValueAtTime(cut0 * 1.45, buildStart + bar);
    const riserLen = clamp(bar, 1.2, 2.4);
    const riserAt = Math.max(buildStart + bar, E - riserLen);
    padLp.frequency.setValueAtTime(cut0 * 1.45, riserAt);
    padLp.frequency.exponentialRampToValueAtTime(cut0 * 1.9, E);
    if (E + 1.2 < dur - 0.1) padLp.frequency.exponentialRampToValueAtTime(cut0 * 1.1, E + 1.2);
    padLp.frequency.exponentialRampToValueAtTime(Math.max(500, cut0 * 0.6), dur);

    const padVoice = (midi: number, t0: number, t1: number, pan: number, attack: number) => {
      const f = mtof(midi);
      const g = c.createGain();
      const pn = makePan(c, pan);
      g.connect(pn); pn.connect(padBus);
      const o1 = c.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = f; o1.detune.value = -7;
      const o2 = c.createOscillator(); o2.type = opts.mood === "cinematic" ? "sawtooth" : "triangle"; o2.frequency.value = f; o2.detune.value = 7;
      const g1 = c.createGain(); g1.gain.value = 0.55;
      o1.connect(g1); g1.connect(g); o2.connect(g);
      const start = Math.max(0, t0 - 0.05);
      const lvl = p.padLevel;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(lvl, start + attack);
      // Plain ramps only (no setTargetAtTime): chained target curves are
      // where Web Audio engines disagree, and one misbehaved in testing.
      const relAt = Math.max(start + attack, t1);
      g.gain.setValueAtTime(lvl, relAt);
      g.gain.linearRampToValueAtTime(0, relAt + 1.4);
      const stop = Math.min(dur, relAt + 1.5);
      o1.start(start); o2.start(start); o1.stop(stop); o2.stop(stop);
    };
    segs.forEach((sg, i) => {
      const rootPc = mod(tonicPc + sg.chord.root, 12);
      const tones = sg.chord.pad.map((iv) => { const pc = mod(rootPc + iv, 12); return 55 + mod(pc - 55, 12); }).sort((a, b) => a - b);
      const attack = i === 0 ? Math.max(1.2, Math.min(2.6, introEnd)) : 0.9;
      const end = i === segs.length - 1 ? dur + 1 : sg.end;
      tones.forEach((m, k) => padVoice(m, sg.start, end, (k / Math.max(1, tones.length - 1) - 0.5) * 0.7, attack));
    });

    // ── Bass ──
    const bassBus = c.createGain(); bassBus.gain.value = 0.08;
    const bassLp = c.createBiquadFilter(); bassLp.type = "lowpass"; bassLp.frequency.value = 420; bassLp.Q.value = 0.5;
    bassBus.connect(bassLp); bassLp.connect(master);
    const bassNote = (midi: number, t0: number, len: number, vel: number) => {
      const f = mtof(midi);
      const g = c.createGain();
      g.connect(bassBus);
      const o = c.createOscillator(); o.type = "sine"; o.frequency.value = f;
      const o8 = c.createOscillator(); o8.type = "triangle"; o8.frequency.value = f * 2;
      const g8 = c.createGain(); g8.gain.value = 0.28;
      o.connect(g); o8.connect(g8); g8.connect(g);
      const s0 = Math.max(0, t0);
      g.gain.setValueAtTime(0, s0);
      g.gain.linearRampToValueAtTime(vel, s0 + 0.03);
      const off = s0 + Math.max(0.08, len);
      const settle = Math.min(off, s0 + 0.6);
      g.gain.linearRampToValueAtTime(vel * 0.78, settle);
      g.gain.setValueAtTime(vel * 0.78, off);
      g.gain.linearRampToValueAtTime(0, off + 0.25);
      const stop = Math.min(dur, off + 0.3);
      if (stop > s0) { o.start(s0); o8.start(s0); o.stop(stop); o8.stop(stop); }
    };
    segs.forEach((sg) => {
      if (groove || lift || throttle) return; // Groove's low end is its 808; Lift and Throttle have their own ducked bass (below)
      const s0 = Math.max(sg.start, introEnd);
      if (sg.end <= s0) return;
      const midi = 33 + mod(tonicPc + sg.chord.root - 33, 12);
      if (sg.start >= E - 1e-4) { bassNote(midi, sg.start, dur - sg.start, 1); return; }
      const busy = (opts.mood === "upbeat" || opts.mood === "elegant") && s0 >= buildStart - 1e-3;
      if (!busy) { bassNote(midi, s0, sg.end - s0 - 0.05, 0.9); return; }
      for (let b = sg.start; b < sg.end - 1e-3; b += bar) {
        if (b < s0 - 1e-3) continue;
        const hits = opts.mood === "upbeat" ? [0, 1.5, 2] : [0, 2];
        hits.forEach((h, k) => {
          const t = b + h * beat;
          if (t >= sg.end - 0.05) return;
          const next = k + 1 < hits.length ? b + hits[k + 1] * beat : b + bar;
          bassNote(midi, t, Math.min(next, sg.end) - t - 0.06, k === 0 ? 0.95 : 0.7);
        });
      }
    });

    // ── Keys ──
    const keysBus = c.createGain(); keysBus.gain.value = 1;
    const keysLp = c.createBiquadFilter(); keysLp.type = "lowpass"; keysLp.frequency.value = 4800;
    keysBus.connect(keysLp); keysLp.connect(master);
    const keysSend = c.createGain(); keysSend.gain.value = 0.55; keysLp.connect(keysSend); keysSend.connect(reverb);
    const keysDelay = c.createGain(); keysDelay.gain.value = 1; keysLp.connect(keysDelay); keysDelay.connect(delayIn);
    const keyNote = (midi: number, t0: number, vel: number, decay: number, pan: number) => {
      const s0 = Math.max(0, t0);
      if (s0 >= dur - 0.05) return;
      const f = mtof(midi);
      const car = c.createOscillator(); car.type = "sine"; car.frequency.value = f;
      const modO = c.createOscillator(); modO.type = "sine"; modO.frequency.value = f * 2;
      const modG = c.createGain();
      modG.gain.setValueAtTime(f * 1.1, s0);
      modG.gain.exponentialRampToValueAtTime(f * 0.08, s0 + 0.45);
      modO.connect(modG); modG.connect(car.frequency);
      const tri = c.createOscillator(); tri.type = "triangle"; tri.frequency.value = f;
      const triG = c.createGain(); triG.gain.value = 0.25;
      tri.connect(triG);
      const g = c.createGain();
      const pn = makePan(c, pan);
      car.connect(g); triG.connect(g); g.connect(pn); pn.connect(keysBus);
      const peak = p.keysLevel * vel;
      g.gain.setValueAtTime(0, s0);
      g.gain.linearRampToValueAtTime(peak, s0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, s0 + decay);
      const stop = Math.min(dur, s0 + decay + 0.05);
      car.start(s0); modO.start(s0); tri.start(s0); car.stop(stop); modO.stop(stop); tri.stop(stop);
    };
    const keyTones = (ch: Chord): number[] => {
      const rootPc = mod(tonicPc + ch.root, 12);
      const base = 60 + mod(rootPc - 60, 12);
      let tones = ch.arp.map((iv) => base + iv);
      if (tones[tones.length - 1] > 84) tones = tones.map((m) => m - 12);
      return tones;
    };
    const keysFrom = introEnd;
    if (!groove && !lift && !throttle) {
      const sub = 0.5 * beat; // walk the eighth-note grid; each section plays a subset
      let t = grid.phase + Math.ceil((keysFrom - grid.phase) / sub - 1e-6) * sub;
      for (; t < E - 0.02; t += sub) {
        const inBuild = t >= buildStart - 1e-3;
        const stepBeats = inBuild ? p.keysStep[1] : p.keysStep[0];
        const posBeats = mod(Math.round((t - grid.phase) / beat * 2) / 2, 4); // 0, 0.5 … 3.5 within the bar
        if (mod(posBeats, stepBeats) > 1e-3) continue;
        const onBeat = mod(posBeats, 1) < 1e-3;
        // The A section breathes: some off-beat notes are left out.
        if (!inBuild && !onBeat && rand() < 0.5) continue;
        if (!inBuild && posBeats !== 0 && rand() < 0.15) continue;
        if (inBuild && !onBeat && rand() < 0.08) continue;
        const ch = chordAt(t);
        const tones = keyTones(ch);
        const k = keysPattern[mod(Math.round((t - grid.phase) / (stepBeats * beat)), keysPattern.length)] % tones.length;
        const accent = posBeats === 0 ? 1 : onBeat ? 0.85 : 0.68;
        const vel = clamp(accent * (1 + jitter(0.12)) * (inBuild ? 1 : 0.85), 0.3, 1.1);
        keyNote(tones[k], t + jitter(0.008), vel, p.keysDecay, jitter(0.35));
      }
    }
    // The landing: a rolled tonic chord on the end card, left to ring.
    if (!groove && !lift && !throttle) {
      const tones = keyTones(tonic);
      tones.slice(0, 4).forEach((m, i) => keyNote(m, E + i * 0.07 + jitter(0.006), 0.9 - i * 0.08, Math.min(3.5, dur - E + 0.2), (i - 1.5) * 0.18));
    }
    // A soft bell on cuts that land on a beat (no more than one a bar).
    if (!groove && !lift && !throttle) {
      let last = -Infinity;
      cuts.forEach((ct) => {
        if (ct < introEnd || ct >= E - 0.2) return;
        if (Math.abs(nearestBeat(ct) - ct) > 0.06) return;
        if (ct - last < bar * 0.95) return;
        last = ct;
        const ch = chordAt(ct + 0.01);
        const tones = keyTones(ch);
        const m = tones[Math.min(tones.length - 1, 2)] + 12;
        keyNote(m, ct, 0.55, Math.min(2.2, p.keysDecay + 0.6), jitter(0.4));
      });
    }

    // ── Rhythm ──
    const noise = c.createBuffer(1, SR, SR);
    { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1; }
    const rhythmBus = c.createGain(); rhythmBus.gain.value = 0.6;
    rhythmBus.connect(master);
    const rhythmSend = c.createGain(); rhythmSend.gain.value = 0.18; rhythmBus.connect(rhythmSend); rhythmSend.connect(reverb);
    const kick = (t0: number, vel: number) => {
      const s0 = Math.max(0, t0);
      const o = c.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(115, s0);
      o.frequency.exponentialRampToValueAtTime(46, s0 + 0.1);
      const g = c.createGain();
      g.gain.setValueAtTime(0, s0);
      g.gain.linearRampToValueAtTime(0.5 * vel, s0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.34);
      o.connect(g); g.connect(rhythmBus);
      o.start(s0); o.stop(Math.min(dur, s0 + 0.4));
    };
    const shaker = (t0: number, vel: number) => {
      const s0 = Math.max(0, t0);
      const src = c.createBufferSource(); src.buffer = noise;
      const hpf = c.createBiquadFilter(); hpf.type = "highpass"; hpf.frequency.value = 6500;
      const bp = c.createBiquadFilter(); bp.type = "peaking"; bp.frequency.value = 9000; bp.gain.value = -4;
      const g = c.createGain();
      const pn = makePan(c, 0.22);
      g.gain.setValueAtTime(0, s0);
      g.gain.linearRampToValueAtTime(0.05 * vel, s0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.07);
      src.connect(hpf); hpf.connect(bp); bp.connect(g); g.connect(pn); pn.connect(rhythmBus);
      src.start(s0, rand() * 0.8); src.stop(Math.min(dur, s0 + 0.09));
    };
    const snap = (t0: number, vel: number) => {
      const s0 = Math.max(0, t0);
      const src = c.createBufferSource(); src.buffer = noise;
      const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 0.9;
      const g = c.createGain();
      g.gain.setValueAtTime(0, s0);
      g.gain.linearRampToValueAtTime(0.09 * vel, s0 + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.13);
      src.connect(bp); bp.connect(g); g.connect(rhythmBus);
      const extra = c.createGain(); extra.gain.value = 1.2; g.connect(extra); extra.connect(reverb);
      src.start(s0, rand() * 0.8); src.stop(Math.min(dur, s0 + 0.16));
      const body = c.createOscillator(); body.type = "sine"; body.frequency.value = 190;
      const bg = c.createGain();
      bg.gain.setValueAtTime(0, s0);
      bg.gain.linearRampToValueAtTime(0.05 * vel, s0 + 0.003);
      bg.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.08);
      body.connect(bg); bg.connect(rhythmBus);
      body.start(s0); body.stop(Math.min(dur, s0 + 0.1));
    };
    if (p.rhythm !== "none" && !groove && !lift && !throttle) {
      const sub = 0.5 * beat;
      const from = p.rhythm === "full" ? introEnd : buildStart;
      let t = grid.phase + Math.ceil((from - grid.phase) / sub - 1e-6) * sub;
      for (; t < E - 0.05; t += sub) {
        const inBuild = t >= buildStart - 1e-3;
        const pos = mod(Math.round((t - grid.phase) / beat * 2) / 2, 4);
        const onBeat = mod(pos, 1) < 1e-3;
        const h = jitter(0.006);
        if (p.rhythm === "pulse") {
          if (inBuild && pos === 0) kick(t, 0.55);
          continue;
        }
        // Shaker on the eighths, off-beats leaning forward.
        const shVel = (onBeat ? 0.6 : 1) * (1 + jitter(0.15)) * (inBuild ? 1 : 0.6) * (p.rhythm === "soft" ? 0.8 : 1);
        shaker(t + h, shVel);
        if (!inBuild) continue;
        if (p.rhythm === "soft") {
          if (pos === 0) kick(t, 0.5);
          else if (pos === 2) kick(t, 0.32);
        } else {
          if (pos === 0 || pos === 2) kick(t, pos === 0 ? 0.8 : 0.65);
          if (pos === 2.5 && rand() < 0.3) kick(t, 0.4);
          if (pos === 1 || pos === 3) snap(t + h, 0.9 * (1 + jitter(0.1)));
        }
      }
    }

    if (groove) {
      composeGrooveLayers({
        c, master, reverb, delayIn, noise, rand, jitter, dur, beat, bar, phase: grid.phase,
        introEnd, buildStart, E, segs, tonicPc, tonicRoot: tonic.root, level: p.keysLevel,
      });
    }

    if (lift) {
      composeLiftLayers({
        c, master, reverb, delayIn, noise, padOut, rand, jitter, dur, beat, bar, phase: grid.phase,
        introEnd, drop: buildStart, E, segs, tonicPc, tonic, level: p.keysLevel,
      });
    }

    if (throttle) {
      composeThrottleLayers({
        c, master, reverb, delayIn, noise, padOut, rand, jitter, dur, beat, bar, phase: grid.phase,
        introEnd, E, segs, cuts, tonicPc, minor, level: p.keysLevel,
      });
    }

    // ── Riser into the end card, and the landing underneath it ──
    // (Throttle swooshes into every cut, the end card included, on its own.)
    if (!throttle) {
      const t0 = Math.max(0, E - riserLen);
      const src = c.createBufferSource(); src.buffer = noise; src.loop = true;
      const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.6;
      bp.frequency.setValueAtTime(500, t0);
      bp.frequency.exponentialRampToValueAtTime(6000, E);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(p.riser, E - 0.02);
      g.gain.linearRampToValueAtTime(0, E + 0.18);
      const pn = makePan(c, 0);
      src.connect(bp); bp.connect(g); g.connect(pn); pn.connect(master);
      const rs = c.createGain(); rs.gain.value = 0.8; g.connect(rs); rs.connect(reverb);
      src.start(t0); src.stop(Math.min(dur, E + 0.6));
      // A soft low bloom under the tonic (Groove lands on its 808 instead).
      if (!groove && !lift && !throttle) {
      const o = c.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(62, E);
      o.frequency.exponentialRampToValueAtTime(44, E + 0.6);
      const og = c.createGain();
      og.gain.setValueAtTime(0, E);
      og.gain.linearRampToValueAtTime(0.22, E + 0.01);
      og.gain.exponentialRampToValueAtTime(0.0001, E + 1.4);
      o.connect(og); og.connect(master);
      o.start(E); o.stop(Math.min(dur, E + 1.5));
      }
    }

    const rendered = await new Promise<AudioBuffer>((resolve, reject) => {
      c.oncomplete = (e) => resolve(e.renderedBuffer);
      try {
        const pr = c.startRendering() as Promise<AudioBuffer> | undefined;
        if (pr && typeof pr.then === "function") pr.then(resolve, reject);
      } catch (err) { reject(err); }
    });
    c.oncomplete = null;
    // Groove's weight is in the sub, which plain RMS over-counts: it is levelled
    // by K-weighted loudness (BS.1770) to -14 LUFS instead (Lift too, with a
    // lower sample ceiling so its true peak stays under -1 dBTP). Other moods: as before.
    levelMaster(rendered, Math.floor(SR * Math.max(0, introEnd)), Math.floor(SR * fadeStart), groove || lift || throttle ? -14 : null, lift ? -1.6 : throttle ? THROTTLE_CEIL_DB : -1);
    return rendered;
  } finally {
    // An OfflineAudioContext has no close(); dropping the reference lets every
    // node and buffer it built be collected now that rendering is over.
    ctx = null;
  }
}

/**
 * The level pass: bring the body of the track (intro and fade left out of the
 * measurement) to an RMS of about -16 dBFS — about -14 LUFS for this mix
 * (measured) — then soft-limit so no sample passes -1 dBFS.
 */
function levelMaster(buf: AudioBuffer, from: number, to: number, lufsTarget: number | null = null, ceilDb = -1) {
  const chans: Float32Array[] = [];
  for (let ch = 0; ch < buf.numberOfChannels; ch++) chans.push(buf.getChannelData(ch));
  const n = buf.length;
  let a = clamp(from, 0, n), b = clamp(to, 0, n);
  if (b - a < buf.sampleRate) { a = 0; b = n; }
  let sum = 0, cnt = 0, peak = 0;
  for (let ch = 0; ch < chans.length; ch++) {
    const d = chans[ch];
    for (let i = 0; i < n; i++) {
      const v = d[i];
      const av = v < 0 ? -v : v;
      if (av > peak) peak = av;
      if (i >= a && i < b) { sum += v * v; cnt++; }
    }
  }
  if (cnt === 0 || peak < 1e-6) return;
  const rms = Math.sqrt(sum / cnt);
  if (rms < 1e-7) return;
  let wanted: number;
  if (lufsTarget !== null) {
    let ms = 0;
    for (let ch = 0; ch < chans.length; ch++) ms += kWeightedMeanSquare(chans[ch], a, b);
    const lufs = -0.691 + 10 * Math.log10(Math.max(1e-12, ms));
    wanted = Math.pow(10, (lufsTarget - lufs) / 20);
  } else {
    wanted = Math.pow(10, -16 / 20) / rms;
  }
  // Never push peaks more than ~4.5 dB into the limiter.
  const gain = Math.min(wanted, 1.5 / peak);
  const ceil = Math.pow(10, ceilDb / 20); // -1 dBFS unless asked lower
  const knee = 0.72;
  const span = ceil - knee;
  for (let ch = 0; ch < chans.length; ch++) {
    const d = chans[ch];
    for (let i = 0; i < n; i++) {
      let y = d[i] * gain;
      const ay = y < 0 ? -y : y;
      if (ay > knee) {
        const lim = knee + span * Math.tanh((ay - knee) / span);
        y = y < 0 ? -lim : lim;
      }
      d[i] = y;
    }
  }
}

/** Mean square of one channel through the BS.1770 K-weighting filters (48 kHz). */
function kWeightedMeanSquare(x: Float32Array, from: number, to: number): number {
  // Stage 1: high shelf. Stage 2: RLB high-pass.
  const s1 = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
  const s2 = [1, -2, 1, -1.99004745483398, 0.99007225036621];
  let ax1 = 0, ax2 = 0, ay1 = 0, ay2 = 0, bx1 = 0, bx2 = 0, by1 = 0, by2 = 0, sum = 0, n = 0;
  for (let i = 0; i < to; i++) {
    const v = x[i];
    const y1 = s1[0] * v + s1[1] * ax1 + s1[2] * ax2 - s1[3] * ay1 - s1[4] * ay2;
    ax2 = ax1; ax1 = v; ay2 = ay1; ay1 = y1;
    const y2 = s2[0] * y1 + s2[1] * bx1 + s2[2] * bx2 - s2[3] * by1 - s2[4] * by2;
    bx2 = bx1; bx1 = y1; by2 = by1; by1 = y2;
    if (i >= from) { sum += y2 * y2; n++; }
  }
  return n > 0 ? sum / n : 0;
}

type Seg = { start: number; end: number; chord: Chord };

/**
 * Groove (Oct 6): a 5th mood in the feel of modern melodic hip-hop — not
 * modelled on any track. Minor key, ~108 BPM with a half-time bounce:
 *   • 808: a sine sub through soft tanh saturation, locked to a seeded
 *     syncopated kick pattern, roots of the chords with the odd octave and a
 *     short pitch glide; it drops out for the last two beats before the end
 *     card and lands on the tonic with a slide.
 *   • Drums: punchy short kick, a layered clap/snare on 2 and 4, closed hats on
 *     the 16ths with seeded 1/32 and triplet rolls (and a roll into the end card).
 *   • Lead: a bright chopped pluck (saw + square through two formant-like band
 *     passes, ~700–1200 Hz notes) playing a seeded syncopated one-bar motif on
 *     the minor pentatonic, answered with a variation that slides up into a
 *     held note at each phrase end; it slides into the tonic on the end card.
 * The pad underneath comes from the shared code (darker and quieter here).
 */
function composeGrooveLayers(g: {
  c: OfflineAudioContext; master: AudioNode; reverb: AudioNode; delayIn: AudioNode; noise: AudioBuffer;
  rand: () => number; jitter: (amt: number) => number;
  dur: number; beat: number; bar: number; phase: number;
  introEnd: number; buildStart: number; E: number; segs: Seg[]; tonicPc: number; tonicRoot: number; level: number;
}) {
  const { c, master, reverb, delayIn, noise, rand, jitter, dur, beat, bar, phase, introEnd, buildStart, E, segs, tonicPc } = g;
  const s16 = beat / 4;
  const dropAt = Math.max(introEnd, E - 2 * beat);
  const chordAt = (t: number): Chord => {
    for (let i = segs.length - 1; i >= 0; i--) if (t >= segs[i].start - 1e-4) return segs[i].chord;
    return segs[0].chord;
  };
  const barStarts: number[] = [];
  for (let t = phase - Math.ceil(phase / bar) * bar; t < E - 1e-3; t += bar) barStarts.push(t);
  const barIndex = (t: number) => Math.round((t - phase) / bar);

  // ── Buses ──
  const drumBus = c.createGain(); drumBus.gain.value = 0.65; drumBus.connect(master);
  const drumSend = c.createGain(); drumSend.gain.value = 0.12; drumBus.connect(drumSend); drumSend.connect(reverb);
  // The 808: notes → drive → soft saturation → low-pass → level. The sub sits
  // well under full scale here; the compressor and limiter keep peaks down.
  const subDrive = c.createGain(); subDrive.gain.value = 0.9;
  const shaper = c.createWaveShaper();
  {
    const n = 1024, curve = new Float32Array(n), k = 2.2;
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
    shaper.curve = curve; shaper.oversample = "2x";
  }
  const subLp = c.createBiquadFilter(); subLp.type = "lowpass"; subLp.frequency.value = 700; subLp.Q.value = 0.5;
  const subOut = c.createGain(); subOut.gain.value = 0.15;
  subDrive.connect(shaper); shaper.connect(subLp); subLp.connect(subOut); subOut.connect(master);
  // Lead: low-pass opens at the build; reverb and the ping-pong delay.
  const leadBus = c.createGain(); leadBus.gain.value = 1;
  const leadLp = c.createBiquadFilter(); leadLp.type = "lowpass"; leadLp.Q.value = 0.6;
  leadLp.frequency.setValueAtTime(1800, 0);
  leadLp.frequency.setValueAtTime(1800, buildStart);
  leadLp.frequency.exponentialRampToValueAtTime(5200, buildStart + bar * 0.5);
  leadBus.connect(leadLp); leadLp.connect(master);
  const leadVerb = c.createGain(); leadVerb.gain.value = 0.4; leadLp.connect(leadVerb); leadVerb.connect(reverb);
  const leadDelay = c.createGain(); leadDelay.gain.value = 0.7; leadLp.connect(leadDelay); leadDelay.connect(delayIn);

  // ── Voices ──
  const note808 = (midi: number, t0: number, len: number, vel: number, glideFrom: number | null) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    const o = c.createOscillator(); o.type = "sine";
    if (glideFrom !== null) {
      o.frequency.setValueAtTime(mtof(glideFrom), s0);
      o.frequency.exponentialRampToValueAtTime(mtof(midi), s0 + 0.08);
    } else {
      o.frequency.setValueAtTime(mtof(midi), s0);
    }
    const gn = c.createGain();
    const off = Math.min(dur, s0 + Math.max(0.08, len));
    const settle = Math.min(off, s0 + 0.9);
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime(vel, s0 + 0.006);
    gn.gain.linearRampToValueAtTime(vel * 0.7, settle);
    gn.gain.setValueAtTime(vel * 0.7, off);
    gn.gain.linearRampToValueAtTime(0, off + 0.04);
    o.connect(gn); gn.connect(subDrive);
    o.start(s0); o.stop(Math.min(dur, off + 0.06));
  };
  const kick = (t0: number, vel: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    const o = c.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(165, s0);
    o.frequency.exponentialRampToValueAtTime(55, s0 + 0.05);
    const gn = c.createGain();
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime(0.85 * vel, s0 + 0.003);
    gn.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.18);
    o.connect(gn); gn.connect(drumBus);
    o.start(s0); o.stop(Math.min(dur, s0 + 0.2));
  };
  const clap = (t0: number, vel: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 450;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1700; bp.Q.value = 1.1;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 6500;
    const gn = c.createGain();
    // Three quick bursts then a short tail: the clap's flam.
    gn.gain.setValueAtTime(0, s0);
    [0, 0.011, 0.022].forEach((d) => {
      gn.gain.setValueAtTime(0, s0 + d);
      gn.gain.linearRampToValueAtTime(0.5 * vel, s0 + d + 0.002);
      gn.gain.linearRampToValueAtTime(0.12 * vel, s0 + d + 0.01);
    });
    gn.gain.setValueAtTime(0.12 * vel, s0 + 0.032);
    gn.gain.linearRampToValueAtTime(0.32 * vel, s0 + 0.034);
    gn.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.2);
    const src = c.createBufferSource(); src.buffer = noise;
    src.connect(hp); hp.connect(bp); bp.connect(lp); lp.connect(gn); gn.connect(drumBus);
    const send = c.createGain(); send.gain.value = 1.4; gn.connect(send); send.connect(reverb);
    src.start(s0, rand() * 0.7); src.stop(Math.min(dur, s0 + 0.22));
    const body = c.createOscillator(); body.type = "triangle"; body.frequency.value = 185;
    const bg = c.createGain();
    bg.gain.setValueAtTime(0, s0);
    bg.gain.linearRampToValueAtTime(0.18 * vel, s0 + 0.003);
    bg.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.09);
    body.connect(bg); bg.connect(drumBus);
    body.start(s0); body.stop(Math.min(dur, s0 + 0.1));
  };
  const hat = (t0: number, vel: number, pan: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    const src = c.createBufferSource(); src.buffer = noise;
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7600;
    const pk = c.createBiquadFilter(); pk.type = "peaking"; pk.frequency.value = 10500; pk.gain.value = 3;
    const gn = c.createGain();
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime(0.16 * vel, s0 + 0.002);
    gn.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.04);
    const pn = makePan(c, pan);
    src.connect(hp); hp.connect(pk); pk.connect(gn); gn.connect(pn); pn.connect(drumBus);
    src.start(s0, rand() * 0.9); src.stop(Math.min(dur, s0 + 0.05));
  };
  const leadNote = (midi: number, t0: number, len: number, vel: number, glideFrom: number | null, glideTime = 0.12) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.03) return;
    const f = mtof(midi);
    const o1 = c.createOscillator(); o1.type = "sawtooth";
    const o2 = c.createOscillator(); o2.type = "square"; o2.detune.value = 6;
    [o1, o2].forEach((o) => {
      if (glideFrom !== null) {
        o.frequency.setValueAtTime(mtof(glideFrom), s0);
        o.frequency.exponentialRampToValueAtTime(f, s0 + glideTime);
      } else {
        o.frequency.setValueAtTime(f, s0);
      }
    });
    const mix = c.createGain(); mix.gain.value = 1;
    const g2 = c.createGain(); g2.gain.value = 0.45;
    o1.connect(mix); o2.connect(g2); g2.connect(mix);
    // Formant-like colour: two resonant band passes plus a little of the body.
    const f1 = c.createBiquadFilter(); f1.type = "bandpass"; f1.frequency.value = 820; f1.Q.value = 4;
    const f2 = c.createBiquadFilter(); f2.type = "bandpass"; f2.frequency.value = 1250; f2.Q.value = 5;
    const bodyLp = c.createBiquadFilter(); bodyLp.type = "lowpass"; bodyLp.frequency.value = 1500;
    const bodyG = c.createGain(); bodyG.gain.value = 0.3;
    const env = c.createGain();
    mix.connect(f1); mix.connect(f2); mix.connect(bodyLp); bodyLp.connect(bodyG);
    f1.connect(env); f2.connect(env); bodyG.connect(env);
    const held = len > beat * 0.6;
    if (held) {
      // A held note: a touch of vibrato once it has arrived.
      const lfo = c.createOscillator(); lfo.frequency.value = 5.2;
      const lfoG = c.createGain(); lfoG.gain.value = 0;
      lfoG.gain.setValueAtTime(0, s0 + glideTime);
      lfoG.gain.linearRampToValueAtTime(14, s0 + glideTime + 0.35);
      lfo.connect(lfoG); lfoG.connect(o1.detune); lfoG.connect(o2.detune);
      lfo.start(s0); lfo.stop(Math.min(dur, s0 + len + 0.3));
    }
    const peak = g.level * vel;
    const off = Math.min(dur, s0 + Math.max(0.05, len));
    env.gain.setValueAtTime(0, s0);
    env.gain.linearRampToValueAtTime(peak, s0 + 0.004);
    env.gain.linearRampToValueAtTime(peak * (held ? 0.8 : 0.55), off);
    env.gain.linearRampToValueAtTime(0, off + (held ? 0.18 : 0.03));
    const pn = makePan(c, jitter(0.25));
    env.connect(pn); pn.connect(leadBus);
    const stop = Math.min(dur, off + 0.22);
    o1.start(s0); o2.start(s0); o1.stop(stop); o2.stop(stop);
  };

  // ── Patterns (seeded) ──
  const KICKS = [[0, 7, 10], [0, 3, 10], [0, 6, 9, 14], [0, 10, 11], [0, 7, 11], [0, 3, 8, 11]];
  const kA = KICKS[Math.floor(rand() * KICKS.length)];
  const kB = KICKS[Math.floor(rand() * KICKS.length)];
  // The lead's motif: a one-bar rhythm on 16ths and a walk on the minor pentatonic.
  const PENTA = [0, 3, 5, 7, 10];
  const scale: number[] = [];
  for (let m = 74; m <= 88; m++) if (PENTA.indexOf(mod(m - tonicPc, 12)) >= 0) scale.push(m);
  const CAND = [0, 2, 3, 5, 6, 8, 10, 11, 13, 14];
  const hits = CAND.filter(() => rand() < 0.5);
  if (hits.length < 4) [0, 3, 6, 10].forEach((x) => { if (hits.indexOf(x) < 0) hits.push(x); });
  hits.sort((a, b) => a - b);
  const motif: { step: number; idx: number; len: number; stutter: boolean }[] = [];
  let idx = Math.floor(scale.length / 2) - 1 + Math.floor(rand() * 3);
  hits.slice(0, 6).forEach((st, i, arr) => {
    idx = clamp(idx + Math.floor(rand() * 5) - 2, 1, scale.length - 2);
    const room = (i + 1 < arr.length ? arr[i + 1] : 16) - st;
    motif.push({ step: st, idx, len: Math.min(room, rand() < 0.3 ? 2 : 1), stutter: rand() < 0.2 });
  });
  const tonicLead = (() => { let best = scale[0]; scale.forEach((m) => { if (mod(m - tonicPc, 12) === 0 && Math.abs(m - 80) < Math.abs(best - 80)) best = m; }); return best; })();

  // ── Lay it out bar by bar ──
  let prev808: number | null = null;
  const hatFrom = Math.max(0, introEnd - bar);
  barStarts.forEach((b0) => {
    const bi = barIndex(b0);
    const second = mod(bi, 2) === 1; // the answer bar of a two-bar phrase
    const inBuild = b0 >= buildStart - 1e-3;
    const drums = b0 >= introEnd - 1e-3;
    // Hats: 16ths (8ths in the intro), with a roll in the last beat of some answer bars.
    const rollBeat = drums && second && rand() < 0.65 ? 3 : -1;
    const rollKind = rand() < 0.5 ? 8 : 6; // 1/32 or 16th triplets
    for (let st = 0; st < 16; st++) {
      const t = b0 + st * s16;
      if (t < hatFrom || t >= E - 0.02) continue;
      const beatNo = Math.floor(st / 4);
      const nearEnd = t >= E - beat - 1e-3; // the roll into the end card
      if ((beatNo === rollBeat || nearEnd) && st % 4 === 0) {
        const n = nearEnd ? 8 : rollKind;
        for (let r = 0; r < n; r++) hat(t + (r * beat) / n, 0.45 + 0.5 * (r / n), 0.12);
        st += 3;
        continue;
      }
      if (!drums && st % 2 === 1) continue;
      const accent = st % 4 === 0 ? 1 : st % 2 === 0 ? 0.7 : 0.5;
      hat(t + jitter(0.003), accent * (drums ? 1 : 0.55) * (1 + jitter(0.12)), st % 2 === 0 ? 0.12 : -0.08);
    }
    if (!drums) return;
    // Kick + 808, locked; clap on 2 and 4.
    const pat = second ? kB : kA;
    pat.forEach((st, k) => {
      const t = b0 + st * s16;
      if (t >= dropAt - 1e-3 || t < introEnd - 1e-3) return;
      const nextSt = k + 1 < pat.length ? pat[k + 1] : 16;
      const len = Math.min((nextSt - st) * s16, dropAt - t) - 0.03;
      const ch = chordAt(t + 0.01);
      let midi = 31 + mod(tonicPc + ch.root - 31, 12);
      if (k > 0 && rand() < 0.22) midi += 12;
      const glide = prev808 !== null && prev808 !== midi && rand() < 0.35 ? prev808 : null;
      kick(t, k === 0 ? 1 : 0.8);
      note808(midi, t, len, k === 0 ? 0.95 : 0.85, glide);
      prev808 = midi;
    });
    [4, 12].forEach((st) => {
      const t = b0 + st * s16;
      if (t < dropAt - 1e-3) clap(t + jitter(0.003), 0.9 * (1 + jitter(0.08)));
    });
    // Lead: the motif (quieter and darker before the build), then its answer,
    // which slides up into a held note at the phrase end.
    const leadVel = inBuild ? 1 : 0.7;
    motif.forEach((m, i) => {
      const t = b0 + m.step * s16;
      if (t >= E - beat * 0.5 || (!inBuild && second && i > 2)) return;
      let pitchIdx = m.idx;
      if (second && i >= motif.length - 2) pitchIdx = clamp(m.idx + (i === motif.length - 1 ? 1 : -1), 0, scale.length - 1);
      const midi = scale[pitchIdx];
      const len = m.len * s16 * 0.85;
      if (m.stutter) {
        leadNote(midi, t + jitter(0.004), s16 * 0.4, leadVel * 0.9, null);
        leadNote(midi, t + s16 * 0.5, s16 * 0.4, leadVel * 0.75, null);
      } else {
        leadNote(midi, t + jitter(0.004), len, leadVel * (m.step % 4 === 0 ? 1 : 0.85), null);
      }
    });
    if (second && inBuild) {
      const t = b0 + 13 * s16;
      if (t + 3 * s16 < E - beat * 0.5) {
        const target = scale[clamp(motif[motif.length - 1].idx + 1, 1, scale.length - 1)];
        leadNote(target, t, 3 * s16, 0.95, target - 3, 0.14);
      }
    }
  });
  // The landing: kick + 808 sliding down onto the tonic, the lead sliding up into it.
  const tonicSub = 31 + mod(tonicPc + g.tonicRoot - 31, 12);
  kick(E, 1);
  note808(tonicSub, E, Math.min(2.6, dur - E - 0.05), 0.95, tonicSub + 7);
  leadNote(tonicLead, E, Math.min(2.2, dur - E - 0.1), 0.9, tonicLead - 3, 0.16);
  clap(E + 2 * beat, 0.6);
}

/**
 * Lift (Oct 6): bright, building, uplifting — a 4-on-the-floor feel at
 * ~136 BPM in a seeded major key, not modelled on any track.
 *   • Intro (up to the drop, ~40–50% in): the shared pad plus a plucky 8th-note
 *     arpeggio in the mids (~300–600 Hz) behind a closed low-pass, and a soft
 *     kick pulse.
 *   • Riser over the 2–3 bars before the drop: the pluck filter opens, a noise
 *     sweep and a light clap roll build, landing on the drop — which is placed
 *     exactly on a cut.
 *   • Drop: steady kick, off-beat open hats, claps on 2 and 4, wide detuned
 *     chord stabs, the pluck up front with 16th pickups, and a moderate clean
 *     bass on the off-beats — bass, chords and pad duck under every kick.
 *   • End card: a wide tonic chord and pluck, and the shared fade.
 */
function composeLiftLayers(g: {
  c: OfflineAudioContext; master: AudioNode; reverb: AudioNode; delayIn: AudioNode; noise: AudioBuffer; padOut: GainNode;
  rand: () => number; jitter: (amt: number) => number;
  dur: number; beat: number; bar: number; phase: number;
  introEnd: number; drop: number; E: number; segs: Seg[]; tonicPc: number; tonic: Chord; level: number;
}) {
  const { c, master, reverb, delayIn, noise, padOut, rand, jitter, dur, beat, bar, phase, introEnd, drop, E, segs, tonicPc } = g;
  const s8 = beat / 2, s16 = beat / 4;
  const riserStart = Math.max(introEnd, drop - (drop - introEnd > 4 * bar ? 3 : 2) * bar);
  const chordAt = (t: number): Chord => {
    for (let i = segs.length - 1; i >= 0; i--) if (t >= segs[i].start - 1e-4) return segs[i].chord;
    return segs[0].chord;
  };

  // ── Buses ──
  const drumBus = c.createGain(); drumBus.gain.value = 0.6; drumBus.connect(master);
  const drumSend = c.createGain(); drumSend.gain.value = 0.14; drumBus.connect(drumSend); drumSend.connect(reverb);
  const pluckBus = c.createGain(); pluckBus.gain.value = 1;
  const pluckLp = c.createBiquadFilter(); pluckLp.type = "lowpass"; pluckLp.Q.value = 0.8;
  pluckLp.frequency.setValueAtTime(1300, 0);
  pluckLp.frequency.setValueAtTime(1300, riserStart);
  pluckLp.frequency.exponentialRampToValueAtTime(7000, drop);
  pluckBus.connect(pluckLp); pluckLp.connect(master);
  const pluckVerb = c.createGain(); pluckVerb.gain.value = 0.35; pluckLp.connect(pluckVerb); pluckVerb.connect(reverb);
  const pluckDelay = c.createGain(); pluckLp.connect(pluckDelay); pluckDelay.connect(delayIn);
  pluckDelay.gain.setValueAtTime(0.2, 0);
  pluckDelay.gain.setValueAtTime(0.2, riserStart);
  pluckDelay.gain.linearRampToValueAtTime(0.6, drop);
  // Ducked buses: bass and chords dip under every kick of the drop.
  const bassDuck = c.createGain(); bassDuck.gain.value = 1;
  const bassLp = c.createBiquadFilter(); bassLp.type = "lowpass"; bassLp.frequency.value = 600; bassLp.Q.value = 0.5;
  const bassOut = c.createGain(); bassOut.gain.value = 0.11;
  bassDuck.connect(bassLp); bassLp.connect(bassOut); bassOut.connect(master);
  const chordDuck = c.createGain(); chordDuck.gain.value = 1;
  const chordLp = c.createBiquadFilter(); chordLp.type = "lowpass"; chordLp.frequency.value = 3400; chordLp.Q.value = 0.5;
  chordDuck.connect(chordLp); chordLp.connect(master);
  const chordVerb = c.createGain(); chordVerb.gain.value = 0.4; chordLp.connect(chordVerb); chordVerb.connect(reverb);

  // ── Voices ──
  const kick = (t0: number, vel: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    const o = c.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(150, s0);
    o.frequency.exponentialRampToValueAtTime(48, s0 + 0.07);
    const gn = c.createGain();
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime(0.8 * vel, s0 + 0.003);
    gn.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.28);
    o.connect(gn); gn.connect(drumBus);
    o.start(s0); o.stop(Math.min(dur, s0 + 0.3));
  };
  const openHat = (t0: number, vel: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    const src = c.createBufferSource(); src.buffer = noise;
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7000;
    const gn = c.createGain();
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime(0.13 * vel, s0 + 0.004);
    gn.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.17);
    const pn = makePan(c, 0.18);
    src.connect(hp); hp.connect(gn); gn.connect(pn); pn.connect(drumBus);
    src.start(s0, rand() * 0.8); src.stop(Math.min(dur, s0 + 0.19));
  };
  const clap = (t0: number, vel: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1500; bp.Q.value = 1;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 6000;
    const gn = c.createGain();
    gn.gain.setValueAtTime(0, s0);
    [0, 0.01, 0.02].forEach((d) => {
      gn.gain.setValueAtTime(0, s0 + d);
      gn.gain.linearRampToValueAtTime(0.4 * vel, s0 + d + 0.002);
      gn.gain.linearRampToValueAtTime(0.1 * vel, s0 + d + 0.009);
    });
    gn.gain.setValueAtTime(0.1 * vel, s0 + 0.03);
    gn.gain.linearRampToValueAtTime(0.26 * vel, s0 + 0.032);
    gn.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.17);
    const src = c.createBufferSource(); src.buffer = noise;
    src.connect(bp); bp.connect(lp); lp.connect(gn); gn.connect(drumBus);
    const send = c.createGain(); send.gain.value = 1.2; gn.connect(send); send.connect(reverb);
    src.start(s0, rand() * 0.7); src.stop(Math.min(dur, s0 + 0.19));
  };
  const pluck = (midi: number, t0: number, vel: number, bright: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.03) return;
    const f = mtof(midi);
    const o1 = c.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = "square"; o2.frequency.value = f; o2.detune.value = 8;
    const g2 = c.createGain(); g2.gain.value = 0.35;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 2;
    lp.frequency.setValueAtTime(600 + 3400 * bright, s0);
    lp.frequency.exponentialRampToValueAtTime(520, s0 + 0.18);
    const env = c.createGain();
    const peak = g.level * vel;
    env.gain.setValueAtTime(0, s0);
    env.gain.linearRampToValueAtTime(peak, s0 + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.34);
    const pn = makePan(c, jitter(0.3));
    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(env); env.connect(pn); pn.connect(pluckBus);
    const stop = Math.min(dur, s0 + 0.36);
    o1.start(s0); o2.start(s0); o1.stop(stop); o2.stop(stop);
  };
  const bassNote = (midi: number, t0: number, len: number, vel: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    const f = mtof(midi);
    const o = c.createOscillator(); o.type = "sine"; o.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = "triangle"; o2.frequency.value = f * 2;
    const g2 = c.createGain(); g2.gain.value = 0.3;
    const gn = c.createGain();
    const off = Math.min(dur, s0 + Math.max(0.06, len));
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime(vel, s0 + 0.008);
    gn.gain.setValueAtTime(vel, off);
    gn.gain.linearRampToValueAtTime(0, off + 0.03);
    o.connect(gn); o2.connect(g2); g2.connect(gn); gn.connect(bassDuck);
    o.start(s0); o2.start(s0); o.stop(Math.min(dur, off + 0.05)); o2.stop(Math.min(dur, off + 0.05));
  };
  /** Wide chord: each tone as two detuned saws panned apart. */
  const chordStab = (ch: Chord, t0: number, t1: number, release: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.05 || t1 <= s0) return;
    const rootPc = mod(tonicPc + ch.root, 12);
    const tones = ch.pad.map((iv) => 60 + mod(rootPc + iv - 60, 12)).sort((a, b) => a - b);
    tones.forEach((m) => {
      [-1, 1].forEach((side) => {
        const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = mtof(m); o.detune.value = side * 12;
        const gn = c.createGain();
        gn.gain.setValueAtTime(0, s0);
        gn.gain.linearRampToValueAtTime(0.014, s0 + 0.02);
        gn.gain.setValueAtTime(0.014, t1);
        gn.gain.linearRampToValueAtTime(0, t1 + release);
        const pn = makePan(c, side * 0.65);
        o.connect(gn); gn.connect(pn); pn.connect(chordDuck);
        o.start(s0); o.stop(Math.min(dur, t1 + release + 0.02));
      });
    });
  };
  const duck = (param: AudioParam, t: number, depth: number) => {
    param.setValueAtTime(1, t);
    param.linearRampToValueAtTime(depth, t + 0.012);
    param.linearRampToValueAtTime(1, t + Math.min(0.22, beat * 0.55));
  };

  // ── Patterns (seeded) ──
  const ARPS = [
    [0, 1, 2, 3, 2, 1, 2, 3],
    [0, 2, 1, 3, 0, 2, 1, 4],
    [0, 1, 2, 4, 3, 2, 1, 2],
    [2, 0, 1, 3, 2, 0, 3, 1],
  ];
  const arp = ARPS[Math.floor(rand() * ARPS.length)];
  const arpTones = (ch: Chord): number[] => {
    const rootPc = mod(tonicPc + ch.root, 12);
    const base = 62 + mod(rootPc - 62, 12); // root in D4–C#5: the 300–600 Hz mids
    return ch.arp.map((iv) => base + iv);
  };

  // ── The arp: 8ths throughout, 16th pickups and an octave sparkle in the drop ──
  for (let t = phase + Math.ceil((introEnd - phase) / s8 - 1e-6) * s8; t < E - 0.02; t += s8) {
    const inDrop = t >= drop - 1e-3;
    const step = Math.round((t - phase) / s8);
    const tones = arpTones(chordAt(t + 0.01));
    let m = tones[arp[mod(step, arp.length)] % tones.length];
    if (inDrop && mod(step, 8) === 6 && rand() < 0.5) m += 12;
    const onBeat = mod(step, 2) === 0;
    const bright = inDrop ? 0.9 : t >= riserStart ? 0.35 + 0.5 * ((t - riserStart) / Math.max(0.1, drop - riserStart)) : 0.3;
    const vel = (onBeat ? 1 : 0.8) * (inDrop ? 1 : 0.65) * (1 + jitter(0.1));
    pluck(m, t + jitter(0.004), vel, bright);
    if (inDrop && !onBeat && rand() < 0.5) pluck(tones[arp[mod(step + 1, arp.length)] % tones.length], t + s16 + jitter(0.004), vel * 0.6, bright);
  }

  // ── Intro pulse and the riser ──
  for (let t = phase + Math.ceil((introEnd - phase) / beat - 1e-6) * beat; t < drop - beat * 0.5; t += beat) {
    kick(t, t >= riserStart ? 0.42 : 0.3);
  }
  {
    const src = c.createBufferSource(); src.buffer = noise; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(400, riserStart);
    bp.frequency.exponentialRampToValueAtTime(8000, drop);
    const gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, riserStart);
    gn.gain.exponentialRampToValueAtTime(0.055, drop - 0.02);
    gn.gain.linearRampToValueAtTime(0, drop + 0.08);
    src.connect(bp); bp.connect(gn); gn.connect(master);
    const rs = c.createGain(); rs.gain.value = 0.7; gn.connect(rs); rs.connect(reverb);
    src.start(riserStart); src.stop(Math.min(dur, drop + 0.12));
    // A light clap roll over the last bar: 8ths, then 16ths.
    const rollFrom = Math.max(riserStart, drop - bar);
    for (let t = rollFrom; t < drop - 1e-3; ) {
      const p = (t - rollFrom) / Math.max(0.1, drop - rollFrom);
      clap(t, 0.25 + 0.5 * p);
      t += p < 0.5 ? s8 : s16;
    }
    // The crash on the drop.
    const cs = c.createBufferSource(); cs.buffer = noise; cs.loop = true;
    const chp = c.createBiquadFilter(); chp.type = "highpass"; chp.frequency.value = 5000;
    const cg = c.createGain();
    cg.gain.setValueAtTime(0, drop);
    cg.gain.linearRampToValueAtTime(0.07, drop + 0.005);
    cg.gain.exponentialRampToValueAtTime(0.0001, drop + 1.5);
    cs.connect(chp); chp.connect(cg); cg.connect(master);
    const cv = c.createGain(); cv.gain.value = 0.6; cg.connect(cv); cv.connect(reverb);
    cs.start(drop); cs.stop(Math.min(dur, drop + 1.6));
  }

  // ── The drop ──
  for (let t = drop; t < E - 0.02; t += beat) {
    const pos = mod(Math.round((t - phase) / beat), 4);
    kick(t, 1);
    duck(bassDuck.gain, t, 0.25);
    duck(chordDuck.gain, t, 0.45);
    duck(padOut.gain, t, 0.6);
    openHat(t + s8 + jitter(0.003), 1 + jitter(0.1));
    if (pos === 1 || pos === 3) clap(t + jitter(0.003), 0.85);
    const ch = chordAt(t + s8);
    const bm = 36 + mod(tonicPc + ch.root - 36, 12);
    bassNote(bm, t + s8, s8 - 0.03, 0.9);
  }
  segs.forEach((sg) => {
    const a = Math.max(sg.start, drop), b = Math.min(sg.end, E);
    if (b - a > 0.05) chordStab(sg.chord, a, b, 0.12);
  });

  // ── The end card: a wide tonic and the pluck, ringing out ──
  kick(E, 0.9);
  chordStab(g.tonic, E, Math.min(dur - 0.3, E + 1.6), 1.0);
  const ft = arpTones(g.tonic);
  ft.slice(0, 3).forEach((m, i) => pluck(m + 12, E + i * s16, 0.8 - i * 0.12, 0.7));
  bassNote(36 + mod(tonicPc + g.tonic.root - 36, 12), E, Math.min(1.6, dur - E - 0.1), 0.8);
}

// ── Throttle (Oct 7) ───────────────────────────────────────────────────────

/** Throttle's sample ceiling: dense and saturated, so a little lower to keep true peak ≤ -1 dBTP. */
const THROTTLE_CEIL_DB = -1.8;

const TH_MIXO: Record<string, Chord> = {
  I:    { root: 0,  pad: [4, 7, 14], arp: [0, 4, 7, 12] },
  bVII: { root: 10, pad: [4, 7, 14], arp: [0, 4, 7, 12] },
  IV:   { root: 5,  pad: [4, 7, 14], arp: [0, 4, 7, 12] },
  v:    { root: 7,  pad: [3, 7, 10], arp: [0, 3, 7, 10] },
};
const TH_MIN: Record<string, Chord> = {
  i:    { root: 0,  pad: [3, 7, 14], arp: [0, 3, 7, 12] },
  bVI:  { root: 8,  pad: [4, 7, 14], arp: [0, 4, 7, 12] },
  bVII: { root: 10, pad: [4, 7, 14], arp: [0, 4, 7, 12] },
  iv:   { root: 5,  pad: [3, 7, 10], arp: [0, 3, 7, 10] },
};
const TH_MIXO_PROGS = [["I", "bVII", "IV", "I"], ["I", "I", "bVII", "IV"], ["I", "v", "bVII", "IV"]];
const TH_MIN_PROGS = [["i", "bVI", "bVII", "i"], ["i", "bVII", "bVI", "bVII"], ["i", "iv", "bVI", "bVII"]];

/** Throttle's chords: a seeded rock progression, bVII before the end card, the tonic on it. */
function assignThrottleChords(segs: Seg[], minor: boolean, rand: () => number) {
  const table = minor ? TH_MIN : TH_MIXO;
  const progs = minor ? TH_MIN_PROGS : TH_MIXO_PROGS;
  const prog = progs[Math.floor(rand() * progs.length)].map((k) => table[k]);
  const tonic = minor ? TH_MIN.i : TH_MIXO.I;
  for (let i = 0; i < segs.length; i++) segs[i].chord = prog[i % prog.length];
  if (segs.length >= 2) segs[segs.length - 2].chord = table.bVII;
  segs[0].chord = tonic;
  segs[segs.length - 1].chord = tonic;
}

/**
 * Throttle (Oct 7): fast, punchy, high-energy — for center consoles and
 * go-fasts. 148–154 BPM, relentless from the first bar (at most a one-bar
 * pickup: a snare roll and a riser).
 *   • Drums: kick on every beat, tight clap/snare on 2 and 4, fast closed
 *     16th hats, an open hat on the off-beats.
 *   • Bass (the engine): a rolling 16th saw bass (two detuned saws + a sub),
 *     lightly saturated and filtered, with real harmonics in 100–400 Hz so a
 *     phone speaker carries it; ducked hard under every kick.
 *   • Short wide stab chords on the off-beats and a bold one-bar lead riff
 *     on the pentatonic, repeating with variation.
 *   • Every cut: a reverse-cymbal swoosh into it and an impact on it (crash +
 *     sub drop, plus the kick when the cut sits on a beat). Every other cut
 *     also gets a one-beat 16th snare fill or a quick filter-sweep riser.
 *   • Reels over 35 s: a 1–2 bar half-time breakdown that slams back in on a cut.
 *   • End card: a big final hit (kick, crash, sub drop, stab, bass) and a short tail.
 */
function composeThrottleLayers(g: {
  c: OfflineAudioContext; master: AudioNode; reverb: AudioNode; delayIn: AudioNode; noise: AudioBuffer; padOut: GainNode;
  rand: () => number; jitter: (amt: number) => number;
  dur: number; beat: number; bar: number; phase: number;
  introEnd: number; E: number; segs: Seg[]; cuts: number[]; tonicPc: number; minor: boolean; level: number;
}) {
  const { c, master, reverb, delayIn, noise, padOut, rand, jitter, dur, beat, bar, phase, introEnd, E, segs, tonicPc, minor } = g;
  const s16 = beat / 4, s8 = beat / 2;
  const chordAt = (t: number): Chord => {
    for (let i = segs.length - 1; i >= 0; i--) if (t >= segs[i].start - 1e-4) return segs[i].chord;
    return segs[0].chord;
  };
  const nearestBeat = (t: number) => phase + Math.round((t - phase) / beat) * beat;
  const end = E; // the music proper stops at the end card's hit

  // ── Cuts: impacts on every cut from the start of the groove, the end card last ──
  const cutList = g.cuts.filter((ct) => ct > introEnd + 0.15 && ct < E - 0.2);
  const impacts = cutList.concat([E]);
  // Half-time breakdown (reels over 35 s): the 1–2 bars before the cut nearest 60%.
  let bdFrom = Infinity, bdTo = -Infinity;
  if (dur > 35 && cutList.length > 2) {
    let best = -1, bestD = Infinity;
    cutList.forEach((ct, i) => { const d = Math.abs(ct - dur * 0.6); if (i > 0 && d < bestD) { bestD = d; best = i; } });
    if (best > 0) {
      const ct = cutList[best];
      const len = Math.min(rand() < 0.5 ? bar : 2 * bar, ct - cutList[best - 1] - 0.2);
      if (len >= bar * 0.75) { bdFrom = ct - len; bdTo = ct; }
    }
  }
  const inBreakdown = (t: number) => t >= bdFrom - 1e-3 && t < bdTo - 1e-3;

  // ── Buses ──
  const drumBus = c.createGain(); drumBus.gain.value = 0.65; drumBus.connect(master);
  const drumSend = c.createGain(); drumSend.gain.value = 0.1; drumBus.connect(drumSend); drumSend.connect(reverb);
  // Bass: notes → duck → drive → saturation → low-pass → level.
  const bassDuck = c.createGain(); bassDuck.gain.value = 1;
  const bassDrive = c.createGain(); bassDrive.gain.value = 1.6;
  const shaper = c.createWaveShaper();
  {
    const n = 1024, curve = new Float32Array(n), k = 3;
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
    shaper.curve = curve; shaper.oversample = "4x";
  }
  const bassLp = c.createBiquadFilter(); bassLp.type = "lowpass"; bassLp.frequency.value = 1300; bassLp.Q.value = 0.7;
  const bassHs = c.createBiquadFilter(); bassHs.type = "highshelf"; bassHs.frequency.value = 2500; bassHs.gain.value = -6;
  const bassOut = c.createGain(); bassOut.gain.value = 0.12;
  bassDuck.connect(bassDrive); bassDrive.connect(shaper); shaper.connect(bassLp); bassLp.connect(bassHs); bassHs.connect(bassOut); bassOut.connect(master);
  // Stabs and lead.
  const stabDuck = c.createGain(); stabDuck.gain.value = 1;
  const stabLp = c.createBiquadFilter(); stabLp.type = "lowpass"; stabLp.frequency.value = 3800; stabLp.Q.value = 0.6;
  stabDuck.connect(stabLp); stabLp.connect(master);
  const stabVerb = c.createGain(); stabVerb.gain.value = 0.3; stabLp.connect(stabVerb); stabVerb.connect(reverb);
  const leadBus = c.createGain(); leadBus.gain.value = 1;
  const leadLp = c.createBiquadFilter(); leadLp.type = "lowpass"; leadLp.frequency.value = 4200; leadLp.Q.value = 0.7;
  leadBus.connect(leadLp); leadLp.connect(master);
  const leadDelay = c.createGain(); leadDelay.gain.value = 0.35; leadLp.connect(leadDelay); leadDelay.connect(delayIn);
  const leadVerb = c.createGain(); leadVerb.gain.value = 0.25; leadLp.connect(leadVerb); leadVerb.connect(reverb);

  // ── Voices ──
  const kick = (t0: number, vel: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    const o = c.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(180, s0);
    o.frequency.exponentialRampToValueAtTime(50, s0 + 0.045);
    const gn = c.createGain();
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime(0.9 * vel, s0 + 0.002);
    gn.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.2);
    o.connect(gn); gn.connect(drumBus);
    // A short filtered click for punch on small speakers.
    const ck = c.createBufferSource(); ck.buffer = noise;
    const cbp = c.createBiquadFilter(); cbp.type = "bandpass"; cbp.frequency.value = 2500; cbp.Q.value = 0.8;
    const cg = c.createGain();
    cg.gain.setValueAtTime(0, s0);
    cg.gain.linearRampToValueAtTime(0.12 * vel, s0 + 0.001);
    cg.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.015);
    ck.connect(cbp); cbp.connect(cg); cg.connect(drumBus);
    o.start(s0); o.stop(Math.min(dur, s0 + 0.22));
    ck.start(s0, rand() * 0.8); ck.stop(Math.min(dur, s0 + 0.02));
  };
  const snare = (t0: number, vel: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    const src = c.createBufferSource(); src.buffer = noise;
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 900;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 7500;
    const gn = c.createGain();
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime(0.42 * vel, s0 + 0.002);
    gn.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.13);
    src.connect(hp); hp.connect(lp); lp.connect(gn); gn.connect(drumBus);
    const send = c.createGain(); send.gain.value = 0.9; gn.connect(send); send.connect(reverb);
    src.start(s0, rand() * 0.8); src.stop(Math.min(dur, s0 + 0.15));
    const body = c.createOscillator(); body.type = "triangle";
    body.frequency.setValueAtTime(240, s0);
    body.frequency.exponentialRampToValueAtTime(170, s0 + 0.05);
    const bg = c.createGain();
    bg.gain.setValueAtTime(0, s0);
    bg.gain.linearRampToValueAtTime(0.3 * vel, s0 + 0.002);
    bg.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.08);
    body.connect(bg); bg.connect(drumBus);
    body.start(s0); body.stop(Math.min(dur, s0 + 0.09));
  };
  const hat = (t0: number, vel: number, open: boolean) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    const src = c.createBufferSource(); src.buffer = noise;
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = open ? 6500 : 8000;
    const gn = c.createGain();
    const len = open ? 0.11 : 0.03;
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime((open ? 0.12 : 0.11) * vel, s0 + 0.002);
    gn.gain.exponentialRampToValueAtTime(0.0001, s0 + len);
    const pn = makePan(c, open ? -0.15 : 0.15);
    src.connect(hp); hp.connect(gn); gn.connect(pn); pn.connect(drumBus);
    src.start(s0, rand() * 0.9); src.stop(Math.min(dur, s0 + len + 0.01));
  };
  const crash = (t0: number, vel: number, len: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    const src = c.createBufferSource(); src.buffer = noise; src.loop = true;
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 4200;
    const gn = c.createGain();
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime(0.1 * vel, s0 + 0.004);
    gn.gain.exponentialRampToValueAtTime(0.0001, s0 + len);
    src.connect(hp); hp.connect(gn); gn.connect(master);
    const send = c.createGain(); send.gain.value = 0.6; gn.connect(send); send.connect(reverb);
    src.start(s0, rand() * 0.5); src.stop(Math.min(dur, s0 + len + 0.02));
  };
  const subDrop = (t0: number, vel: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.05) return;
    const o = c.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(95, s0);
    o.frequency.exponentialRampToValueAtTime(34, s0 + 0.5);
    const gn = c.createGain();
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime(0.32 * vel, s0 + 0.004);
    gn.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.6);
    o.connect(gn); gn.connect(master);
    o.start(s0); o.stop(Math.min(dur, s0 + 0.62));
  };
  /** Reverse cymbal: filtered noise swelling up to exactly `at`. */
  const swoosh = (at: number, len: number, vel: number) => {
    const s0 = Math.max(0, at - len);
    if (at - s0 < 0.08) return;
    const src = c.createBufferSource(); src.buffer = noise; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(2500, s0);
    bp.frequency.exponentialRampToValueAtTime(9000, at);
    const gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, s0);
    gn.gain.exponentialRampToValueAtTime(0.09 * vel, at - 0.004);
    gn.gain.linearRampToValueAtTime(0, at);
    const pn = makePan(c, jitter(0.3));
    src.connect(bp); bp.connect(gn); gn.connect(pn); pn.connect(master);
    src.start(s0, rand() * 0.5); src.stop(Math.min(dur, at + 0.01));
  };
  /** A quick filter-sweep riser (noise + the bass filter opening) into `at`. */
  const sweep = (at: number, len: number) => {
    const s0 = Math.max(0, at - len);
    if (at - s0 < 0.1) return;
    const src = c.createBufferSource(); src.buffer = noise; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 3;
    bp.frequency.setValueAtTime(600, s0);
    bp.frequency.exponentialRampToValueAtTime(6000, at);
    const gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, s0);
    gn.gain.exponentialRampToValueAtTime(0.07, at - 0.005);
    gn.gain.linearRampToValueAtTime(0, at);
    src.connect(bp); bp.connect(gn); gn.connect(master);
    src.start(s0); src.stop(Math.min(dur, at + 0.01));
  };
  const bassNote = (midi: number, t0: number, len: number, vel: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    const f = mtof(midi);
    const o1 = c.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = f; o1.detune.value = -7;
    const o2 = c.createOscillator(); o2.type = "sawtooth"; o2.frequency.value = f; o2.detune.value = 7;
    const sub = c.createOscillator(); sub.type = "sine"; sub.frequency.value = f / 2;
    const subG = c.createGain(); subG.gain.value = 0.7;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 3;
    lp.frequency.setValueAtTime(1800, s0);
    lp.frequency.exponentialRampToValueAtTime(420, s0 + Math.max(0.05, len));
    const gn = c.createGain();
    const off = Math.min(dur, s0 + Math.max(0.04, len));
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime(0.5 * vel, s0 + 0.003);
    gn.gain.linearRampToValueAtTime(0.4 * vel, off);
    gn.gain.linearRampToValueAtTime(0, off + 0.015);
    o1.connect(lp); o2.connect(lp); lp.connect(gn); sub.connect(subG); subG.connect(gn); gn.connect(bassDuck);
    const stop = Math.min(dur, off + 0.03);
    o1.start(s0); o2.start(s0); sub.start(s0); o1.stop(stop); o2.stop(stop); sub.stop(stop);
  };
  const stab = (ch: Chord, t0: number, vel: number, len = 0.11) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    const rootPc = mod(tonicPc + ch.root, 12);
    const tones = [0].concat(ch.pad).map((iv) => 60 + mod(rootPc + iv - 60, 12)).sort((a, b) => a - b);
    tones.forEach((m, k) => {
      const o = c.createOscillator(); o.type = k % 2 === 0 ? "sawtooth" : "square"; o.frequency.value = mtof(m); o.detune.value = (k % 2 === 0 ? -1 : 1) * 9;
      const gn = c.createGain();
      gn.gain.setValueAtTime(0, s0);
      gn.gain.linearRampToValueAtTime(0.25 * vel, s0 + 0.003);
      gn.gain.exponentialRampToValueAtTime(0.0001, s0 + len);
      const pn = makePan(c, (k / Math.max(1, tones.length - 1) - 0.5) * 1.2);
      o.connect(gn); gn.connect(pn); pn.connect(stabDuck);
      o.start(s0); o.stop(Math.min(dur, s0 + len + 0.02));
    });
  };
  const leadNote = (midi: number, t0: number, len: number, vel: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    const f = mtof(midi);
    const o1 = c.createOscillator(); o1.type = "square"; o1.frequency.value = f; o1.detune.value = -5;
    const o2 = c.createOscillator(); o2.type = "sawtooth"; o2.frequency.value = f; o2.detune.value = 5;
    const g2 = c.createGain(); g2.gain.value = 0.6;
    const gn = c.createGain();
    const off = Math.min(dur, s0 + Math.max(0.04, len));
    const peak = g.level * vel;
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime(peak, s0 + 0.004);
    gn.gain.linearRampToValueAtTime(peak * 0.7, off);
    gn.gain.linearRampToValueAtTime(0, off + 0.04);
    const pn = makePan(c, jitter(0.15));
    o1.connect(gn); o2.connect(g2); g2.connect(gn); gn.connect(pn); pn.connect(leadBus);
    const stop = Math.min(dur, off + 0.06);
    o1.start(s0); o2.start(s0); o1.stop(stop); o2.stop(stop);
  };
  const duck = (param: AudioParam, t: number, depth: number, next: number) => {
    param.setValueAtTime(1, t);
    param.linearRampToValueAtTime(depth, t + 0.006);
    param.linearRampToValueAtTime(1, Math.min(next - 0.002, t + Math.min(0.16, beat * 0.42)));
  };

  // ── Patterns (seeded) ──
  const BASS_PATS = [[0, 1, 1, 1], [0, 0, 1, 1], [0, 1, 0, 1]]; // per beat, 16ths: 0 = rest (the kick's own 16th)
  const bassPat = BASS_PATS[Math.floor(rand() * BASS_PATS.length)];
  const STABS = [[2, 6, 10, 14], [2, 6, 11, 14], [2, 7, 10, 14], [3, 6, 10, 14]];
  const stabPat = STABS[Math.floor(rand() * STABS.length)];
  const scaleIv = minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 10];
  const scale: number[] = [];
  for (let m = 69; m <= 86; m++) if (scaleIv.indexOf(mod(m - tonicPc, 12)) >= 0) scale.push(m);
  // The riff: 8 eighths, a seeded walk, a few doubled into 16ths.
  const riff: { idx: number; on: boolean; dbl: boolean }[] = [];
  {
    let idx = Math.floor(scale.length / 2) - 2 + Math.floor(rand() * 3);
    for (let k = 0; k < 8; k++) {
      const on = k === 0 || rand() < 0.72;
      if (on) idx = clamp(idx + Math.floor(rand() * 5) - 2, 0, scale.length - 1);
      riff.push({ idx, on, dbl: on && rand() < 0.25 });
    }
  }

  // ── Kicks (on every beat, plus impacts on cuts that sit on a beat) ──
  const kicks: { t: number; vel: number }[] = [];
  // A cut on (or within 100 ms of) a beat takes the kick; the end card's hit always does.
  const impactKick = impacts.map((ct, i) => i === impacts.length - 1 || Math.abs(nearestBeat(ct) - ct) <= 0.1);
  for (let t = phase + Math.ceil((introEnd - phase) / beat - 1e-6) * beat; t < end - 1e-3; t += beat) {
    if (inBreakdown(t) && mod(Math.round((t - phase) / beat), 4) !== 0) continue;
    if (impacts.some((ct, i) => impactKick[i] && Math.abs(ct - t) < 0.15)) continue;
    kicks.push({ t, vel: 1 });
  }
  impacts.forEach((ct, i) => { if (impactKick[i]) kicks.push({ t: ct, vel: 1.1 }); });
  kicks.sort((a, b) => a.t - b.t);
  kicks.forEach((k, i) => {
    const next = i + 1 < kicks.length ? kicks[i + 1].t : k.t + beat;
    kick(k.t, k.vel);
    duck(bassDuck.gain, k.t, 0.08, next);
    duck(stabDuck.gain, k.t, 0.5, next);
    duck(padOut.gain, k.t, 0.5, next);
  });

  // ── The groove, 16th by 16th ──
  const fillCuts: number[] = [], sweepCuts: number[] = [];
  // Every other cut gets a fill or a sweep — the two alternate (seeded start);
  // the cut that ends a breakdown always gets the sweep.
  const fillFirst = rand() < 0.5 ? 0 : 1;
  cutList.forEach((ct, i) => {
    if (ct === bdTo) sweepCuts.push(ct);
    else if (i % 2 === 1) (mod(Math.floor(i / 2) + fillFirst, 2) === 0 ? fillCuts : sweepCuts).push(ct);
  });
  const inFill = (t: number) => fillCuts.some((ct) => t >= ct - beat - 1e-3 && t < ct - 1e-3);
  const leadFrom = introEnd + bar;
  for (let t = phase + Math.ceil((introEnd - phase) / s16 - 1e-6) * s16; t < end - 0.01; t += s16) {
    const n16 = Math.round((t - phase) / s16);
    const st = mod(n16, 16);          // 16th within the bar
    const inBeat = mod(n16, 4);       // 16th within the beat
    const barNo = Math.floor(n16 / 16);
    const bd = inBreakdown(t);
    const ch = chordAt(t + 0.005);
    // Hats: closed on every 16th (8ths in a breakdown), open on the off-beat 8ths.
    if (inBeat === 2) hat(t + jitter(0.002), bd ? 0.6 : 1, true);
    else if (!bd || inBeat === 0) hat(t + jitter(0.002), (inBeat === 0 ? 0.85 : 0.55) * (1 + jitter(0.12)), false);
    // Snare/clap on 2 and 4 (half time: on 3), unless a fill owns this beat.
    if (!inFill(t)) {
      if (!bd && (st === 4 || st === 12)) snare(t + jitter(0.002), 1);
      else if (bd && st === 8) snare(t, 1);
    }
    if (bd) continue;
    // Bass: rolling 16ths on the chord root (octave up on the last 16th of some beats).
    if (bassPat[inBeat] === 1) {
      let m = 36 + mod(tonicPc + ch.root - 36, 12);
      if (inBeat === 3 && mod(barNo, 2) === 1 && rand() < 0.4) m += 12;
      bassNote(m, t, s16 * 0.8, inBeat === 2 ? 1 : 0.85);
    }
    // Stabs on the off-beats.
    if (stabPat.indexOf(st) >= 0) stab(ch, t, st === 14 ? 0.9 : 1);
    // Lead riff: one bar of 8ths, repeated with variation.
    if (t >= leadFrom - 1e-3 && mod(st, 2) === 0) {
      const k = st / 2;
      const r = riff[k];
      if (r.on) {
        let idx = r.idx;
        if (mod(barNo, 4) === 3 && k >= 5) idx = clamp(idx + (k === 7 ? 2 : 1), 0, scale.length - 1); // the answer
        else if (mod(barNo, 2) === 1 && k >= 6) idx = clamp(idx - 1, 0, scale.length - 1);
        const m = scale[idx];
        if (r.dbl) { leadNote(m, t, s16 * 0.7, 1); leadNote(m, t + s16, s16 * 0.7, 0.8); }
        else leadNote(m, t, s8 * 0.75, k === 0 ? 1 : 0.9);
      }
    }
  }

  // ── Fills, sweeps, swooshes and impacts on the cuts ──
  fillCuts.forEach((ct) => { for (let k = 0; k < 4; k++) snare(ct - beat + k * s16, 0.55 + 0.15 * k); });
  sweepCuts.forEach((ct) => sweep(ct, Math.min(beat * 2, 0.9)));
  let prevCut = introEnd;
  impacts.forEach((ct, i) => {
    swoosh(ct, clamp((ct - prevCut) * 0.4, 0.15, 0.6), i === impacts.length - 1 ? 1.2 : 1);
    crash(ct, i === impacts.length - 1 ? 1.2 : 0.85, i === impacts.length - 1 ? 1.6 : 0.9);
    subDrop(ct, i === impacts.length - 1 ? 1.2 : 0.85);
    prevCut = ct;
  });

  // ── The pickup (at most a bar): a snare roll and a riser into the first downbeat ──
  if (introEnd > 0.3) {
    const from = Math.max(0, introEnd - bar);
    for (let t = from; t < introEnd - 1e-3; ) {
      const p = (t - from) / Math.max(0.1, introEnd - from);
      snare(t, 0.35 + 0.55 * p);
      t += p < 0.5 ? s8 : s16;
    }
    sweep(introEnd, Math.min(introEnd, bar));
  }
  // The first downbeat lands like a cut (its kick is the groove's first).
  crash(introEnd, 0.9, 1); subDrop(introEnd, 0.9);

  // ── The end card: one big hit and a short tail ──
  const tonic = segs[segs.length - 1].chord;
  stab(tonic, E, 1.3, 1.1);
  bassNote(36 + mod(tonicPc + tonic.root - 36, 12), E, Math.min(1.0, dur - E - 0.05), 1.1);
  let home = scale[0];
  scale.forEach((m) => { if (mod(m - tonicPc, 12) === 0 && Math.abs(m - 78) < Math.abs(home - 78)) home = m; });
  leadNote(home, E, Math.min(0.9, dur - E - 0.05), 0.9);
}
