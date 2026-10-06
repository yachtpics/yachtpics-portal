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

export type MusicMood = "calm" | "cinematic" | "elegant" | "upbeat" | "groove";
export type MusicChoice = "off" | "auto" | MusicMood;

export const MUSIC_MOODS: MusicMood[] = ["calm", "cinematic", "elegant", "upbeat", "groove"];
export const MUSIC_CHOICES: MusicChoice[] = ["off", "auto", "calm", "cinematic", "elegant", "upbeat", "groove"];
export const MUSIC_LABEL: Record<MusicChoice, string> = {
  off: "Off",
  auto: "Auto",
  calm: "Calm",
  cinematic: "Cinematic",
  elegant: "Elegant",
  upbeat: "Upbeat",
  groove: "Groove",
};

/**
 * Each look's own mood — what "Auto" means. Groove (Oct 6) is never a look's
 * default: it's picked on purpose.
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
  rhythm: "none" | "pulse" | "soft" | "full" | "groove";
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
  const fadeSec = clamp(dur - E, 2, 3);
  const fadeStart = Math.max(0.1, dur - fadeSec);
  let introEnd = firstBar + (bar >= 2.6 ? 1 : 2) * bar;
  while (introEnd < 1.6) introEnd += bar;
  introEnd = Math.min(introEnd, E * 0.5);
  const quarter = dur * 0.25;
  let anchor = quarter;
  let anchorD = dur * 0.12;
  cuts.forEach((c) => { const d = Math.abs(c - quarter); if (d < anchorD) { anchorD = d; anchor = c; } });
  let buildStart = nearestBar(anchor);
  if (buildStart < introEnd) buildStart = introEnd;
  if (buildStart > E - bar) buildStart = Math.max(introEnd, E - bar);

  // Chord segments up to the end card: bar lines, grouped by harmonic rhythm.
  const barLines: number[] = [];
  for (let t = firstBar; t < E - 1e-3; t += bar) barLines.push(t);
  if (barLines.length > 1 && E - barLines[barLines.length - 1] < 0.4 * bar) barLines.pop();
  // A pickup of under ~half a bar before the first bar line joins the first
  // chord, so the opening swell isn't cut short by a chord change.
  if (barLines.length > 2 && barLines[1] < 0.6 * bar) barLines.splice(1, 1);
  const segStarts: number[] = [];
  for (let i = 0; i < barLines.length; i += p.harmonic) segStarts.push(barLines[i]);
  const segs: Seg[] = segStarts.map((s, i) => ({ start: s, end: i + 1 < segStarts.length ? segStarts[i + 1] : E, chord: prog[i % prog.length] }));
  // The cadence: …IV (or VI) → V sus (or VII sus) → tonic on the end card.
  if (segs.length >= 3) { segs[segs.length - 1].chord = dominant; segs[segs.length - 2].chord = predominant; }
  else if (segs.length === 2) segs[1].chord = dominant;
  if (segs.length > 0 && segs[0].chord === dominant) segs[0].chord = tonic;
  segs.push({ start: E, end: dur, chord: tonic });
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
      if (groove) return; // Groove's low end is its 808 (below)
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
    if (!groove) {
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
    if (!groove) {
      const tones = keyTones(tonic);
      tones.slice(0, 4).forEach((m, i) => keyNote(m, E + i * 0.07 + jitter(0.006), 0.9 - i * 0.08, Math.min(3.5, dur - E + 0.2), (i - 1.5) * 0.18));
    }
    // A soft bell on cuts that land on a beat (no more than one a bar).
    if (!groove) {
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
    if (p.rhythm !== "none" && !groove) {
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

    // ── Riser into the end card, and the landing underneath it ──
    {
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
      if (!groove) {
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
    // by K-weighted loudness (BS.1770) to -14 LUFS instead. Other moods: as before.
    levelMaster(rendered, Math.floor(SR * Math.max(0, introEnd)), Math.floor(SR * fadeStart), groove ? -14 : null);
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
function levelMaster(buf: AudioBuffer, from: number, to: number, lufsTarget: number | null = null) {
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
  const ceil = Math.pow(10, -1 / 20); // -1 dBFS
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
