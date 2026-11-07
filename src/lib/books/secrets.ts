/**
 * Billing secrets at rest (the PayPal client secret). AES-256-GCM with a key
 * from the Vercel env var BILLING_SECRETS_KEY — 32 random bytes, base64
 * (generate with `openssl rand -base64 32`). Stored as
 * "v1:<iv>:<tag>:<ciphertext>", each part base64. Server only.
 *
 * Never log a secret, a decrypted value or the key. If the key is missing the
 * caller refuses to save (503) — nothing is ever stored unencrypted.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

export const SECRETS_KEY_MISSING = "BILLING_SECRETS_KEY is not set on Vercel";

function key(): Buffer | null {
  const raw = process.env.BILLING_SECRETS_KEY;
  if (!raw) return null;
  try {
    const k = Buffer.from(raw.trim(), "base64");
    return k.length === 32 ? k : null;
  } catch {
    return null;
  }
}

/** True when BILLING_SECRETS_KEY is set and decodes to 32 bytes. */
export function secretsKeyConfigured(): boolean {
  return key() !== null;
}

/** Encrypt a secret; null when the key isn't configured. */
export function encryptSecret(plain: string): string | null {
  const k = key();
  if (!k) return null;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

/** Decrypt a stored secret; null when the key is missing, wrong, or the value is damaged. */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const k = key();
  if (!k) return null;
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const d = createDecipheriv("aes-256-gcm", k, Buffer.from(parts[1], "base64"));
    d.setAuthTag(Buffer.from(parts[2], "base64"));
    return Buffer.concat([d.update(Buffer.from(parts[3], "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
