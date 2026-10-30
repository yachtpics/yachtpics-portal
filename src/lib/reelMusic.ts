/**
 * Original music for reels — composed in the browser, owned by YachtPics.
 *
 * A small deterministic composer built on the Web Audio API. The music itself
 * — key, chords, tempo, melodies, arrangement — is composed here, so a track
 * made by this file belongs to YachtPics and a broker can post it anywhere
 * without a copyright claim. Two engines play it (`engine`):
 *   • "studio" (the default, Oct 23): real instrument samples — grand piano,
 *     Rhodes, string ensemble, a warm pad, nylon guitar, finger bass, vibes,
 *     glockenspiel and a drum kit, rendered from the FluidR3 General MIDI
 *     soundfont (Frank Wen, MIT licence; see src/lib/reelSampler.ts) — on
 *     per-instrument buses with simple EQ, two generated rooms (a short room
 *     for keys and guitar, a long hall for the bed and bells), a ping-pong
 *     delay on the keys, and a gentle mastering chain. A mood fetches only
 *     the instruments it plays; they are cached after the first fetch.
 *   • "classic": the original sound, every voice synthesized (oscillators,
 *     filtered noise, a generated reverb). Kept for A/B, and played
 *     automatically when the samples can't be fetched (offline, blocked).
 * Both engines play the same notes for the same seed — the studio's own
 * choices (strum timing, its rooms) draw from a separate seeded stream — so
 * an A/B compares the sound alone.
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
 *     Studio: high-pass 30 Hz → +1 dB low shelf → +1.5 dB air shelf → a very
 *     gentle tanh saturation → a slow 2.5:1 compressor, then the same level
 *     pass by K-weighted loudness to -14 LUFS.
 * The layer descriptions above (and in each mood's comment) are the classic
 * voices; the studio voicing of each mood is listed at STUDIO_INSTRUMENTS.
 */
import type { StyleKey } from "@/lib/reelStyles";
import { discardNotes, flushNotes, loadInstruments, playHit, playNote, type DrumHit, type InstrumentName, type SampledInstrument } from "@/lib/reelSampler";

export type MusicMood = "calm" | "cinematic" | "elegant" | "upbeat" | "groove" | "lift" | "coastal" | "coastal_drive" | "sail";
export type MusicChoice = "off" | "auto" | MusicMood;

export const MUSIC_MOODS: MusicMood[] = ["calm", "cinematic", "elegant", "upbeat", "groove", "lift", "coastal", "coastal_drive", "sail"];
export const MUSIC_CHOICES: MusicChoice[] = ["off", "auto", "calm", "cinematic", "elegant", "upbeat", "groove", "lift", "coastal", "coastal_drive", "sail"];
export const MUSIC_LABEL: Record<MusicChoice, string> = {
  off: "Off",
  auto: "Auto",
  calm: "Calm",
  cinematic: "Cinematic",
  elegant: "Elegant",
  upbeat: "Upbeat",
  groove: "Groove",
  lift: "Lift",
  coastal: "Coastal",
  coastal_drive: "Coastal Drive",
  sail: "Sail",
};

/** One line on what each mood sounds like (shown under the picker). */
export const MUSIC_BLURB: Record<MusicMood, string> = {
  calm: "Soft, warm and spacious",
  cinematic: "Slow, wide and dramatic",
  elegant: "Light and refined, with a gentle beat",
  upbeat: "Bright, with a steady beat",
  groove: "Modern hip-hop beat with deep bass",
  lift: "Bright, building, uplifting",
  coastal: "Warm, melodic, feel-good",
  coastal_drive: "Coastal with more punch",
  sail: "Bright, breezy, sunlit — a tropical-house glide",
};

/**
 * Each look's own mood — what "Auto" means. Groove, Lift (Oct 6), Coastal and
 * Coastal Drive (Oct 7) are never a look's default: they're picked on purpose.
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
  /**
   * "studio" (default): sampled instruments. "classic": the original
   * oscillator sound — also what plays when the samples can't be fetched.
   */
  engine?: MusicEngine;
  /** Instrument download progress, 0…1 (studio engine, while fetching). */
  onLoadProgress?: (fraction: number) => void;
};

export type MusicEngine = "studio" | "classic";

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
  rhythm: "none" | "pulse" | "soft" | "full" | "groove" | "lift" | "coastal" | "sail";
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
  // Coastal: warm and melodic, minor leaning to its relative major, with "breaths" before cuts (see composeCoastalLayers).
  // Coastal Drive: the same world with a punchier kit and a more forward 8th-note bass.
  // Sail (Oct 27, studio only — the classic engine plays it as Coastal Drive): tropical house, major only.
  sail:      { tempo: [108, 114], harmonic: 1, keysStep: [0.5, 0.5], keysDecay: 0.5, keysLevel: 0.13, padCut: 1800, padLevel: 0.034, reverbSec: 2.6, reverbWet: 0.32, delayWet: 0.24, rhythm: "sail", minorChance: 0, riser: 0.045 },
  coastal_drive: { tempo: [126, 130], harmonic: 1, keysStep: [0.5, 0.5], keysDecay: 0.5, keysLevel: 0.13, padCut: 1700, padLevel: 0.034, reverbSec: 2.5, reverbWet: 0.32, delayWet: 0.22, rhythm: "coastal", minorChance: 1, riser: 0.045 },
  coastal:   { tempo: [118, 126], harmonic: 1, keysStep: [0.5, 0.5], keysDecay: 0.5, keysLevel: 0.13, padCut: 1600, padLevel: 0.036, reverbSec: 2.8, reverbWet: 0.36, delayWet: 0.22, rhythm: "coastal", minorChance: 1, riser: 0.04 },
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
/** Sail's keys: Bb, C, D, F, G. */
const SAIL_TONICS = [10, 0, 2, 5, 7];
/** Sail's chords: the major set plus a plain V (no sus) — the vi–IV–I–V / I–V–vi–IV family. */
const SAIL_CH: Record<string, Chord> = { ...MAJ, V: { root: 7, pad: [4, 7, 14], arp: [0, 4, 7, 12] } };
const SAIL_PROGS = [
  ["vi", "IV", "I", "V"],
  ["I", "V", "vi", "IV"],
  ["IV", "I", "V", "vi"],
  ["vi", "IV", "I", "Vsus"],
  ["I", "vi", "IV", "V"],
];

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

// ── The studio engine: instruments, rooms, buses (Oct 23) ────────────────

/**
 * What each mood plays in the studio engine (only these packs are fetched).
 * Oct 23, from the owner's ear: no vibes or glockenspiel anywhere (they made
 * it sound like a child's toy) — a cut is marked by one soft piano note two
 * octaves over the chord root in the hall (a quiet strings swell in
 * Cinematic) — and every track develops instead of looping (makePlan,
 * developHarmony): a second progression in the middle, keys/guitar patterns
 * and register that keep changing, answered motifs, drop-outs, a light →
 * full → thinning arc, and drums that vary every 4 bars. Older notes below
 * still describe the voices; where they mention vibes or glockenspiel, read
 * the above.
 *   • Calm — the bed is the warm pad with the string ensemble a little
 *     quieter, detuned and 30 ms behind it (panned the other way, for width);
 *     piano for the sparse arpeggio, with the ping-pong delay; the sub bass
 *     kept for the root and a soft finger bass an octave up; glockenspiel
 *     for the bells on cuts.
 *   • Cinematic — strings carry the chords (a low root-and-fifth and a high
 *     voicing, swelling in slowly), the pad underneath, piano low octaves on
 *     the downbeats, floor tom + a round kick as the soft pulse, and a long,
 *     very quiet reversed crash into the end card (with the crash on it).
 *   • Elegant — Rhodes chords, piano arpeggio, nylon-guitar dyads on the
 *     off-beats, a brushes-style kit (shaker, rim, soft hat, soft kick),
 *     finger bass over a quieter sub.
 *   • Upbeat — Rhodes (held, then stabs in the build), piano arpeggio,
 *     finger bass, kick + snap + hats + shaker, a quiet tambourine on 2 and 4,
 *     vibes on the cuts.
 *   • Groove — Rhodes plays the lead motif; finger bass layered on the 808
 *     sub; kick, snap + snare, hats (open hats in the build); the warm pad.
 *   • Lift — piano drives the 8ths (its filter opening into the drop), the
 *     warm pad, strings swelling in over the riser and carrying the drop,
 *     glockenspiel sparkle, drums joining in stages (soft kick; then hats
 *     and a snare roll; then the full kit), crash on the drop and end card.
 *     The clean synth bass stays.
 *   • Coastal — a picked nylon guitar (below C5) and Rhodes chords, a short
 *     answered Rhodes motif as the top line, finger bass over the sine bass;
 *     kick, swung shaker and rim. (The strums and the vibes lead went Oct 23.)
 *   • Coastal Drive (reworked Oct 23 — the owner heard "a sample song on a
 *     child's toy"): fewer voices, more space. Held Rhodes chords over a quiet
 *     pad; ONE picked nylon guitar, kept below C5; finger bass + sub; a few
 *     short Rhodes motifs an octave over the chords (one phrase in four bars)
 *     instead of the vibes lead; a relaxed kit — kick, swung shaker, rim on 2
 *     and 4, a very quiet hat, a soft snare on beat 4 of every other bar. Its
 *     tempo stays within ~6 BPM of Coastal's: the drive is the kick and bass.
 *   Both Coastal moods are humanized (makeFeel): seeded ±6–10 ms timing, ±12%
 *   velocity with a downbeat accent, ~55% swing on guitar and shaker 8ths, and
 *   guitar notes of different lengths, some ringing over the next.
 * Every mood keeps the noise riser into the end card and its sub bloom.
 */
const STUDIO_INSTRUMENTS: Record<MusicMood, InstrumentName[]> = {
  calm: ["pad", "strings", "piano", "bass"],
  cinematic: ["strings", "pad", "piano", "drums"],
  elegant: ["epiano", "piano", "nylon", "bass", "drums"],
  upbeat: ["piano", "pad", "strings", "bass", "drums"],
  groove: ["pad", "epiano", "piano", "strings", "bass", "drums"],
  lift: ["pad", "piano", "strings", "drums"],
  coastal: ["epiano", "nylon", "bass", "drums"],
  coastal_drive: ["epiano", "nylon", "bass", "pad", "strings", "drums"],
  sail: ["pad", "strings", "nylon", "bass", "drums"],
};

/**
 * Studio level into the master's saturation and compressor, in dB per mood:
 * set by measurement (Oct 23) so the mix's peaks reach about -0.5 dBFS at the
 * saturation — under 1 dB taken off the very loudest moments — and the
 * compressor, seeing the body of the track around -15 dBFS, works 1–2 dB.
 */
const STUDIO_DRIVE_DB: Record<MusicMood, number> = {
  calm: -2.2, cinematic: -3.2, elegant: -2.3, upbeat: -4.3, groove: -6.4, lift: -2.6, coastal: -5.9, coastal_drive: -7.2, sail: -5,
};

/** How much of the classic sub bass stays under the finger bass (Calm and Cinematic keep it all). */
const STUDIO_SUB: Record<MusicMood, number> = {
  calm: 1, cinematic: 1, elegant: 0.45, upbeat: 0.45, groove: 1, lift: 1, coastal: 1, coastal_drive: 1, sail: 1,
};

/** Studio bus levels (relative; the level pass sets the overall loudness). */
const STUDIO_TRIM = { bed: 0.5, strings: 0.5, keys: 0.5, guitar: 0.5, bells: 0.35, bass: 0.55, kit: 0.6, perc: 0.45, pluck: 0.5 };
type StudioBus = keyof typeof STUDIO_TRIM;

/**
 * The studio mix sheet: each bus's level per mood, in dB on top of
 * STUDIO_TRIM. Set by measurement (Oct 23): every bus rendered solo, its
 * gated loudness compared with the mood's lead, and the whole mix kept at
 * the classic engine's loudness so the synth parts that stay (sub, 808,
 * riser) keep the weight they had.
 */
const STUDIO_MIX: Record<MusicMood, Partial<Record<StudioBus, number>>> = {
  // Lead: the piano; the bed 2 LU under it, the finger bass well under the sub.
  calm: { keys: 6.7, bed: -7.6, bass: 2.7, bells: 15.2 },
  // Lead: the strings; piano 4 LU under, the pulse far back.
  cinematic: { bed: -1.4, keys: 2.9, kit: 2, bells: 8.8 },
  elegant: { keys: 4.3, bed: -1.4, guitar: 0.5, bass: -2.7, kit: 3.6, perc: 7.1, bells: 14.4 },
  // Upbeat, Groove, Coastal Drive and Sail: the lively arrangement (Oct 30), set
  // by measurement around the hook (pluck bus = 0): chords -3 LU, pad -6, finger
  // bass -5, sub/808 -4 (Groove's 808 +1), kick and snare -1, hats -6, guitar -8.
  upbeat: { pluck: 5.8, keys: 3.3, strings: -3.2, bass: -3.8, kit: 5.7, perc: 7.6 },
  groove: { keys: 3.1, strings: -2.2, bass: 1.6, kit: 6.6, perc: 8 },
  lift: { keys: -0.5, bed: -12.8, strings: -4.5, kit: -1.6, perc: 0.9, bells: 8.6 },
  // Lead: the vibes; the guitars 2 LU under, the Rhodes bed 6.
  // Oct 23, owner's ear ("a little tinny"): finger bass +2.5 dB, Rhodes +1.5 dB,
  // Coastal's kick +1.5 dB (and the guitar bus EQ'd warmer — see makeStudio).
  coastal: { keys: 4.3, guitar: 3.1, bed: 1, bass: 0.7, kit: 4.4, perc: 10.1 },
  coastal_drive: { pluck: 4.5, keys: 1.7, strings: -2.8, guitar: 7.2, bass: -1.9, kit: 5.8, perc: 7.7 },
  sail: { pluck: 6.2, strings: -2.7, guitar: 6.6, bass: -2.5, kit: 4.5, perc: 7.8 },
};

/** The keys/guitar (and bed) dip under each kick: about -1.5 dB for ~120 ms. */
const DUCK_DEPTH = 0.84;

/** tanh soft-clip over ±2 (the shaper is fed half the signal): unity when quiet, about -0.8 dB at full scale. */
function saturationCurve(): Float32Array<ArrayBuffer> {
  const n = 2048, k = 0.55, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 2;
    curve[i] = Math.tanh(k * x) / k;
  }
  return curve;
}

/**
 * A generated space for the studio engine — makeImpulse grown up: separate
 * left and right noise (a wide tail), a pre-delay, a few early reflections,
 * a 25 ms build into a tail that darkens as it decays (to -60 dB at `sec`).
 * Scaled to unit energy per channel, with the convolver's own normalisation
 * off, so a send level means the same thing whatever the room's length.
 */
function makeSpace(ctx: BaseAudioContext, sec: number, rand: () => number, o: { predelay: number; damp: number; early: number }): AudioBuffer {
  const sr = ctx.sampleRate;
  const pre = Math.floor(o.predelay * sr);
  const len = pre + Math.floor(sec * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const build = Math.floor(0.025 * sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let k = 0; k < 8; k++) {
      const at = pre + Math.floor((0.004 + rand() * 0.066) * sr);
      if (at < len) d[at] += (rand() < 0.5 ? -1 : 1) * o.early * (1 - k / 10);
    }
    let y = 0;
    const tail = len - pre;
    for (let i = 0; i < tail; i++) {
      const t = i / tail;
      const x = (rand() * 2 - 1) * Math.exp(-6.9 * t) * Math.min(1, i / build);
      y += Math.max(0.05, 0.75 - o.damp * t) * (x - y);
      d[pre + i] += y;
    }
    let e = 0;
    for (let i = 0; i < len; i++) e += d[i] * d[i];
    const sc = 1 / Math.sqrt(e || 1);
    for (let i = 0; i < len; i++) d[i] *= sc;
  }
  return buf;
}

/** The studio's buses: each takes notes in and sums (EQ'd, with its sends) into the master. */
type StudioMix = {
  /** The bed's EQ (high-pass, presence dip), inserted after the arrangement's pad filter. */
  bedIn: AudioNode; bedOut: AudioNode;
  /** After the pad chain's own output: ducked under kicks where asked, with the hall send. */
  bedDuck: AudioNode;
  strings: AudioNode; keys: AudioNode; guitar: AudioNode; bells: AudioNode; bass: AudioNode; kit: AudioNode; perc: AudioNode;
  /** Sail's synth pluck: high-passed at 200 Hz, a gentle -1.5 dB above 8 kHz (bright, not tinny), the 3/16 delay. */
  pluck: AudioNode;
  hall: AudioNode;
  /** Dip the keys and guitar (and the bed, where asked) under a kick at `t`. */
  duck: (t: number) => void;
  /** The studio's own seeded stream (strum timing, small velocity variations). */
  rand: () => number;
  /** The arrangement plan (patterns, register, drum variants, drop-outs, arc). */
  plan: DevPlan;
};

function makeStudio(c: BaseAudioContext, master: AudioNode, delayIn: AudioNode, rand: () => number, hallSec: number, duckBed: boolean, mood: MusicMood, plan: DevPlan): StudioMix {
  const trim = (b: StudioBus) => STUDIO_TRIM[b] * Math.pow(10, (STUDIO_MIX[mood][b] ?? 0) / 20);
  const filt = (type: BiquadFilterType, f: number, q = 0.7, gainDb = 0) => {
    const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = gainDb; return b;
  };
  const send = (from: AudioNode, to: AudioNode, amt: number) => {
    if (!(amt > 0)) return;
    const g = c.createGain(); g.gain.value = amt; from.connect(g); g.connect(to);
  };
  const space = (sec: number, predelay: number, damp: number, early: number, hpHz: number) => {
    const cv = c.createConvolver();
    cv.normalize = false; // the impulse is already unit energy (see makeSpace)
    cv.buffer = makeSpace(c, sec, rand, { predelay, damp, early });
    const hp = filt("highpass", hpHz); // no low-end mud from the tails
    cv.connect(hp); hp.connect(master);
    return cv;
  };
  const hall = space(hallSec, 0.024, 0.55, 0.35, 170);
  const room = space(1.0, 0.006, 0.3, 0.6, 140);

  const ducked: GainNode[] = [];
  const duckTimes = new Map<GainNode, number[]>();
  const bus = (o: { hp?: number; lp?: number; dip?: boolean; subShelf?: number; shelves?: [BiquadFilterType, number, number][]; trim: number; room?: number; hall?: number; delay?: number; duck?: boolean }) => {
    const input = c.createGain();
    let head: AudioNode = input;
    if (o.hp) { const f = filt("highpass", o.hp); head.connect(f); head = f; }
    if (o.subShelf) { const f = filt("lowshelf", 80, 0.7, o.subShelf); head.connect(f); head = f; }
    if (o.lp) { const f = filt("lowpass", o.lp, 0.5); head.connect(f); head = f; }
    // A gentle presence dip where a voice-over lives, so the music sits under it.
    if (o.dip) { const f = filt("peaking", 2600, 0.8, -2.5); head.connect(f); head = f; }
    (o.shelves ?? []).forEach(([type, f0, db]) => { const f = filt(type, f0, 0.7, db); head.connect(f); head = f; });
    const out = c.createGain(); out.gain.value = o.trim;
    head.connect(out);
    let tail: AudioNode = out;
    if (o.duck) { const d = c.createGain(); out.connect(d); ducked.push(d); tail = d; }
    tail.connect(master);
    send(tail, room, o.room ?? 0);
    send(tail, hall, o.hall ?? 0);
    send(tail, delayIn, o.delay ?? 0);
    return input;
  };

  // The bed: EQ in the pad chain; its output ducked (where asked) and sent to the hall.
  const bedIn = c.createGain();
  const bedHp = filt("highpass", 100);
  const bedDip = filt("peaking", 2600, 0.8, -2.5);
  const bedOut = c.createGain(); bedOut.gain.value = trim("bed");
  bedIn.connect(bedHp); bedHp.connect(bedDip); bedDip.connect(bedOut);
  const bedDuck = c.createGain();
  bedDuck.connect(master);
  send(bedDuck, hall, 0.45);
  send(bedDuck, room, 0.08);
  if (duckBed) ducked.push(bedDuck);

  const mix: StudioMix = {
    bedIn, bedOut, bedDuck, hall, rand, plan,
    strings: bus({ hp: 110, dip: true, trim: trim("strings"), hall: 0.4, room: 0.06 }),
    keys: bus({ hp: 90, trim: trim("keys"), room: 0.22, hall: 0.2, delay: 0.5, duck: true }),
    // Coastal moods (owner's ear, Oct 23: "a little tinny"): the nylon gets a
    // 120 Hz high-pass, +1.5 dB of low-mid warmth at 250 Hz and -2 dB above 6 kHz.
    guitar: mood === "coastal" || mood === "coastal_drive"
      ? bus({ hp: 120, shelves: [["lowshelf", 250, 1.5], ["highshelf", 6000, -2]], trim: trim("guitar"), room: 0.3, hall: 0.12, delay: 0.3, duck: true })
      : bus({ hp: 110, trim: trim("guitar"), room: 0.3, hall: 0.12, delay: 0.3, duck: true }),
    bells: bus({ hp: 250, trim: trim("bells"), hall: 0.5, delay: 0.25 }),
    bass: bus({ lp: 2500, trim: trim("bass") }),
    // The sampled kicks carry ~9 dB more energy around 50 Hz than the classic
    // ones (measured): phones can't play it and it costs the limiter headroom,
    // so it's shelved down, keeping the punch above 80 Hz.
    kit: bus({ hp: 40, subShelf: -4, trim: trim("kit"), room: 0.12 }),
    perc: bus({ hp: 300, trim: trim("perc"), room: 0.2, hall: 0.06 }),
    pluck: bus({ hp: 200, shelves: [["highshelf", 8000, -1.5]], trim: trim("pluck"), room: 0.15, hall: 0.18, delay: 0.5, duck: true }),
    duck: (t: number) => {
      if (!(t >= 0) || !isFinite(t)) return;
      ducked.forEach((d) => {
        // One dip at a time: a kick inside another's 120 ms window is left alone.
        const times = duckTimes.get(d) ?? [];
        if (times.some((x) => Math.abs(x - t) < 0.125)) return;
        times.push(t); duckTimes.set(d, times);
        d.gain.setValueAtTime(1, t);
        d.gain.linearRampToValueAtTime(DUCK_DEPTH, t + 0.012);
        d.gain.linearRampToValueAtTime(1, t + 0.12);
      });
    },
  };
  return mix;
}

// ── Development: so a track grows instead of looping (studio, Oct 23) ──────

/** Borrowed chords for the major keys' second progression. */
const MAJ_X: Record<string, Chord> = {
  iv:   { root: 5,  pad: [3, 7, 10, 14], arp: [0, 3, 7, 10] },
  bVII: { root: 10, pad: [4, 7, 11, 14], arp: [0, 4, 7, 11] },
};
/** Second progressions (the middle section): relative minor, IV-based, or a borrowed iv / ♭VII turn. */
const MAJ_B = [["vi", "iii", "ii", "Vsus"], ["IV", "iv", "I", "vi"], ["ii", "IV", "bVII", "Vsus"], ["vi", "ii", "IV", "iv"]];
const MIN_B = [["iv", "VI", "III", "VIIsus"], ["VI", "iv", "i", "VIIsus"], ["III", "iv", "VI", "VIIsus"]];
const CO_B = [["iv", "VI", "i", "VII"], ["VI", "iv", "III", "VII"], ["iv", "i", "VI", "VII"]];

/**
 * The middle section moves to a second, related progression for 4–8 bars
 * from segment `from`, then the opening progression returns for the bars
 * before the cadence (which, with the end card, is left alone).
 */
function developHarmony(segs: Seg[], from: number, kind: "maj" | "min" | "co", rand: () => number, harmonic: number) {
  const end = segs.length - 3; // the cadence's first chord
  const avail = end - from;
  if (from < 1 || avail < 2) return;
  const lenB = clamp(Math.round(avail * 0.6), 2, Math.min(avail, harmonic === 2 ? 4 : 8));
  const table: Record<string, Chord> = kind === "maj" ? { ...MAJ, ...MAJ_X } : kind === "min" ? MIN : CO;
  const opts = kind === "maj" ? MAJ_B : kind === "min" ? MIN_B : CO_B;
  const prog = opts[Math.floor(rand() * opts.length)].map((k) => table[k]);
  for (let k = 0; k < lenB; k++) segs[from + k].chord = prog[k % prog.length];
}

/** Keys / arpeggio / guitar patterns: an order through the chord and which 8ths of the bar play. */
const STUDIO_PATTERNS: { order: number[]; mask: number[] }[] = [
  { order: [0, 1, 2, 3, 2, 1, 2, 3], mask: [1, 1, 1, 1, 1, 1, 1, 1] }, // rolling up and back
  { order: [0, 1, 2, 3, 4, 3, 2, 1], mask: [1, 0, 1, 1, 0, 1, 1, 0] }, // rising, with space
  { order: [4, 3, 2, 1, 3, 2, 1, 0], mask: [1, 1, 0, 1, 1, 0, 1, 0] }, // falling
  { order: [0, 2, 1, 3, 0, 2, 4, 2], mask: [1, 0, 0, 1, 0, 1, 1, 0] }, // broken, sparse
];
/** Register per 4-bar block: an inversion, and sometimes the octave below. */
const VOICINGS = [{ inv: 0, oct: 0 }, { inv: 1, oct: 0 }, { inv: 2, oct: -12 }, { inv: 1, oct: -12 }];

/** Chord tones re-voiced: `inv` lowest notes moved up an octave, the lot shifted by `oct`, kept at or under `max`. */
function voiceTones(tones: number[], v: { inv: number; oct: number }, max = 96): number[] {
  const t = tones.slice();
  for (let i = 0; i < v.inv && i < t.length - 1; i++) t.push((t.shift() as number) + 12);
  return t.map((m) => { let x = m + v.oct; while (x > max) x -= 12; return x; });
}

/** The studio's arrangement plan for one track (seeded; see makePlan). */
type DevPlan = {
  /** Which STUDIO_PATTERNS entry a bar plays (never the same three bars running). */
  pattern: (t: number) => number;
  /** The register of the 4-bar block (always different from the block before). */
  voicing: (t: number) => { inv: number; oct: number };
  /** The drum variant of the 4-bar block, 0–3 (always different from the block before). */
  drums: (t: number) => number;
  /** 4-bar block number, and the bar's place in it (0–3). */
  block: (t: number) => number;
  barInBlock: (t: number) => number;
  /** The arc: ~0.65 → 1 over the first third, 1 through the middle, thinning to ~0.72 into the end card. */
  fullness: (t: number) => number;
  /** Inside a 2-bar drop-out of that kind (drums out, or keys/guitar out leaving pad and bass). */
  out: (kind: "drums" | "keys", t: number) => boolean;
};

function makePlan(rand: () => number, o: { firstBar: number; bar: number; dur: number; E: number; introEnd: number; cuts: number[]; drums: boolean }): DevPlan {
  const { firstBar, bar, dur, E, introEnd } = o;
  const n = Math.ceil((dur - firstBar) / bar) + 2;
  const barOf = (t: number) => clamp(Math.floor((t - firstBar) / bar + 1e-6), 0, n - 1);
  const count = STUDIO_PATTERNS.length;
  const pats: number[] = [];
  for (let k = 0; k < n; k++) {
    let p = k === 0 ? Math.floor(rand() * count) : pats[k - 1];
    if (k > 0 && rand() < 0.55) p = Math.floor(rand() * count);
    if (k >= 2 && pats[k - 1] === pats[k - 2] && p === pats[k - 1]) p = (p + 1 + Math.floor(rand() * (count - 1))) % count;
    pats.push(p);
  }
  const pick = (prev: number | undefined, m: number) => {
    let x = Math.floor(rand() * m);
    if (x === prev) x = (x + 1 + Math.floor(rand() * (m - 1))) % m;
    return x;
  };
  const voi: number[] = [], drm: number[] = [];
  for (let b = 0; b < Math.ceil(n / 4) + 1; b++) {
    voi.push(b === 0 ? 0 : pick(voi[b - 1], VOICINGS.length));
    drm.push(b === 0 ? 0 : pick(drm[b - 1], 4));
  }
  // Drop-outs: one in a short reel, two in a longer one, each 2 bars, back on a cut when one is near.
  const outs: { kind: "drums" | "keys"; from: number; to: number }[] = [];
  const span = E - introEnd;
  const want = span >= 16 * bar ? 2 : span >= 7 * bar ? 1 : 0;
  const room = span - 5 * bar;
  for (let i = 0; i < want; i++) {
    const lo = introEnd + 2 * bar + (want === 2 && i === 1 ? room / 2 : 0);
    const hi = introEnd + 2 * bar + (want === 2 && i === 0 ? room / 2 : room);
    const r = rand();
    if (!(hi > lo)) continue;
    const from = firstBar + Math.round((lo + r * (hi - lo) - firstBar) / bar) * bar;
    let to = from + 2 * bar;
    let best = Infinity;
    o.cuts.forEach((ct) => { const d = Math.abs(ct - to); if (d <= bar * 0.5 && d < best && ct < E - bar) { best = d; to = ct; } });
    if (from < introEnd || to > E - bar) continue;
    const kind: "drums" | "keys" = !o.drums ? "keys" : outs.length && outs[0].kind === "drums" ? "keys" : outs.length ? "drums" : rand() < 0.5 ? "drums" : "keys";
    outs.push({ kind, from, to });
  }
  return {
    pattern: (t) => pats[barOf(t)],
    voicing: (t) => VOICINGS[voi[Math.floor(barOf(t) / 4)]],
    drums: (t) => drm[Math.floor(barOf(t) / 4)],
    block: (t) => Math.floor(barOf(t) / 4),
    barInBlock: (t) => barOf(t) % 4,
    fullness: (t) => {
      if (t < introEnd) return 0.6;
      if (t >= E - 1e-3) return 1;
      const x = (t - introEnd) / Math.max(1e-3, E - introEnd);
      return x < 0.33 ? 0.65 + 0.35 * (x / 0.33) : x < 0.75 ? 1 : 1 - 0.28 * ((x - 0.75) / 0.25);
    },
    out: (kind, t) => outs.some((w) => w.kind === kind && t >= w.from - 1e-3 && t < w.to - 1e-3),
  };
}

/**
 * Studio feel for the Coastal moods (Oct 23). Busy, perfectly quantized,
 * equal-velocity parts are what make General-MIDI arrangements sound like a
 * toy's demo song; a player is a little early or late, leans on the downbeat
 * and swings the off-beats. Seeded (the studio's own stream), so a seed still
 * gives the same performance every time.
 */
function makeFeel(rand: () => number, phase: number, beat: number, swing = 0.55) {
  const bar = 4 * beat;
  return {
    /** An off-beat 8th moved late: `swing` of the beat instead of half (0.5 = straight). */
    swing: (t: number) => (Math.abs(mod((t - phase) / beat, 1) - 0.5) < 0.01 ? t + (swing - 0.5) * beat : t),
    /** 6–10 ms early or late. */
    time: (t: number) => Math.max(0, t + (rand() < 0.5 ? -1 : 1) * (0.006 + rand() * 0.004)),
    /** ±12%, and an accent on the bar's downbeat. */
    vel: (v: number, t: number) => {
      const down = mod(t - phase + 0.02, bar) < 0.04;
      return clamp(v * (1 + (rand() - 0.5) * 0.24) * (down ? 1.12 : 1), 0.05, 1);
    },
  };
}

// ── The composer ──────────────────────────────────────────────────────────

/**
 * Compose the music for a reel. The studio engine (default) fetches the
 * mood's instruments first (cached after the first time); if they can't be
 * had — offline, blocked — or the studio render fails, the classic engine
 * plays instead and this still resolves.
 */
export async function composeReelMusic(opts: ComposeOptions): Promise<AudioBuffer> {
  if (!offlineCtor()) throw new Error("This browser can’t make music (no Web Audio).");
  if ((opts.engine ?? "studio") === "studio") {
    let ready = false;
    try {
      await loadInstruments(STUDIO_INSTRUMENTS[opts.mood], opts.onLoadProgress);
      ready = true;
    } catch (err) {
      console.warn("Reel music: instruments unavailable; using the classic sound.", err);
    }
    if (ready) {
      try {
        return await composeTrack(opts, true);
      } catch (err) {
        console.warn("Reel music: the studio sound failed; using the classic sound.", err);
      }
    }
  }
  // The classic engine has no Sail of its own: it plays Coastal Drive's
  // voicing, so the A/B checkbox still has something to compare.
  return composeTrack(opts.mood === "sail" ? { ...opts, mood: "coastal_drive" } : opts, false);
}

async function composeTrack(opts: ComposeOptions, studio: boolean): Promise<AudioBuffer> {
  const Ctor = offlineCtor();
  if (!Ctor) throw new Error("This browser can’t make music (no Web Audio).");
  const SR = MUSIC_SAMPLE_RATE;
  const dur = Math.max(2, opts.durationSec);
  const length = Math.max(1, Math.round(dur * SR));
  // Studio Coastal Drive (Oct 23): its drive comes from the kick and bass, not
  // speed — a tempo within ~6 BPM of Coastal's (118–126). Classic keeps 126–130.
  const p: MoodParams = studio && opts.mood === "coastal_drive" ? { ...MOOD.coastal_drive, tempo: [120, 124] }
    // Studio Upbeat (Oct 30, "more lively"): a pop tempo.
    : studio && opts.mood === "upbeat" ? { ...MOOD.upbeat, tempo: [112, 120] }
    : MOOD[opts.mood];
  /** The lively arrangement's style (studio Upbeat, Groove, Coastal Drive, Sail — Oct 30); null otherwise. */
  const live: LiveStyle | null = studio ? LIVE_STYLES[opts.mood] ?? null : null;
  const groove = opts.mood === "groove";
  const lift = opts.mood === "lift";
  const coastalDrive = opts.mood === "coastal_drive";
  const coastal = opts.mood === "coastal" || coastalDrive; // Coastal Drive shares Coastal's world
  const sail = opts.mood === "sail";
  const rand = mulberry32((opts.seed >>> 0) ^ seedFromString(opts.mood));
  const jitter = (amt: number) => (rand() - 0.5) * 2 * amt;
  // The studio's own choices draw from a separate stream, so `rand` stays in
  // step with the classic engine and both play the same notes for a seed.
  const srand = mulberry32(((opts.seed >>> 0) ^ seedFromString(opts.mood + ":studio")) >>> 0);

  const cuts = Array.from(new Set(opts.cutTimesSec.filter((c) => isFinite(c) && c > 0.3 && c < dur - 0.3).map((c) => Math.round(c * 1000) / 1000))).sort((a, b) => a - b);

  // Key, mode, progression.
  const tonicPc = sail ? SAIL_TONICS[Math.floor(rand() * SAIL_TONICS.length)] : TONICS[Math.floor(rand() * TONICS.length)];
  const minor = rand() < p.minorChance;
  const table = minor ? MIN : MAJ;
  const prog = sail
    ? SAIL_PROGS[Math.floor(rand() * SAIL_PROGS.length)].map((k) => SAIL_CH[k])
    : (minor ? MIN_PROGS : MAJ_PROGS)[Math.floor(rand() * (minor ? MIN_PROGS.length : MAJ_PROGS.length))].map((k) => table[k]);
  const tonic = minor ? MIN.i : MAJ.I;
  const dominant = minor ? MIN.VIIsus : MAJ.Vsus;
  const predominant = minor ? MIN.VI : MAJ.IV;
  const keysPattern = KEYS_PATTERNS[Math.floor(rand() * KEYS_PATTERNS.length)];

  // The grid.
  const grid = fitGrid(cuts, p, opts.bpm ?? null, rand);
  // Lift: the drop lands ON a cut — the one nearest 45% (preferring 40–50%) —
  // and the grid is turned so that cut is a downbeat.
  let liftDrop: number | null = null;
  // Lively: the first drop lands ON the cut nearest 4–6 bars in (after the
  // intro and build), and the grid is turned so that cut is a downbeat.
  let liveDrop: number | null = null;
  if (live) {
    const bar0 = 240 / grid.bpm;
    let E0 = opts.endCardStartSec ?? NaN;
    if (!isFinite(E0) || E0 <= 1 || E0 > dur - 0.8) E0 = Math.max(dur * 0.85, dur - 3);
    const nb = E0 / bar0;
    const target = (nb >= 14 ? 6 : nb >= 9 ? 4 : nb >= 6 ? 3 : 2) * bar0;
    let bestD = Infinity;
    cuts.forEach((ct) => {
      const d = Math.abs(ct - target);
      if (d <= bar0 * 1.25 && ct >= bar0 * 1.5 && ct <= E0 - 2 * bar0 && d < bestD) { bestD = d; liveDrop = ct; }
    });
    if (liveDrop === null) liveDrop = target;
    grid.phase = mod(liveDrop, bar0);
  } else if (lift || sail) { // Sail's drop is placed the same way
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
  if ((lift || sail) && liftDrop !== null) buildStart = clamp(liftDrop, introEnd, Math.max(introEnd, E - bar));
  const livePlan: LivePlan | null = live && liveDrop !== null ? planLively(liveDrop, bar, E, cuts) : null;
  if (livePlan) buildStart = livePlan.d1;
  if (coastal) buildStart = introEnd;

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
  // Coastal has its own harmony: minor, leaning to the relative major, resolving there.
  if (coastal) assignCoastalChords(segs, rand);
  // Studio: the middle moves to a second, related progression, so no reel is
  // one 4-chord loop from start to finish (after 8 bars, or at the build).
  if (livePlan && segs.length >= 4) {
    // Lively harmony: the opening progression from the top of each drop (and
    // the intro and builds), a second related one through the breakdown, the
    // cadence into the end card as before.
    const A = (coastal && segs.length >= 7 ? segs.slice(0, 4).map((sg) => sg.chord) : prog).slice(0, 4);
    const kind = coastal ? "co" : minor ? "min" : "maj";
    const tbl: Record<string, Chord> = kind === "maj" ? { ...(sail ? SAIL_CH : MAJ), ...MAJ_X } : kind === "min" ? MIN : CO;
    const optsB = kind === "maj" ? MAJ_B : kind === "min" ? MIN_B : CO_B;
    const B = optsB[Math.floor(srand() * optsB.length)].map((k) => tbl[k]);
    const bounds = [firstBar, livePlan.b1, livePlan.d1, livePlan.bk, livePlan.b2, livePlan.d2];
    for (let i = 0; i < segs.length - 3; i++) {
      const t = segs[i].start + 1e-3;
      const from = bounds.filter((x) => x <= t).reduce((m, x) => Math.max(m, x), firstBar);
      const inB = t >= livePlan.bk && t < livePlan.d2 && livePlan.b2 > livePlan.bk;
      const n = segs.filter((sg, j) => j < i && sg.start >= from - 1e-3).length;
      segs[i].chord = inB ? B[n % 4] : A[n % 4];
    }
  } else if (studio && segs.length >= 5) {
    const target = Math.min(firstBar + 8 * bar, Math.max(buildStart, introEnd + bar));
    let from = segs.findIndex((sg) => sg.start >= target - 1e-3);
    if (lift) from = Math.max(from, segs.findIndex((sg) => sg.start >= buildStart - 1e-3) + 1); // the drop keeps its home chord
    if (from > 0) developHarmony(segs, from, coastal ? "co" : minor ? "min" : "maj", srand, p.harmonic);
  }
  /** The studio's arrangement plan (null in the classic engine). */
  const plan: DevPlan | null = studio ? makePlan(srand, { firstBar, bar, dur, E, introEnd, cuts, drums: opts.mood !== "calm" }) : null;
  const chordAt = (t: number): Chord => {
    for (let i = segs.length - 1; i >= 0; i--) if (t >= segs[i].start - 1e-4) return segs[i].chord;
    return segs[0].chord;
  };

  let ctx: OfflineAudioContext | null = new Ctor(2, length, SR);
  try {
    const c = ctx;
    // ── Buses ──
    const master = c.createGain();
    const fade = c.createGain();
    if (studio) {
      // Rumble out, a touch of weight and air, a very gentle tanh saturation
      // (about 1 dB off the peaks: glue, not grit), then a slow, soft-kneed
      // compressor. The level pass after rendering sets the loudness.
      const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 30; hp.Q.value = 0.7;
      // +2 dB of weight for the Coastal moods (owner's ear, Oct 23), +1 elsewhere.
      const low = c.createBiquadFilter(); low.type = "lowshelf"; low.frequency.value = 100; low.gain.value = coastal || sail || live ? 2 : 1;
      const air = c.createBiquadFilter(); air.type = "highshelf"; air.frequency.value = 10000; air.gain.value = 1.5;
      const drive = c.createGain(); drive.gain.value = Math.pow(10, STUDIO_DRIVE_DB[opts.mood] / 20) * 0.5; // the shaper's ±1 is ±2 of signal
      const shaper = c.createWaveShaper(); shaper.curve = saturationCurve(); shaper.oversample = "2x";
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 2.5; comp.attack.value = 0.02; comp.release.value = 0.25; comp.knee.value = 12;
      // Lively: a firmer bus compressor — the glue of a produced track.
      if (live) { comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.15; comp.knee.value = 6; }
      master.connect(hp); hp.connect(low); low.connect(air); air.connect(drive); drive.connect(shaper); shaper.connect(comp); comp.connect(fade);
    } else {
      const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 28; hp.Q.value = 0.7;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -18; comp.knee.value = 10; comp.ratio.value = 3; comp.attack.value = 0.02; comp.release.value = 0.25;
      if (coastal) { comp.threshold.value = -19; comp.ratio.value = 3; comp.attack.value = 0.015; comp.release.value = 0.22; }
      if (lift) { comp.threshold.value = -19; comp.ratio.value = 3.5; comp.attack.value = 0.012; comp.release.value = 0.2; }
      if (groove) { comp.threshold.value = -20; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.18; }
      master.connect(hp); hp.connect(comp); comp.connect(fade);
    }
    fade.connect(c.destination);
    fade.gain.setValueAtTime(0, 0);
    fade.gain.linearRampToValueAtTime(1, 0.04);
    const curve = new Float32Array(64);
    for (let i = 0; i < 64; i++) curve[i] = Math.cos((i / 63) * Math.PI / 2);
    fade.gain.setValueCurveAtTime(curve, fadeStart, Math.max(0.05, dur - fadeStart - 0.002));

    // The classic room. Its impulse is made in both engines because it draws
    // from the seeded stream (the studio has its own rooms, made below).
    const classicIr = makeImpulse(c, p.reverbSec, rand);
    const reverb = c.createConvolver();
    if (!studio) {
      reverb.buffer = classicIr;
      const reverbRet = c.createGain(); reverbRet.gain.value = p.reverbWet * 2.5; // the convolver normalizes its impulse, which runs quiet
      reverb.connect(reverbRet); reverbRet.connect(master);
    }

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
    delayRet.connect(master);

    // The studio's buses and rooms (null in the classic engine). Lift and
    // Coastal already pump the bed under their kicks, so only the keys dip there.
    const mixer = studio ? makeStudio(c, master, delayIn, srand, p.reverbSec * 1.35, !lift && !coastal && !sail, opts.mood, plan as DevPlan) : null;
    /** Where reverb sends go: the studio's hall, or the classic room. */
    const verb: AudioNode = mixer ? mixer.hall : reverb;
    delayRet.connect(verb);
    /** Studio: a player's timing and touch on the keys and drums (straight, no swing). */
    const feel = mixer ? makeFeel(srand, grid.phase, beat, 0.5) : null;

    // ── Pad ──
    const padBus = c.createGain();
    const padLp = c.createBiquadFilter(); padLp.type = "lowpass"; padLp.Q.value = 0.6;
    padBus.connect(padLp);
    const padOut = c.createGain(); padOut.gain.value = 1;
    if (mixer) {
      // Studio: the bed's EQ after the arrangement's filter; the hall send
      // comes off the (ducked) output inside the mixer.
      padLp.connect(mixer.bedIn); mixer.bedOut.connect(padOut); padOut.connect(mixer.bedDuck);
    } else {
      padLp.connect(padOut); padOut.connect(master);
      const padSend = c.createGain(); padSend.gain.value = 0.6; padLp.connect(padSend); padSend.connect(reverb);
    }
    padBus.gain.setValueAtTime(0.25, 0);
    padBus.gain.linearRampToValueAtTime(1, Math.max(0.5, introEnd));
    padBus.gain.setValueAtTime(1, buildStart);
    padBus.gain.linearRampToValueAtTime(1.12, buildStart + bar);
    // Studio: the same opening sweep, scaled for real strings and pads (a
    // saw-tuned 1.3 kHz would bury them).
    const cut0 = mixer ? clamp(p.padCut * 3.2, 2400, 7000) : p.padCut;
    padLp.frequency.setValueAtTime(mixer ? 500 : 320, 0);
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
    /** Studio: one chord of the bed, voiced per mood (see STUDIO_INSTRUMENTS). */
    const studioBed = (sg: Seg, i: number, rootPc: number, tones: number[], attack: number, end: number) => {
      const start = Math.max(0, sg.start - 0.05);
      const len = Math.max(0.2, end - start);
      const spread = (k: number, w: number) => (k / Math.max(1, tones.length - 1) - 0.5) * 2 * w;
      const mood = opts.mood;
      if (mood === "calm") {
        tones.forEach((m, k) => {
          playNote(c, padBus, { instrument: "pad", midi: m, at: start, duration: len, velocity: 0.72, attack, release: 1.4, pan: spread(k, 0.45) });
          // The strings a touch quieter, detuned and 30 ms behind, panned the other way: width without a chorus.
          playNote(c, padBus, { instrument: "strings", midi: m, at: start + 0.03, duration: len, velocity: 0.52, attack: attack * 1.2, release: 1.6, detuneCents: 6, pan: -spread(k, 0.7) });
        });
      } else if (mood === "cinematic") {
        // Strings carry it — a low root and fifth, and the chord an octave up —
        // swelling in slowly; the pad underneath.
        const swell = Math.max(attack, Math.min(2.2, len * 0.45));
        const low = 43 + mod(rootPc - 43, 12);
        [low, low + 7].forEach((m, k) => playNote(c, padBus, { instrument: "strings", midi: m, at: start, duration: len, velocity: 0.62, attack: swell, release: 1.8, pan: k === 0 ? -0.25 : 0.25 }));
        tones.forEach((m, k) => {
          playNote(c, padBus, { instrument: "strings", midi: m + 12, at: start + 0.02, duration: len, velocity: 0.5, attack: swell * 1.15, release: 2, pan: spread(k, 0.75) });
          playNote(c, padBus, { instrument: "pad", midi: m, at: start, duration: len, velocity: 0.45, attack, release: 1.6, pan: -spread(k, 0.4) });
        });
      } else if (mood === "elegant" || mood === "upbeat" || coastal) {
        // A Rhodes holding the chord — struck each bar with a light roll; in
        // Upbeat's build it stabs instead.
        const strike = (t: number, hold: number, vel: number) => {
          // Coastal: humanized (±12% velocity, ±8 ms) — see makeFeel.
          const hv = coastal ? 1 + (srand() - 0.5) * 0.24 : 1;
          const ht = coastal ? (srand() - 0.5) * 0.016 : 0;
          tones.forEach((m, k) => playNote(c, padBus, {
            instrument: "epiano", midi: m, at: Math.max(0, t + ht) + k * 0.012, duration: Math.max(0.1, hold), velocity: vel * hv * (1 - 0.05 * k), release: 0.6, pan: spread(k, 0.4),
          }));
        };
        // Coastal Drive: a quiet pad under the Rhodes, for glue.
        if (mood === "coastal_drive") tones.forEach((m, k) => playNote(c, padBus, { instrument: "pad", midi: m, at: start, duration: len, velocity: 0.3, attack, release: 1.4, pan: -spread(k, 0.5) }));
        if (i === segs.length - 1) { strike(sg.start, end - sg.start, 0.5); return; }
        for (let b = sg.start; b < sg.end - 1e-3; b += bar) {
          const nb = Math.min(sg.end, b + bar);
          if (mood === "upbeat" && b >= buildStart - 1e-3) {
            // Four stab rhythms, chosen bar by bar from the plan.
            const STABS: [number, number, number][][] = [
              [[0, 0.9, 0.5], [1.5, 0.45, 0.4], [2.5, 0.9, 0.45]],
              [[0, 0.45, 0.5], [1, 0.45, 0.35], [2.5, 1.2, 0.45]],
              [[0.5, 0.45, 0.42], [1.5, 0.45, 0.4], [3, 0.9, 0.45]],
              [[0, 1.9, 0.5], [2.5, 0.45, 0.4]],
            ];
            STABS[mixer ? mixer.plan.pattern(b + 0.01) : 0].forEach(([pos, hold, vel]) => {
              const t = b + pos * beat;
              if (t < nb - 0.05) strike(t, Math.min(hold * beat, nb - t - 0.02), vel);
            });
          } else {
            strike(b, nb - b - 0.03, mood === "elegant" ? 0.42 : coastal ? 0.36 : 0.4);
          }
        }
      } else if (mood === "sail") {
        // Sail: the warm pad with the strings quietly in it (it pumps under the kick).
        tones.forEach((m, k) => {
          playNote(c, padBus, { instrument: "pad", midi: m, at: start, duration: len, velocity: 0.62, attack, release: 1.2, pan: spread(k, 0.5) });
          playNote(c, padBus, { instrument: "strings", midi: m + 12, at: start + 0.02, duration: len, velocity: 0.34, attack: attack * 1.2, release: 1.4, detuneCents: 5, pan: -spread(k, 0.65) });
        });
      } else {
        // Groove and Lift: the warm pad.
        tones.forEach((m, k) => playNote(c, padBus, { instrument: "pad", midi: m, at: start, duration: len, velocity: 0.7, attack, release: 1.4, pan: spread(k, 0.5) }));
      }
    };
    segs.forEach((sg, i) => {
      const rootPc = mod(tonicPc + sg.chord.root, 12);
      const tones = sg.chord.pad.map((iv) => { const pc = mod(rootPc + iv, 12); return 55 + mod(pc - 55, 12); }).sort((a, b) => a - b);
      const attack = i === 0 ? Math.max(1.2, Math.min(2.6, introEnd)) : 0.9;
      const end = i === segs.length - 1 ? dur + 1 : sg.end;
      if (mixer) { if (!live) studioBed(sg, i, rootPc, tones, attack, end); return; }
      tones.forEach((m, k) => padVoice(m, sg.start, end, (k / Math.max(1, tones.length - 1) - 0.5) * 0.7, attack));
    });

    // ── Bass ──
    const bassBus = c.createGain(); bassBus.gain.value = 0.08 * (mixer ? STUDIO_SUB[opts.mood] : 1);
    const bassLp = c.createBiquadFilter(); bassLp.type = "lowpass"; bassLp.frequency.value = 420; bassLp.Q.value = 0.5;
    bassBus.connect(bassLp); bassLp.connect(master);
    const bassNote = (midi: number, t0: number, len: number, vel: number) => {
      if (mixer && opts.mood !== "cinematic") {
        // Finger bass over the sub: Calm an octave up and soft (the sub keeps
        // the root), Elegant and Upbeat in the bass's own register.
        const calm = opts.mood === "calm";
        playNote(c, mixer.bass, { instrument: "bass", midi: midi + (calm ? 12 : 0), at: Math.max(0, t0), duration: Math.max(0.08, len), velocity: (calm ? 0.42 : 0.72) * Math.min(1, vel), release: 0.12 });
      }
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
      if (groove || lift || coastal || sail || live) return; // Groove's low end is its 808; Lift, Coastal and Sail have their own bass (below)
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
    const keysSend = c.createGain(); keysSend.gain.value = 0.55; keysLp.connect(keysSend); keysSend.connect(verb);
    const keysDelay = c.createGain(); keysDelay.gain.value = 1; keysLp.connect(keysDelay); keysDelay.connect(delayIn);
    const keyNote = (midi: number, t0: number, vel: number, decay: number, pan: number) => {
      const s0 = Math.max(0, t0);
      if (s0 >= dur - 0.05) return;
      if (mixer) {
        // The grand piano, held for about half the classic decay and left to
        // ring for the rest (a light pedal); softer notes are darker.
        const v = clamp((0.2 + 0.55 * vel) * (opts.mood === "calm" ? 0.9 : 1), 0.15, 0.9);
        playNote(c, mixer.keys, { instrument: "piano", midi, at: s0, duration: decay * 0.45, velocity: v, release: Math.max(0.3, decay * 0.55), pan });
        return;
      }
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
    if (mixer && feel && !groove && !lift && !coastal && !sail && !live) {
      // Studio: the arpeggio follows the plan — its pattern bar by bar, its
      // register every 4 bars, out in a keys drop-out, lighter early and late.
      const sub = 0.5 * beat;
      const plan = mixer.plan;
      let t = grid.phase + Math.ceil((keysFrom - grid.phase) / sub - 1e-6) * sub;
      for (; t < E - 0.02; t += sub) {
        if (plan.out("keys", t)) continue;
        const inBuild = t >= buildStart - 1e-3;
        const stepBeats = inBuild ? p.keysStep[1] : p.keysStep[0];
        const posBeats = mod(Math.round((t - grid.phase) / beat * 2) / 2, 4);
        if (mod(posBeats, stepBeats) > 1e-3) continue;
        const pos8 = Math.round(posBeats * 2);
        const pat = STUDIO_PATTERNS[plan.pattern(t)];
        if (!pat.mask[pos8]) continue;
        const full = plan.fullness(t);
        if (pos8 % 2 === 1 && srand() > full) continue;
        const tones = voiceTones(keyTones(chordAt(t)), plan.voicing(t));
        const accent = pos8 === 0 ? 1 : pos8 % 2 === 0 ? 0.85 : 0.7;
        keyNote(tones[pat.order[pos8] % tones.length], feel.time(t), feel.vel(accent * (inBuild ? 1 : 0.85) * (0.8 + 0.2 * full), t), p.keysDecay, (srand() - 0.5) * 0.7);
      }
    }
    if (!mixer && !groove && !lift && !coastal) {
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
    if (!groove && !lift && !coastal && !sail && !live) {
      const tones = keyTones(tonic);
      tones.slice(0, 4).forEach((m, i) => keyNote(m, E + i * 0.07 + jitter(0.006), 0.9 - i * 0.08, Math.min(3.5, dur - E + 0.2), (i - 1.5) * 0.18));
    }
    // A soft bell on cuts that land on a beat (no more than one a bar).
    if (!groove && !lift && !coastal && !sail && !live) {
      let last = -Infinity;
      cuts.forEach((ct) => {
        if (ct < introEnd || ct >= E - 0.2) return;
        if (Math.abs(nearestBeat(ct) - ct) > 0.06) return;
        if (ct - last < bar * 0.95) return;
        last = ct;
        const ch = chordAt(ct + 0.01);
        const tones = keyTones(ch);
        const m = tones[Math.min(tones.length - 1, 2)] + 12;
        if (mixer) {
          const pan = jitter(0.4);
          if (opts.mood === "cinematic") {
            // Cinematic: a quiet strings swell on the cut, not a bell.
            playNote(c, mixer.strings, { instrument: "strings", midi: tones[1] ?? tones[0], at: ct, duration: Math.min(2.4, bar * 0.75), velocity: 0.42, attack: 0.7, release: 1.2, pan });
          } else {
            // One soft piano note two octaves over the chord root, in the hall.
            const root = 48 + mod(tonicPc + ch.root - 48, 12) + 24;
            playNote(c, mixer.bells, { instrument: "piano", midi: root, at: ct, duration: 0.3, velocity: 0.3, release: 1.8, pan });
          }
          return;
        }
        keyNote(m, ct, 0.55, Math.min(2.2, p.keysDecay + 0.6), jitter(0.4));
      });
    }

    // ── Rhythm ──
    const noise = c.createBuffer(1, SR, SR);
    { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1; }
    const rhythmBus = c.createGain(); rhythmBus.gain.value = 0.6;
    rhythmBus.connect(master);
    const rhythmSend = c.createGain(); rhythmSend.gain.value = 0.18; rhythmBus.connect(rhythmSend); rhythmSend.connect(verb);
    const kick = (t0: number, vel: number) => {
      const s0 = Math.max(0, t0);
      if (mixer) {
        mixer.duck(s0);
        if (opts.mood === "cinematic") {
          // A soft, low pulse: floor tom and a round kick, both darkened.
          playHit(c, mixer.kit, { name: "tom_lo", at: s0, velocity: vel * 0.85, lowpassHz: 1400, pitch: -2 });
          playHit(c, mixer.kit, { name: "kick2", at: s0, velocity: vel * 0.8, lowpassHz: 1100 });
        } else {
          playHit(c, mixer.kit, { name: "kick", at: s0, velocity: vel * (opts.mood === "elegant" ? 0.85 : 0.95), lowpassHz: opts.mood === "elegant" ? 2400 : undefined });
        }
        return;
      }
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
      if (mixer) {
        rand(); // the classic voice's draw: keeps the seeded stream in step
        playHit(c, mixer.perc, { name: "shaker", at: s0, velocity: vel * 0.5, pan: 0.22 });
        return;
      }
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
      if (mixer) {
        rand(); // in step with the classic voice
        playHit(c, mixer.perc, { name: "snap", at: s0, velocity: vel * 0.7, pan: -0.05 });
        playHit(c, mixer.perc, { name: "tamb", at: s0, velocity: vel * 0.32, pan: -0.3 });
        return;
      }
      const src = c.createBufferSource(); src.buffer = noise;
      const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 0.9;
      const g = c.createGain();
      g.gain.setValueAtTime(0, s0);
      g.gain.linearRampToValueAtTime(0.09 * vel, s0 + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.13);
      src.connect(bp); bp.connect(g); g.connect(rhythmBus);
      const extra = c.createGain(); extra.gain.value = 1.2; g.connect(extra); extra.connect(verb);
      src.start(s0, rand() * 0.8); src.stop(Math.min(dur, s0 + 0.16));
      const body = c.createOscillator(); body.type = "sine"; body.frequency.value = 190;
      const bg = c.createGain();
      bg.gain.setValueAtTime(0, s0);
      bg.gain.linearRampToValueAtTime(0.05 * vel, s0 + 0.003);
      bg.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.08);
      body.connect(bg); bg.connect(rhythmBus);
      body.start(s0); body.stop(Math.min(dur, s0 + 0.1));
    };
    /**
     * Studio rhythm: the classic parts, varied every 4 bars by the plan
     * (shaker/hat density, the rim displaced to the and-of-4, a skipped
     * kick), out in a drums drop-out, softer early and late.
     */
    const studioRhythm = (t: number, pos: number, onBeat: boolean, inBuild: boolean) => {
      if (!mixer || !feel) return;
      const plan = mixer.plan;
      if (plan.out("drums", t)) return;
      const dv = plan.drums(t), last = plan.barInBlock(t) === 3, pv = 0.7 + 0.3 * plan.fullness(t);
      if (p.rhythm === "pulse") {
        if (!inBuild) return;
        if (pos === 0 && !(dv === 2 && last)) kick(t, 0.55);
        if (dv === 1 && pos === 2) kick(t, 0.36);
        if (dv === 3 && pos === 3.5) kick(t, 0.3);
        return;
      }
      const shakerOn = dv === 1 ? !onBeat : dv === 3 ? !onBeat || pos === 0 || pos === 2 : true;
      if (shakerOn) shaker(feel.time(t), (onBeat ? 0.6 : 1) * (inBuild ? 1 : 0.6) * (p.rhythm === "soft" ? 0.8 : 1) * pv);
      if (dv === 2 && inBuild && !onBeat && srand() < 0.3) shaker(feel.time(t + beat / 4), 0.45 * pv);
      if (!inBuild) return;
      if (p.rhythm === "soft") {
        if (pos === 0) kick(t, 0.5);
        else if (pos === 2 && !(dv === 2 && last)) kick(t, 0.32);
        const rims = dv === 1 || dv === 3 ? [1, 3.5] : [1, 3];
        if (rims.indexOf(pos) >= 0) playHit(c, mixer.perc, { name: "rim", at: feel.time(t), velocity: feel.vel(0.4 * pv, t), pan: -0.15 });
        if ((pos === 1.5 || pos === 3.5) && dv !== 1 && rims.indexOf(pos) < 0) playHit(c, mixer.perc, { name: "hat", at: feel.time(t), velocity: feel.vel(0.27 * pv, t), pan: 0.3, lowpassHz: 7000 });
      } else {
        if (dv !== 1 || onBeat) playHit(c, mixer.perc, { name: "hat", at: feel.time(t), velocity: feel.vel((onBeat ? 0.3 : 0.42) * pv, t), pan: 0.28 });
        if (pos === 0 || (pos === 2 && !(dv === 0 && last))) kick(t, pos === 0 ? 0.8 : 0.65);
        if (pos === 2.5 && (dv === 3 || (dv === 2 && last))) kick(t, 0.4);
        if (pos === 1 || pos === 3) snap(feel.time(t), 0.9 * pv);
      }
    };
    if (p.rhythm !== "none" && !groove && !lift && !coastal && !sail && !live) {
      const sub = 0.5 * beat;
      const from = p.rhythm === "full" ? introEnd : buildStart;
      let t = grid.phase + Math.ceil((from - grid.phase) / sub - 1e-6) * sub;
      for (; t < E - 0.05; t += sub) {
        const inBuild = t >= buildStart - 1e-3;
        const pos = mod(Math.round((t - grid.phase) / beat * 2) / 2, 4);
        const onBeat = mod(pos, 1) < 1e-3;
        const h = jitter(0.006);
        if (mixer) { studioRhythm(t, pos, onBeat, inBuild); continue; }
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

    // Studio extras that have no classic counterpart (and so no draw on `rand`).
    if (mixer && opts.mood === "elegant") {
      // Nylon-guitar dyads on the off-beats of the build: the chord's third and fifth, low and soft.
      const DYADS = [[0.5, 2.5], [1.5, 3.5], [0.5, 1.5, 3], [2.5]];
      for (let t = grid.phase + Math.ceil((buildStart - grid.phase) / bar - 1e-6) * bar; t < E - 0.1; t += bar) {
        DYADS[mixer.plan.pattern(t + 0.01)].forEach((pos) => {
          const at = t + pos * beat;
          if (at >= E - 0.1 || mixer.plan.out("keys", at)) return;
          const ch = chordAt(at + 0.01);
          const rootPc = mod(tonicPc + ch.root, 12);
          [ch.arp[1], ch.arp[2]].forEach((iv, k) => playNote(c, mixer.guitar, {
            instrument: "nylon", midi: 55 + mod(rootPc + iv - 55, 12), at: at + k * 0.018, duration: beat * 0.7, velocity: 0.34 + srand() * 0.06, release: 0.3, pan: 0.35,
          }));
        });
      }
    }
    if (mixer && opts.mood === "cinematic") {
      // Piano low octaves on the downbeats: on each chord before the build, every bar after it.
      for (let t = grid.phase + Math.ceil((introEnd - grid.phase) / bar - 1e-6) * bar; t < E - 0.1; t += bar) {
        const onChord = segs.some((sg) => Math.abs(sg.start - t) < 1e-3);
        if (t < buildStart - 1e-3 && !onChord) continue;
        const ch = chordAt(t + 0.01);
        const root = 36 + mod(tonicPc + ch.root - 36, 12);
        [root, root + 12].forEach((m, k) => playNote(c, mixer.keys, { instrument: "piano", midi: m, at: t + k * 0.008, duration: bar * 0.85, velocity: 0.5 - 0.08 * k, release: 1.2, pan: -0.1 }));
      }
      // And on the end card.
      const root = 36 + mod(tonicPc + tonic.root - 36, 12);
      [root, root + 12].forEach((m, k) => playNote(c, mixer.keys, { instrument: "piano", midi: m, at: E + k * 0.008, duration: Math.max(0.3, dur - E - 0.3), velocity: 0.55, release: 1.5, pan: -0.1 }));
    }

    if (live && livePlan && mixer) {
      composeLivelyLayers({
        c, master, noise, mixer, style: live, plan: livePlan, dur, beat, bar, phase: grid.phase, E, segs, tonicPc,
      });
    }

    if (groove && !live) {
      composeGrooveLayers({
        c, master, reverb: verb, delayIn, noise, rand, jitter, dur, beat, bar, phase: grid.phase,
        introEnd, buildStart, E, segs, tonicPc, tonicRoot: tonic.root, level: p.keysLevel, mixer,
      });
    }

    if (lift) {
      composeLiftLayers({
        c, master, reverb: verb, delayIn, noise, padOut, rand, jitter, dur, beat, bar, phase: grid.phase,
        introEnd, drop: buildStart, E, segs, tonicPc, tonic, level: p.keysLevel, mixer,
      });
    }

    if (sail && mixer && !live) {
      composeSailLayers({
        c, master, verb, noise, padOut, mixer, dur, beat, bar, phase: grid.phase,
        introEnd, drop: buildStart, E, segs, tonicPc, tonic,
      });
    }

    if (coastal && !live) {
      composeCoastalLayers({
        c, master, reverb: verb, delayIn, noise, padOut, rand, jitter, dur, beat, bar, phase: grid.phase,
        introEnd, E, segs, cuts, tonicPc, level: p.keysLevel, drive: coastalDrive, mixer,
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
      // Studio Cinematic: the reversed crash does most of the lifting, so the noise steps back.
      g.gain.exponentialRampToValueAtTime(p.riser * (mixer && opts.mood === "cinematic" ? 0.6 : 1), E - 0.02);
      g.gain.linearRampToValueAtTime(0, E + 0.18);
      const pn = makePan(c, 0);
      src.connect(bp); bp.connect(g); g.connect(pn); pn.connect(master);
      const rs = c.createGain(); rs.gain.value = 0.8; g.connect(rs); rs.connect(verb);
      src.start(t0); src.stop(Math.min(dur, E + 0.6));
      if (mixer && opts.mood === "cinematic") {
        // A long, very quiet reversed crash into the end card, and the crash itself on it.
        playHit(c, mixer.bells, { name: "crash", at: E, velocity: 0.42, reverse: true, lowpassHz: 7000 });
        playHit(c, mixer.bells, { name: "crash", at: E, velocity: 0.3, lowpassHz: 6000 });
      }
      // A soft low bloom under the tonic (Groove lands on its 808 instead).
      if (!groove && !lift && !coastal && !sail && !live) {
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

    // Studio: decode what the queued notes need and build them (before rendering).
    if (mixer) await flushNotes(c);

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
    // lower sample ceiling so its true peak stays under -1 dBTP). Other moods: as
    // before. The studio engine levels every mood by K-weighted loudness.
    // Lively (Oct 30): louder — about -11.5 LUFS, true peak under -1 dBTP.
    if (live) levelLoud(rendered, 0, Math.floor(SR * fadeStart), -11.5, -1.4);
    else levelMaster(rendered, Math.floor(SR * Math.max(0, introEnd)), Math.floor(SR * fadeStart), studio || groove || lift || coastal ? -14 : null, lift || coastal ? -1.6 : -1);
    return rendered;
  } finally {
    // Anything still queued for the sampler (a render that failed part-way) is dropped.
    if (ctx) discardNotes(ctx);
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
  /** The studio engine's buses; null for the classic sound. */
  mixer: StudioMix | null;
}) {
  const { c, master, reverb, delayIn, noise, rand, jitter, dur, beat, bar, phase, introEnd, buildStart, E, segs, tonicPc, mixer } = g;
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
    // Studio: finger bass an octave up on the same notes, so the line is heard on a phone.
    if (mixer) playNote(c, mixer.bass, { instrument: "bass", midi: midi + 12, at: s0, duration: Math.max(0.08, off - s0), velocity: 0.6 * Math.min(1, vel), release: 0.08 });
  };
  const kick = (t0: number, vel: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    if (mixer) { mixer.duck(s0); playHit(c, mixer.kit, { name: "kick", at: s0, velocity: 0.95 * vel }); return; }
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
    if (mixer) {
      rand(); // the classic voice's draw: keeps the seeded stream in step
      playHit(c, mixer.perc, { name: "snap", at: s0, velocity: 0.72 * vel });
      playHit(c, mixer.kit, { name: "snare", at: s0, velocity: 0.42 * vel, lowpassHz: 5000 });
      return;
    }
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
    if (mixer) { rand(); playHit(c, mixer.perc, { name: "hat", at: s0, velocity: 0.5 * vel, pan }); return; }
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
    if (mixer) {
      // Studio: the Rhodes plays the motif. It can't slide, so a slide becomes
      // a quick grace note from below.
      const pan = jitter(0.25); // the classic voice's pan draw, in step
      const v = clamp(0.35 + 0.5 * vel, 0.3, 0.9);
      let at = s0;
      if (glideFrom !== null) {
        playNote(c, mixer.keys, { instrument: "epiano", midi: glideFrom, at: s0, duration: 0.05, velocity: v * 0.6, release: 0.06, pan });
        at = s0 + Math.min(0.07, glideTime * 0.5);
      }
      playNote(c, mixer.keys, { instrument: "epiano", midi, at, duration: Math.max(0.08, len), velocity: v, release: len > beat * 0.6 ? 0.6 : 0.25, pan });
      return;
    }
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
  // Studio: the kick pattern pair changes every 4 bars (never the same pair
  // twice running), and hat rolls cycle through four kinds so no fill repeats.
  const kickBlocks: [number[], number[]][] = [];
  if (mixer) {
    for (let b = 0; b < barStarts.length / 4 + 2; b++) {
      let a = Math.floor(mixer.rand() * KICKS.length), z = Math.floor(mixer.rand() * KICKS.length);
      const prev = kickBlocks[b - 1];
      if (prev && KICKS[a] === prev[0] && KICKS[z] === prev[1]) a = (a + 1) % KICKS.length;
      if (b === 0) { a = KICKS.indexOf(kA); z = KICKS.indexOf(kB); }
      kickBlocks.push([KICKS[a], KICKS[z]]);
    }
  }
  const ROLLS = [8, 6, 4, 12];
  let rollNo = mixer ? Math.floor(mixer.rand() * ROLLS.length) : 0;
  barStarts.forEach((b0) => {
    const bi = barIndex(b0);
    const second = mod(bi, 2) === 1; // the answer bar of a two-bar phrase
    const inBuild = b0 >= buildStart - 1e-3;
    const drums = b0 >= introEnd - 1e-3;
    // Hats: 16ths (8ths in the intro), with a roll in the last beat of some answer bars.
    const rollBeat = drums && second && rand() < 0.65 ? 3 : -1;
    let rollKind = rand() < 0.5 ? 8 : 6; // 1/32 or 16th triplets
    if (mixer && rollBeat >= 0) rollKind = ROLLS[rollNo++ % ROLLS.length];
    const plan = mixer ? mixer.plan : null;
    const drumsOut = !!plan && plan.out("drums", b0 + 0.01);
    const dv = plan ? plan.drums(b0 + 0.01) : 0;
    for (let st = 0; st < 16; st++) {
      const t = b0 + st * s16;
      if (t < hatFrom || t >= E - 0.02) continue;
      if (drumsOut) continue;
      const beatNo = Math.floor(st / 4);
      const nearEnd = t >= E - beat - 1e-3; // the roll into the end card
      if ((beatNo === rollBeat || nearEnd) && st % 4 === 0) {
        const n = nearEnd ? 8 : rollKind;
        for (let r = 0; r < n; r++) hat(t + (r * beat) / n, 0.45 + 0.5 * (r / n), 0.12);
        st += 3;
        continue;
      }
      if (!drums && st % 2 === 1) continue;
      // Studio: the hat pattern varies every 4 bars — 16ths; 8ths with a 16th
      // pair on beat 4; 8ths only; 16ths with gaps.
      if (plan && drums && ((dv === 1 && st % 2 === 1 && beatNo !== 3) || (dv === 2 && st % 2 === 1) || (dv === 3 && (st === 5 || st === 13)))) continue;
      const accent = st % 4 === 0 ? 1 : st % 2 === 0 ? 0.7 : 0.5;
      hat(t + jitter(0.003), accent * (drums ? 1 : 0.55) * (1 + jitter(0.12)), st % 2 === 0 ? 0.12 : -0.08);
    }
    if (!drums) return;
    // Studio: a quiet open hat on the and-of-2 and -4 once the build is in.
    if (mixer && inBuild && !drumsOut) {
      [6, 14].forEach((s) => {
        const t = b0 + s * s16;
        if (t < dropAt - 1e-3) playHit(c, mixer.perc, { name: "hat_open", at: t, velocity: 0.34, pan: -0.15, choke: s16 * 1.8 });
      });
    }
    // Kick + 808, locked; clap on 2 and 4.
    const pat = plan ? kickBlocks[Math.min(kickBlocks.length - 1, plan.block(b0 + 0.01))][second ? 1 : 0] : second ? kB : kA;
    pat.forEach((st, k) => {
      const t = b0 + st * s16;
      if (t >= dropAt - 1e-3 || t < introEnd - 1e-3) return;
      const nextSt = k + 1 < pat.length ? pat[k + 1] : 16;
      const len = Math.min((nextSt - st) * s16, dropAt - t) - 0.03;
      const ch = chordAt(t + 0.01);
      let midi = 31 + mod(tonicPc + ch.root - 31, 12);
      if (k > 0 && rand() < 0.22) midi += 12;
      const glide = prev808 !== null && prev808 !== midi && rand() < 0.35 ? prev808 : null;
      // Studio: no kick in a drums drop-out (the 808 stays), and the last kick
      // of some 4-bar blocks is left out.
      const skip = !!plan && (drumsOut || (dv === 2 && plan.barInBlock(b0 + 0.01) === 3 && k === pat.length - 1));
      if (!skip) kick(t, k === 0 ? 1 : 0.8);
      note808(midi, t, len, k === 0 ? 0.95 : 0.85, glide);
      prev808 = midi;
    });
    [4, 12].forEach((st) => {
      const t = b0 + st * s16;
      if (t < dropAt - 1e-3 && !drumsOut) clap(t + jitter(0.003), 0.9 * (1 + jitter(0.08)));
    });
    // Lead: the motif (quieter and darker before the build), then its answer,
    // which slides up into a held note at the phrase end.
    // Studio: the motif develops phrase by phrase — moved a step up or down
    // the scale, a note dropped or held — and each answer bar ends on a
    // different chord tone; out in a keys drop-out; lighter early and late.
    const leadVel = (inBuild ? 1 : 0.7) * (plan ? 0.8 + 0.2 * plan.fullness(b0) : 1);
    const phraseVar = plan ? mod(Math.floor(bi / 2), 3) : 0;
    const keysOut = !!plan && plan.out("keys", b0 + 0.01);
    motif.forEach((m, i) => {
      const t = b0 + m.step * s16;
      if (t >= E - beat * 0.5 || (!inBuild && second && i > 2)) return;
      if (keysOut || (phraseVar === 1 && i === 1)) return;
      let pitchIdx = clamp(m.idx + (phraseVar === 1 ? 1 : phraseVar === 2 ? -1 : 0), 0, scale.length - 1);
      if (second && i >= motif.length - 2) pitchIdx = clamp(pitchIdx + (i === motif.length - 1 ? 1 : -1), 0, scale.length - 1);
      if (plan && second && i === motif.length - 1) {
        // The answer ends on a chord tone other than the one the statement ended on.
        const pcs = [0].concat(chordAt(t + 0.01).pad).map((iv) => mod(tonicPc + chordAt(t + 0.01).root + iv, 12));
        const was = mod(scale[clamp(m.idx, 0, scale.length - 1)], 12);
        for (let d = 1; d < scale.length; d++) {
          const up = pitchIdx + d, dn = pitchIdx - d;
          if (up < scale.length && pcs.indexOf(mod(scale[up], 12)) >= 0 && mod(scale[up], 12) !== was) { pitchIdx = up; break; }
          if (dn >= 0 && pcs.indexOf(mod(scale[dn], 12)) >= 0 && mod(scale[dn], 12) !== was) { pitchIdx = dn; break; }
        }
      }
      const midi = scale[pitchIdx];
      const len = m.len * s16 * (phraseVar === 2 && i === motif.length - 1 ? 1.8 : 0.85);
      if (m.stutter) {
        leadNote(midi, t + jitter(0.004), s16 * 0.4, leadVel * 0.9, null);
        leadNote(midi, t + s16 * 0.5, s16 * 0.4, leadVel * 0.75, null);
      } else {
        leadNote(midi, t + jitter(0.004), len, leadVel * (m.step % 4 === 0 ? 1 : 0.85), null);
      }
    });
    if (second && inBuild && !keysOut) {
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
  /** The studio engine's buses; null for the classic sound. */
  mixer: StudioMix | null;
}) {
  const { c, master, reverb, delayIn, noise, padOut, rand, jitter, dur, beat, bar, phase, introEnd, drop, E, segs, tonicPc, mixer } = g;
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
  const chordLp = c.createBiquadFilter(); chordLp.type = "lowpass"; chordLp.frequency.value = mixer ? 12000 : 3400; chordLp.Q.value = 0.5;
  chordDuck.connect(chordLp);
  if (mixer) {
    chordLp.connect(mixer.strings); // the strings bus has its own EQ and hall
  } else {
    chordLp.connect(master);
    const chordVerb = c.createGain(); chordVerb.gain.value = 0.4; chordLp.connect(chordVerb); chordVerb.connect(reverb);
  }

  // ── Voices ──
  const kick = (t0: number, vel: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    if (mixer) {
      // Before the drop a soft, rounder kick; from the drop the full one (and the keys dip under it).
      const pre = s0 < drop - 1e-3;
      if (!pre) mixer.duck(s0);
      playHit(c, mixer.kit, pre ? { name: "kick2", at: s0, velocity: Math.min(1, vel * 1.5), lowpassHz: 1000 } : { name: "kick", at: s0, velocity: vel });
      return;
    }
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
    if (mixer) { rand(); playHit(c, mixer.perc, { name: "hat_open", at: s0, velocity: 0.42 * vel, pan: 0.18, choke: s8 * 0.85 }); return; }
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
    if (mixer) {
      rand(); // in step with the classic voice
      playHit(c, mixer.perc, { name: "snap", at: s0, velocity: 0.7 * vel });
      playHit(c, mixer.kit, { name: "snare", at: s0, velocity: 0.45 * vel, lowpassHz: 6000 });
      return;
    }
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
    if (mixer) {
      // Studio: the piano drives the 8ths, its tone opening with `bright` (into the drop).
      const pan = jitter(0.3); // the classic voice's pan draw, in step
      playNote(c, mixer.keys, { instrument: "piano", midi, at: s0, duration: s8 * 0.8, velocity: clamp((0.3 + 0.55 * vel) * (0.8 + 0.2 * bright), 0.2, 0.92), lowpassHz: 1600 + 12000 * bright * bright, release: 0.3, pan });
      return;
    }
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
    if (mixer) {
      // Studio: the string ensemble holds the chord, spread wide.
      tones.forEach((m, k) => playNote(c, chordDuck, { instrument: "strings", midi: m, at: s0, duration: t1 - s0, velocity: 0.55, attack: 0.06, release: Math.max(0.35, release), pan: (k / Math.max(1, tones.length - 1) - 0.5) * 1.3 }));
      return;
    }
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
    const sparkle = inDrop && mod(step, 8) === 6 && rand() < 0.5;
    if (sparkle) m += 12;
    const onBeat = mod(step, 2) === 0;
    const bright = inDrop ? 0.9 : t >= riserStart ? 0.35 + 0.5 * ((t - riserStart) / Math.max(0.1, drop - riserStart)) : 0.3;
    const vel = (onBeat ? 1 : 0.8) * (inDrop ? 1 : 0.65) * (1 + jitter(0.1));
    if (mixer) {
      // Studio: the piano's 8ths follow the plan — pattern bar by bar,
      // register every 4 bars, out in a keys drop-out (in the drop), lighter
      // early. The sparkle is a soft high piano note, now and then.
      const plan = mixer.plan;
      if (inDrop && plan.out("keys", t)) continue;
      const pat = STUDIO_PATTERNS[plan.pattern(t)];
      const pos8 = mod(step, 8);
      if (!pat.mask[pos8]) continue;
      if (pos8 % 2 === 1 && mixer.rand() > plan.fullness(t) + 0.15) continue;
      const vt = voiceTones(tones, plan.voicing(t), 84);
      pluck(vt[pat.order[pos8] % vt.length], t + jitter(0.004), vel * (0.8 + 0.2 * plan.fullness(t)), bright);
      if (sparkle && mod(step, 16) === 6) playNote(c, mixer.bells, { instrument: "piano", midi: m, at: Math.max(0, t), duration: 0.25, velocity: 0.3, release: 1.4, pan: 0.3 });
      continue;
    }
    pluck(m, t + jitter(0.004), vel, bright);
    if (inDrop && !onBeat && rand() < 0.5) pluck(tones[arp[mod(step + 1, arp.length)] % tones.length], t + s16 + jitter(0.004), vel * 0.6, bright);
  }

  // ── Intro pulse and the riser ──
  for (let t = phase + Math.ceil((introEnd - phase) / beat - 1e-6) * beat; t < drop - beat * 0.5; t += beat) {
    kick(t, t >= riserStart ? 0.42 : 0.3);
  }
  if (mixer) {
    // Studio: the drums join in stages — closed hats on the 8ths over the
    // riser, rising — and the strings swell in under it, peaking on the drop.
    for (let t = phase + Math.ceil((riserStart - phase) / s8 - 1e-6) * s8; t < drop - 1e-3; t += s8) {
      const k = (t - riserStart) / Math.max(0.1, drop - riserStart);
      playHit(c, mixer.perc, { name: "hat", at: t, velocity: 0.2 + 0.3 * k + mixer.rand() * 0.05, pan: 0.2 });
    }
    if (drop - riserStart > 0.5) {
      const swell = c.createGain();
      swell.gain.value = 0.0001;
      swell.gain.setValueAtTime(0.0001, riserStart);
      swell.gain.exponentialRampToValueAtTime(1, drop);
      swell.connect(chordDuck);
      segs.forEach((sg) => {
        const a = Math.max(sg.start, riserStart), b = Math.min(sg.end, drop);
        if (b - a < 0.2) return;
        const rootPc = mod(tonicPc + sg.chord.root, 12);
        sg.chord.pad.map((iv) => 60 + mod(rootPc + iv - 60, 12)).sort((x, y) => x - y)
          .forEach((m, k) => playNote(c, swell, { instrument: "strings", midi: m, at: a, duration: b - a, velocity: 0.5, attack: 0.2, release: 0.3, pan: k % 2 ? 0.5 : -0.5 }));
      });
    }
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
    // The crash on the drop (studio: the kit's crash).
    if (mixer) {
      playHit(c, mixer.perc, { name: "crash", at: drop, velocity: 0.6 });
    } else {
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
  }

  // ── The drop ──
  for (let t = drop; t < E - 0.02; t += beat) {
    const pos = mod(Math.round((t - phase) / beat), 4);
    if (mixer) {
      // Studio: the kit varies every 4 bars (16th hats; open hats on 2 and 4
      // only; a skipped kick; a ghost snare), and drops out once for 2 bars.
      const plan = mixer.plan;
      const dv = plan.drums(t), last = plan.barInBlock(t) === 3;
      if (!plan.out("drums", t)) {
        if (!(dv === 2 && last && pos === 3)) {
          kick(t, 1);
          duck(bassDuck.gain, t, 0.25);
          duck(chordDuck.gain, t, 0.7);
          duck(padOut.gain, t, 0.75);
        }
        if (dv !== 2 || pos === 1 || pos === 3) openHat(t + s8 + jitter(0.003), 1 + jitter(0.1));
        if (dv === 1) [1, 3].forEach((k) => playHit(c, mixer.perc, { name: "hat", at: t + k * s16, velocity: 0.22 + mixer.rand() * 0.06, pan: -0.2 }));
        if (pos === 1 || pos === 3) clap(t + jitter(0.003), 0.85);
        if (dv === 3 && pos === 3) playHit(c, mixer.kit, { name: "snare", at: t + 3 * s16, velocity: 0.22, lowpassHz: 5000 });
      }
    } else {
      kick(t, 1);
      duck(bassDuck.gain, t, 0.25);
      duck(chordDuck.gain, t, 0.45);
      duck(padOut.gain, t, 0.6);
      openHat(t + s8 + jitter(0.003), 1 + jitter(0.1));
      if (pos === 1 || pos === 3) clap(t + jitter(0.003), 0.85);
    }
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
  if (mixer) {
    // Studio: the crash, and one soft high piano note over the last pluck.
    playHit(c, mixer.perc, { name: "crash", at: E, velocity: 0.48 });
    playNote(c, mixer.bells, { instrument: "piano", midi: ft[0] + 24, at: E + 2 * s16, duration: 0.4, velocity: 0.3, release: 1.8, pan: 0.25 });
  }
  bassNote(36 + mod(tonicPc + g.tonic.root - 36, 12), E, Math.min(1.6, dur - E - 0.1), 0.8);
}

// ── Coastal (Oct 7) ────────────────────────────────────────────────────────

/** Coastal output levels (set by measurement, Oct 7 revision). */
const BASS_OUT_COASTAL = 0.34;
const BASS_OUT_DRIVE = 0.52;
const LEAD_OUT = 3.2;

const CO: Record<string, Chord> = {
  i:   { root: 0,  pad: [3, 7, 10, 14], arp: [0, 3, 7, 10, 14] },
  III: { root: 3,  pad: [4, 7, 11, 14], arp: [0, 4, 7, 11, 14] },
  iv:  { root: 5,  pad: [3, 7, 10, 14], arp: [0, 3, 7, 10] },
  VI:  { root: 8,  pad: [4, 7, 11, 14], arp: [0, 4, 7, 11, 14] },
  VII: { root: 10, pad: [4, 7, 14],     arp: [0, 4, 7, 14] },
};
// Minor progressions that keep leaning to the relative major (III).
const CO_PROGS = [
  ["VI", "VII", "III", "III"],
  ["i", "VI", "III", "VII"],
  ["VI", "III", "VII", "i"],
  ["III", "VII", "VI", "VII"],
  ["i", "VI", "VII", "III"],
];

/** Coastal's chords: seeded, VII before the end card, the relative major (III) on it. */
function assignCoastalChords(segs: Seg[], rand: () => number) {
  const prog = CO_PROGS[Math.floor(rand() * CO_PROGS.length)].map((k) => CO[k]);
  for (let i = 0; i < segs.length; i++) segs[i].chord = prog[i % prog.length];
  if (segs.length >= 3) segs[segs.length - 3].chord = CO.VI;
  if (segs.length >= 2) segs[segs.length - 2].chord = CO.VII;
  segs[segs.length - 1].chord = CO.III;
}

/**
 * Coastal (Oct 7): warm, melodic, feel-good — harmony first, drums underneath.
 * 118–126 BPM, a seeded minor key whose progression leans to its relative
 * major and resolves there on the end card.
 *   • Opening: 1–2 soft bars (pad and plucks), then the full groove.
 *   • Drums: a soft, rounded 4-on-the-floor kick, a light clap on 2 and 4, an
 *     airy shaker on the 8ths (the odd 16th) — no hard transients.
 *   • Bass (revised Oct 7): warm, clean and forward — sine + 2nd and 3rd
 *     harmonics (~100–250 Hz, so phones carry it), gently ducked.
 *   • Coastal Drive (`drive`): the same harmony, motif and mallet at 126–130
 *     BPM with a firmer kick (more click), a snappier clap/snare, off-beat
 *     open hats, a 16th shaker, a rhythmic 8th-note bass further forward,
 *     and a 1-beat snare fill into some breaths. Still clean: no distortion.
 *   • Lead (revised Oct 7): a bright, plucky mallet — additive marimba-like
 *     partials (1, 4, 9.2×) plus a light FM shimmer on the attack, fast attack,
 *     short-to-medium decay, a touch of stereo delay — playing a short seeded
 *     two-bar motif, varied: A, A' (new ending), B (lifted), A'' (resolving).
 *   • Plucked 8th-note arpeggios underneath.
 *   • "Breaths": before about every 2nd–3rd cut the drums and bass drop out
 *     for a beat, two beats or a bar, so the full groove lands on the cut
 *     (with a soft swell into it). A gentle filtered riser goes into the
 *     biggest breath landing, about every 30 s.
 *   • End card: a warm resolve on the relative major, then the shared fade.
 */
function composeCoastalLayers(g: {
  c: OfflineAudioContext; master: AudioNode; reverb: AudioNode; delayIn: AudioNode; noise: AudioBuffer; padOut: GainNode;
  rand: () => number; jitter: (amt: number) => number;
  dur: number; beat: number; bar: number; phase: number;
  introEnd: number; E: number; segs: Seg[]; cuts: number[]; tonicPc: number; level: number; drive: boolean;
  /** The studio engine's buses; null for the classic sound. */
  mixer: StudioMix | null;
}) {
  const { c, master, reverb, delayIn, noise, padOut, rand, jitter, dur, beat, bar, phase, introEnd, E, segs, tonicPc, drive, mixer } = g;
  const s8 = beat / 2, s16 = beat / 4;
  const chordAt = (t: number): Chord => {
    for (let i = segs.length - 1; i >= 0; i--) if (t >= segs[i].start - 1e-4) return segs[i].chord;
    return segs[0].chord;
  };
  const nearestBeat = (t: number) => phase + Math.round((t - phase) / beat) * beat;
  const chordPcs = (ch: Chord) => [0].concat(ch.pad).map((iv) => mod(tonicPc + ch.root + iv, 12));
  /** Studio: the humanizing (null in the classic engine, which stays as it was). */
  const feel = mixer ? makeFeel(mixer.rand, phase, beat) : null;

  // ── Breaths: before about every 2nd–3rd cut, preferring cuts that sit on a beat ──
  const cutList = g.cuts.filter((ct) => ct > introEnd + bar && ct < E - 0.3);
  const breaths: { from: number; to: number; land: number }[] = [];
  {
    let since = 0, want = rand() < 0.5 ? 2 : 3, prev = introEnd;
    cutList.forEach((ct, i) => {
      since++;
      const onBeat = Math.abs(nearestBeat(ct) - ct) <= 0.12;
      const overdue = since > want;
      if (since >= want && (onBeat || overdue)) {
        const choices = [beat, 2 * beat, bar];
        let len = choices[Math.floor(rand() * choices.length)];
        len = Math.min(len, ct - prev - 0.6);
        if (len >= beat * 0.9) {
          // The groove returns ON the cut: on its beat when the cut is close to one.
          const land = onBeat ? nearestBeat(ct) : ct;
          breaths.push({ from: land - len, to: land, land: ct });
          since = 0; want = rand() < 0.5 ? 2 : 3;
        }
      }
      prev = ct;
      void i;
    });
  }
  const inBreath = (t: number) => breaths.some((b) => t >= b.from - 1e-3 && t < b.to - 1e-3);
  // A gentle filtered riser into the biggest breath landing, about every 30 s.
  const riserLands: number[] = [];
  {
    let last = -Infinity;
    breaths.forEach((b) => { if (b.land - last >= 12 && b.land > dur * 0.3) { riserLands.push(b.land); last = b.land + 18; } });
  }

  // ── Buses ──
  const drumBus = c.createGain(); drumBus.gain.value = drive ? 0.58 : 0.5;
  const drumLp = c.createBiquadFilter(); drumLp.type = "lowpass"; drumLp.frequency.value = drive ? 11000 : 9000;
  drumBus.connect(drumLp); drumLp.connect(master);
  const drumSend = c.createGain(); drumSend.gain.value = 0.16; drumLp.connect(drumSend); drumSend.connect(reverb);
  const bassDuck = c.createGain(); bassDuck.gain.value = 1;
  const bassLp = c.createBiquadFilter(); bassLp.type = "lowpass"; bassLp.frequency.value = 900; bassLp.Q.value = 0.5;
  // Studio: the finger bass leads; a little of the sine bass stays under it for weight.
  // (Oct 23: on Coastal it's raised ~4.7 dB, to about Drive's level, so its
  // 2nd/3rd harmonics read on a phone under the finger bass.)
  const bassOut = c.createGain(); bassOut.gain.value = (drive ? BASS_OUT_DRIVE : BASS_OUT_COASTAL) * (mixer ? (drive ? 0.35 : 0.6) : 1);
  bassDuck.connect(bassLp); bassLp.connect(bassOut); bassOut.connect(master);
  const leadBus = c.createGain(); leadBus.gain.value = LEAD_OUT;
  const leadLp = c.createBiquadFilter(); leadLp.type = "lowpass"; leadLp.frequency.value = 6500; leadLp.Q.value = 0.5;
  leadBus.connect(leadLp); leadLp.connect(master);
  const leadVerb = c.createGain(); leadVerb.gain.value = 0.5; leadLp.connect(leadVerb); leadVerb.connect(reverb);
  const leadDelay = c.createGain(); leadDelay.gain.value = 0.55; leadLp.connect(leadDelay); leadDelay.connect(delayIn);
  const pluckBus = c.createGain(); pluckBus.gain.value = 1;
  const pluckLp = c.createBiquadFilter(); pluckLp.type = "lowpass"; pluckLp.frequency.value = 3200;
  pluckBus.connect(pluckLp); pluckLp.connect(master);
  const pluckDelay = c.createGain(); pluckDelay.gain.value = 0.5; pluckLp.connect(pluckDelay); pluckDelay.connect(delayIn);
  const pluckVerb = c.createGain(); pluckVerb.gain.value = 0.35; pluckLp.connect(pluckVerb); pluckVerb.connect(reverb);

  // ── Voices ──
  const kick = (t0: number, vel: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    if (mixer) {
      if (drive) rand(); // the classic click's draw, in step
      mixer.duck(s0);
      playHit(c, mixer.kit, { name: "kick", at: s0, velocity: (drive ? 0.95 : 0.78) * vel, lowpassHz: drive ? undefined : 2800 });
      return;
    }
    const o = c.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(drive ? 150 : 110, s0);
    o.frequency.exponentialRampToValueAtTime(drive ? 50 : 47, s0 + (drive ? 0.06 : 0.09));
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = drive ? 900 : 500;
    const gn = c.createGain();
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime(0.9 * vel, s0 + (drive ? 0.002 : 0.005));
    gn.gain.exponentialRampToValueAtTime(0.0001, s0 + (drive ? 0.26 : 0.32));
    o.connect(lp); lp.connect(gn); gn.connect(drumBus);
    o.start(s0); o.stop(Math.min(dur, s0 + 0.34));
    if (drive) {
      // The click: a few milliseconds of band-passed noise, soft-edged.
      const ck = c.createBufferSource(); ck.buffer = noise;
      const cbp = c.createBiquadFilter(); cbp.type = "bandpass"; cbp.frequency.value = 3200; cbp.Q.value = 0.9;
      const cg = c.createGain();
      cg.gain.setValueAtTime(0, s0);
      cg.gain.linearRampToValueAtTime(0.14 * vel, s0 + 0.0015);
      cg.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.014);
      ck.connect(cbp); cbp.connect(cg); cg.connect(drumBus);
      ck.start(s0, rand() * 0.8); ck.stop(Math.min(dur, s0 + 0.02));
    }
  };
  const clap = (t0: number, vel: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    if (mixer) {
      rand(); // in step with the classic voice
      if (drive) {
        playHit(c, mixer.kit, { name: "snare", at: s0, velocity: 0.6 * vel, lowpassHz: 7000 });
        playHit(c, mixer.perc, { name: "snap", at: s0, velocity: 0.42 * vel });
      } else {
        playHit(c, mixer.perc, { name: "rim", at: s0, velocity: 0.55 * vel, pan: -0.1 });
      }
      return;
    }
    const src = c.createBufferSource(); src.buffer = noise;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = drive ? 1800 : 1400; bp.Q.value = drive ? 1 : 0.8;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = drive ? 7000 : 4800;
    const gn = c.createGain();
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime((drive ? 0.34 : 0.26) * vel, s0 + (drive ? 0.002 : 0.005));
    gn.gain.exponentialRampToValueAtTime(0.0001, s0 + (drive ? 0.15 : 0.2));
    src.connect(bp); bp.connect(lp); lp.connect(gn); gn.connect(drumBus);
    const send = c.createGain(); send.gain.value = drive ? 1.1 : 1.5; gn.connect(send); send.connect(reverb);
    src.start(s0, rand() * 0.8); src.stop(Math.min(dur, s0 + 0.22));
    if (drive) {
      // Snare body: a short pitched thump under the snap.
      const body = c.createOscillator(); body.type = "triangle";
      body.frequency.setValueAtTime(220, s0);
      body.frequency.exponentialRampToValueAtTime(175, s0 + 0.05);
      const bg = c.createGain();
      bg.gain.setValueAtTime(0, s0);
      bg.gain.linearRampToValueAtTime(0.22 * vel, s0 + 0.002);
      bg.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.08);
      body.connect(bg); bg.connect(drumBus);
      body.start(s0); body.stop(Math.min(dur, s0 + 0.09));
    }
  };
  /** Coastal Drive: a soft open hat on the off-beats. */
  const openHat = (t0: number, vel: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    if (mixer) { rand(); playHit(c, mixer.perc, { name: "hat_open", at: s0, velocity: 0.4 * vel, pan: -0.2, choke: s8 * 0.8 }); return; }
    const src = c.createBufferSource(); src.buffer = noise;
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7200;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 13000;
    const gn = c.createGain();
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime(0.08 * vel, s0 + 0.004);
    gn.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.13);
    const pn = makePan(c, -0.2);
    src.connect(hp); hp.connect(lp); lp.connect(gn); gn.connect(pn); pn.connect(drumBus);
    src.start(s0, rand() * 0.8); src.stop(Math.min(dur, s0 + 0.15));
  };
  const shaker = (t0: number, vel: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    if (mixer) { rand(); playHit(c, mixer.perc, { name: "shaker", at: s0, velocity: 0.5 * vel, pan: 0.25 }); return; }
    const src = c.createBufferSource(); src.buffer = noise;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 7200; bp.Q.value = 0.7;
    const gn = c.createGain();
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime(0.09 * vel, s0 + 0.008);
    gn.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.07);
    const pn = makePan(c, 0.25);
    src.connect(bp); bp.connect(gn); gn.connect(pn); pn.connect(drumBus);
    src.start(s0, rand() * 0.9); src.stop(Math.min(dur, s0 + 0.08));
  };
  /** A soft swell of filtered noise up to `at` (into a breath's landing); bigger = a real riser. */
  const swell = (at: number, len: number, big: boolean) => {
    const s0 = Math.max(0, at - len);
    if (at - s0 < 0.1) return;
    const src = c.createBufferSource(); src.buffer = noise; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = big ? 1.2 : 0.8;
    bp.frequency.setValueAtTime(big ? 500 : 1500, s0);
    bp.frequency.exponentialRampToValueAtTime(big ? 6500 : 5000, at);
    const gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, s0);
    gn.gain.exponentialRampToValueAtTime(big ? 0.06 : 0.035, at - 0.01);
    gn.gain.linearRampToValueAtTime(0, at + 0.12);
    src.connect(bp); bp.connect(gn); gn.connect(master);
    const rs = c.createGain(); rs.gain.value = 0.8; gn.connect(rs); rs.connect(reverb);
    src.start(s0); src.stop(Math.min(dur, at + 0.15));
  };
  /** A soft, airy cymbal on a landing. */
  const air = (t0: number, vel: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.05) return;
    const src = c.createBufferSource(); src.buffer = noise; src.loop = true;
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 5000;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 11000;
    const gn = c.createGain();
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime(0.05 * vel, s0 + 0.01);
    gn.gain.exponentialRampToValueAtTime(0.0001, s0 + 1.4);
    src.connect(hp); hp.connect(lp); lp.connect(gn); gn.connect(master);
    const rs = c.createGain(); rs.gain.value = 0.7; gn.connect(rs); rs.connect(reverb);
    src.start(s0, rand() * 0.5); src.stop(Math.min(dur, s0 + 1.45));
  };
  const bassNote = (midi: number, t0: number, len: number, vel: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    const f = mtof(midi);
    // Fundamental + clean 2nd and 3rd harmonics (sines): round, but heard on a phone.
    const o = c.createOscillator(); o.type = "sine"; o.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = "sine"; o2.frequency.value = f * 2;
    const o3 = c.createOscillator(); o3.type = "sine"; o3.frequency.value = f * 3;
    const g2 = c.createGain(); g2.gain.value = 0.45;
    const g3 = c.createGain(); g3.gain.value = 0.22;
    const gn = c.createGain();
    const off = Math.min(dur, s0 + Math.max(0.08, len));
    if (mixer) playNote(c, mixer.bass, { instrument: "bass", midi, at: s0, duration: Math.max(0.08, off - s0), velocity: 0.78 * Math.min(1, vel), release: 0.09 });
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime(vel, s0 + 0.012);
    gn.gain.linearRampToValueAtTime(vel * 0.8, off);
    gn.gain.linearRampToValueAtTime(0, off + 0.06);
    o.connect(gn); o2.connect(g2); g2.connect(gn); o3.connect(g3); g3.connect(gn); gn.connect(bassDuck);
    const stop = Math.min(dur, off + 0.08);
    o.start(s0); o2.start(s0); o3.start(s0); o.stop(stop); o2.stop(stop); o3.stop(stop);
  };
  const pluck = (midi: number, t0: number, vel: number, decay = 0.45) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.03) return;
    if (mixer) {
      // Studio: nylon guitar, picked.
      const pan = jitter(0.45); // the classic voice's pan draw, in step
      playNote(c, mixer.guitar, { instrument: "nylon", midi, at: s0, duration: Math.max(0.12, decay * 0.55), velocity: clamp(0.3 + 0.45 * vel, 0.25, 0.85), release: Math.max(0.2, decay * 0.5), pan });
      return;
    }
    const f = mtof(midi);
    const o = c.createOscillator(); o.type = "triangle"; o.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = "sine"; o2.frequency.value = f * 2;
    const g2 = c.createGain(); g2.gain.value = 0.25;
    const gn = c.createGain();
    const peak = g.level * 1.6 * vel;
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime(peak, s0 + 0.004);
    gn.gain.exponentialRampToValueAtTime(0.0001, s0 + decay);
    const pn = makePan(c, jitter(0.45));
    o.connect(gn); o2.connect(g2); g2.connect(gn); gn.connect(pn); pn.connect(pluckBus);
    const stop = Math.min(dur, s0 + decay + 0.02);
    o.start(s0); o2.start(s0); o.stop(stop); o2.stop(stop);
  };
  /**
   * The mallet lead: marimba-like additive partials (1×, 4×, 9.2×) — the upper
   * ones die fast — plus a light FM shimmer on the attack. Fast attack,
   * short-to-medium decay (longer for longer notes). `_glide` is unused: a
   * mallet doesn't slide.
   */
  const leadNote = (midi: number, t0: number, len: number, vel: number, _glide: number | null) => {
    void _glide;
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.05) return;
    if (mixer) {
      // Studio: vibraphone.
      const pan = jitter(0.2); // in step with the classic voice
      playNote(c, mixer.keys, { instrument: "vibes", midi, at: s0, duration: clamp(len * 0.85, 0.2, 1.3), velocity: clamp(0.4 + 0.45 * vel, 0.35, 0.92), release: 0.9, pan });
      return;
    }
    const f = mtof(midi);
    const decay = clamp(len * 0.9, 0.45, 1.6);
    const peak = g.level * vel;
    const out = c.createGain(); out.gain.value = 1;
    const pn = makePan(c, jitter(0.2));
    out.connect(pn); pn.connect(leadBus);
    const partial = (ratio: number, amp: number, dec: number, fm: boolean) => {
      const o = c.createOscillator(); o.type = "sine"; o.frequency.value = f * ratio;
      if (fm) {
        const m = c.createOscillator(); m.type = "sine"; m.frequency.value = f * 3.5;
        const mg = c.createGain();
        mg.gain.setValueAtTime(f * 0.9, s0);
        mg.gain.exponentialRampToValueAtTime(f * 0.02, s0 + 0.09);
        m.connect(mg); mg.connect(o.frequency);
        m.start(s0); m.stop(Math.min(dur, s0 + dec + 0.05));
      }
      const gn = c.createGain();
      gn.gain.setValueAtTime(0, s0);
      gn.gain.linearRampToValueAtTime(peak * amp, s0 + 0.003);
      gn.gain.exponentialRampToValueAtTime(0.0001, s0 + dec);
      o.connect(gn); gn.connect(out);
      o.start(s0); o.stop(Math.min(dur, s0 + dec + 0.05));
    };
    partial(1, 1, decay, true);
    partial(4, 0.32, Math.min(0.22, decay), false);
    partial(9.2, 0.07, 0.06, false);
  };
  const duck = (param: AudioParam, t: number, depth: number) => {
    param.setValueAtTime(1, t);
    param.linearRampToValueAtTime(depth, t + 0.02);
    param.linearRampToValueAtTime(1, t + Math.min(0.3, beat * 0.6));
  };

  // ── Patterns (seeded) ──
  const ARPS = [[0, 1, 2, 3, 2, 1, 2, 3], [0, 2, 1, 3, 2, 1, 3, 2], [0, 1, 2, 1, 3, 2, 1, 2]];
  const arp = ARPS[Math.floor(rand() * ARPS.length)];
  const BASS = [[0, 1, 2, 3], [0, 1.5, 2, 3.5], [0, 2, 2.5, 3.5]]; // beats in the bar
  const bassPat = BASS[Math.floor(rand() * BASS.length)];
  // Coastal Drive: a rhythmic 8th-note bass (seeded rests), off-beats leaning in.
  const DRIVE_BASS = [[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], [0, 0.5, 1.5, 2, 2.5, 3.5], [0, 1, 1.5, 2, 2.5, 3, 3.5], [0, 0.5, 1, 1.5, 2.5, 3, 3.5]];
  const drivePat = drive ? DRIVE_BASS[Math.floor(rand() * DRIVE_BASS.length)] : bassPat;
  const RHYTHMS = [[1.5, 0.5, 1, 1, 2], [1, 0.5, 0.5, 1, 1.5, 1.5], [0.5, 1, 0.5, 2, 1, 1], [2, 1, 1, 1.5, 0.5]];
  const rhythm = RHYTHMS[Math.floor(rand() * RHYTHMS.length)];
  // Lead notes: the natural minor in a comfortable singing register.
  const NAT = [0, 2, 3, 5, 7, 8, 10];
  const scale: number[] = [];
  for (let m = 64; m <= 81; m++) if (NAT.indexOf(mod(m - tonicPc, 12)) >= 0) scale.push(m);
  const contour: number[] = [];
  {
    let d = Math.floor(scale.length / 2) - 1 + Math.floor(rand() * 2);
    rhythm.forEach((_, i) => {
      if (i > 0) { const r = rand(); d += r < 0.3 ? 1 : r < 0.55 ? -1 : r < 0.75 ? 2 : r < 0.9 ? -2 : 0; }
      d = clamp(d, 2, scale.length - 3);
      contour.push(d);
    });
  }

  // ── Drums and bass: the full groove, except in the opening and the breaths ──
  for (let t = phase + Math.ceil((introEnd - phase) / s8 - 1e-6) * s8; t < E - 0.02; t += s8) {
    const n8 = Math.round((t - phase) / s8);
    const pos = mod(n8, 8);
    const br = inBreath(t);
    if (mixer && feel) {
      // Studio: relaxed, brushed — a swung shaker, the kick on the beat (the
      // drive), a rim on 2 and 4. Drive adds a very quiet closed hat and a soft
      // snare on beat 4 of every other bar. No snap, no open hats.
      if (br) continue;
      // Varied every 4 bars (plan): shaker density, the rim on 4 displaced to
      // the and-of-4, a skipped kick, a ghost rim; out in a drums drop-out.
      const plan = mixer.plan;
      if (plan.out("drums", t)) continue;
      const dv = plan.drums(t), last = plan.barInBlock(t) === 3, pv = 0.75 + 0.25 * plan.fullness(t);
      const sw = feel.swing(t);
      if (dv !== 2 || pos % 2 === 1) shaker(feel.time(sw), feel.vel((pos % 2 === 1 ? 0.85 : 0.55) * pv, t));
      if (dv === 1 && pos % 2 === 1 && mixer.rand() < 0.35) shaker(feel.time(sw + s16), feel.vel(0.4 * pv, t));
      if (drive && pos % 2 === 1 && dv !== 3) playHit(c, mixer.perc, { name: "hat", at: feel.time(sw), velocity: feel.vel(0.16 * pv, t), pan: 0.3, lowpassHz: 8000 });
      const rimPos = dv === 1 ? [2, 7] : [2, 6];
      if (rimPos.indexOf(pos) >= 0) playHit(c, mixer.perc, { name: "rim", at: feel.time(sw), velocity: feel.vel((drive ? 0.5 : 0.55) * pv, t), pan: -0.1 });
      if (dv === 3 && pos === 5) playHit(c, mixer.perc, { name: "rim", at: feel.time(sw), velocity: feel.vel(0.25, t), pan: -0.1 });
      if (pos % 2 === 0) {
        if (!(dv === 2 && last && pos === 4)) {
          kick(t, feel.vel(pos === 0 ? 1 : 0.88, t));
          duck(bassDuck.gain, t, drive ? 0.5 : 0.55);
          duck(padOut.gain, t, 0.82);
        }
        if (drive && pos === 6 && mod(Math.floor(n8 / 8), 2) === 1) playHit(c, mixer.kit, { name: "snare", at: feel.time(t), velocity: feel.vel(0.32, t), lowpassHz: 6000 });
      }
      continue;
    }
    if (!br) {
      if (drive) {
        // 16th shaker, open hat on the off-beat 8ths.
        shaker(t + jitter(0.003), (pos % 2 === 1 ? 0.9 : 0.6) * (1 + jitter(0.12)));
        shaker(t + s16 + jitter(0.003), 0.5 * (1 + jitter(0.12)));
        if (pos % 2 === 1) openHat(t + jitter(0.003), 1 + jitter(0.1));
      } else {
        shaker(t + jitter(0.004), (pos % 2 === 1 ? 1 : 0.6) * (1 + jitter(0.15)));
        if (pos % 2 === 1 && rand() < 0.2) shaker(t + s16 + jitter(0.004), 0.45);
      }
      if (pos % 2 === 0) {
        kick(t, pos === 0 ? 1 : 0.9);
        duck(bassDuck.gain, t, drive ? 0.5 : 0.55);
        duck(padOut.gain, t, 0.82);
        if (pos === 2 || pos === 6) clap(t + jitter(0.004), 1);
      }
    }
  }
  segs.forEach((sg) => {
    if (sg.start >= E - 1e-3) return;
    const ch = sg.chord;
    const m = 36 + mod(tonicPc + ch.root - 36, 12);
    const pat = drive ? drivePat : bassPat;
    for (let b0 = sg.start; b0 < sg.end - 1e-3; b0 += bar) {
      pat.forEach((bt, k) => {
        const t = b0 + bt * beat;
        if (t < introEnd - 1e-3 || t >= Math.min(sg.end, E) - 0.02 || inBreath(t)) return;
        const next = drive ? t + s8 * 0.85 : k + 1 < pat.length ? b0 + pat[k + 1] * beat : b0 + bar;
        let len = Math.min(next, sg.end, E) - t - 0.05;
        // A note never rings into a breath.
        breaths.forEach((b) => { if (b.from > t && b.from < t + len) len = b.from - t - 0.03; });
        let up = drive && mod(k, 4) === 3 && rand() < 0.3 ? 12 : 0; // the odd octave lift
        if (mixer && (bt === 0 || bt === 2)) up = 0; // studio: beats 1 and 3 stay on the root octave
        const bv = drive ? (mod(bt, 1) > 0 ? 1 : 0.85) : k === 0 ? 1 : 0.85;
        if (feel) bassNote(m + up, feel.time(t), len, feel.vel(bv, t));
        else bassNote(m + up, t, len, bv);
      });
    }
  });

  // ── Plucked arpeggio underneath: 8ths from the very start ──
  for (let t = phase + Math.ceil((0.05 - phase) / s8 - 1e-6) * s8; t < E - 0.02; t += s8) {
    const n8 = Math.round((t - phase) / s8);
    const ch = chordAt(t + 0.01);
    const rootPc = mod(tonicPc + ch.root, 12);
    const base = 60 + mod(rootPc - 60, 12);
    const tones = ch.arp.map((iv) => base + iv);
    const m = tones[arp[mod(n8, arp.length)] % tones.length];
    const opening = t < introEnd;
    if (mixer && feel) {
      // Studio: the picked guitar — swung, humanized, and the notes not all
      // one length: some cut short, some left to ring over the next. Below C5.
      // Its pattern follows the plan bar by bar, its register every 4 bars;
      // out in a keys drop-out; lighter early and late.
      const plan = mixer.plan;
      if (plan.out("keys", t)) continue;
      const pat = STUDIO_PATTERNS[plan.pattern(t)];
      const pos8 = mod(n8, 8);
      if (!opening && !pat.mask[pos8]) continue;
      if (pos8 % 2 === 1 && mixer.rand() > plan.fullness(t) + 0.15) continue;
      const vt = voiceTones(tones.map((x) => x - 12), { inv: plan.voicing(t).inv, oct: 0 }, 71); // register by inversion: it stays below C5
      let mm = vt[pat.order[pos8] % vt.length];
      while (mm > 71) mm -= 12;
      while (mm < 45) mm += 12;
      const r = mixer.rand();
      const hold = r < 0.3 ? s8 * 2.6 : r < 0.75 ? s8 * 1.2 : s8 * 0.6;
      const v = clamp(0.3 + 0.45 * (mod(n8, 2) === 0 ? 1 : 0.8) * (opening ? 0.7 : 1), 0.25, 0.85);
      playNote(c, mixer.guitar, { instrument: "nylon", midi: mm, at: feel.time(feel.swing(t)), duration: hold, velocity: feel.vel(v, t), release: 0.35, pan: (mixer.rand() - 0.5) * 0.6 });
      continue;
    }
    pluck(m, t + jitter(0.005), (mod(n8, 2) === 0 ? 1 : 0.8) * (opening ? 0.7 : 1) * (1 + jitter(0.1)));
  }

  // ── The lead: two-bar phrases, A A' B A'' ──
  let prevLead: number | null = null;
  let prevEnd = -1;
  for (let ph = 0, p0 = introEnd; p0 < E - beat; ph++, p0 += 2 * bar) {
    const kind = mod(ph, 4);
    let t = p0;
    rhythm.forEach((len, i) => {
      let d = contour[i];
      if (kind === 2) d += 2;                                         // B: lifted
      if (kind === 1 && i >= rhythm.length - 2) d += i === rhythm.length - 1 ? -1 : 1; // A': a new ending
      d = clamp(d, 0, scale.length - 1);
      let m = scale[d];
      const onBeat = Math.abs((t - p0) / beat - Math.round((t - p0) / beat)) < 1e-3;
      const pcs = chordPcs(chordAt(t + 0.01));
      if (onBeat || i === rhythm.length - 1) {
        // Strong beats and phrase ends sit on a chord tone.
        let best = m, bestD = 99;
        for (let dm = -2; dm <= 2; dm++) if (pcs.indexOf(mod(m + dm, 12)) >= 0 && Math.abs(dm) < bestD) { bestD = Math.abs(dm); best = m + dm; }
        m = best;
      }
      if (kind === 3 && i === rhythm.length - 1) {
        // A'': resolve onto the chord's root or third, held.
        let best = m, bestD = 99;
        for (let dm = -4; dm <= 4; dm++) {
          const pc = mod(m + dm, 12);
          if ((pc === pcs[0] || pc === pcs[1]) && Math.abs(dm) < bestD) { bestD = Math.abs(dm); best = m + dm; }
        }
        m = best;
      }
      const dur0 = len * beat;
      if (t < E - 0.1) {
        const l = Math.min(dur0 - 0.02, E - t - 0.05);
        const legato = prevLead !== null && Math.abs(t - prevEnd) < 0.06 && prevLead !== m;
        if (mixer && feel) {
          // Studio (both Coastal moods): no vibes. A short Rhodes motif, an
          // octave over the chords, in every other phrase with rests between;
          // each appearance after a statement is its answer — a different
          // rhythm (other notes of the phrase) ending on another chord tone, held.
          const answer = mod(ph / 2, 2) === 1;
          const picks = answer ? [0, 2, 3] : [0, 1, 2];
          const lastPick = picks[picks.length - 1];
          if (mod(ph, 2) === 0 && picks.indexOf(i) >= 0 && !mixer.plan.out("keys", t)) {
            let mm = m;
            if (answer && i === lastPick) {
              const pcs = chordPcs(chordAt(t + 0.01));
              for (let dm = 1; dm <= 5; dm++) {
                if (pcs.indexOf(mod(m + dm, 12)) >= 0) { mm = m + dm; break; }
                if (pcs.indexOf(mod(m - dm, 12)) >= 0) { mm = m - dm; break; }
              }
            }
            while (mm > 79) mm -= 12;
            while (mm < 67) mm += 12;
            const hold = answer && i === lastPick ? 1.6 : 0.9;
            playNote(c, mixer.keys, { instrument: "epiano", midi: mm, at: feel.time(t), duration: Math.max(0.12, l * hold), velocity: feel.vel(0.44, t), release: 0.5, pan: 0.15 });
          }
        } else {
          leadNote(m, t + jitter(0.006), l, (i === 0 ? 1 : 0.9) * (1 + jitter(0.06)), legato ? prevLead : null);
        }
        prevLead = m; prevEnd = t + dur0;
      }
      t += dur0;
    });
  }

  // ── Breaths: a soft swell into each landing, an airy cymbal on it ──
  breaths.forEach((b, bi) => {
    // Coastal Drive: a 1-beat 16th snare fill into every other breath landing.
    if (drive && !mixer && mod(bi, 2) === 0 && b.to - b.from >= beat * 0.95) {
      for (let k = 0; k < 4; k++) clap(b.to - beat + k * s16, 0.35 + 0.17 * k);
    }
    const big = riserLands.indexOf(b.land) >= 0;
    swell(b.to, big ? Math.min(2 * bar, b.to - introEnd) : Math.min(b.to - b.from, beat * 2), big);
    air(b.to, big ? 1.2 : 0.8);
  });

  // ── The end card: a warm resolve on the relative major ──
  const home = segs[segs.length - 1].chord;
  const rootPc = mod(tonicPc + home.root, 12);
  kick(E, 0.9);
  air(E, 1);
  bassNote(36 + mod(rootPc - 36, 12), E, Math.min(2.4, dur - E - 0.1), 0.9);
  const base = 60 + mod(rootPc - 60, 12);
  // (Studio: the guitar's last chord an octave down, below C5.)
  home.arp.slice(0, 4).forEach((iv, i) => pluck(base + iv - (mixer ? 12 : 0), E + i * 0.08, 0.9 - i * 0.1, 1.6));
  let target = scale[0];
  scale.forEach((m) => { if (mod(m, 12) === rootPc || mod(m - rootPc, 12) === 4) { if (Math.abs(m - 74) < Math.abs(target - 74)) target = m; } });
  if (mixer) {
    // Studio: the landing note on the Rhodes, not the vibes.
    let mm = target;
    while (mm > 79) mm -= 12;
    while (mm < 67) mm += 12;
    playNote(c, mixer.keys, { instrument: "epiano", midi: mm, at: E + 0.02, duration: Math.max(0.3, Math.min(2.2, dur - E - 0.3)), velocity: 0.48, release: 1.2, pan: 0.15 });
  } else {
    leadNote(target, E, Math.min(2.2, dur - E - 0.3), 0.95, prevLead !== null && prevLead !== target ? prevLead : null);
  }
}

// ── Sail (Oct 27) ──────────────────────────────────────────────────────────

/**
 * Sail's sine sub under the finger bass. v2: +1.5 dB a note, and it now plays
 * on the beat as well as the off-beat — about +5 dB of sub in all (measured).
 */
const SAIL_SUB = 0.143;

/**
 * Sail (Oct 27, studio engine): bright, breezy, sunlit — a tropical-house
 * glide at 108–114 BPM in a seeded major key. The style is the one the owner
 * pointed at; the melodies and progressions are this composer's own (seeded),
 * not modelled on any track.
 *   • Intro (1–2 bars): the pad and a filtered pluck, no kick.
 *   • Groove: a soft, short kick on every beat — the pad ducks ~6 dB under
 *     each and recovers over 60% of a beat (the sidechain pump) — a closed hat
 *     on the off-beats, a quiet 16th shaker, finger bass on the off-beat 8ths
 *     over a sine sub.
 *   • Riser: a noise sweep and the pluck's low-pass opening, into the drop on
 *     the cut nearest 45% of the reel; the kick sits out the beat before it.
 *   • Drop: the pluck wide open, claps on 2 and 4, a soft crash on the downbeat.
 *   • Thin-out over the last two bars (no claps or shaker, sparser pluck), then
 *     the shared riser, end-card cadence and fade.
 *   • The pluck: a saw + square voice through a fast-closing low-pass, 180–300
 *     ms, with the 3/16 stereo delay; the nylon guitar doubles it quietly an
 *     octave down. Syncopated 16th motifs in call-and-answer bar pairs (the
 *     answer drops a note and ends on another chord tone), a rest at each bar
 *     end, three seeded rhythms rotating (never three phrases running), the
 *     register moving every 4 bars (the plan's inversions).
 * The classic engine has no Sail: it plays Coastal Drive (composeReelMusic).
 */
function composeSailLayers(g: {
  c: OfflineAudioContext; master: AudioNode; verb: AudioNode; noise: AudioBuffer; padOut: GainNode; mixer: StudioMix;
  dur: number; beat: number; bar: number; phase: number;
  introEnd: number; drop: number; E: number; segs: Seg[]; tonicPc: number; tonic: Chord;
}) {
  const { c, master, verb, noise, padOut, mixer, dur, beat, bar, phase, introEnd, drop, E, segs, tonicPc } = g;
  const rnd = mixer.rand, plan = mixer.plan;
  const s8 = beat / 2, s16 = beat / 4;
  const chordAt = (t: number): Chord => {
    for (let i = segs.length - 1; i >= 0; i--) if (t >= segs[i].start - 1e-4) return segs[i].chord;
    return segs[0].chord;
  };
  const riserStart = clamp(drop - 2 * bar, introEnd, drop);
  const thinAt = Math.max(drop + 2 * bar, E - 2 * bar);
  type Section = "intro" | "groove" | "riser" | "full" | "thin" | "end";
  const section = (t: number): Section =>
    t >= E - 1e-3 ? "end" : t < introEnd - 1e-3 ? "intro" : t < riserStart - 1e-3 ? "groove" : t < drop - 1e-3 ? "riser" : t < thinAt - 1e-3 ? "full" : "thin";

  // ── The pluck: voices → the arrangement's low-pass → the pluck bus ──
  const pluckIn = c.createGain();
  const sweep = c.createBiquadFilter(); sweep.type = "lowpass"; sweep.Q.value = 0.7;
  pluckIn.connect(sweep); sweep.connect(mixer.pluck);
  {
    // Closed in the intro, half open in the groove, sweeping open over the
    // riser, open in the drop, closing a little to thin out, open on the card.
    const pts: [number, number][] = [[introEnd, 900], [introEnd + bar * 0.5, 2600], [riserStart, 2600], [drop, 10000], [thinAt, 10000], [thinAt + bar, 4000], [E, 4000], [E + 0.4, 7000]];
    sweep.frequency.setValueAtTime(900, 0);
    let last = 0;
    pts.forEach(([t, f]) => {
      if (!(t > last + 1e-3) || t > dur) return;
      sweep.frequency.exponentialRampToValueAtTime(f, t);
      last = t;
    });
  }
  /** Saw + square through a fast-closing low-pass: bright on the attack, round by the tail. */
  const synth = (midi: number, t0: number, vel: number, decay: number, pan: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.03) return;
    const f = mtof(midi);
    const o1 = c.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = f; o1.detune.value = -5;
    const o2 = c.createOscillator(); o2.type = "square"; o2.frequency.value = f; o2.detune.value = 5;
    const g2 = c.createGain(); g2.gain.value = 0.35;
    // v2: a gentler transient — a smaller filter sweep, less resonance and an
    // 18 ms attack — so it reads as a soft keys pluck rather than a snappy one.
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.9;
    lp.frequency.setValueAtTime(Math.min(6000, f * 3 + 1200 * vel), s0);
    lp.frequency.exponentialRampToValueAtTime(Math.max(250, f * 1.5), s0 + decay * 0.8);
    const env = c.createGain();
    env.gain.setValueAtTime(0, s0);
    env.gain.linearRampToValueAtTime(vel, s0 + 0.018);
    env.gain.exponentialRampToValueAtTime(0.0001, s0 + decay);
    const pn = makePan(c, pan);
    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(env); env.connect(pn); pn.connect(pluckIn);
    const stop = Math.min(dur, s0 + decay + 0.02);
    o1.start(s0); o2.start(s0); o1.stop(stop); o2.stop(stop);
  };

  // ── The motifs: three seeded 16th rhythms (nothing in a bar's last three 16ths) ──
  // v2: mostly 8ths and held notes, one syncopation each — fewer 16th runs.
  const POOL = [[0, 2, 4, 6, 10], [0, 3, 6, 8, 12], [0, 4, 6, 10], [2, 4, 8, 10, 12], [0, 2, 6, 8, 10]];
  const pool = POOL.slice();
  const motifs: { steps: number[]; order: number[] }[] = [];
  for (let k = 0; k < 3; k++) {
    const steps = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    const order: number[] = [];
    let d = rnd() < 0.5 ? 0 : 2;
    steps.forEach((_, i) => {
      if (i > 0) { const r = rnd(); d = clamp(d + (r < 0.35 ? 1 : r < 0.6 ? -1 : r < 0.8 ? 2 : -2), 0, 4); }
      order.push(d);
    });
    motifs.push({ steps, order });
  }
  const firstBarT = phase - Math.ceil(phase / bar) * bar;
  const nBars = Math.ceil((E - firstBarT) / bar) + 1;
  // One motif per 2-bar phrase: often a new one, never the same three phrases running.
  const phraseMotif: number[] = [];
  for (let p = 0; p < nBars / 2 + 1; p++) {
    let m = p === 0 ? 0 : rnd() < 0.6 ? Math.floor(rnd() * 3) : phraseMotif[p - 1];
    if (p >= 2 && phraseMotif[p - 1] === phraseMotif[p - 2] && m === phraseMotif[p - 1]) m = (m + 1) % 3;
    phraseMotif.push(m);
  }
  for (let bi = 0; bi < nBars; bi++) {
    const b0 = firstBarT + bi * bar;
    if (b0 >= E - 0.05) break;
    const answer = bi % 2 === 1;
    const mo = motifs[phraseMotif[Math.floor(bi / 2)]];
    const inv = plan.voicing(b0 + 0.01).inv;
    if (answer && section(b0 + 0.01) === "thin") continue;
    mo.steps.forEach((st, i) => {
      if (answer && i === 3) return; // the answer drops a note: its rhythm differs
      const t = b0 + st * s16;
      if (t < 0 || t >= E - 0.05) return;
      const sc = section(t);
      if (sc === "thin" && i % 2 === 1) return;
      const ch = chordAt(t + 0.01);
      const base = 64 + mod(tonicPc + ch.root - 64, 12);
      const tones = voiceTones(ch.arp.map((iv) => base + iv), { inv, oct: 0 }, 86);
      const last = i === mo.steps.length - 1;
      const m = tones[(mo.order[i] + (answer && last ? 2 : 0)) % tones.length]; // the answer ends on another chord tone
      const secVel = sc === "intro" ? 0.55 : sc === "groove" || sc === "riser" ? 0.75 : sc === "full" ? 0.95 : 0.6;
      const vel = clamp(secVel * (st % 4 === 0 ? 1 : 0.82) * (1 + (rnd() - 0.5) * 0.16), 0.2, 1);
      const at = t + (rnd() - 0.5) * 0.006;
      const room = (i + 1 < mo.steps.length ? mo.steps[i + 1] : 16) - st;
      // v2: notes ring for the room they have (up to ~0.9 s), and the nylon carries more of it.
      synth(m, at, vel, Math.min(0.9, 0.3 + 0.06 * room), (rnd() - 0.5) * 0.5);
      playNote(c, mixer.guitar, { instrument: "nylon", midi: m - 12, at: Math.max(0, at), duration: Math.min(0.6, room * s16 * 0.8), velocity: vel * 0.55, release: 0.35, pan: -0.25 });
    });
  }

  // ── The riser into the drop: a noise sweep (the pluck's filter opens with it) ──
  if (drop - riserStart > 0.5) {
    const src = c.createBufferSource(); src.buffer = noise; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(400, riserStart);
    bp.frequency.exponentialRampToValueAtTime(7000, drop);
    const gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, riserStart);
    gn.gain.exponentialRampToValueAtTime(0.04, drop - 0.02);
    gn.gain.linearRampToValueAtTime(0, drop + 0.08);
    src.connect(bp); bp.connect(gn); gn.connect(master);
    const rs = c.createGain(); rs.gain.value = 0.7; gn.connect(rs); rs.connect(verb);
    src.start(riserStart); src.stop(Math.min(dur, drop + 0.12));
  }
  if (drop < E - bar) playHit(c, mixer.perc, { name: "crash", at: drop, velocity: 0.42 });

  // ── The sine sub under the finger bass ──
  const sub = c.createGain(); sub.gain.value = SAIL_SUB; sub.connect(master);
  const subNote = (midi: number, t0: number, len: number, vel: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02) return;
    const f = mtof(midi);
    const o = c.createOscillator(); o.type = "sine"; o.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = "sine"; o2.frequency.value = f * 2; // so a phone hears it
    const g2 = c.createGain(); g2.gain.value = 0.3;
    const gn = c.createGain();
    const off = Math.min(dur, s0 + Math.max(0.06, len));
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime(vel, s0 + 0.008);
    gn.gain.setValueAtTime(vel, off);
    gn.gain.linearRampToValueAtTime(0, off + 0.04);
    o.connect(gn); o2.connect(g2); g2.connect(gn); gn.connect(sub);
    const stop = Math.min(dur, off + 0.06);
    o.start(s0); o2.start(s0); o.stop(stop); o2.stop(stop);
  };

  // ── The groove, beat by beat ──
  for (let t = phase + Math.ceil((introEnd - phase) / beat - 1e-6) * beat; t < E - 0.02; t += beat) {
    const sc = section(t + 1e-3);
    const pos = mod(Math.round((t - phase) / beat), 4);
    const dv = plan.drums(t), lastBar = plan.barInBlock(t) === 3;
    const preDrop = t >= drop - beat - 1e-3 && t < drop - 1e-3;
    // Kick on every beat — soft and short, the low end kept clean — and the pad pumps under it.
    if (!preDrop && !(dv === 3 && lastBar && pos === 3 && sc !== "thin")) {
      playHit(c, mixer.kit, { name: "kick", at: t, velocity: sc === "thin" ? 0.7 : sc === "full" ? 0.9 : 0.8, choke: 0.3, lowpassHz: 3500 }); // v2: a longer, fuller tail
      mixer.duck(t);
      padOut.gain.setValueAtTime(1, t);
      padOut.gain.linearRampToValueAtTime(0.5, t + 0.01);
      padOut.gain.linearRampToValueAtTime(1, t + 0.6 * beat);
    }
    // Off-beat closed hat (an open one closing the bar, in some 4-bar blocks).
    const off = t + s8;
    if (off < E - 0.03) {
      const hv = (sc === "full" ? 0.36 : 0.28) * (1 + (rnd() - 0.5) * 0.2);
      if (dv === 1 && pos === 3) playHit(c, mixer.perc, { name: "hat_open", at: off, velocity: 0.3, pan: 0.25, choke: s8 * 0.9 });
      else playHit(c, mixer.perc, { name: "hat", at: off, velocity: hv, pan: 0.25 });
    }
    // A quiet 16th shaker (8ths only in some blocks); not in the thin-out.
    if (sc !== "thin") {
      for (let k = 0; k < 4; k++) {
        if (dv === 2 && k % 2 === 1) continue;
        const at = t + k * s16;
        if (at >= E - 0.03) break;
        playHit(c, mixer.perc, { name: "shaker", at, velocity: (k === 2 ? 0.26 : 0.18) * (sc === "full" ? 1 : 0.8) * (1 + (rnd() - 0.5) * 0.2), pan: -0.25 });
      }
    }
    // Claps on 2 and 4 in the drop only.
    if (sc === "full" && (pos === 1 || pos === 3)) {
      playHit(c, mixer.perc, { name: "snap", at: t, velocity: 0.6 });
      playHit(c, mixer.kit, { name: "snare", at: t, velocity: 0.2, lowpassHz: 5000 });
    }
    // Finger bass — v2: the root on the beat as well as the off-beat bounce,
    // notes held into each other (not staccato) and darker — over the sine sub.
    const bv = sc === "full" ? 0.88 : sc === "thin" ? 0.65 : 0.78;
    [[t, 0.85], [off, 1]].forEach(([at, w]) => {
      if (at >= E - 0.05) return;
      const bm = 36 + mod(tonicPc + chordAt(at + 0.01).root - 36, 12);
      const len = Math.min(s8 * 0.95, E - at - 0.03);
      playNote(c, mixer.bass, { instrument: "bass", midi: bm, at, duration: len, velocity: bv * w, release: 0.22, lowpassHz: 900 });
      subNote(bm, at, len, bv * w);
    });
  }

  // ── The end card: a kick, the tonic rolled on the pluck, bass and sub held ──
  const rootPc = mod(tonicPc + g.tonic.root, 12);
  playHit(c, mixer.kit, { name: "kick", at: E, velocity: 0.85, choke: 0.3, lowpassHz: 3500 });
  const base = 64 + mod(rootPc - 64, 12);
  g.tonic.arp.slice(0, 3).forEach((iv, i) => {
    synth(base + iv, E + i * s16, 0.8 - i * 0.1, 0.6, (i - 1) * 0.3);
    playNote(c, mixer.guitar, { instrument: "nylon", midi: base + iv - 12, at: E + i * s16, duration: 0.6, velocity: 0.35, release: 0.8, pan: -0.25 });
  });
  const hold = Math.max(0.2, Math.min(1.6, dur - E - 0.1));
  playNote(c, mixer.bass, { instrument: "bass", midi: 36 + mod(rootPc - 36, 12), at: E, duration: hold, velocity: 0.8, release: 0.3 });
  subNote(36 + mod(rootPc - 36, 12), E, hold, 0.8);
}

// ── Lively (Oct 30): a produced-pop arrangement for the lively moods ───────

/**
 * Charlie (Oct 30): "make the music sound more mainstream … a little more
 * lively." In the studio engine, Upbeat, Groove, Coastal Drive and Sail are
 * now arranged like a produced track rather than a loop with layers:
 *   intro (≈4 bars, filtered) → build (snare roll, noise riser, reversed
 *   crash, the music's filter opening) → DROP ON A PHOTO CUT (full kit, the
 *   hook) → breakdown (no kick; pad, strings, the hook softly on keys) → a
 *   1-bar build → the FINAL DROP on the bar line nearest a cut (the hook with
 *   an octave double and a strings counter-line) → a thinned last bar into
 *   the end card's cadence.
 * The groove: kick and sub locked (pad, chords and sub pump under every
 * kick), clap + snare layered on 2 and 4, 16th hats with accents and the odd
 * open hat, ghost snares, a fill closing every 4-bar phrase (a bigger one
 * every 8, never the same fill twice running), a crash on each section
 * change, swing where the mood wants it. The hook: a seeded 2-bar phrase
 * that comes back in every section, its ending different each time it is
 * played. Mastered louder (≈ -11.5 LUFS, true peak ≤ -1 dBTP; levelLoud).
 * The other moods are unchanged.
 */
type LiveStyle = {
  /** Four on the floor, or a syncopated hip-hop kick with an 808 locked to it. */
  kick: "four" | "hiphop";
  /** 16th swing: where the second 16th of each 8th falls (0.5 = straight). */
  swing: number;
  /** The chord instrument ("pad": the pad is the chords) and how it plays. */
  chords: SampledInstrument;
  chordStyle: "stabs" | "held" | "offbeat";
  /** The hook voice: the soft synth lead, or a sampled instrument. */
  hook: "synth" | SampledInstrument;
  /** The hook's double in the final drop (an octave up; the guitar an octave down). */
  double: SampledInstrument;
  bass: "pump8" | "offbeat" | "808";
  /** Nylon arpeggios in the drops. */
  guitar: boolean;
  /** Sidechain depth on the pad (gain at the bottom of the duck; the chords dip a little less). */
  pump: number;
  /** Major or minor scale for the hook (Coastal Drive's harmony is minor). */
  minorHook: boolean;
};

const LIVE_STYLES: Partial<Record<MusicMood, LiveStyle>> = {
  upbeat:        { kick: "four",   swing: 0.5,  chords: "piano",  chordStyle: "stabs",   hook: "synth",  double: "piano", bass: "pump8",   guitar: false, pump: 0.5,  minorHook: false },
  groove:        { kick: "hiphop", swing: 0.56, chords: "epiano", chordStyle: "held",    hook: "epiano", double: "piano", bass: "808",     guitar: false, pump: 0.6,  minorHook: true },
  coastal_drive: { kick: "four",   swing: 0.54, chords: "epiano", chordStyle: "offbeat", hook: "synth",  double: "nylon", bass: "offbeat", guitar: true,  pump: 0.55, minorHook: true },
  sail:          { kick: "four",   swing: 0.5,  chords: "pad",    chordStyle: "held",    hook: "synth",  double: "nylon", bass: "offbeat", guitar: true,  pump: 0.5,  minorHook: false },
};

/** Lively sub (sine) and 808 levels, straight to the master (set by measurement). */
const LIVE_SUB = 0.16;
const LIVE_808 = 0.16;

/** The lively arrangement's section boundaries (seconds): build 1, drop 1, breakdown, build 2, final drop. */
type LivePlan = { b1: number; d1: number; bk: number; b2: number; d2: number };
type LiveSection = "intro" | "build1" | "drop1" | "breakdown" | "build2" | "drop2" | "end";

/**
 * Sections from the first drop (already on a cut and a downbeat): a 1–2 bar
 * build before it; then, room permitting, drop 1, a 2–4 bar breakdown, a
 * 1-bar build, and the final drop on the bar line with a cut nearest it.
 * Short reels: no breakdown — the final drop's double comes in halfway.
 */
function planLively(d1: number, bar: number, E: number, cuts: number[]): LivePlan {
  const b1 = Math.max(0, d1 - (d1 >= 5 * bar - 1e-3 ? 2 : 1) * bar);
  const R = Math.floor((E - d1) / bar + 1e-6);
  if (R < 7) {
    const d2 = R >= 4 ? d1 + Math.floor(R / 2) * bar : E;
    return { b1, d1, bk: d2, b2: d2, d2 };
  }
  let bestK = clamp(Math.round(R * 0.6), 6, R - 3), bestS = Infinity;
  for (let k = 6; k <= R - 3; k++) {
    const t = d1 + k * bar;
    let d = Infinity;
    cuts.forEach((ct) => { d = Math.min(d, Math.abs(ct - t)); });
    const s = Math.min(d, bar) + 0.02 * Math.abs(k - R * 0.6);
    if (s < bestS) { bestS = s; bestK = k; }
  }
  const d2 = d1 + bestK * bar;
  const brk = bestK >= 10 ? 4 : 2;
  return { b1, d1, bk: d2 - (brk + 1) * bar, b2: d2 - bar, d2 };
}

/**
 * Loudness for the lively moods: K-weighted loudness to `target` LUFS
 * through a look-ahead peak limiter (1.5 ms look-ahead, 80 ms release,
 * sample ceiling -1.6 dBFS), measured again after limiting and corrected
 * once, then a 4× true-peak check that trims the whole track if any
 * inter-sample peak would pass `tpDb` dBTP. Called with -1.4 dBTP: the
 * reel's AAC encode adds up to ~0.4 dB of overshoot (measured), so the
 * delivered file stays under -1 dBTP.
 */
function levelLoud(buf: AudioBuffer, from: number, to: number, target = -11.5, tpDb = -1) {
  const chans: Float32Array[] = [];
  for (let ch = 0; ch < buf.numberOfChannels; ch++) chans.push(buf.getChannelData(ch));
  const n = buf.length, sr = buf.sampleRate;
  let a = clamp(from, 0, n), b = clamp(to, 0, n);
  if (b - a < sr) { a = 0; b = n; }
  const lufs = (xs: Float32Array[]) => {
    let ms = 0;
    xs.forEach((x) => { ms += kWeightedMeanSquare(x, a, b); });
    return -0.691 + 10 * Math.log10(Math.max(1e-12, ms));
  };
  const orig = chans.map((x) => x.slice());
  const l0 = lufs(orig);
  if (!isFinite(l0) || l0 < -70) return;
  const ceil = Math.pow(10, -1.6 / 20);
  const L = Math.max(1, Math.round(0.0015 * sr));
  const rel = 1 / (0.08 * sr);
  const need = new Float32Array(n), mn = new Float32Array(n), env = new Float32Array(n);
  const render = (gain: number) => {
    for (let i = 0; i < n; i++) {
      let pk = 0;
      for (let ch = 0; ch < orig.length; ch++) { const v = Math.abs(orig[ch][i] * gain); if (v > pk) pk = v; }
      need[i] = pk > ceil ? ceil / pk : 1;
    }
    // mn[i] = min(need[i … i+2L]) — a sliding minimum looking ahead.
    const dq = new Int32Array(n);
    let h = 0, tl = 0;
    for (let i = n - 1; i >= 0; i--) {
      while (tl > h && need[dq[tl - 1]] >= need[i]) tl--;
      dq[tl++] = i;
      while (dq[h] > i + 2 * L) h++;
      mn[i] = need[dq[h]];
    }
    // A moving average of that over the L samples before (a smooth attack that
    // is already down when the peak arrives), then a linear release.
    let sum = 0, prev = 1;
    for (let i = 0; i < n; i++) {
      sum += mn[i];
      if (i >= L) sum -= mn[i - L];
      const avg = sum / Math.min(i + 1, L);
      prev = Math.min(avg, prev + rel, 1);
      env[i] = prev;
    }
    for (let ch = 0; ch < orig.length; ch++) {
      const s = orig[ch], d = chans[ch];
      for (let i = 0; i < n; i++) d[i] = s[i] * gain * env[i];
    }
  };
  let gain = Math.pow(10, (target - l0) / 20);
  render(gain);
  const l1 = lufs(chans);
  gain *= Math.pow(10, clamp(target - l1, -3, 3) / 20);
  render(gain);
  // True peak (4×): interpolate between samples near the top with a short windowed sinc.
  const TAPS = 8;
  const kern: number[][] = [1, 2, 3].map((ph) => {
    const k: number[] = [];
    for (let j = -TAPS + 1; j <= TAPS; j++) {
      const x = j - ph / 4;
      const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / TAPS);
      k.push(sinc * w);
    }
    return k;
  });
  let tp = 0;
  const near = ceil * 0.8;
  chans.forEach((d) => {
    for (let i = TAPS; i < n - TAPS; i++) {
      const v = Math.abs(d[i]);
      if (v > tp) tp = v;
      if (v < near && Math.abs(d[i + 1]) < near) continue;
      kern.forEach((k) => {
        let s = 0;
        for (let j = 0; j < k.length; j++) s += d[i - TAPS + 1 + j] * k[j];
        const av = Math.abs(s);
        if (av > tp) tp = av;
      });
    }
  });
  const tpMax = Math.pow(10, tpDb / 20);
  if (tp > tpMax) {
    const s = tpMax / tp;
    chans.forEach((d) => { for (let i = 0; i < n; i++) d[i] *= s; });
  }
}

function composeLivelyLayers(g: {
  c: OfflineAudioContext; master: AudioNode; noise: AudioBuffer; mixer: StudioMix; style: LiveStyle; plan: LivePlan;
  dur: number; beat: number; bar: number; phase: number; E: number; segs: Seg[]; tonicPc: number;
}) {
  const { c, master, noise, mixer, style: S, plan: P, dur, beat, bar, phase, E, segs, tonicPc } = g;
  const rnd = mixer.rand;
  const s8 = beat / 2, s16 = beat / 4;
  const chordAt = (t: number): Chord => {
    for (let i = segs.length - 1; i >= 0; i--) if (t >= segs[i].start - 1e-4) return segs[i].chord;
    return segs[0].chord;
  };
  const sec = (t: number): LiveSection =>
    t >= E - 1e-3 ? "end" : t < P.b1 - 1e-3 ? "intro" : t < P.d1 - 1e-3 ? "build1" : t < P.bk - 1e-3 ? "drop1"
      : t < P.b2 - 1e-3 ? "breakdown" : t < P.d2 - 1e-3 ? "build2" : "drop2";
  const isDrop = (s: LiveSection) => s === "drop1" || s === "drop2";
  const isBuild = (s: LiveSection) => s === "build1" || s === "build2";
  const secStart = (s: LiveSection) => (s === "build1" ? P.b1 : s === "drop1" ? P.d1 : s === "breakdown" ? P.bk : s === "build2" ? P.b2 : s === "drop2" ? P.d2 : 0);
  /** The second 16th of each 8th, swung late. */
  const swung = (t: number) => (Math.abs(mod((t - phase) / s16, 2) - 1) < 0.02 ? t + (S.swing - 0.5) * 2 * s16 : t);
  const hum = (t: number, amt = 0.005) => Math.max(0, t + (rnd() - 0.5) * 2 * amt);
  const vv = (v: number) => clamp(v * (1 + (rnd() - 0.5) * 0.2), 0.02, 1);
  const preDropBeat = (t: number) => (t >= P.d1 - beat - 1e-3 && t < P.d1 - 1e-3) || (P.d2 < E && P.b2 < P.d2 && t >= P.d2 - beat - 1e-3 && t < P.d2 - 1e-3);
  const thin = (t: number) => t >= E - bar - 1e-3; // the end card's thinned last bar

  // ── Routing: the music's filter opens over each build and closes for the breakdown ──
  const pts: [number, number][] = [[Math.max(0.05, P.b1), 2600], [P.d1, 16000]];
  if (P.b2 > P.bk + 1e-3) pts.push([P.bk, 16000], [P.bk + 0.4, 2400], [P.b2, 2600], [P.d2, 16000]);
  const sweep = () => {
    const f = c.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 0.6;
    f.frequency.setValueAtTime(1400, 0);
    let last = 0;
    pts.forEach(([t, v]) => { if (!(t > last + 1e-3) || t > dur) return; f.frequency.exponentialRampToValueAtTime(v, t); last = t; });
    return f;
  };
  const chain = (dest: AudioNode) => { const inp = c.createGain(); const f = sweep(); inp.connect(f); f.connect(dest); return inp; };
  const padPump = c.createGain(); padPump.connect(mixer.strings);
  const chordPump = c.createGain(); chordPump.connect(mixer.keys);
  const padIn = chain(padPump), chordIn = chain(chordPump);
  // The hook: a gentle de-ess (-2.5 dB around 4.2 kHz) before the pluck bus, so it is bright, not tinny.
  const deess = c.createBiquadFilter(); deess.type = "peaking"; deess.frequency.value = 4200; deess.Q.value = 1; deess.gain.value = -2.5;
  deess.connect(mixer.pluck);
  const hookIn = chain(deess);
  const guitarIn = chain(mixer.guitar);
  const counterIn = c.createGain(); counterIn.connect(mixer.strings);
  // High-pass everything but the kick and the sub: the finger bass too, at 40 Hz.
  const bassHp = c.createBiquadFilter(); bassHp.type = "highpass"; bassHp.frequency.value = 40; bassHp.Q.value = 0.7; bassHp.connect(mixer.bass);
  const subBus = c.createGain(); subBus.gain.value = LIVE_SUB; subBus.connect(master);
  const subPump = c.createGain(); subPump.connect(subBus);
  const b808 = c.createGain(); b808.gain.value = LIVE_808;
  {
    const sh = c.createWaveShaper();
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(1.8 * x) / Math.tanh(1.8); }
    sh.curve = curve; sh.oversample = "2x";
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 600;
    b808.connect(sh); sh.connect(lp); lp.connect(master);
  }
  /** The sidechain pump: pad, chords and sub dip under each kick and recover over 55% of a beat. */
  let lastPump = -Infinity;
  const pump = (t: number) => {
    if (t - lastPump < beat * 0.55) return;
    lastPump = t;
    const dips: [GainNode, number][] = [[padPump, S.pump], [chordPump, Math.min(1, S.pump + 0.2)]];
    if (S.bass !== "808") dips.push([subPump, 0.4]);
    dips.forEach(([node, d]) => {
      node.gain.setValueAtTime(1, t);
      node.gain.linearRampToValueAtTime(d, t + 0.008);
      node.gain.linearRampToValueAtTime(1, t + 0.55 * beat);
    });
  };

  // ── Voices ──
  const hit = (dest: AudioNode, name: DrumHit, at: number, vel: number, o: { pan?: number; choke?: number; lowpassHz?: number; pitch?: number; reverse?: boolean } = {}) => {
    if (!(at >= 0) || (!o.reverse && at >= dur - 0.02)) return;
    // No per-hit velocity low-pass unless asked: a filter on every 16th hat made
    // the dense arrangement slow to render (the hats and shaker are bright anyway).
    playHit(c, dest, { name, at, velocity: clamp(vel, 0.02, 1), lowpassHz: 20000, ...o });
  };
  const kick = (t: number, vel: number) => { hit(mixer.kit, "kick", t, vel, { choke: 0.32, lowpassHz: 4000 }); mixer.duck(t); pump(t); };
  const clap = (t: number, vel: number) => { hit(mixer.perc, "snap", hum(t, 0.003), vel * 0.75); hit(mixer.kit, "snare", t, vel * 0.55, { lowpassHz: 7000 }); };
  const subNote = (midi: number, t0: number, len: number, vel: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02 || len <= 0.02) return;
    const f = mtof(midi);
    const o = c.createOscillator(); o.type = "sine"; o.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = "sine"; o2.frequency.value = f * 2;
    const g2 = c.createGain(); g2.gain.value = 0.25;
    const gn = c.createGain();
    const off = Math.min(dur, s0 + len);
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime(vel, s0 + 0.006);
    gn.gain.setValueAtTime(vel, Math.max(s0 + 0.006, off));
    gn.gain.linearRampToValueAtTime(0, off + 0.04);
    o.connect(gn); o2.connect(g2); g2.connect(gn); gn.connect(subPump);
    const stop = Math.min(dur, off + 0.06);
    o.start(s0); o2.start(s0); o.stop(stop); o2.stop(stop);
  };
  /** The 808: a sine with a fast pitch drop (its punch), held, through a soft tanh; an optional glide in. */
  const n808 = (midi: number, t0: number, len: number, vel: number, from: number | null) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.02 || len <= 0.02) return;
    const o = c.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(mtof(from ?? midi + 12), s0);
    o.frequency.exponentialRampToValueAtTime(mtof(midi), s0 + (from !== null ? 0.09 : 0.03));
    const gn = c.createGain();
    const off = Math.min(dur, s0 + len);
    gn.gain.setValueAtTime(0, s0);
    gn.gain.linearRampToValueAtTime(vel, s0 + 0.004);
    gn.gain.linearRampToValueAtTime(vel * 0.65, Math.max(s0 + 0.005, off));
    gn.gain.linearRampToValueAtTime(0, off + 0.05);
    o.connect(gn); gn.connect(b808);
    o.start(s0); o.stop(Math.min(dur, off + 0.07));
  };
  /** The hook's synth: three detuned saws (soft attack, a modest filter sweep) — a lead, not a pluck. */
  const lead = (midi: number, t0: number, len: number, vel: number, pan: number) => {
    const s0 = Math.max(0, t0);
    if (s0 >= dur - 0.03) return;
    const f = mtof(midi);
    const mix = c.createGain(); mix.gain.value = 0.33;
    const oscs = [-9, 0, 9].map((dt) => { const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.detune.value = dt; o.connect(mix); return o; });
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(Math.min(5200, f * 4 + 1500 * vel), s0);
    lp.frequency.exponentialRampToValueAtTime(Math.max(900, f * 2.5), s0 + 0.25);
    const env = c.createGain();
    const off = s0 + Math.max(0.05, len);
    env.gain.setValueAtTime(0, s0);
    env.gain.linearRampToValueAtTime(vel, s0 + 0.012);
    env.gain.linearRampToValueAtTime(vel * 0.7, Math.min(off, s0 + 0.2));
    env.gain.setValueAtTime(vel * 0.7, off);
    env.gain.linearRampToValueAtTime(0, off + 0.12);
    const pn = makePan(c, pan);
    mix.connect(lp); lp.connect(env); env.connect(pn); pn.connect(hookIn);
    const stop = Math.min(dur, off + 0.14);
    oscs.forEach((o) => { o.start(s0); o.stop(stop); });
  };
  const hookVoice = (midi: number, t: number, len: number, vel: number) => {
    if (S.hook === "synth") lead(midi, t, len, vel * 0.8, (rnd() - 0.5) * 0.3);
    else playNote(c, hookIn, { instrument: S.hook, midi, at: Math.max(0, t), duration: len, velocity: vel, release: 0.3, pan: (rnd() - 0.5) * 0.3 });
  };

  // ── Chord tones ──
  const rootOf = (ch: Chord) => mod(tonicPc + ch.root, 12);
  const voicing = (ch: Chord, low = 55) => ch.pad.map((iv) => low + mod(rootOf(ch) + iv - low, 12)).sort((x, y) => x - y);

  // ── The hook: a seeded 2-bar phrase (16th steps, lengths in 16ths) ──
  const RH: [number, number][][] = [
    [[0, 2], [3, 1], [4, 2], [6, 2], [10, 2], [12, 4], [16, 2], [19, 1], [20, 2], [22, 2], [26, 6]],
    [[0, 3], [3, 3], [6, 2], [8, 4], [14, 2], [16, 3], [19, 3], [22, 2], [24, 6]],
    [[2, 2], [4, 2], [6, 4], [10, 2], [12, 2], [18, 2], [20, 2], [22, 4], [28, 4]],
    [[0, 2], [2, 2], [4, 4], [8, 2], [11, 3], [14, 2], [16, 4], [20, 2], [22, 2], [24, 8]],
    [[0, 4], [6, 2], [8, 2], [10, 4], [16, 2], [18, 2], [20, 2], [22, 2], [24, 8]],
  ];
  const rhythm = RH[Math.floor(rnd() * RH.length)];
  const SCALE = S.minorHook ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const scale: number[] = [];
  for (let m = 57; m <= 81; m++) if (SCALE.indexOf(mod(m - tonicPc, 12)) >= 0) scale.push(m);
  const degs: number[] = [];
  {
    let d = Math.floor(scale.length / 2) + Math.floor(rnd() * 3) - 1;
    rhythm.forEach((_, i) => {
      if (i > 0) { const r = rnd(); d += r < 0.3 ? 1 : r < 0.55 ? -1 : r < 0.7 ? 2 : r < 0.85 ? -2 : 0; }
      d = clamp(d, 2, scale.length - 3);
      degs.push(d);
    });
  }
  /** Endings, rotated so no two appearances in a row end the same way: root, third, fifth (held), a step off (open), or a rest. */
  const ENDINGS = 5;
  let endNo = Math.floor(rnd() * ENDINGS), lastEnd = -1;
  const nextEnding = () => { let e = endNo++ % ENDINGS; if (e === lastEnd) e = endNo++ % ENDINGS; lastEnd = e; return e; };
  const nearestPc = (m: number, pcs: number[], avoid = -1) => {
    for (let d = 0; d <= 6; d++) {
      for (const s of [d, -d]) { const pc = mod(m + s, 12); if (pcs.indexOf(pc) >= 0 && pc !== avoid) return m + s; }
    }
    return m;
  };
  /** Play the hook phrase from t0. mode: how much of it (teaser = its first bar), and who plays it. */
  const playPhrase = (t0: number, mode: "teaser" | "full" | "soft", vel: number, dbl: boolean, until: number) => {
    const ending = mode === "full" ? nextEnding() : -1;
    const notes = rhythm.map(([st, len], i) => ({ st, len, i }));
    let last = -1;
    notes.forEach(({ st, len, i }) => {
      if (mode === "teaser" && st >= 16) return;
      if (mode === "soft" && st % 4 !== 0) return;
      const t = t0 + st * s16;
      if (t < 0 || t >= until - 0.02 || t >= E - 0.05) return;
      const ch = chordAt(t + 0.01);
      const pcs = [0].concat(ch.pad).map((iv) => mod(rootOf(ch) + iv, 12));
      let m = scale[degs[i]];
      if (st % 8 === 0) m = nearestPc(m, pcs); // strong 8ths sit on a chord tone
      let l = len * s16 * (mode === "soft" ? 1.8 : 0.92);
      const isLast = i === notes.length - 1;
      if (isLast && ending >= 0) {
        if (ending === 0) m = nearestPc(m, [pcs[0]]);
        else if (ending === 1) m = nearestPc(m, [pcs[1] ?? pcs[0]]);
        else if (ending === 2) { m = nearestPc(m + 3, [pcs[2] ?? pcs[0]]); l *= 1.5; }
        else if (ending === 3) m = scale[clamp(degs[i] - 1, 0, scale.length - 1)];
        else return; // a rest where the phrase would end
      }
      l = Math.min(l, until - t - 0.02, E - t - 0.03);
      if (l <= 0.03) return;
      const accent = st % 4 === 0 ? 1 : 0.85;
      const v = vv(vel * accent);
      if (mode === "soft") playNote(c, hookIn, { instrument: S.chords === "pad" ? "nylon" : S.chords, midi: m, at: hum(t), duration: l, velocity: v * 0.8, release: 0.5 });
      else hookVoice(m, hum(t, 0.003), l, v);
      if (dbl) {
        const dm = S.double === "nylon" ? m - 12 : m + 12;
        playNote(c, hookIn, { lowpassHz: 20000, instrument: S.double, midi: dm, at: hum(t, 0.003), duration: l, velocity: v * 0.5, release: 0.35, pan: 0.35 });
      }
      last = m;
    });
    return last;
  };

  // ── Bar by bar ──
  const firstBarT = phase - Math.ceil(phase / bar - 1e-9) * bar;
  const FILLS = 4;
  let fillNo = Math.floor(rnd() * FILLS), lastFill = -1;
  const KICKS = [[0, 7, 10], [0, 3, 10], [0, 6, 9, 14], [0, 10, 11], [0, 7, 11], [0, 3, 8, 11]];
  const kickBlocks: number[][] = [];
  let lastHook = -1;
  let prevCounter = -1;
  let prev808: number | null = null;
  const CH_RHY: [number, number][][] = [
    [[0, 0.45], [0.75, 0.4], [1.5, 0.4], [2.5, 0.4], [3.25, 0.4]],
    [[0.5, 0.4], [1.5, 0.4], [2.5, 0.4], [3.5, 0.4]],
    [[0, 0.9], [1.5, 0.45], [2.5, 0.9], [3.5, 0.4]],
    [[0, 0.4], [1, 0.4], [1.75, 0.4], [2.5, 0.4], [3.5, 0.4]],
  ];
  for (let b0 = firstBarT, bi = 0; b0 < E - 1e-3; b0 += bar, bi++) {
    const s = sec(b0 + 1e-3);
    const k = Math.round((b0 - secStart(s)) / bar);
    const nextS = sec(b0 + bar + 1e-3);
    const sectionEnds = nextS !== s;
    const lastBar = thin(b0 + 1e-3);
    const ch = chordAt(b0 + 0.01);
    const root = rootOf(ch);
    const introHalf = s === "intro" && b0 >= P.b1 - Math.max(bar, P.b1 / 2) - 1e-3;
    const full = isDrop(s) ? (s === "drop2" ? 1 : 0.9) : isBuild(s) ? 0.75 : 0.6;
    const blk = Math.floor(bi / 4);

    // Crash on section changes (and every 8 bars of a drop), soft into the breakdown.
    if (k === 0 && isDrop(s) && b0 > 0.1) hit(mixer.perc, "crash", b0, s === "drop2" ? 0.6 : 0.55);
    else if (isDrop(s) && k > 0 && k % 8 === 0) hit(mixer.perc, "crash", b0, 0.4);
    if (k === 0 && s === "breakdown") hit(mixer.perc, "crash", b0, 0.32);
    // Into each drop: a reversed crash and a noise sweep over the build.
    if (k === 0 && isBuild(s)) {
      const drop = s === "build1" ? P.d1 : P.d2;
      hit(mixer.perc, "crash", drop, 0.32, { reverse: true, lowpassHz: 8000 });
      const len = drop - b0;
      if (len > 0.5) {
        const src = c.createBufferSource(); src.buffer = noise; src.loop = true;
        const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.3;
        bp.frequency.setValueAtTime(350, b0); bp.frequency.exponentialRampToValueAtTime(7500, drop);
        const gn = c.createGain();
        gn.gain.setValueAtTime(0.0001, b0); gn.gain.exponentialRampToValueAtTime(0.05, drop - 0.02); gn.gain.linearRampToValueAtTime(0, drop + 0.06);
        src.connect(bp); bp.connect(gn); gn.connect(master);
        src.start(b0); src.stop(Math.min(dur, drop + 0.1));
      }
    }

    // ── Drums ──
    const drumsOn = isDrop(s) || isBuild(s) || introHalf;
    // Fills close each 4-bar phrase of a drop (bigger every 8), never the same one twice running.
    const fillHere = isDrop(s) && !lastBar && ((k % 4 === 3) || sectionEnds);
    const bigFill = fillHere && (k % 8 === 7 || nextS === "breakdown");
    let fill = -1;
    if (fillHere) { fill = fillNo++ % FILLS; if (fill === lastFill) fill = fillNo++ % FILLS; lastFill = fill; }
    const fillFrom = bigFill ? 2 : 3;
    if (S.kick === "hiphop" && kickBlocks[blk] === undefined) {
      let a = Math.floor(rnd() * KICKS.length);
      if (blk > 0 && KICKS[a] === kickBlocks[blk - 1]) a = (a + 1) % KICKS.length;
      kickBlocks[blk] = KICKS[a];
    }
    const kpat = S.kick === "four" ? [0, 4, 8, 12] : kickBlocks[blk];
    const openAt = rnd() < 0.6 ? 14 : 6; // the bar's open hat (and of 4, or and of 2)
    const ghosts = [7, 9, 15].filter(() => rnd() < 0.4);
    for (let st = 0; st < 16; st++) {
      const t0 = b0 + st * s16;
      if (t0 < 0 || t0 >= E - 1e-3 || !drumsOn) continue;
      const beatNo = st >> 2;
      const t = swung(t0);
      if (preDropBeat(t0)) continue; // the gap before a drop
      const inFill = fill >= 0 && beatNo >= fillFrom;
      // Kick
      if (s === "intro") {
        if (S.kick === "four" && (st === 0 || st === 8)) kick(t0, 0.55);
      } else if (isBuild(s)) {
        if (S.kick === "four" ? st % 4 === 0 : kpat.indexOf(st) >= 0) kick(t0, 0.7);
      } else if (isDrop(s)) {
        const skip = lastBar && st > 0 && (S.kick === "hiphop" || st !== 8);
        if (!skip && kpat.indexOf(st) >= 0) kick(t0, st === 0 ? 1 : 0.88);
      }
      // Clap + snare on 2 and 4 in the drops
      if (isDrop(s) && (st === 4 || st === 12) && !(inFill && beatNo === 3) && !(lastBar && st === 12)) clap(t0, (s === "drop2" ? 0.95 : 0.88));
      // Ghost snares
      if (isDrop(s) && !inFill && !lastBar && ghosts.indexOf(st) >= 0) hit(mixer.kit, "snare", t, vv(0.14), { lowpassHz: 5000 });
      // Hats: 16ths with accents in the drops (an open hat once a bar), 8ths in the build and intro
      if (!inFill && !(lastBar && st >= 8)) {
        if (isDrop(s)) {
          if (st === openAt) hit(mixer.perc, "hat_open", t, vv(0.36 * full), { choke: s16 * 1.8, pan: -0.2 });
          else if (!(st === openAt + 1)) hit(mixer.perc, "hat", t, vv((st % 4 === 0 ? 0.5 : st % 4 === 2 ? 0.38 : 0.22) * full), { pan: 0.22 });
        } else if (st % 2 === 0) {
          hit(mixer.perc, "hat", t, vv((st % 4 === 2 ? 0.32 : 0.2) * full), { pan: 0.22 });
        }
        if ((S.guitar || S.kick === "four") && isDrop(s) && st % 2 === 1) hit(mixer.perc, "shaker", t, vv(0.2), { pan: -0.3 });
      }
      // The build's snare roll: 8ths, then 16ths, rising
      if (isBuild(s)) {
        const drop = s === "build1" ? P.d1 : P.d2;
        const x = clamp((t0 - b0 + (b0 - secStart(s))) / Math.max(0.1, drop - secStart(s)), 0, 1);
        const step = x < 0.5 ? 2 : 1;
        if (st % step === 0) hit(mixer.kit, "snare", t0, 0.15 + 0.55 * x, { lowpassHz: 3000 + 6000 * x });
      }
      // Fills
      if (inFill) {
        const fb = st - fillFrom * 4; // 16ths into the fill
        if (bigFill && beatNo === 2) { if (st % 2 === 0) hit(mixer.kit, "snare", t0, 0.35 + 0.05 * fb); continue; }
        const q = st - 12;
        if (fill === 0) hit(mixer.kit, "snare", t0, 0.35 + 0.15 * q);
        else if (fill === 1) hit(mixer.kit, q < 2 ? "tom_hi" : "tom_lo", t0, 0.55 + 0.08 * q);
        else if (fill === 2) { if (q !== 1) hit(mixer.kit, q === 3 ? "tom_lo" : "snare", t0, 0.45 + 0.1 * q); }
        else if (q >= 2) { clap(t0, 0.6 + 0.15 * (q - 2)); }
      }
    }

    // ── Bass and sub ──
    if (s !== "intro" || introHalf) {
      const bm = 36 + mod(root - 36, 12);
      const sm = 28 + mod(root - 28, 12);
      if (s === "intro" || s === "breakdown") {
        subNote(sm + 12, b0, bar * 0.95, 0.5);
        if (s === "breakdown") playNote(c, bassHp, { lowpassHz: 20000, instrument: "bass", midi: bm, at: b0, duration: bar * 0.9, velocity: 0.45, release: 0.4 });
      } else if (S.bass === "808") {
        kpat.forEach((st, i) => {
          const t = b0 + st * s16;
          if (t >= E - 0.05 || preDropBeat(t) || (lastBar && st > 0)) return;
          const nxt = i + 1 < kpat.length ? kpat[i + 1] : 16;
          let m = 31 + mod(root - 31, 12);
          if (i > 0 && rnd() < 0.2) m += 12;
          const glide = prev808 !== null && prev808 !== m && rnd() < 0.3 ? prev808 : null;
          const len = Math.min((nxt - st) * s16 - 0.03, E - t - 0.03);
          n808(m, t, len, isBuild(s) ? 0.7 : 0.95, glide);
          playNote(c, bassHp, { lowpassHz: 20000, instrument: "bass", midi: m + 12, at: t, duration: Math.max(0.08, len), velocity: 0.45, release: 0.1 });
          prev808 = m;
        });
      } else {
        for (let e8 = 0; e8 < 8; e8++) {
          const t = b0 + e8 * s8;
          if (t >= E - 0.05 || preDropBeat(t)) continue;
          if (lastBar && e8 >= 4) break;
          const off = e8 % 2 === 1;
          if (S.bass === "offbeat" && !off && e8 % 4 !== 0) continue;
          let m = bm;
          if (S.bass === "pump8" && e8 === 7 && rnd() < 0.4) m += 12;
          const v = (off ? 0.88 : 0.7) * (isBuild(s) ? 0.8 : 1);
          const len = (S.bass === "offbeat" && !off ? s8 * 0.95 : s8 * 0.9);
          playNote(c, bassHp, { lowpassHz: 20000, instrument: "bass", midi: m, at: swung(t), duration: len, velocity: v, release: 0.12 });
        }
        // The sub: a beat at a time on the root, pumped under the kick.
        for (let q = 0; q < 4; q++) {
          const t = b0 + q * beat;
          if (t >= E - 0.05 || preDropBeat(t) || (lastBar && q >= 2)) continue;
          subNote(sm + 12, t, beat * 0.98, isBuild(s) ? 0.6 : 0.8);
        }
      }
    }

    // ── Pad (pumped; strings join it in the breakdown) held through each chord, and the chords ──
    const vt = voicing(ch);
    const padVel = s === "breakdown" ? 0.72 : s === "intro" ? 0.5 : 0.58;
    const seg = segs.find((sg) => b0 + 0.01 >= sg.start - 1e-4 && b0 + 0.01 < sg.end);
    const bounds = [P.b1, P.d1, P.bk, P.b2, P.d2, E].filter((x) => x > b0 + 1e-3);
    const secEnd = bounds.length ? Math.min(...bounds) : E;
    if (bi === 0 || k === 0 || (seg && Math.abs(seg.start - b0) < 1e-3)) {
      const padEnd = Math.min(seg ? seg.end : b0 + bar, secEnd);
      const at = Math.max(0, b0);
      if (padEnd - at > 0.05) vt.forEach((m, i) => {
        const pan = (i / Math.max(1, vt.length - 1) - 0.5) * 1.1;
        playNote(c, padIn, { instrument: "pad", midi: m, at, duration: padEnd - at, velocity: padVel, attack: k === 0 ? 0.3 : 0.08, release: 0.6, pan, detuneCents: i % 2 ? 6 : -6 });
        if (s === "breakdown" || s === "drop2") playNote(c, counterIn, { instrument: "strings", midi: m + 12, at: at + 0.02, duration: padEnd - at, velocity: s === "breakdown" ? 0.42 : 0.3, attack: 0.25, release: 0.8, pan: -pan });
      });
    }
    if (S.chords !== "pad" && s !== "end") {
      const cv = voicing(ch, S.chords === "piano" ? 57 : 55);
      const strike = (t: number, len: number, v: number) => cv.forEach((m, i) => {
        if (t >= E - 0.05) return;
        playNote(c, chordIn, { lowpassHz: 20000, instrument: S.chords, midi: m, at: Math.max(0, hum(t) + i * 0.008), duration: Math.max(0.08, Math.min(len, E - t - 0.03)), velocity: vv(v * (1 - 0.05 * i)), release: 0.3, pan: (i / Math.max(1, cv.length - 1) - 0.5) * 0.9 });
      });
      if (s === "intro" || s === "breakdown" || lastBar) strike(b0, bar * 0.95, 0.4);
      else if (S.chordStyle === "stabs") {
        const r = CH_RHY[mixer.plan.pattern(b0 + 0.01) % CH_RHY.length];
        r.forEach(([pos, len]) => { const t = b0 + pos * beat; if (!preDropBeat(t)) strike(swung(t), len * beat, isDrop(s) ? 0.6 : 0.45); });
      } else if (S.chordStyle === "offbeat") {
        [0.5, 1.5, 2.5, 3.5].forEach((pos) => { const t = b0 + pos * beat; if (!preDropBeat(t)) strike(t, beat * 0.35, isDrop(s) ? 0.55 : 0.42); });
      } else {
        strike(b0, bar * 0.9, isDrop(s) ? 0.55 : 0.45);
        if (isDrop(s) && mixer.plan.pattern(b0 + 0.01) % 2 === 1) strike(b0 + 2.5 * beat, beat, 0.35);
      }
    }

    // ── Nylon arpeggios in the drops (below C5) ──
    if (S.guitar && isDrop(s)) {
      const pat = STUDIO_PATTERNS[mixer.plan.pattern(b0 + 0.01)];
      const tones = voiceTones(ch.arp.map((iv) => 52 + mod(root - 52, 12) + iv), { inv: mixer.plan.voicing(b0 + 0.01).inv, oct: 0 }, 71);
      for (let e8 = 0; e8 < 8; e8++) {
        const t = b0 + e8 * s8;
        if (!pat.mask[e8] || t >= E - 0.05 || (lastBar && e8 >= 4)) continue;
        playNote(c, guitarIn, { lowpassHz: 20000, instrument: "nylon", midi: tones[pat.order[e8] % tones.length], at: hum(swung(t)), duration: s8 * 1.4, velocity: vv(0.4), release: 0.3, pan: 0.4 });
      }
    }

    // ── The hook (2-bar phrases from each section's start) and, in the final drop, the counter-line ──
    if (k % 2 === 0 && b0 > -bar) {
      const until = Math.min(E, b0 + 2 * bar);
      const start = b0; // notes before 0 are skipped, so the phrase stays on the grid
      if (introHalf) lastHook = playPhrase(start, "teaser", 0.5, false, until);
      else if (isBuild(s)) lastHook = playPhrase(start, "teaser", 0.62, false, Math.min(until, s === "build1" ? P.d1 : P.d2) - beat);
      else if (isDrop(s)) lastHook = playPhrase(start, "full", s === "drop2" ? 0.92 : 0.85, s === "drop2", until);
      else if (s === "breakdown") lastHook = playPhrase(start, "soft", 0.5, false, until);
    }
    if (s === "drop2" && !lastBar) {
      // The counter-line: one long note a bar, the chord's 3rd or 5th, moving as little as it can.
      const pcs = [ch.pad[0], ch.pad[1] ?? ch.pad[0]].map((iv) => mod(root + iv, 12));
      let best = 60, bd = 99;
      for (let m = 52; m <= 64; m++) if (pcs.indexOf(mod(m, 12)) >= 0) { const d = prevCounter < 0 ? Math.abs(m - 58) : Math.abs(m - prevCounter); if (d < bd) { bd = d; best = m; } }
      prevCounter = best;
      playNote(c, counterIn, { instrument: "strings", midi: best, at: b0, duration: bar * 0.95, velocity: 0.48, attack: 0.15, release: 0.5, pan: -0.3 });
    }
  }

  // ── The end card: the home chord rings out, the hook lands on its root ──
  const home = segs[segs.length - 1].chord;
  const hr = rootOf(home);
  const ring = Math.max(0.3, Math.min(2.4, dur - E - 0.1));
  kick(E, 0.85);
  hit(mixer.perc, "crash", E, 0.38);
  voicing(home).forEach((m, i) => playNote(c, padIn, { instrument: "pad", midi: m, at: E, duration: ring, velocity: 0.6, release: 1.2, pan: (i - 1.5) * 0.3 }));
  if (S.chords !== "pad") voicing(home, S.chords === "piano" ? 57 : 55).forEach((m, i) => playNote(c, chordIn, { instrument: S.chords, midi: m, at: E + i * 0.02, duration: ring, velocity: 0.5, release: 1, pan: (i - 1.5) * 0.25 }));
  const land = nearestPc(lastHook > 0 ? lastHook : 67, [hr]);
  hookVoice(land, E + 0.01, Math.min(1.8, ring), 0.7);
  playNote(c, bassHp, { lowpassHz: 20000, instrument: "bass", midi: 36 + mod(hr - 36, 12), at: E, duration: Math.min(2, ring), velocity: 0.8, release: 0.3 });
  if (S.bass === "808") n808(31 + mod(hr - 31, 12), E, Math.min(2.2, ring), 0.9, null);
  else subNote(28 + mod(hr - 28, 12) + 12, E, Math.min(2, ring), 0.8);
}
