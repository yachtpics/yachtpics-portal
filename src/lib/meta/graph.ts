import { createHmac } from "crypto";
import { GRAPH_BASE, metaAppSecret } from "./config";

/** A Graph API error, with Meta's message kept for the UI / social_posts.error. */
export class GraphError extends Error {
  status: number;
  code: number | null;
  subcode: number | null;
  constructor(message: string, status: number, code: number | null = null, subcode: number | null = null) {
    super(message);
    this.name = "GraphError";
    this.status = status;
    this.code = code;
    this.subcode = subcode;
  }
}

type Params = Record<string, string | number | boolean | undefined | null>;

/** appsecret_proof — Meta's recommended guard on server-side calls with a user/page token. */
function proof(token: string): string | null {
  const secret = metaAppSecret();
  return secret ? createHmac("sha256", secret).update(token).digest("hex") : null;
}

function toSearch(params: Params, token?: string): URLSearchParams {
  const q = new URLSearchParams();
  Object.keys(params).forEach((k) => {
    const v = params[k];
    if (v !== undefined && v !== null) q.set(k, String(v));
  });
  if (token) {
    q.set("access_token", token);
    const p = proof(token);
    if (p && !token.includes("|")) q.set("appsecret_proof", p);
  }
  return q;
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok || (body && typeof body === "object" && "error" in (body as Record<string, unknown>))) {
    const err = ((body as { error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string } } | null)?.error) ?? {};
    const msg = err.error_user_msg || err.message || `Meta returned ${res.status}.`;
    throw new GraphError(msg, res.status, err.code ?? null, err.error_subcode ?? null);
  }
  return body as T;
}

/** GET {GRAPH_BASE}/{path}. `path` has no leading slash. */
export async function graphGet<T>(path: string, params: Params = {}, token?: string): Promise<T> {
  const res = await fetch(`${GRAPH_BASE}/${path}?${toSearch(params, token)}`, { cache: "no-store" });
  return parse<T>(res);
}

/** POST {GRAPH_BASE}/{path} with form-encoded params. */
export async function graphPost<T>(path: string, params: Params = {}, token?: string): Promise<T> {
  const res = await fetch(`${GRAPH_BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: toSearch(params, token),
    cache: "no-store",
  });
  return parse<T>(res);
}

/**
 * POST {GRAPH_BASE}/{path} as multipart/form-data — for endpoints that take a
 * file upload (a video's cover image). The token and appsecret_proof ride in
 * the form like any other field. No Content-Type header is set on purpose:
 * fetch writes the multipart boundary itself, and a hand-set one breaks it.
 */
export async function graphPostForm<T>(path: string, form: FormData, token?: string): Promise<T> {
  if (token) {
    form.set("access_token", token);
    const p = proof(token);
    if (p && !token.includes("|")) form.set("appsecret_proof", p);
  }
  const res = await fetch(`${GRAPH_BASE}/${path}`, { method: "POST", body: form, cache: "no-store" });
  return parse<T>(res);
}

export async function graphDelete<T>(path: string, params: Params = {}, token?: string): Promise<T> {
  const res = await fetch(`${GRAPH_BASE}/${path}?${toSearch(params, token)}`, { method: "DELETE", cache: "no-store" });
  return parse<T>(res);
}

/** Raw fetch with Graph-style error handling (for rupload). */
export async function metaFetch<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  return parse<T>(res);
}

export function graphErrorMessage(e: unknown): string {
  if (e instanceof GraphError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
