/**
 * Depth motion — the engine behind the Walkthrough and Underway looks.
 * -------------------------------------------------------------------
 * A flat zoom scales the whole photograph by the same amount, so a chair in
 * the foreground and the window behind it grow together and the picture reads
 * as a picture being enlarged. A camera that actually moves does something
 * different: near things grow and shift faster than far things. That
 * difference is what makes a room feel walked into.
 *
 * So for each photograph we first estimate how far away every part of it is
 * (a small depth model, Depth Anything V2 Small, run in the broker's own
 * browser — see public/depth/v1/README.md), and then a WebGL shader moves a
 * virtual camera through the photograph. For every pixel on screen the shader
 * marches a ray into the depth map and takes the colour of the photograph
 * where the ray lands, so nearer things correctly pass in front of farther
 * ones. Every pixel on screen is sampled from the original photograph;
 * nothing is generated or filled in — the overscan below keeps every ray
 * inside the photograph.
 *
 * v3: a small vocabulary of camera moves (MOVES), one chosen per photograph:
 * the next move in a rotation that the photograph can take cleanly, never the
 * same as the photograph before it. A photograph that can't take any of them
 * at a decent strength gets the gentle move on a softened depth map.
 *
 * The maths is a port of the Python prototype (engine.py, engine2.py,
 * engine3.py: guided_filter, prepare, march, overscan, tear_score, choose,
 * render).
 *
 * Client-only. Loaded with a dynamic import from the ReelMaker, so nothing
 * here runs or is bundled until a depth look's render starts. Nothing here
 * throws at the caller: a photograph whose depth can't be made simply plays
 * with the ordinary flat zoom.
 */

/** Versioned, self-hosted asset folder (model, runtime, worker). */
const ASSET_BASE = "/depth/v1/";
/**
 * Bumped whenever what the cache holds changes meaning, so a map made by an
 * older engine in the same page session is never reused.
 */
const ENGINE_VERSION = "v3";

/** Far plane as a multiple of the nearest surface: the scene's depth spread. */
const FAR = 8;
/** Default short side of the image the depth model sees (a multiple of 14). */
const INPUT_SHORT = 392;
/** Long side of the depth map the shader marches (the prototype's 960×540). */
const MAP_LONG = 960;
/** Guided filter: window radius (px, at a 960 map) and edge sensitivity. */
const GUIDE_RADIUS = 5;
const GUIDE_EPS = 3e-4;

export type MoveName = "push_arc" | "pull_arc" | "glide" | "rise" | "diagonal";
type Move = { push: number; slide: number; lift: number; rev: boolean };

/**
 * The camera moves, at full strength. push = forward travel (a fraction of
 * the distance to the nearest surface); slide = sideways and lift = up/down
 * (fractions of the frame, end to end, for something at the nearest
 * surface's depth); rev = the move is played backwards (pull_arc is push_arc
 * walking out of the room instead of into it).
 */
const MOVES: Record<MoveName, Move> = {
  push_arc: { push: 0.17, slide: 0.035, lift: 0.0, rev: false },
  pull_arc: { push: 0.17, slide: 0.035, lift: 0.0, rev: true },
  glide: { push: 0.06, slide: 0.075, lift: 0.0, rev: false },
  rise: { push: 0.09, slide: 0.0, lift: 0.05, rev: false },
  diagonal: { push: 0.12, slide: 0.045, lift: -0.03, rev: false },
};
/** The rotations: inside the boat leads with walking in; outside with a glide past. */
const INTERIOR_ORDER: MoveName[] = ["push_arc", "glide", "diagonal", "rise", "pull_arc"];
const EXTERIOR_ORDER: MoveName[] = ["glide", "pull_arc", "rise", "diagonal", "push_arc"];

/**
 * How much movement — "as much as each photograph can take".
 *
 * Before a photograph plays, a candidate move is tried on it (cheaply, on the
 * CPU, at low resolution) and we measure how much of the picture would be
 * visibly stretched: where a near object pulls away from what is behind it,
 * the photograph has no pixels for the gap and the edge smears across it. A
 * smear only counts where the photograph has detail to smear. That is the
 * tear score, in percent of the frame.
 *
 * A move is scaled by m = min(1, SCORE_FULL / score) — full strength on a
 * clean scene, less on a harder one — and is only taken if m ≥ MIN_SCALE
 * (a move cut to less than 60% of itself stops reading as that move).
 * Otherwise the next move in the rotation is tried. If none qualifies, the
 * scene has thin or mirror-like things close to the lens — stainless rails,
 * poles, glass edges — and it gets the gentle move (SOFT) on a softened depth
 * map, which spreads any stretching beside objects rather than on them.
 */
const SCORE_FULL = 0.9;
const MIN_SCALE = 0.6;
const SOFT = { push: 0.09, slide: 0.012, lift: 0 };

/** Ray-march steps and refinements in the shader (prototype: 28 / 5). */
const MARCH_STEPS = 28;
const MARCH_REFINE = 5;
/** …and in the tear score (prototype: 24 / 4, at half the map's size). */
const SCORE_STEPS = 24;
const SCORE_REFINE = 4;

/**
 * Photographs' depth work kept for the page's lifetime. Each holds a 960px
 * depth map and contrast map in half floats (~2.1–2.5 MB together), so 40 —
 * a full Long reel — is ~85–100 MB at most.
 */
const CACHE_MAX = 40;
/** Photo textures kept on the GPU at once (each is ~13 MB at 2208px). */
const PHOTO_TEX_MAX = 3;
/** Output canvases kept at once: a crossfade needs two to stay valid together. */
const CANVAS_POOL_MAX = 3;
/** The first request also downloads the model and the runtime (~41 MB). */
const FIRST_TIMEOUT_MS = 180_000;
const NEXT_TIMEOUT_MS = 90_000;

export type DepthInfo = {
  /** The chosen move, or "gentle" for the soft fallback. */
  move: MoveName | "gentle";
  /** "rigid": edges snapped to the photo. "soft": the gentle move's softened map. */
  mode: "rigid" | "soft";
  /** Sideways direction: +1 for an even turn, −1 for an odd one. */
  sign: 1 | -1;
  push: number;
  slide: number;
  lift: number;
  rev: boolean;
  /** The chosen move's tear score (gentle: the lowest of those tried), % of frame. */
  score: number;
  /** Every candidate tried, in order, with its score. */
  tried: { move: MoveName; score: number }[];
  /** Timings of the work done for this prepare (0 where it came from the cache). */
  inferMs: number;
  guidedMs: number;
  contrastMs: number;
  /** CPU time of each tear score computed in this prepare (cached ones are absent). */
  candidateMs: { move: MoveName; ms: number }[];
  /** True when nothing had to be computed but the plan. */
  cached: boolean;
};

export type PrepareOptions = {
  /** Short side of the model's input (default 392; 308 on phones). */
  inputShort?: number;
  /** Shot from off the boat (isExterior): picks the exterior rotation, and reverses the gentle move. */
  exterior?: boolean;
  /** The move chosen for the photograph before this one, never repeated. */
  lastMove?: string | null;
  /** This photograph's position among the reel's photographs, in play order. */
  turn?: number;
};

export type DepthMotion = {
  /**
   * Make (or fetch from cache) the depth map for item i and choose its move.
   * Resolves to the chosen move's name ("gentle" for the soft fallback), or
   * null if depth could not be made — the caller then falls back to the flat
   * zoom for that photo. Never throws.
   */
  prepare(i: number, cacheKey: string, bmp: ImageBitmap, opts?: PrepareOptions): Promise<string | null>;
  /**
   * The photograph for item i at `u` (0..1) along its move: plain progress —
   * the engine applies the move's own direction, strength and side. Returns a
   * canvas exactly bmp.width x bmp.height, or null if i was not prepared (or
   * the GPU context was lost).
   */
  frame(i: number, bmp: ImageBitmap, u: number): HTMLCanvasElement | OffscreenCanvas | null;
  /** What prepare decided for item i, or null. */
  info(i: number): DepthInfo | null;
  /**
   * Test only: march item i's move on the CPU over the depth map's grid at
   * both ends of the move and return how far any ray lands outside the
   * photograph (≤ 0 means every sample is inside it).
   */
  debugBounds(i: number): number;
  dispose(): void;
};

/** WebGL2 + module workers: everything the engine needs. */
export function depthMotionSupported(): boolean {
  try {
    if (typeof window === "undefined" || typeof Worker === "undefined") return false;
    if (typeof WebGL2RenderingContext === "undefined") return false;
    // Module workers: Chrome 80+, Safari 15+, Firefox 114+. The only reliable
    // test is to ask for one and see whether the options object's `type` is read.
    let moduleOk = false;
    const probe = {
      get type() { moduleOk = true; return "module" as const; },
    };
    try {
      const w = new Worker("data:text/javascript,", probe as WorkerOptions);
      w.terminate();
    } catch { /* a data: URL may be refused; the getter has already run */ }
    if (!moduleOk) return false;
    // A browser drawing WebGL in software (no GPU, or a blocklisted driver)
    // would take the better part of a second per frame here — a reel would
    // take many minutes. Those get the flat zoom instead.
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2", { failIfMajorPerformanceCaveat: true });
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

// ── The worker (one per page, kept alive) ───────────────────────────────────

type Pending = { resolve: (r: { depth: Float32Array; width: number; height: number } | null) => void; timer: ReturnType<typeof setTimeout> };

let worker: Worker | null = null;
let workerBroken = false;
let workerAnswered = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAll() {
  pending.forEach((p) => { clearTimeout(p.timer); p.resolve(null); });
  pending.clear();
}

function breakWorker() {
  workerBroken = true;
  failAll();
  try { worker?.terminate(); } catch { /* already gone */ }
  worker = null;
}

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    // A plain URL string, built at runtime — webpack leaves it alone, so the
    // worker and the runtime it imports are served straight from /public.
    const url = new URL(`${ASSET_BASE}worker.mjs`, window.location.origin).href;
    const w = new Worker(url, { type: "module" });
    w.onmessage = (e: MessageEvent) => {
      const { id, depth, width, height, error } = e.data || {};
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      clearTimeout(p.timer);
      if (error || !(depth instanceof Float32Array)) {
        // The model could not load, or this run failed. The worker does not
        // retry a failed load, so don't send it any more work.
        if (!workerAnswered) breakWorker();
        p.resolve(null);
        return;
      }
      workerAnswered = true;
      p.resolve({ depth, width, height });
    };
    w.onerror = () => breakWorker();
    w.onmessageerror = () => breakWorker();
    worker = w;
    return w;
  } catch {
    workerBroken = true;
    return null;
  }
}

function inferDepth(rgba: Uint8ClampedArray, width: number, height: number) {
  return new Promise<{ depth: Float32Array; width: number; height: number } | null>((resolve) => {
    const w = getWorker();
    if (!w) { resolve(null); return; }
    const id = nextId++;
    // A worker that has gone quiet is treated as broken: waiting on it for
    // every photograph would turn a fallback into a frozen page.
    const timer = setTimeout(() => {
      if (pending.delete(id)) { resolve(null); breakWorker(); }
    }, workerAnswered ? NEXT_TIMEOUT_MS : FIRST_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    try {
      w.postMessage({ id, rgba, width, height }, [rgba.buffer]);
    } catch {
      pending.delete(id);
      clearTimeout(timer);
      resolve(null);
    }
  });
}


// ── Depth cache (module-level: survives re-renders) ─────────────────────────
//
// What is expensive and the same whatever order the photographs play in —
// the model's answer turned into the edge-snapped map, the focus point, the
// contrast map, each move's tear score once computed, the softened map once
// needed — is kept per photograph. Which move a photograph gets depends on
// its neighbours (never the same move twice running) and is decided afresh
// on every render, from these.

type Analysed = {
  w: number;
  h: number;
  cx: number;
  cy: number;
  /** Median of the rigid map: the depth that stays put as the camera slides. */
  f: number;
  /** The rigid (edge-snapped) invz map, half floats, top row first. */
  invz: Uint16Array;
  zmin: number;
  zmax: number;
  /** Local contrast (blurred grey → Sobel → 5×5 max), half floats. */
  grad: Uint16Array;
  scores: Partial<Record<MoveName, number>>;
  /** The gentle move's softened map, made the first time it is needed. */
  soft?: { invz: Uint16Array; zmin: number; zmax: number };
  inferMs: number;
  guidedMs: number;
  contrastMs: number;
};

const cache = new Map<string, Analysed>();

function cacheGet(key: string): Analysed | undefined {
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); } // most recent last
  return hit;
}

function cacheSet(key: string, v: Analysed) {
  cache.delete(key);
  cache.set(key, v);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Let the page repaint (progress text) and take clicks (Cancel). */
const yieldToPage = () => new Promise<void>((r) => setTimeout(r, 0));

// ── Image operations (ports of the cv2 calls in the prototype) ─────────────

/** np.percentile with linear interpolation, on an already-sorted array. */
function percentileSorted(sorted: Float32Array, q: number) {
  const pos = (sorted.length - 1) * (q / 100);
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** cv2 BORDER_REFLECT_101 index. */
function refl(v: number, n: number) {
  if (n === 1) return 0;
  while (v < 0 || v >= n) v = v < 0 ? -v : 2 * n - 2 - v;
  return v;
}

/** cv2.resize INTER_CUBIC (a = −0.75, pixel-centre aligned, edge replicated). */
function resizeCubic(src: Float32Array, sw: number, sh: number, dw: number, dh: number) {
  const A = -0.75;
  const weights = (t: number) => {
    const w0 = ((A * (t + 1) - 5 * A) * (t + 1) + 8 * A) * (t + 1) - 4 * A;
    const w1 = ((A + 2) * t - (A + 3)) * t * t + 1;
    const w2 = ((A + 2) * (1 - t) - (A + 3)) * (1 - t) * (1 - t) + 1;
    return [w0, w1, w2, 1 - w0 - w1 - w2];
  };
  const axis = (sn: number, dn: number) => {
    const idx = new Int32Array(dn * 4), wt = new Float32Array(dn * 4);
    const sc = sn / dn;
    for (let o = 0; o < dn; o++) {
      const s = (o + 0.5) * sc - 0.5;
      const i0 = Math.floor(s);
      const w = weights(s - i0);
      for (let k = 0; k < 4; k++) {
        idx[o * 4 + k] = Math.min(sn - 1, Math.max(0, i0 - 1 + k));
        wt[o * 4 + k] = w[k];
      }
    }
    return { idx, wt };
  };
  const ax = axis(sw, dw), ay = axis(sh, dh);
  const tmp = new Float32Array(dw * sh);
  for (let y = 0; y < sh; y++) {
    const row = y * sw;
    for (let x = 0; x < dw; x++) {
      let a = 0;
      for (let k = 0; k < 4; k++) a += ax.wt[x * 4 + k] * src[row + ax.idx[x * 4 + k]];
      tmp[y * dw + x] = a;
    }
  }
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let a = 0;
      for (let k = 0; k < 4; k++) a += ay.wt[y * 4 + k] * tmp[ay.idx[y * 4 + k] * dw + x];
      out[y * dw + x] = a;
    }
  }
  return out;
}

/** Separable correlation with a 1-D kernel on both axes, reflect-101 border. */
function sepFilter(src: Float32Array, w: number, h: number, kx: ArrayLike<number>, ky: ArrayLike<number>) {
  const rx = (kx.length - 1) >> 1, ry = (ky.length - 1) >> 1;
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = 0; i < kx.length; i++) a += kx[i] * src[row + refl(x + i - rx, w)];
      tmp[row + x] = a;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = 0; i < ky.length; i++) a += ky[i] * tmp[refl(y + i - ry, h) * w + x];
      out[y * w + x] = a;
    }
  }
  return out;
}

/** cv2.blur, a (2r+1)² normalised box. */
function boxBlur(src: Float32Array, w: number, h: number, r: number) {
  const k = new Float32Array(2 * r + 1).fill(1 / (2 * r + 1));
  return sepFilter(src, w, h, k, k);
}

function gaussKernel(k: number, sigma: number) {
  const r = (k - 1) >> 1;
  const kern = new Float32Array(k);
  let sum = 0;
  for (let i = 0; i < k; i++) { const v = Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)); kern[i] = v; sum += v; }
  for (let i = 0; i < k; i++) kern[i] /= sum;
  return kern;
}

/** cv2.GaussianBlur((k,k), 0): sigma from k. */
function gaussianK(src: Float32Array, w: number, h: number, k: number) {
  const g = gaussKernel(k, 0.3 * ((k - 1) * 0.5 - 1) + 0.8);
  return sepFilter(src, w, h, g, g);
}

/** cv2.GaussianBlur((0,0), sigma) on float data: k = round(8σ + 1) | 1. */
function gaussianSigma(src: Float32Array, w: number, h: number, sigma: number) {
  const g = gaussKernel(Math.round(sigma * 8 + 1) | 1, sigma);
  return sepFilter(src, w, h, g, g);
}

/** He et al.'s guided filter (cv2 box means): snaps p's edges to I's. */
function guidedFilter(I: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number) {
  const n = w * h;
  const Ip = new Float32Array(n), II = new Float32Array(n);
  for (let k = 0; k < n; k++) { Ip[k] = I[k] * p[k]; II[k] = I[k] * I[k]; }
  const mI = boxBlur(I, w, h, r), mp = boxBlur(p, w, h, r);
  const mIp = boxBlur(Ip, w, h, r), mII = boxBlur(II, w, h, r);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const cov = mIp[k] - mI[k] * mp[k];
    const v = mII[k] - mI[k] * mI[k];
    a[k] = cov / (v + eps);
    b[k] = mp[k] - a[k] * mI[k];
  }
  const ma = boxBlur(a, w, h, r), mb = boxBlur(b, w, h, r);
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) out[k] = ma[k] * I[k] + mb[k];
  return out;
}

/** Grey dilation (max filter) with a given row-half-width per kernel row. */
function dilateRows(src: Float32Array, w: number, h: number, half: number[]) {
  const r = (half.length - 1) >> 1;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = -Infinity;
      for (let i = 0; i < half.length; i++) {
        const yy = y + i - r;
        if (yy < 0 || yy >= h || half[i] < 0) continue;
        const row = yy * w;
        const x0 = Math.max(0, x - half[i]), x1 = Math.min(w - 1, x + half[i]);
        for (let xx = x0; xx <= x1; xx++) { const v = src[row + xx]; if (v > m) m = v; }
      }
      out[y * w + x] = m;
    }
  }
  return out;
}

/** Row half-widths of cv2's MORPH_ELLIPSE k×k element. */
function ellipseRows(k: number) {
  const r = Math.floor(k / 2);
  const half: number[] = [];
  for (let i = 0; i < k; i++) {
    const dy = i - r;
    half.push(Math.abs(dy) <= r ? Math.round(r * Math.sqrt((r * r - dy * dy) / (r * r || 1))) : -1);
  }
  return half;
}

/** Bilinear sample at normalised (px, py), edge replicated (cv2.remap + BORDER_REPLICATE). */
function sampleAt(m: Float32Array, w: number, h: number, px: number, py: number) {
  const fx = px * w - 0.5, fy = py * h - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const wx = fx - x0, wy = fy - y0;
  const xa = Math.min(w - 1, Math.max(0, x0)), xb = Math.min(w - 1, Math.max(0, x0 + 1));
  const ya = Math.min(h - 1, Math.max(0, y0)), yb = Math.min(h - 1, Math.max(0, y0 + 1));
  const a = m[ya * w + xa], b = m[ya * w + xb], c = m[yb * w + xa], d = m[yb * w + xb];
  return (a + (b - a) * wx) * (1 - wy) + (c + (d - c) * wx) * wy;
}


/**
 * The ray march (engine2.march), one output point. Walks the ray's depth z
 * from the lens (1) to the far plane (1/FAR) and stops at the first depth
 * the surface reaches — the nearest thing along the ray — then refines.
 * Writes the source position into out[0..1] and returns z.
 */
function marchPoint(
  m: Float32Array, w: number, h: number, qx: number, qy: number,
  t: number, sx: number, sy: number, cx: number, cy: number, f: number,
  steps: number, refine: number, out: Float32Array,
) {
  const loFar = 1 / FAR;
  let found = false, lo = loFar, hi = 1, prev = 1;
  for (let k = 0; k <= steps; k++) {
    const z = 1 - ((1 - loFar) * k) / steps;
    const s = 1 - t * z;
    const px = cx + (qx - cx) * s + sx * (z - f);
    const py = cy + (qy - cy) * s + sy * (z - f);
    if (sampleAt(m, w, h, px, py) >= z) { lo = z; hi = prev; found = true; break; }
    prev = z;
  }
  if (!found) { lo = loFar; hi = loFar; }
  for (let k = 0; k < refine; k++) {
    const z = (lo + hi) * 0.5;
    const s = 1 - t * z;
    const px = cx + (qx - cx) * s + sx * (z - f);
    const py = cy + (qy - cy) * s + sy * (z - f);
    if (sampleAt(m, w, h, px, py) >= z) lo = z; else hi = z;
  }
  const s = 1 - t * lo;
  out[0] = cx + (qx - cx) * s + sx * (lo - f);
  out[1] = cy + (qy - cy) * s + sy * (lo - f);
  return lo;
}

/**
 * engine3.overscan: just enough enlargement that the sideways and up/down
 * parts of the move never look past the photograph's edge. The furthest any
 * point can shift is half the slide (or lift) times the largest depth
 * difference from f in this map; the focus point's distance to the nearer
 * edge is the room there is.
 */
function overscan(zmin: number, zmax: number, f: number, cx: number, cy: number, slide: number, lift: number) {
  const span = Math.max(zmax - f, f - zmin);
  const mx = 0.5 * Math.abs(slide) * span, my = 0.5 * Math.abs(lift) * span;
  const ox = 1 / Math.max(1e-3, 1 - mx / Math.min(cx, 1 - cx));
  const oy = 1 / Math.max(1e-3, 1 - my / Math.min(cy, 1 - cy));
  return Math.max(ox, oy) + 0.004;
}

/** engine3.contrast_map: blurred grey → Sobel magnitude → 5×5 max. */
function contrastMap(grey: Float32Array, w: number, h: number) {
  const g = gaussianSigma(grey, w, h, 1.5);
  const gx = sepFilter(g, w, h, [-1, 0, 1], [1, 2, 1]);
  const gy = sepFilter(g, w, h, [1, 2, 1], [-1, 0, 1]);
  const mag = new Float32Array(w * h);
  for (let k = 0; k < mag.length; k++) mag[k] = Math.hypot(gx[k], gy[k]);
  return dilateRows(mag, w, h, [2, 2, 2, 2, 2]);
}

/**
 * engine3.tear_score: the share of the frame (in percent) that the move
 * would show as stretched picture with detail in it, the worse of the move's
 * two ends. Marched at half the map's size.
 */
function tearScore(invz: Float32Array, grad: Float32Array, w: number, h: number,
  cx: number, cy: number, f: number, over: number, push: number, slide: number, lift: number) {
  const lw = Math.max(2, Math.round(w / 2)), lh = Math.max(2, Math.round(h / 2));
  const px = new Float32Array(lw * lh), py = new Float32Array(lw * lh), pz = new Float32Array(lw * lh);
  const pt = new Float32Array(2);
  let worst = 0;
  for (const u of [0, 1]) {
    const t = push * u, sx = slide * (u - 0.5), sy = lift * (u - 0.5);
    for (let y = 0; y < lh; y++) {
      const qy = cy + ((y + 0.5) / lh - cy) / over;
      for (let x = 0; x < lw; x++) {
        const qx = cx + ((x + 0.5) / lw - cx) / over;
        const k = y * lw + x;
        pz[k] = marchPoint(invz, w, h, qx, qy, t, sx, sy, cx, cy, f, SCORE_STEPS, SCORE_REFINE, pt);
        px[k] = pt[0]; py[k] = pt[1];
      }
    }
    let sum = 0;
    for (let y = 0; y < lh; y++) {
      for (let x = 0; x < lw; x++) {
        const k = y * lw + x;
        const nom = (1 - t * pz[k]) / over;
        // np.diff with the last value appended: the last column/row is 0.
        const dx = x < lw - 1 ? Math.abs(px[k + 1] - px[k]) : 0;
        const dy = y < lh - 1 ? Math.abs(py[k + lw] - py[k]) : 0;
        const stretched = dx / (nom / lw) < 0.3 || dy / (nom / lh) < 0.3;
        if (!stretched) continue;
        sum += Math.min(1, Math.max(0, sampleAt(grad, w, h, px[k], py[k]) / 0.12));
      }
    }
    worst = Math.max(worst, sum / (lw * lh));
  }
  return worst * 100;
}

/** Float32 ↔ IEEE half (round to nearest), for compact storage and R16F upload. */
const f32b = new Float32Array(1);
const u32b = new Uint32Array(f32b.buffer);
function toHalf(v: number) {
  f32b[0] = v;
  const x = u32b[0];
  const sign = (x >>> 16) & 0x8000;
  const e = ((x >>> 23) & 0xff) - 127 + 15;
  const m = x & 0x7fffff;
  if (e <= 0) return sign;
  if (e >= 31) return sign | 0x7c00;
  let hv = sign | (e << 10) | (m >>> 13);
  if (m & 0x1000) hv++;
  return hv;
}
function fromHalf(hv: number) {
  const s = hv & 0x8000 ? -1 : 1;
  const e = (hv >> 10) & 0x1f;
  const m = hv & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}
function packHalf(a: Float32Array) {
  const out = new Uint16Array(a.length);
  for (let k = 0; k < a.length; k++) out[k] = toHalf(a[k]);
  return out;
}
function unpackHalf(a: Uint16Array) {
  const out = new Float32Array(a.length);
  for (let k = 0; k < a.length; k++) out[k] = fromHalf(a[k]);
  return out;
}
function minMax(a: Float32Array) {
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < a.length; k++) { const v = a[k]; if (v < lo) lo = v; if (v > hi) hi = v; }
  return [lo, hi];
}

/**
 * Raw model output + the photograph's grey image → everything about the
 * photograph that doesn't depend on the order it plays in (engine2.prepare,
 * engine3.contrast_map).
 */
async function analyse(raw: Float32Array, rw: number, rh: number, grey: Float32Array, w: number, h: number, inferMs: number): Promise<Analysed> {
  const t0 = performance.now();
  // Normalise to 0 (far) .. 1 (near) by the 1st/99th percentile.
  const sorted = Float32Array.from(raw).sort();
  const lo = percentileSorted(sorted, 1), hi = percentileSorted(sorted, 99);
  const span = hi - lo + 1e-6;
  const d0 = new Float32Array(raw.length);
  for (let p = 0; p < raw.length; p++) d0[p] = Math.min(1, Math.max(0, (raw[p] - lo) / span));

  // Rigid map: edges snapped to the photograph's own edges.
  const up = resizeCubic(d0, rw, rh, w, h);
  const radius = Math.max(1, Math.round((GUIDE_RADIUS * Math.max(w, h)) / 960));
  const d = guidedFilter(grey, up, w, h, radius, GUIDE_EPS);
  const invz = new Float32Array(w * h);
  for (let p = 0; p < d.length; p++) {
    d[p] = Math.min(1, Math.max(0, d[p]));
    invz[p] = 1 / FAR + d[p] * (1 - 1 / FAR);
  }

  // Focus: centroid of the deepest 12%, clamped and blended toward centre.
  const ds = Float32Array.from(d).sort();
  const thr = percentileSorted(ds, 12);
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[y * w + x] <= thr) { sx += x; sy += y; n++; }
    }
  }
  let cx = n > 0 ? sx / n / w : 0.5;
  let cy = n > 0 ? sy / n / h : 0.5;
  cx = 0.5 + Math.min(0.18, Math.max(-0.18, cx - 0.5)) * 0.7;
  cy = 0.5 + Math.min(0.12, Math.max(-0.12, cy - 0.5)) * 0.7;

  // f: the median depth — the plane that stays put while the camera slides.
  const zs = Float32Array.from(invz).sort();
  const mid = zs.length >> 1;
  const f = zs.length % 2 ? zs[mid] : (zs[mid - 1] + zs[mid]) / 2;
  const invzHalf = packHalf(invz);
  const [zmin, zmax] = minMax(unpackHalf(invzHalf));
  const guidedMs = performance.now() - t0;

  await yieldToPage();
  const t1 = performance.now();
  const grad = packHalf(contrastMap(grey, w, h));
  const contrastMs = performance.now() - t1;
  return { w, h, cx, cy, f, invz: invzHalf, zmin, zmax, grad, scores: {}, inferMs, guidedMs, contrastMs };
}

/** The gentle move's map: v1's softening (grow near surfaces, then blur) of the snapped depth. */
function softMap(a: Analysed) {
  if (a.soft) return a.soft;
  const { w, h } = a;
  const rigid = unpackHalf(a.invz);
  const d = new Float32Array(w * h);
  for (let p = 0; p < d.length; p++) d[p] = Math.min(1, Math.max(0, (rigid[p] - 1 / FAR) / (1 - 1 / FAR)));
  const kDil = Math.max(3, Math.floor(w * 0.006) | 1);
  const kBlur = Math.max(3, Math.floor(w * 0.012) | 1);
  const soft = gaussianK(dilateRows(d, w, h, ellipseRows(kDil)), w, h, kBlur);
  const invz = new Float32Array(w * h);
  for (let p = 0; p < soft.length; p++) invz[p] = 1 / FAR + soft[p] * (1 - 1 / FAR);
  const half = packHalf(invz);
  const [zmin, zmax] = minMax(unpackHalf(half));
  a.soft = { invz: half, zmin, zmax };
  return a.soft;
}

type Plan = {
  move: MoveName | "gentle";
  mode: "rigid" | "soft";
  sign: 1 | -1;
  push: number;
  slide: number;
  lift: number;
  rev: boolean;
  score: number;
  tried: { move: MoveName; score: number }[];
  candidateMs: { move: MoveName; ms: number }[];
  /** The map the shader marches (rigid or soft) and its overscan. */
  map: Uint16Array;
  over: number;
};

/**
 * engine3.choose: rotate the photograph's order by its turn, skip the move
 * the photograph before it used, and take the first move it can carry at
 * MIN_SCALE or more of full strength. Tear scores are computed only as far
 * down the rotation as needed, and kept.
 */
async function choosePlan(a: Analysed, exterior: boolean, lastMove: string | null, turn: number): Promise<Plan> {
  const base = exterior ? EXTERIOR_ORDER : INTERIOR_ORDER;
  const r = ((turn % base.length) + base.length) % base.length;
  const order = base.slice(r).concat(base.slice(0, r));
  const sign: 1 | -1 = turn % 2 === 0 ? 1 : -1;
  const tried: { move: MoveName; score: number }[] = [];
  const candidateMs: { move: MoveName; ms: number }[] = [];
  let invz: Float32Array | null = null, grad: Float32Array | null = null;
  for (let k = 0; k < order.length; k++) {
    const name = order[k];
    if (name === lastMove) continue;
    const mv = MOVES[name];
    let sc = a.scores[name];
    if (sc === undefined) {
      await yieldToPage();
      if (!invz) invz = unpackHalf(a.invz);
      if (!grad) grad = unpackHalf(a.grad);
      const t0 = performance.now();
      const over = overscan(a.zmin, a.zmax, a.f, a.cx, a.cy, mv.slide, mv.lift);
      sc = tearScore(invz, grad, a.w, a.h, a.cx, a.cy, a.f, over, mv.push, mv.slide, mv.lift);
      candidateMs.push({ move: name, ms: performance.now() - t0 });
      a.scores[name] = sc;
    }
    tried.push({ move: name, score: sc });
    const m = Math.min(1, SCORE_FULL / Math.max(sc, 1e-6));
    if (m >= MIN_SCALE) {
      const slide = mv.slide * m, lift = mv.lift * m;
      return {
        move: name, mode: "rigid", sign, push: mv.push * m, slide, lift, rev: mv.rev, score: sc,
        tried, candidateMs, map: a.invz, over: overscan(a.zmin, a.zmax, a.f, a.cx, a.cy, slide, lift),
      };
    }
  }
  // Nothing clean at strength: the gentle move on the softened map.
  const s = softMap(a);
  const score = tried.length ? Math.min(...tried.map((x) => x.score)) : 0;
  return {
    move: "gentle", mode: "soft", sign, push: SOFT.push, slide: SOFT.slide, lift: SOFT.lift, rev: exterior,
    score, tried, candidateMs, map: s.invz, over: overscan(s.zmin, s.zmax, a.f, a.cx, a.cy, SOFT.slide, SOFT.lift),
  };
}

// ── WebGL ───────────────────────────────────────────────────────────────────

const VERT = `#version 300 es
void main() {
  // One triangle that covers the viewport; no buffers needed.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// The ray march from engine2.march / engine3.render. For each output point
// g, q is g pulled toward the focus by the overscan (so the sideways and
// up/down parts of the move never reach past the photograph's edge). The ray
// is walked from the lens (z = 1) to the far plane; the first depth where the
// surface is at or in front of the ray is the hit, refined by bisection; no
// hit means the far plane. The photograph is sampled where the ray landed.
// Both textures are stored top row first (texture v = 0 is the top of the
// photograph); g is flipped to match because gl_FragCoord counts from the
// bottom.
const FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_photo;
uniform sampler2D u_depth;
uniform vec2 u_size;
uniform vec2 u_c;
uniform float u_t;
uniform vec2 u_s;
uniform float u_f;
uniform float u_over;
out vec4 o;
const float LO_FAR = ${(1 / FAR).toFixed(6)};
vec2 at(vec2 q, float z) {
  return u_c + (q - u_c) * (1.0 - u_t * z) + u_s * (z - u_f);
}
void main() {
  vec2 g = vec2(gl_FragCoord.x / u_size.x, 1.0 - gl_FragCoord.y / u_size.y);
  vec2 q = u_c + (g - u_c) / u_over;
  float lo = LO_FAR;
  float hi = LO_FAR;
  float prev = 1.0;
  for (int k = 0; k <= ${MARCH_STEPS}; k++) {
    float z = 1.0 - (1.0 - LO_FAR) * float(k) / ${MARCH_STEPS}.0;
    if (texture(u_depth, at(q, z)).r >= z) { lo = z; hi = prev; break; }
    prev = z;
  }
  for (int k = 0; k < ${MARCH_REFINE}; k++) {
    float z = (lo + hi) * 0.5;
    if (texture(u_depth, at(q, z)).r >= z) lo = z; else hi = z;
  }
  o = vec4(texture(u_photo, at(q, lo)).rgb, 1.0);
}`;

type Item = Plan & {
  tex: WebGLTexture;
  w: number;
  h: number;
  cx: number;
  cy: number;
  f: number;
  inferMs: number;
  guidedMs: number;
  contrastMs: number;
  cached: boolean;
};

export async function createDepthMotion(): Promise<DepthMotion> {
  const glCanvas = document.createElement("canvas");
  glCanvas.width = 1; glCanvas.height = 1;
  const gl = glCanvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    // The frame is copied out with drawImage straight after drawing; keeping
    // the buffer makes that copy safe whenever it happens.
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error("WebGL2 unavailable");

  let lost = false;
  const onLost = (e: Event) => { e.preventDefault(); lost = true; };
  glCanvas.addEventListener("webglcontextlost", onLost);

  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(`shader: ${log}`);
    }
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(prog)}`);
  const vao = gl.createVertexArray();
  const loc = {
    photo: gl.getUniformLocation(prog, "u_photo"),
    depth: gl.getUniformLocation(prog, "u_depth"),
    size: gl.getUniformLocation(prog, "u_size"),
    c: gl.getUniformLocation(prog, "u_c"),
    t: gl.getUniformLocation(prog, "u_t"),
    s: gl.getUniformLocation(prog, "u_s"),
    f: gl.getUniformLocation(prog, "u_f"),
    over: gl.getUniformLocation(prog, "u_over"),
  };
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

  const items = new Map<number, Item>();
  // Photo textures, most recently used last. Keyed by item and by bitmap, so
  // a different bitmap for the same item (a re-render) is uploaded afresh.
  const photoTex = new Map<number, { tex: WebGLTexture; bmp: ImageBitmap }>();
  // Output canvases by item, most recently used last.
  const pool = new Map<number, HTMLCanvasElement>();
  let disposed = false;

  const makeTex = () => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };

  // Depth textures are kept for every prepared photograph: a 960px map is
  // ~1.0–1.2 MB in R16F, so a 40-photo Long reel holds ~40–50 MB of them.
  const uploadDepth = (i: number, a: Analysed, plan: Plan, cached: boolean) => {
    const old = items.get(i);
    if (old) gl.deleteTexture(old.tex);
    const tex = makeTex();
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    // R16F is filterable in core WebGL2.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, a.w, a.h, 0, gl.RED, gl.HALF_FLOAT, plan.map);
    items.set(i, {
      ...plan, tex, w: a.w, h: a.h, cx: a.cx, cy: a.cy, f: a.f,
      inferMs: cached ? 0 : a.inferMs, guidedMs: cached ? 0 : a.guidedMs, contrastMs: cached ? 0 : a.contrastMs,
      cached: cached && plan.candidateMs.length === 0,
    });
  };

  const photoTexture = (i: number, bmp: ImageBitmap): WebGLTexture => {
    const hit = photoTex.get(i);
    if (hit && hit.bmp === bmp) {
      photoTex.delete(i); photoTex.set(i, hit);
      return hit.tex;
    }
    if (hit) { gl.deleteTexture(hit.tex); photoTex.delete(i); }
    while (photoTex.size >= PHOTO_TEX_MAX) {
      const oldest = photoTex.keys().next().value;
      if (oldest === undefined) break;
      gl.deleteTexture(photoTex.get(oldest)!.tex);
      photoTex.delete(oldest);
    }
    const tex = makeTex();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    photoTex.set(i, { tex, bmp });
    return tex;
  };

  const outCanvas = (i: number, w: number, h: number) => {
    let c = pool.get(i);
    if (c) {
      pool.delete(i);
    } else {
      // Recycle the least recently used canvas. With three in the pool, the
      // canvas handed out for photo A stays A's while B (and a third) are
      // drawn — a crossfade only ever needs two at once.
      if (pool.size >= CANVAS_POOL_MAX) {
        const oldest = pool.keys().next().value as number;
        c = pool.get(oldest)!;
        pool.delete(oldest);
      } else {
        c = document.createElement("canvas");
      }
    }
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    pool.set(i, c);
    return c;
  };

  /** Draw bmp at w×h (high-quality smoothing) and read its pixels back. */
  const pixels = (bmp: ImageBitmap, w: number, h: number) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    c.width = 0; c.height = 0;
    return img.data;
  };

  return {
    async prepare(i, cacheKey, bmp, opts) {
      try {
        if (disposed || lost) return null;
        const short = Math.max(14, Math.round((opts?.inputShort ?? INPUT_SHORT) / 14) * 14);
        const key = `${ENGINE_VERSION}|${cacheKey}|${short}`;
        let a = cacheGet(key);
        const cached = !!a;
        if (!a) {
          const aspect = bmp.width / bmp.height;
          const iw = aspect >= 1 ? Math.max(14, Math.round((aspect * short) / 14) * 14) : short;
          const ih = aspect >= 1 ? short : Math.max(14, Math.round((short / aspect) / 14) * 14);
          const rgba = pixels(bmp, iw, ih);
          if (!rgba) return null;
          const t0 = performance.now();
          const res = await inferDepth(rgba, iw, ih);
          const inferMs = performance.now() - t0;
          if (!res || disposed) return null;
          await yieldToPage();
          // The photograph's grey image at the map's size guides the edges
          // and weighs the tear score (cv2's BGR2GRAY weights).
          const mw = aspect >= 1 ? MAP_LONG : Math.max(8, Math.round(MAP_LONG * aspect));
          const mh = aspect >= 1 ? Math.max(8, Math.round(MAP_LONG / aspect)) : MAP_LONG;
          const px = pixels(bmp, mw, mh);
          if (!px) return null;
          const grey = new Float32Array(mw * mh);
          for (let p = 0, q = 0; p < grey.length; p++, q += 4) {
            grey[p] = (0.299 * px[q] + 0.587 * px[q + 1] + 0.114 * px[q + 2]) / 255;
          }
          a = await analyse(res.depth, res.width, res.height, grey, mw, mh, inferMs);
          cacheSet(key, a);
        }
        const plan = await choosePlan(a, !!opts?.exterior, opts?.lastMove ?? null, opts?.turn ?? 0);
        if (disposed || lost || gl.isContextLost()) return null;
        uploadDepth(i, a, plan, cached);
        return plan.move;
      } catch {
        return null;
      }
    },

    frame(i, bmp, u) {
      try {
        if (disposed || lost || gl.isContextLost()) return null;
        const it = items.get(i);
        if (!it) return null;
        const w = bmp.width, h = bmp.height;
        if (!w || !h || w > maxTex || h > maxTex) return null;
        // The GL canvas only ever grows: a crossfade between a landscape and
        // a portrait would otherwise reallocate it twice every frame. Each
        // photograph is drawn into the bottom-left w×h of it (GL's origin),
        // which is rows H−h..H from the top when it is copied out below.
        if (glCanvas.width < w || glCanvas.height < h) {
          glCanvas.width = Math.max(glCanvas.width, w);
          glCanvas.height = Math.max(glCanvas.height, h);
        }
        let uu = Math.min(1, Math.max(0, u));
        // A reversed move (pull_arc, an exterior's gentle move) plays backwards.
        if (it.rev) uu = 1 - uu;
        const tp = photoTexture(i, bmp);
        gl.viewport(0, 0, w, h);
        gl.useProgram(prog);
        gl.bindVertexArray(vao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tp);
        gl.uniform1i(loc.photo, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, it.tex);
        gl.uniform1i(loc.depth, 1);
        gl.uniform2f(loc.size, w, h);
        gl.uniform2f(loc.c, it.cx, it.cy);
        gl.uniform1f(loc.t, it.push * uu);
        gl.uniform2f(loc.s, it.slide * it.sign * (uu - 0.5), it.lift * (uu - 0.5));
        gl.uniform1f(loc.f, it.f);
        gl.uniform1f(loc.over, it.over);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (gl.isContextLost()) return null;
        const out = outCanvas(i, w, h);
        const ctx = out.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(glCanvas, 0, glCanvas.height - h, w, h, 0, 0, w, h);
        return out;
      } catch {
        return null;
      }
    },

    info(i) {
      const it = items.get(i);
      if (!it) return null;
      return {
        move: it.move, mode: it.mode, sign: it.sign, push: it.push, slide: it.slide, lift: it.lift,
        rev: it.rev, score: it.score, tried: it.tried.slice(),
        inferMs: it.inferMs, guidedMs: it.guidedMs, contrastMs: it.contrastMs,
        candidateMs: it.candidateMs.slice(), cached: it.cached,
      };
    },

    debugBounds(i) {
      const it = items.get(i);
      if (!it) return NaN;
      const m = unpackHalf(it.map);
      const pt = new Float32Array(2);
      let worst = -Infinity;
      for (const u of [0, 1]) {
        const t = it.push * u, sx = it.slide * it.sign * (u - 0.5), sy = it.lift * (u - 0.5);
        for (let y = 0; y < it.h; y++) {
          const qy = it.cy + ((y + 0.5) / it.h - it.cy) / it.over;
          for (let x = 0; x < it.w; x++) {
            const qx = it.cx + ((x + 0.5) / it.w - it.cx) / it.over;
            marchPoint(m, it.w, it.h, qx, qy, t, sx, sy, it.cx, it.cy, it.f, MARCH_STEPS, MARCH_REFINE, pt);
            worst = Math.max(worst, -pt[0], pt[0] - 1, -pt[1], pt[1] - 1);
          }
        }
      }
      return worst;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        if (!gl.isContextLost()) {
          items.forEach((it) => gl.deleteTexture(it.tex));
          photoTex.forEach((p) => gl.deleteTexture(p.tex));
          gl.deleteProgram(prog);
          if (vao) gl.deleteVertexArray(vao);
        }
      } catch { /* context already gone */ }
      items.clear();
      photoTex.clear();
      pool.forEach((c) => { c.width = 0; c.height = 0; });
      pool.clear();
      glCanvas.removeEventListener("webglcontextlost", onLost);
      try { gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* fine */ }
      glCanvas.width = 0; glCanvas.height = 0;
      // The worker and the depth cache are kept for the page's lifetime, so
      // "Make it again" on the same photographs doesn't re-run the model.
    },
  };
}
