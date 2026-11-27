import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { googleClientSecret } from "./config";

/**
 * AES-256-GCM for the YouTube tokens at rest — the same scheme and format as
 * the Meta tokens (src/lib/meta/crypto.ts: "v1.<iv>.<tag>.<ciphertext>",
 * base64url), with its own key.
 *
 * Key: SHA-256 of a fixed label + GOOGLE_OAUTH_CLIENT_SECRET, so the feature
 * needs no third env var. A refresh token is useless without that secret
 * anyway; the encryption keeps a database export or the SQL editor from
 * showing a usable token. If the client secret is ever replaced, the stored
 * tokens can't be opened: the channel shows "needs reconnecting" and is
 * connected again.
 *
 * Server only — never import from a client component.
 */

function key(): Buffer {
  const secret = googleClientSecret();
  if (!secret) throw new Error("GOOGLE_OAUTH_CLIENT_SECRET is not set.");
  return createHash("sha256").update(`yachtpics-youtube-token-key-v1:${secret}`).digest();
}

export function sealYouTubeToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

/** null when missing, tampered with, or sealed under another key. */
export function openYouTubeToken(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  try {
    const parts = sealed.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(parts[1], "base64url"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
