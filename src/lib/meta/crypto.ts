import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * AES-256-GCM for Meta tokens at rest (and the short-lived "pick a Page"
 * cookie). Key: SOCIAL_TOKEN_KEY, 32 random bytes, base64.
 *
 * Format: "v1.<iv>.<tag>.<ciphertext>", each part base64url.
 * Server-only — never import from a client component.
 */

function key(): Buffer {
  const raw = process.env.SOCIAL_TOKEN_KEY;
  if (!raw) throw new Error("SOCIAL_TOKEN_KEY is not set.");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("SOCIAL_TOKEN_KEY must be 32 bytes, base64-encoded.");
  return k;
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptToken(sealed: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Unrecognised token format.");
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const ct = Buffer.from(parts[3], "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function sealJson(value: unknown): string {
  return encryptToken(JSON.stringify(value));
}

/** null when missing, tampered with, or sealed under another key. */
export function openJson<T>(sealed: string | undefined | null): T | null {
  if (!sealed) return null;
  try {
    return JSON.parse(decryptToken(sealed)) as T;
  } catch {
    return null;
  }
}
