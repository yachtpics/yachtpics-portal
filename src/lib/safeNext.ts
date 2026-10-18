/**
 * Validate a post-sign-in return path ("?next=").
 *
 * Only same-site relative paths are allowed: must start with a single "/",
 * never "//" (protocol-relative), never a backslash (browsers treat "\" like
 * "/"), never ":" (schemes). Anything else returns null and the caller falls
 * back to its usual destination. Safe to use in middleware, server routes and
 * client components.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  if (raw.length > 2000) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw.includes("\\") || raw.includes(":")) return null;
  // Control characters (incl. CR/LF and tab) have no business in a path.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  return raw;
}
