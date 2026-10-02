/**
 * The transition vocabulary — how one frame gives way to the next.
 *
 * A high-end short-form edit never uses the same cut twice in a row. It has
 * a vocabulary — whip, push, wipe, zoom-through, flash, a quick dissolve, a
 * dip — and deals from it so the eye can't predict the next move. Every
 * transition here is drawn on a 2D canvas from two callbacks (the outgoing
 * frame and the incoming one), so it works the same for a single photograph,
 * a stack run, or the end card.
 *
 * The quiet looks (Editorial, Cinematic, Gallery, Classic) don't use this —
 * they dissolve, every time, on purpose. Restraint is their vocabulary.
 */

export type TransitionType =
  | "cut"       // hard cut, no frame between
  | "dissolve"  // quick crossfade
  | "flash"     // hard cut under a white flash
  | "whip"      // both frames rush sideways under a motion smear
  | "push"      // incoming shoves the outgoing off, no blur
  | "wipe"      // hard-edged reveal with a thin light seam
  | "zoom"      // outgoing blows up and fades, incoming settles in from large
  | "dip"       // dip through the ground colour
  | "softwipe"; // feathered wipe, both frames visible across a soft edge (Underway)

export type Dir = "left" | "right" | "up" | "down" | "diag";

export type Transition = {
  type: TransitionType;
  dur: number;
  dir: Dir;
  /**
   * Underway's curves, taken from the sample Charlie approved: a smoothstep
   * dissolve, and a dip that is fully out by 45% and comes back from 55%
   * (a beat of pure ground between rooms). Left out, the curves above.
   */
  timing?: "smooth";
};

/** A weighted entry in a look's vocabulary. */
type Entry = { type: TransitionType; weight: number; dur: number };

/**
 * Energy: fast but never the same twice. Whips and pushes carry the speed;
 * wipes and zoom-throughs give it shape; the flash is a punctuation mark,
 * not a habit; the quick dissolve is the breath between.
 */
export const ENERGY_VOCAB: Entry[] = [
  { type: "whip", weight: 22, dur: 0.30 },
  { type: "push", weight: 14, dur: 0.34 },
  { type: "wipe", weight: 18, dur: 0.36 },
  { type: "zoom", weight: 16, dur: 0.40 },
  { type: "flash", weight: 10, dur: 0.0 },
  { type: "dissolve", weight: 14, dur: 0.32 },
  { type: "dip", weight: 6, dur: 0.44 },
];

/**
 * Stack: the same family, leaning on the moves that suit a frame changing
 * shape. No flash — Charlie took the strobe out of the Stack altogether;
 * the boat is meant to be seen.
 */
export const STACK_VOCAB: Entry[] = [
  { type: "whip", weight: 22, dur: 0.30 },
  { type: "push", weight: 20, dur: 0.34 },
  { type: "wipe", weight: 22, dur: 0.36 },
  { type: "zoom", weight: 14, dur: 0.40 },
  { type: "dissolve", weight: 16, dur: 0.30 },
  { type: "dip", weight: 6, dur: 0.44 },
];

/** Tiny deterministic generator — same boat, same photos, same film. */
export function seededRandom(seed: number) {
  let x = (seed * 2654435761 + 12345) >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
}

/**
 * Deal `count` transitions from a vocabulary: weighted, never the same type
 * twice running, and directional moves alternate so the film doesn't drift
 * one way. `fixed` pins particular slots (a burst is always flash cuts).
 */
export function dealTransitions(
  count: number,
  vocab: Entry[],
  seed: number,
  fixed: Record<number, Transition> = {},
): Transition[] {
  const rand = seededRandom(seed);
  const total = vocab.reduce((a, e) => a + e.weight, 0);
  const out: Transition[] = [];
  let lastType: TransitionType | null = null;
  let lastDir: Dir = "right";
  const sideways: Dir[] = ["left", "right"];
  for (let i = 0; i < count; i++) {
    const pinned = fixed[i];
    if (pinned) { out.push(pinned); lastType = pinned.type; continue; }
    let pick: Entry | null = null;
    for (let tries = 0; tries < 8 && (!pick || pick.type === lastType); tries++) {
      let r = rand() * total;
      pick = vocab[vocab.length - 1];
      for (const e of vocab) { r -= e.weight; if (r <= 0) { pick = e; break; } }
    }
    const e = pick!;
    let dir: Dir = "left";
    if (e.type === "whip" || e.type === "push") {
      // Alternate the sideways moves; the occasional vertical push.
      dir = e.type === "push" && rand() < 0.3 ? (rand() < 0.5 ? "up" : "down")
        : sideways[(sideways.indexOf(lastDir) + 1) % 2];
      if (dir === "left" || dir === "right") lastDir = dir;
    } else if (e.type === "wipe") {
      const r = rand();
      dir = r < 0.4 ? "diag" : r < 0.7 ? "left" : "up";
    }
    out.push({ type: e.type, dur: e.dur, dir });
    lastType = e.type;
  }
  return out;
}

/** Ease-out — fast off the line, settles. */
export const easeOut = (p: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);
/** Smoothstep — Underway's dissolve and soft wipe. */
export const smoothstep = (p: number) => { const x = Math.min(1, Math.max(0, p)); return x * x * (3 - 2 * x); };
/** Ease in-out — for wipes and dissolves. */
export const easeInOut = (p: number) => { const x = Math.min(1, Math.max(0, p)); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };

type Draw = (alpha: number) => void;

/**
 * Draw one transition frame. `p` runs 0→1 across the transition; `a` is the
 * outgoing frame, `b` the incoming. Both callbacks draw the WHOLE frame at
 * the alpha they're given, so this only has to arrange them.
 *
 * `disjoint` says the two frames do NOT cover the same pixels — one or both
 * is a photograph placed in a third of the frame rather than filling it. It
 * only matters to the dissolve, and it matters a lot: see the case below.
 */
export function drawTransition(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  tr: Transition,
  p: number,
  ground: string,
  a: Draw,
  b: Draw,
  disjoint = false,
  /**
   * A canvas the size of the frame, for the soft wipe (it holds the outgoing
   * frame while the incoming one is drawn). The caller owns and releases it;
   * without one, a soft wipe falls back to a dissolve.
   */
  scratch?: HTMLCanvasElement | null,
) {
  const sc = Math.min(W, H) / 1080;
  switch (tr.type) {
    case "cut":
    case "flash":
      b(1);
      return;

    case "dissolve": {
      const e = tr.timing === "smooth" ? smoothstep(p) : easeInOut(p);
      if (disjoint) {
        // The two photographs are in different parts of the frame, so the
        // incoming one cannot cover the outgoing one as it arrives. Drawn the
        // usual way the outgoing would sit at full strength for the whole
        // transition and then vanish on one frame — which reads as the new
        // photo appearing and only THEN the old one leaving. Both have to
        // move at once: one fades down while the other fades up, each against
        // the ground. They don't overlap, so there is no double-exposure to
        // worry about.
        a(1 - e);
        b(e);
        return;
      }
      // Full-frame to full-frame: the incoming photograph is painted over the
      // outgoing one at rising alpha, which composites to a true cross-fade
      // with no ground showing through the middle.
      a(1);
      b(e);
      return;
    }

    case "dip": {
      if (tr.timing === "smooth") {
        // Underway: the outgoing frame is gone by 45%, the incoming one
        // starts at 55% — a breath of pure ground between outside and inside.
        ctx.fillStyle = ground; ctx.fillRect(0, 0, W, H);
        if (p < 0.5) a(Math.max(0, 1 - 2.2 * p));
        else b(Math.max(0, 2.2 * p - 1.2));
        return;
      }
      // Through the ground: out by the halfway point, in from it.
      if (p < 0.5) { a(1); ctx.save(); ctx.globalAlpha = easeInOut(p * 2); ctx.fillStyle = ground; ctx.fillRect(0, 0, W, H); ctx.restore(); }
      else { ctx.fillStyle = ground; ctx.fillRect(0, 0, W, H); b(easeInOut((p - 0.5) * 2)); }
      return;
    }

    case "whip":
    case "push": {
      const e = easeOut(p);
      const horiz = tr.dir === "left" || tr.dir === "right";
      const sign = tr.dir === "left" || tr.dir === "up" ? -1 : 1;
      const span = horiz ? W : H;
      const shiftA = sign * span * e;
      const shiftB = shiftA - sign * span;
      // The whip smears along the axis of travel — three copies, spread by
      // how fast the frame is moving right now.
      const smear = tr.type === "whip" ? 70 * sc * Math.sin(Math.PI * p) : 0;
      const place = (shift: number, draw: Draw) => {
        const dx = horiz ? shift : 0, dy = horiz ? 0 : shift;
        if (smear > 0.5) {
          const sx = horiz ? smear : 0, sy = horiz ? 0 : smear;
          ctx.save(); ctx.translate(dx - sx, dy - sy); draw(0.35); ctx.restore();
          ctx.save(); ctx.translate(dx + sx, dy + sy); draw(0.35); ctx.restore();
          ctx.save(); ctx.translate(dx, dy); draw(0.5); ctx.restore();
        } else {
          ctx.save(); ctx.translate(dx, dy); draw(1); ctx.restore();
        }
      };
      ctx.fillStyle = ground; ctx.fillRect(0, 0, W, H);
      place(shiftA, a);
      place(shiftB, b);
      return;
    }

    case "wipe": {
      const e = easeInOut(p);
      a(1);
      ctx.save();
      ctx.beginPath();
      if (tr.dir === "diag") {
        // A diagonal edge sweeping from the top-left; the reveal region is
        // everything above-left of the line.
        const reach = (W + H) * e;
        ctx.moveTo(0, 0); ctx.lineTo(reach, 0); ctx.lineTo(0, reach); ctx.closePath();
      } else if (tr.dir === "up") {
        ctx.rect(0, H * (1 - e), W, H * e);
      } else {
        ctx.rect(0, 0, W * e, H);
      }
      ctx.clip();
      b(1);
      ctx.restore();
      // A thin light seam on the edge — the detail that makes a wipe read
      // as a cut, not a glitch.
      if (p > 0.02 && p < 0.98) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = Math.max(1.5, 2.5 * sc);
        ctx.beginPath();
        if (tr.dir === "diag") { const reach = (W + H) * e; ctx.moveTo(reach, 0); ctx.lineTo(0, reach); }
        else if (tr.dir === "up") { const y = H * (1 - e); ctx.moveTo(0, y); ctx.lineTo(W, y); }
        else { const x = W * e; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
        ctx.stroke();
        ctx.restore();
      }
      return;
    }

    case "softwipe": {
      // The incoming frame is revealed behind a feathered edge that travels
      // across the frame ("right": left to right). The edge is 22% of the
      // width, its profile and its travel both smoothstepped. Drawn as: the
      // outgoing frame copied aside, the incoming frame drawn in full, then
      // the outgoing laid back over it through a gradient that is opaque
      // ahead of the edge and clear behind it.
      if (!scratch) { a(1); b(smoothstep(p)); return; }
      const sctx = scratch.getContext("2d");
      if (!sctx) { a(1); b(smoothstep(p)); return; }
      if (scratch.width !== W || scratch.height !== H) { scratch.width = W; scratch.height = H; }
      const F = 0.22;
      const e = smoothstep(p);
      a(1);
      sctx.globalCompositeOperation = "copy";
      sctx.drawImage(ctx.canvas, 0, 0);
      b(1);
      // m(x) = smoothstep(clamp((e(1+F) − x) / F)) is how much of the incoming
      // frame shows at x; the outgoing frame is kept at 1 − m(x).
      const x1 = e * (1 + F), x0 = x1 - F;
      const rightward = tr.dir !== "left";
      const g = rightward
        ? sctx.createLinearGradient(x0 * W, 0, x1 * W, 0)
        : sctx.createLinearGradient((1 - x0) * W, 0, (1 - x1) * W, 0);
      const STOPS = 16;
      for (let k = 0; k <= STOPS; k++) {
        const s = k / STOPS;               // 0 at x0 (fully incoming) .. 1 at x1
        const m = smoothstep(1 - s);
        g.addColorStop(s, `rgba(0,0,0,${(1 - m).toFixed(4)})`);
      }
      sctx.globalCompositeOperation = "destination-in";
      sctx.fillStyle = g;
      sctx.fillRect(0, 0, W, H);
      sctx.globalCompositeOperation = "source-over";
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.drawImage(scratch, 0, 0);
      ctx.restore();
      return;
    }

    case "zoom": {
      // Zoom-through: the outgoing frame blows up and fades; the incoming
      // one arrives large and settles to size beneath it.
      const e = easeInOut(p);
      const kA = 1 + 0.35 * e;
      const kB = 1.18 - 0.18 * e;
      ctx.fillStyle = ground; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(kB, kB); ctx.translate(-W / 2, -H / 2); b(1); ctx.restore();
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(kA, kA); ctx.translate(-W / 2, -H / 2); a(1 - e); ctx.restore();
      return;
    }
  }
}
