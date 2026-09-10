/**
 * Small canvas typography helpers shared by the Social Post and Listing Reel
 * renderers. A 2D context has no reliable letter-spacing across browsers, so
 * tracked caps are drawn a glyph at a time.
 */

export function trackedWidth(ctx: CanvasRenderingContext2D, text: string, track: number) {
  let total = 0;
  for (const ch of text) total += ctx.measureText(ch).width + track;
  return total - track;
}

/** Draw tracked text centred on `cx`. */
export function fillTrackedCentered(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  track: number
) {
  let x = cx - trackedWidth(ctx, text, track) / 2;
  for (const ch of text) {
    ctx.fillText(ch, x, y);
    x += ctx.measureText(ch).width + track;
  }
}

/** Draw tracked text starting at `x` (left-aligned). */
export function fillTrackedLeft(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  track: number
) {
  for (const ch of text) {
    ctx.fillText(ch, x, y);
    x += ctx.measureText(ch).width + track;
  }
}

/**
 * Word-wrap TRACKED text against the current ctx.font. `wrapLines` measures
 * without tracking, so a wide-tracked caps line it thinks fits can still run
 * off both edges — the builder line on an end card was the first casualty.
 */
export function wrapTracked(ctx: CanvasRenderingContext2D, text: string, maxW: number, track: number): string[] {
  if (trackedWidth(ctx, text, track) <= maxW) return [text];
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && trackedWidth(ctx, candidate, track) > maxW) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Greedy word-wrap against the current ctx.font. */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  if (ctx.measureText(text).width <= maxW) return [text];
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && ctx.measureText(`${line} ${word}`).width > maxW) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Fetch → blob → ImageBitmap. Keeps the canvas untainted so it can be exported. */
export async function loadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image failed to load (${res.status})`);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

/** Smoothstep — gentle ease for fades and drifts. */
export function ease(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}
