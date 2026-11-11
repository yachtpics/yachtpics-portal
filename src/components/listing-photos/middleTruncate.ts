/**
 * Shorten a file name in the MIDDLE so both ends stay readable:
 * "41_bahama_tower_02.jpg" → "41_bahama_to…r_02.jpg". The tail keeps the
 * extension plus a few characters before it (usually the frame number).
 * Returns the name unchanged when it already fits.
 */
export function middleTruncate(name: string, max: number): string {
  if (name.length <= max || max < 5) return name;
  const dot = name.lastIndexOf(".");
  const extLen = dot > 0 ? name.length - dot : 0;
  const room = max - 1; // one character for the ellipsis
  const tail = Math.min(room - 2, Math.max(extLen + 4, Math.floor(room * 0.4)));
  const head = room - tail;
  return name.slice(0, head) + "…" + name.slice(name.length - tail);
}
