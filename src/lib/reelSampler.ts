/**
 * A small sampler for the reel composer (src/lib/reelMusic.ts) — Oct 23.
 *
 * The oscillator instruments sounded synthetic, so the "studio" engine plays
 * real instrument recordings instead: one note every 3–4 semitones per
 * instrument, rendered from the FluidR3 General MIDI soundfont (Frank Wen,
 * MIT licence) by scripts/render_music_samples.py into public/music/. Each
 * instrument is one packed .bin (the per-note MP3 files back to back) and
 * public/music/index.json says where each note starts, how long it is, and
 * how long the note was held (`hold`) and left to ring (`release`) when it
 * was rendered.
 *
 *   loadInstruments(names, onProgress?) fetches the index once and each .bin
 *     once (kept in memory; the service worker also caches them).
 *   playNote(ctx, dest, {...}) / playHit(ctx, dest, {...}) QUEUE a note or a
 *     drum hit on a context. They are synchronous, so the composer's
 *     scheduling code stays synchronous too.
 *   flushNotes(ctx) decodes just the notes the queue needs (once per sample
 *     rate — decodeAudioData on the 48 kHz OfflineAudioContext resamples the
 *     44.1 kHz files for us) and builds the nodes, in queue order.
 *
 * Always queuing (even when every buffer is already decoded) keeps the node
 * graph — and so the rendered audio — identical whether or not this is the
 * first render of the session: same seed, same music, sample for sample.
 * Nothing here is random; the composer passes its own seeded values.
 */

export type SampledInstrument = "piano" | "epiano" | "strings" | "pad" | "nylon" | "bass" | "vibes" | "glock";
export type InstrumentName = SampledInstrument | "drums";
export type DrumHit = "kick" | "kick2" | "snare" | "rim" | "snap" | "hat" | "hat_open" | "shaker" | "ride" | "tom_lo" | "tom_hi" | "crash" | "tamb";

export type NoteOptions = {
  instrument: SampledInstrument;
  midi: number;
  /** Start, seconds on the context's clock (clamped to ≥ 0). */
  at: number;
  /** How long the key is held, seconds; the release starts after it. */
  duration: number;
  /** 0–1. Scales the level (≈ velocity^1.6) and, unless lowpassHz is given, the brightness. */
  velocity: number;
  /** Fade-in, seconds (default 4 ms — just enough to never click). */
  attack?: number;
  /** Fade-out after `duration`, seconds (default: the instrument's own, below). */
  release?: number;
  detuneCents?: number;
  /** -1 (left) … 1 (right). */
  pan?: number;
  /** A fixed low-pass instead of the velocity one. */
  lowpassHz?: number;
};

export type HitOptions = {
  name: DrumHit;
  at: number;
  velocity: number;
  pan?: number;
  /** Re-pitch in semitones (a tom a step lower, a softer kick). */
  pitch?: number;
  lowpassHz?: number;
  /** Cut the hit short after this many seconds (an open hat closed by the next hat). */
  choke?: number;
  /**
   * Play the hit backwards so it swells INTO `at` (a reversed crash into an
   * end card): `at` is where the reversed sound ends, not where it starts.
   */
  reverse?: boolean;
};

type NoteEntry = { midi: number; name?: string; offset: number; length: number; seconds: number };
type InstrumentEntry = { file: string; hold: number; release: number; notes: NoteEntry[] };
type SampleIndex = { sampleRate: number; instruments: Partial<Record<InstrumentName, InstrumentEntry>> };

const MUSIC_BASE = "/music/";

/**
 * Default release per instrument, seconds. Not the index's `release` (that is
 * how long the tail was RENDERED — 2 s for the piano, which would play every
 * note as if the sustain pedal were down): these are how long each one rings
 * after the key comes up, by ear for each kind of instrument. Callers that
 * want a pedal pass `release` themselves.
 */
const DEFAULT_RELEASE: Record<SampledInstrument, number> = {
  piano: 0.45, epiano: 0.4, strings: 0.9, pad: 1.4, nylon: 0.35, bass: 0.1, vibes: 0.9, glock: 0.7,
};
/** Sustained instruments that loop, so a chord can be held for any length. */
const LOOPED: Record<string, true> = { strings: true, pad: true };
/** The loop region starts this far in (past the attack) and ends this far before the note-off. */
const LOOP_FROM = 1.5;
const LOOP_BEFORE_OFF = 0.5;
/** Crossfade baked into the loop, so the jump from loopEnd back to loopStart is seamless. */
const LOOP_XFADE = 0.3;

// ── Pure helpers (no Web Audio; exported for tests) ───────────────────────

/** Index of the sampled note nearest `midi` (ties go to the lower one — pitching up sounds brighter, down rounder). */
export function nearestSample(midis: number[], midi: number): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < midis.length; i++) {
    const d = Math.abs(midis[i] - midi);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** playbackRate that turns the sampled note into `midi` (plus a detune in cents). */
export function playbackRateFor(midi: number, sampledMidi: number, detuneCents = 0): number {
  return Math.pow(2, (midi - sampledMidi + detuneCents / 100) / 12);
}

/** Linear gain for a 0–1 velocity: a soft note is a good deal quieter than a hard one, as on a real instrument. */
export function velocityGain(velocity: number): number {
  const v = Math.max(0, Math.min(1, velocity));
  return Math.pow(v, 1.6);
}

/** Low-pass for a velocity: soft notes darker (≈3 kHz at 0.3, ≈7 kHz at 0.7, open at 1). */
export function velocityLowpassHz(velocity: number): number {
  const v = Math.max(0, Math.min(1, velocity));
  return 1500 * Math.pow(2, 3.5 * v);
}

/**
 * Fold a note into an instrument's range by octaves when it is well outside
 * it — a guitar note shifted a whole octave by playbackRate sounds like a
 * different instrument; the same pitch class an octave over does not.
 */
export function foldIntoRange(midi: number, lo: number, hi: number, slack = 5): number {
  let m = midi;
  while (m > hi + slack && m - 12 >= lo - slack) m -= 12;
  while (m < lo - slack && m + 12 <= hi + slack) m += 12;
  return m;
}

/**
 * The loop region of a sustained note, seconds into its buffer: from
 * LOOP_FROM after the onset to LOOP_BEFORE_OFF before the note-off, kept
 * inside the buffer. Null when there isn't room for a usable loop.
 */
export function loopRegion(onset: number, hold: number, bufferSec: number): [number, number] | null {
  const a = onset + LOOP_FROM;
  const b = Math.min(onset + hold - LOOP_BEFORE_OFF, bufferSec - 0.1);
  if (!(b - a >= 1) || a - LOOP_XFADE < 0) return null;
  return [a, b];
}

// ── Loading ────────────────────────────────────────────────────────────────

let indexPromise: Promise<SampleIndex> | null = null;
let indexLoaded: SampleIndex | null = null;
const binPromises = new Map<InstrumentName, Promise<ArrayBuffer>>();
const bins = new Map<InstrumentName, ArrayBuffer>();

function loadIndex(): Promise<SampleIndex> {
  if (!indexPromise) {
    indexPromise = fetch(MUSIC_BASE + "index.json")
      .then((r) => {
        if (!r.ok) throw new Error(`Instrument index: HTTP ${r.status}`);
        return r.json() as Promise<SampleIndex>;
      })
      .then((ix) => {
        if (!ix || typeof ix !== "object" || !ix.instruments) throw new Error("Instrument index is malformed.");
        indexLoaded = ix;
        return ix;
      });
    // A failed fetch (offline, blocked) is retried next time rather than cached.
    indexPromise.catch(() => { indexPromise = null; });
  }
  return indexPromise;
}

function entryOf(ix: SampleIndex, name: InstrumentName): InstrumentEntry {
  const e = ix.instruments[name];
  if (!e || !Array.isArray(e.notes) || e.notes.length === 0) throw new Error(`No samples for “${name}”.`);
  return e;
}

/** Bytes the index says the pack holds (the end of its last note). */
function packBytes(e: InstrumentEntry): number {
  let end = 0;
  e.notes.forEach((n) => { end = Math.max(end, n.offset + n.length); });
  return end;
}

/**
 * Every note's bytes must start with an MP3 file's first bytes — an ID3 tag
 * or an MPEG frame sync. Checked once per pack: an index that has drifted
 * from its .bin would otherwise decode the tail of one note into the head of
 * the next (that happened: Oct 23, index.json was off by one file's tag).
 */
function checkPack(name: InstrumentName, e: InstrumentEntry, buf: ArrayBuffer) {
  const u8 = new Uint8Array(buf);
  if (u8.length < packBytes(e)) throw new Error(`The “${name}” samples are incomplete.`);
  e.notes.forEach((n) => {
    const o = n.offset;
    const id3 = u8[o] === 0x49 && u8[o + 1] === 0x44 && u8[o + 2] === 0x33;
    const sync = u8[o] === 0xff && (u8[o + 1] & 0xe0) === 0xe0;
    if (!id3 && !sync) throw new Error(`The “${name}” sample index doesn't match its pack.`);
  });
}

function loadBin(ix: SampleIndex, name: InstrumentName, onBytes?: (n: number) => void): Promise<ArrayBuffer> {
  const have = binPromises.get(name);
  if (have) return have;
  const e = entryOf(ix, name);
  const p = (async () => {
    const res = await fetch(MUSIC_BASE + e.file);
    if (!res.ok) throw new Error(`“${name}” samples: HTTP ${res.status}`);
    let buf: ArrayBuffer;
    const reader = onBytes && res.body ? res.body.getReader() : null;
    if (reader) {
      // Streamed, so the progress bar moves while a large pack arrives.
      const chunks: Uint8Array[] = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) { chunks.push(value); got += value.length; onBytes?.(got); }
      }
      const all = new Uint8Array(got);
      let at = 0;
      chunks.forEach((c) => { all.set(c, at); at += c.length; });
      buf = all.buffer;
    } else {
      buf = await res.arrayBuffer();
    }
    checkPack(name, e, buf);
    bins.set(name, buf);
    return buf;
  })();
  binPromises.set(name, p);
  p.catch(() => { binPromises.delete(name); });
  return p;
}

/**
 * Fetch the index and the packs for `names` (each once per page load).
 * onProgress gets 0…1 by bytes; packs already in memory count as done.
 * Rejects if anything can't be fetched — the composer then falls back to
 * its classic (oscillator) sound.
 */
export async function loadInstruments(names: InstrumentName[], onProgress?: (fraction: number) => void): Promise<void> {
  const wanted = names.filter((n, i) => names.indexOf(n) === i);
  const ix = await loadIndex();
  const sizes = wanted.map((n) => packBytes(entryOf(ix, n)));
  const total = Math.max(1, sizes.reduce((a, b) => a + b, 0));
  const got = wanted.map((n, i) => (bins.has(n) ? sizes[i] : 0));
  const report = () => { if (onProgress) onProgress(Math.min(1, got.reduce((a, b) => a + b, 0) / total)); };
  report();
  await Promise.all(wanted.map((n, i) => loadBin(ix, n, (b) => { got[i] = Math.min(sizes[i], b); report(); }).then(() => { got[i] = sizes[i]; report(); })));
}

/** Whether every one of `names` is already in memory (no fetch needed). */
export function instrumentsLoaded(names: InstrumentName[]): boolean {
  return !!indexLoaded && names.every((n) => bins.has(n));
}

// ── Decoding ───────────────────────────────────────────────────────────────

type Voice = {
  buffer: AudioBuffer;
  /** Where the sound starts in the buffer, seconds (decoders differ in how much MP3 priming they leave). */
  onset: number;
  midi: number;
  loop: [number, number] | null;
};

/** Decoded voices, by `${sampleRate}|${instrument}|${note index}` (+ "|rev" for a reversed hit). */
const voices = new Map<string, Promise<Voice>>();

function decode(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  // Both forms: older Safari only calls back; everyone else also returns a promise.
  return new Promise<AudioBuffer>((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(data, resolve, (e) => reject(e ?? new Error("decode failed")));
      if (p && typeof (p as Promise<AudioBuffer>).then === "function") (p as Promise<AudioBuffer>).then(resolve, reject);
    } catch (err) { reject(err); }
  });
}

/** First sample above ~-54 dBFS, less a millisecond; never more than 60 ms in. */
function findOnset(buf: AudioBuffer): number {
  const d = buf.getChannelData(0);
  const max = Math.min(d.length, Math.round(buf.sampleRate * 0.06));
  for (let i = 0; i < max; i++) {
    if (d[i] > 0.002 || d[i] < -0.002) return Math.max(0, i - Math.round(buf.sampleRate * 0.001)) / buf.sampleRate;
  }
  return 0;
}

/**
 * A copy of `buf` whose loop is seamless: the last LOOP_XFADE seconds before
 * loopEnd are crossfaded (equal power — an ensemble's sustain is
 * uncorrelated with itself seconds apart) into the LOOP_XFADE seconds before
 * loopStart, so arriving at loopEnd sounds exactly like arriving at
 * loopStart. Without it a held chord would click every five seconds.
 */
function bakeLoop(ctx: BaseAudioContext, buf: AudioBuffer, loop: [number, number]): AudioBuffer {
  const sr = buf.sampleRate;
  const out = ctx.createBuffer(buf.numberOfChannels, buf.length, sr);
  const a = Math.round(loop[0] * sr), b = Math.round(loop[1] * sr), x = Math.round(LOOP_XFADE * sr);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch);
    const dst = out.getChannelData(ch);
    dst.set(src);
    for (let i = 0; i < x; i++) {
      const th = (i / x) * (Math.PI / 2);
      dst[b - x + i] = src[b - x + i] * Math.cos(th) + src[a - x + i] * Math.sin(th);
    }
  }
  return out;
}

function reversed(ctx: BaseAudioContext, buf: AudioBuffer, onset: number): AudioBuffer {
  const from = Math.round(onset * buf.sampleRate);
  const n = Math.max(1, buf.length - from);
  const out = ctx.createBuffer(buf.numberOfChannels, n, buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const s = buf.getChannelData(ch), d = out.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = s[buf.length - 1 - i];
  }
  return out;
}

function voiceFor(ctx: BaseAudioContext, ix: SampleIndex, inst: InstrumentName, i: number, reverse: boolean): Promise<Voice> {
  const key = `${ctx.sampleRate}|${inst}|${i}${reverse ? "|rev" : ""}`;
  const have = voices.get(key);
  if (have) return have;
  const p = (async (): Promise<Voice> => {
    if (reverse) {
      const fwd = await voiceFor(ctx, ix, inst, i, false);
      return { buffer: reversed(ctx, fwd.buffer, fwd.onset), onset: 0, midi: fwd.midi, loop: null };
    }
    const e = entryOf(ix, inst);
    const bin = bins.get(inst);
    if (!bin) throw new Error(`“${inst}” samples aren't loaded.`);
    const n = e.notes[i];
    // slice() copies, which decodeAudioData needs: it detaches what it is given.
    const buffer = await decode(ctx, bin.slice(n.offset, n.offset + n.length));
    const onset = findOnset(buffer);
    const loop = LOOPED[inst] ? loopRegion(onset, e.hold, buffer.duration) : null;
    return { buffer: loop ? bakeLoop(ctx, buffer, loop) : buffer, onset, midi: n.midi, loop };
  })();
  voices.set(key, p);
  p.catch(() => { voices.delete(key); });
  return p;
}

// ── The queue ──────────────────────────────────────────────────────────────

type Job =
  | { kind: "note"; dest: AudioNode; o: NoteOptions }
  | { kind: "hit"; dest: AudioNode; o: HitOptions };

const queues = new WeakMap<BaseAudioContext, Job[]>();

function queueOf(ctx: BaseAudioContext): Job[] {
  let q = queues.get(ctx);
  if (!q) { q = []; queues.set(ctx, q); }
  return q;
}

const finite = (...xs: (number | undefined)[]) => xs.every((x) => x === undefined || Number.isFinite(x));

/** Queue a note (built by flushNotes). Silently ignores a note with no level or a non-finite time. */
export function playNote(ctx: BaseAudioContext, dest: AudioNode, o: NoteOptions): void {
  if (!finite(o.at, o.duration, o.velocity, o.attack, o.release, o.detuneCents, o.pan, o.lowpassHz, o.midi)) return;
  if (!(o.velocity > 0) || !(o.duration > 0)) return;
  queueOf(ctx).push({ kind: "note", dest, o: { ...o } });
}

/** Queue a drum hit (built by flushNotes). */
export function playHit(ctx: BaseAudioContext, dest: AudioNode, o: HitOptions): void {
  if (!finite(o.at, o.velocity, o.pan, o.pitch, o.lowpassHz, o.choke)) return;
  if (!(o.velocity > 0)) return;
  queueOf(ctx).push({ kind: "hit", dest, o: { ...o } });
}

function panNode(ctx: BaseAudioContext, v: number): AudioNode | null {
  if (Math.abs(v) < 1e-3) return null;
  const c = ctx as BaseAudioContext & { createStereoPanner?: () => StereoPannerNode };
  if (typeof c.createStereoPanner !== "function") return null;
  const p = c.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, v));
  return p;
}

/** The end of an offline render (Infinity for a live context). */
function horizon(ctx: BaseAudioContext): number {
  const len = (ctx as OfflineAudioContext).length;
  return typeof len === "number" && len > 0 ? len / ctx.sampleRate : Infinity;
}

/** source → (low-pass) → envelope → (pan) → dest. Returns the envelope gain. */
function chain(ctx: BaseAudioContext, src: AudioBufferSourceNode, dest: AudioNode, lowpassHz: number, pan: number): GainNode {
  const env = ctx.createGain();
  let head: AudioNode = src;
  if (lowpassHz < 16000) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = Math.max(80, lowpassHz); lp.Q.value = 0.5;
    head.connect(lp); head = lp;
  }
  head.connect(env);
  const pn = panNode(ctx, pan);
  if (pn) { env.connect(pn); pn.connect(dest); } else env.connect(dest);
  return env;
}

/**
 * Decode what the queued notes need, then build them, in the order they were
 * queued. Call once, after all scheduling and before startRendering().
 * Rejects if a needed note can't be decoded.
 */
export async function flushNotes(ctx: BaseAudioContext): Promise<number> {
  const jobs = queues.get(ctx) ?? [];
  queues.delete(ctx);
  if (jobs.length === 0) return 0;
  const ix = indexLoaded ?? (await loadIndex());

  // Which sampled note each job plays.
  const picks = jobs.map((j) => {
    if (j.kind === "note") {
      const e = entryOf(ix, j.o.instrument);
      const midis = e.notes.map((n) => n.midi);
      const midi = foldIntoRange(j.o.midi, midis[0], midis[midis.length - 1]);
      return { inst: j.o.instrument as InstrumentName, i: nearestSample(midis, midi), midi, reverse: false };
    }
    const e = entryOf(ix, "drums");
    const i = e.notes.findIndex((n) => n.name === j.o.name);
    if (i < 0) throw new Error(`No “${j.o.name}” in the drum kit.`);
    return { inst: "drums" as InstrumentName, i, midi: e.notes[i].midi, reverse: !!j.o.reverse };
  });
  const need = new Map<string, Promise<Voice>>();
  picks.forEach((p) => {
    const k = `${p.inst}|${p.i}|${p.reverse ? 1 : 0}`;
    if (!need.has(k)) need.set(k, voiceFor(ctx, ix, p.inst, p.i, p.reverse));
  });
  const keys = Array.from(need.keys());
  const done = await Promise.all(keys.map((k) => need.get(k)!));
  const got = new Map<string, Voice>();
  keys.forEach((k, n) => got.set(k, done[n]));

  const end = horizon(ctx);
  let built = 0;
  jobs.forEach((j, n) => {
    const p = picks[n];
    const v = got.get(`${p.inst}|${p.i}|${p.reverse ? 1 : 0}`)!;
    if (j.kind === "note") {
      const o = j.o;
      const at = Math.max(0, o.at);
      if (at >= end) return;
      const rate = playbackRateFor(p.midi, v.midi, o.detuneCents ?? 0);
      const peak = velocityGain(o.velocity);
      if (!(peak > 1e-5)) return;
      const attack = Math.max(0.001, o.attack ?? 0.004);
      const rel = Math.max(0.01, o.release ?? DEFAULT_RELEASE[o.instrument]);
      const off = at + Math.max(attack, o.duration);
      const src = ctx.createBufferSource();
      src.buffer = v.buffer;
      src.playbackRate.value = rate;
      // Loop only when the note would otherwise run past the loop's end.
      const loops = !!v.loop && (off + rel - at) * rate > v.loop[1] - v.onset;
      if (loops && v.loop) { src.loop = true; src.loopStart = v.loop[0]; src.loopEnd = v.loop[1]; }
      const env = chain(ctx, src, j.dest, o.lowpassHz ?? velocityLowpassHz(o.velocity), o.pan ?? 0);
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(peak, at + attack);
      env.gain.setValueAtTime(peak, off);
      // From the held level (never 0) down 60 dB: an exponential ramp sounds like a real damper.
      env.gain.exponentialRampToValueAtTime(peak * 0.001, off + rel);
      const natural = loops ? Infinity : at + Math.max(0, v.buffer.duration - v.onset) / rate + 0.01;
      const stop = Math.min(off + rel + 0.02, natural);
      src.start(at, v.onset);
      src.stop(Math.max(at + 0.005, stop));
      built++;
      return;
    }
    // A drum hit.
    const o = j.o;
    const rate = Math.pow(2, (o.pitch ?? 0) / 12);
    const len = Math.max(0.005, (v.buffer.duration - v.onset) / rate);
    const peak = velocityGain(o.velocity);
    if (!(peak > 1e-5)) return;
    const src = ctx.createBufferSource();
    src.buffer = v.buffer;
    src.playbackRate.value = rate;
    const env = chain(ctx, src, j.dest, o.lowpassHz ?? velocityLowpassHz(Math.min(1, 0.35 + o.velocity)), o.pan ?? 0);
    if (o.reverse) {
      // Ends at `at`; starts inside the buffer if that would be before 0.
      const endAt = o.at;
      if (endAt <= 0.02) return;
      const startAt = endAt - len;
      const at = Math.max(0, startAt);
      const offset = (at - startAt) * rate;
      env.gain.setValueAtTime(peak, at);
      env.gain.setValueAtTime(peak, Math.max(at, endAt - 0.008));
      env.gain.linearRampToValueAtTime(0, endAt);
      src.start(at, offset);
      src.stop(endAt + 0.005);
      built++;
      return;
    }
    const at = Math.max(0, o.at);
    if (at >= end) return;
    env.gain.setValueAtTime(peak, at);
    let stop = at + len + 0.01;
    if (o.choke !== undefined && o.choke > 0 && o.choke < len) {
      env.gain.setValueAtTime(peak, at + o.choke);
      env.gain.linearRampToValueAtTime(0, at + o.choke + 0.04);
      stop = at + o.choke + 0.05;
    }
    src.start(at, v.onset);
    src.stop(stop);
    built++;
  });
  return built;
}

/** Drop anything queued on `ctx` without building it (a render abandoned part-way). */
export function discardNotes(ctx: BaseAudioContext): void {
  queues.delete(ctx);
}
